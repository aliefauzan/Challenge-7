// Popup controller: reads the current tab's state through `api`, builds the
// view model and renders it. Kept apart from popup.js so tests can run it
// with a fake `api` and DOM.
import { buildPopupView, platformOf, blockedPageAddress } from "./model.js";
import { renderPopup } from "./view.js";

const PREFS_KEY = "tm.prefs";
const META_KEY = "tm.rulesetMeta";
const ALL_SITES = { origins: ["<all_urls>"] };

// Safari on iOS answers false for "<all_urls>" even when All Websites is set
// to Allow, so that answer alone is not trusted. A verdict for the tab means
// the content script ran there, which needs access; otherwise the tab's own
// site is asked about too.
async function hasSiteAccess(api, tab, verdict) {
  if (verdict) return true;
  try {
    if (await api.permissions?.contains(ALL_SITES)) return true;
    const origin = /^https?:/.test(tab?.url ?? "") ? new URL(tab.url).origin : null;
    return origin ? Boolean(await api.permissions?.contains({ origins: [`${origin}/*`] })) : false;
  } catch {
    return false;
  }
}

/**
 * @param {{api: object, doc: Document, target: string, nav?: object, now?: () => number}} deps
 * @returns {Promise<{render: () => Promise<void>}>}
 */
export async function startPopup({ api, doc, target, nav = {}, now = Date.now }) {
  const root = doc.querySelector("main");
  const platform = platformOf(target, nav);
  const [tab] = (await api.tabs.query({ active: true, currentWindow: true })) ?? [];
  const verdictKey = tab ? `tm.verdict.${tab.id}` : null;
  const blockedAddress = blockedPageAddress(tab?.url);
  const blockedListed = blockedAddress
    ? (await api.runtime.sendMessage({ type: "blocked-check", href: blockedAddress }).catch(() => null))?.listed === true
    : false;
  let prefs = {};

  async function render() {
    const [session, sync, local] = await Promise.all([
      verdictKey ? api.storage.session.get(verdictKey) : {},
      api.storage.sync.get(PREFS_KEY),
      api.storage.local.get(META_KEY),
    ]);
    const verdict = (verdictKey && session[verdictKey]) || null;
    const hasAccess = await hasSiteAccess(api, tab, verdict);
    prefs = sync[PREFS_KEY] ?? {};
    const view = buildPopupView({
      target,
      platform,
      tab: tab ?? null,
      verdict,
      prefs,
      meta: local[META_KEY] ?? null,
      hasAccess,
      blockedListed,
      now: now(),
    });
    root.replaceChildren(...renderPopup(view, handlers));
  }

  const handlers = {
    onToggle: (key, on) => {
      api.storage.sync.set({ [PREFS_KEY]: { scam: true, bias: true, social: true, ...prefs, [key]: on } });
    },
    onRequestAccess: () => {
      // Must run inside the click; the browser asks the user.
      api.permissions?.request(ALL_SITES).then(render, () => {});
    },
  };

  api.storage.onChanged.addListener((changes, area) => {
    const relevant =
      (area === "session" && verdictKey in changes) || (area === "sync" && PREFS_KEY in changes) || (area === "local" && META_KEY in changes);
    if (relevant) render().catch((err) => console.error("tm:popup", err));
  });

  await render();
  return { render };
}
