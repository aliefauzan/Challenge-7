// The content script's work, kept apart from main.js so tests can run it
// with a fake API and DOM.
//
// Top frame: scan the page, decide the tier, render it, report the verdict,
// and keep watching (late text, frame signals, in-page navigation, prefs).
// Sub-frame: scan text only and forward signals to the top frame.
import { compileRules, validatePayload } from "../engine/ruleset.js";
import { scanText } from "../engine/text.js";
import { decideTier } from "../engine/tier.js";
import { parseHttpUrl } from "../engine/url.js";
import { createFlags } from "./flags.js";
import { scanPage, createRescanner } from "./scan.js";
import { createRoot } from "../ui/shadow.js";
import { scamBanner, biasBanner } from "../ui/banner.js";
import { blocker, lockScroll } from "../ui/blocker.js";

const RULESET_KEY = "tm.ruleset";
const PREFS_KEY = "tm.prefs";
const DEFAULT_PREFS = { scam: true, bias: true, social: true };
const URL_POLL_MS = 1000;

const pageKey = (href) => href.split("#")[0];
const signalKey = (s) => `${s.id}|${s.frameUrl ?? ""}`;

async function loadRules(api) {
  const payload = (await api.storage.local.get(RULESET_KEY))[RULESET_KEY];
  if (!payload || !validatePayload(payload).ok) return null;
  return compileRules(payload).rules;
}

async function loadPrefs(api) {
  try {
    return { ...DEFAULT_PREFS, ...((await api.storage.sync.get(PREFS_KEY))[PREFS_KEY] ?? {}) };
  } catch {
    return { ...DEFAULT_PREFS }; // sync storage unavailable
  }
}

function readText(doc) {
  return doc.body?.innerText ?? "";
}

/** The story headline on article pages, else "". */
function articleHeadline(doc) {
  const meta = (p) => doc.querySelector(`meta[property="${p}"]`)?.getAttribute("content") ?? "";
  const isArticle = meta("og:type") === "article" || Boolean(doc.querySelector("article"));
  if (!isArticle) return "";
  return (meta("og:title") || doc.querySelector("h1")?.textContent || "").trim();
}

/**
 * @param {{api: object, win: Window, now?: () => number}} env
 */
export async function startContent({ api, win, now = () => Date.now() }) {
  const doc = win.document;
  const isTop = win.top === win;
  if (!parseHttpUrl(win.location.href)) return { root: null };
  let rules = await loadRules(api);
  if (!rules) return { root: null };

  if (!isTop) return startSubFrame({ api, win, now, rules });

  const flags = createFlags(api);
  const root = createRoot({ doc, MutationObserver: win.MutationObserver });
  let prefs = await loadPrefs(api);
  let href = win.location.href;
  let domain = "";
  let dismissed = false;
  let bypassed = false;
  let frameSignals = new Map(); // frameUrl → Signal[]
  let shownKey = "";
  let sentKey = "";
  let unlockScroll = null;
  let rescanner = null;
  let current = null;

  const contentApi = { root, get verdict() { return current; } };

  function render(verdict) {
    const key = `${verdict.tier}|${verdict.signals.map(signalKey).join(",")}`;
    if (key === shownKey) return;
    shownKey = key;
    unlockScroll?.();
    unlockScroll = null;
    if (verdict.tier === "clean") return root.clear();
    if (verdict.tier === "block" || verdict.tier === "block-bypass") {
      const view = blocker(verdict, {
        onBack: () => (win.history.length > 1 ? win.history.back() : win.location.replace("about:blank")),
        onBypass: () => onFlag("bypass"),
      });
      root.mount(view.node);
      unlockScroll = lockScroll(doc);
      view.focus();
      return;
    }
    const onDismiss = () => onFlag("dismiss");
    root.mount(verdict.tier === "bias" ? biasBanner(verdict, { headline: articleHeadline(doc), onDismiss }) : scamBanner(verdict, { onDismiss }));
  }

  async function report(verdict) {
    const key = `${href}|${verdict.tier}|${verdict.signals.map(signalKey).join(",")}`;
    if (key === sentKey) return;
    sentKey = key;
    try {
      await api.runtime.sendMessage({ type: "verdict", verdict });
    } catch {
      // Background unavailable; the popup will show no verdict for this tab.
    }
  }

  /** Scan, decide, render and report. Returns the tier. */
  async function evaluate(text = readText(doc)) {
    const page = scanPage({ href, text, rules });
    domain = page.domain;
    const seen = new Set(page.signals.map(signalKey));
    const extra = [...frameSignals.values()].flat().filter((s) => !seen.has(signalKey(s)) && seen.add(signalKey(s)));
    current = decideTier([...page.signals, ...extra], {
      domain,
      knownDomain: page.knownDomain,
      prefs,
      dismissed,
      bypassed,
      source: page.source,
      blockHighCount: rules.thresholds.block_high_count,
    });
    render(current);
    await report(current);
    return current.tier;
  }

  async function onFlag(kind) {
    if (kind === "dismiss") dismissed = true;
    else bypassed = true;
    await evaluate();
    await flags.setFlag(kind, domain);
  }

  async function loadFlags() {
    const reg = scanPage({ href, text: "", rules }).domain;
    [dismissed, bypassed] = await Promise.all([flags.getFlag("dismiss", reg), flags.getFlag("bypass", reg)]);
  }

  async function startPage() {
    rescanner?.stop();
    frameSignals = new Map();
    await loadFlags();
    const tier = await evaluate();
    rescanner = createRescanner({ win, now, readText: () => readText(doc), onChange: (text) => evaluate(text) });
    if (tier === "block") rescanner.stop();
  }

  await startPage();

  const observer = new win.MutationObserver(() => rescanner?.notify());
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });

  // In-page (SPA) navigation: a new path or query is a new page.
  const checkUrl = () => {
    if (pageKey(win.location.href) === pageKey(href)) return;
    href = win.location.href;
    shownKey = "";
    root.clear();
    startPage().catch((err) => console.error("tm:content", err));
  };
  win.setInterval(checkUrl, URL_POLL_MS);
  win.addEventListener("popstate", checkUrl);

  api.runtime.onMessage.addListener((msg, sender) => {
    if (sender?.id !== api.runtime.id) return false;
    if (msg?.type !== "frame-signals" || !Array.isArray(msg.signals)) return false;
    frameSignals.set(String(msg.frameUrl ?? ""), msg.signals.filter((s) => s && s.source === "text"));
    evaluate().catch((err) => console.error("tm:content", err));
    return false;
  });

  api.storage.onChanged.addListener(async (changes, area) => {
    if (area === "sync" && PREFS_KEY in changes) prefs = await loadPrefs(api);
    else if (area === "local" && RULESET_KEY in changes) rules = (await loadRules(api)) ?? rules;
    else return;
    await evaluate();
  });

  return contentApi;
}

/** Sub-frames scan their own text and send new signals to the top frame. */
async function startSubFrame({ api, win, now, rules }) {
  const doc = win.document;
  const host = parseHttpUrl(win.location.href).hostname;
  let sentKey = "";

  async function scan(text = readText(doc)) {
    const signals = scanText(text, rules, { host });
    const key = signals.map(signalKey).join(",");
    if (!signals.length || key === sentKey) return "clean";
    sentKey = key;
    try {
      await api.runtime.sendMessage({ type: "frame-signals", signals, frameUrl: win.location.href });
    } catch {
      // Background unavailable.
    }
    return "clean";
  }

  await scan();
  const rescanner = createRescanner({ win, now, readText: () => readText(doc), onChange: (text) => scan(text) });
  const observer = new win.MutationObserver(() => rescanner.notify());
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  return { root: null };
}
