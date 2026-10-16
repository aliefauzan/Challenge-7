// Wires the background modules to extension events. Kept apart from
// background.js so tests can start it with a fake `api`.
import { ensureRuleset, refreshRuleset, RULESET_KEY } from "./refresh.js";
import { syncBlockRules, scamDomainSet, isBlockedUrl, blockedPageUrl } from "./block.js";
import { handleFlagGet, handleFlagSet } from "./flags.js";
import { handleVerdict, handleFrameSignals, clearVerdict, setBadge } from "./verdicts.js";

export const REFRESH_ALARM = "tm.refresh";
export const PREFS_KEY = "tm.prefs";
export const DEFAULT_PREFS = { scam: true, bias: true, social: true };

/**
 * @param {object} api
 * @param {{target: "chrome"|"safari", bundled: object, rulesetUrl: string,
 *   keys: Record<string, string>, refreshMinutes: number, welcomeUrl: string, fetch?: typeof fetch}} deps
 */
export function startBackground(api, deps) {
  let cache = null; // {version, domains}

  async function prefs() {
    const got = await api.storage.sync.get(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(got[PREFS_KEY] ?? {}) };
  }

  async function ruleset() {
    return (await api.storage.local.get(RULESET_KEY))[RULESET_KEY];
  }

  async function scamDomains() {
    const payload = await ruleset();
    if (!cache || cache.version !== payload?.version) cache = { version: payload?.version, domains: scamDomainSet(payload) };
    return cache.domains;
  }

  // One sync at a time: two overlapping ones (start-up and a storage change)
  // would both remove the old rules and then add rules with the same IDs.
  let syncing = Promise.resolve();
  function resyncRules() {
    const run = syncing.then(async () => {
      cache = null;
      await syncBlockRules(api, { target: deps.target, payload: await ruleset(), prefs: await prefs() });
    });
    syncing = run.catch(() => {});
    return run;
  }

  const refresh = () => refreshRuleset(api, { url: deps.rulesetUrl, keys: deps.keys, fetch: deps.fetch });

  async function boot() {
    await ensureRuleset(api, deps.bundled);
    await resyncRules();
    if (!(await api.alarms.get(REFRESH_ALARM))) {
      await api.alarms.create(REFRESH_ALARM, { periodInMinutes: deps.refreshMinutes, delayInMinutes: 1 });
    }
  }
  const ready = boot().catch((err) => console.error("tm:boot", err));

  /** True when scam protection is on and `href` is on a listed domain. */
  async function shouldBlock(href) {
    await ready;
    if ((await prefs()).scam === false) return false;
    return isBlockedUrl(href, await scamDomains());
  }

  const handlers = {
    "flag-get": (msg, sender) => handleFlagGet(api, msg, sender),
    "flag-set": (msg, sender) => handleFlagSet(api, msg, sender),
    verdict: (msg, sender) => handleVerdict(api, msg, sender),
    "frame-signals": (msg, sender) => handleFrameSignals(api, msg, sender),
    "nav-check": async (msg, sender) => ({ block: sender.frameId === 0 && (await shouldBlock(sender.url ?? msg.href ?? "")) }),
    // The blocked page is web-accessible, so any site can open it with any
    // address in the hash. It shows the address only when this says yes.
    "blocked-check": async (msg) => ({ listed: typeof msg.href === "string" && isBlockedUrl(msg.href, await scamDomains()) }),
    "ruleset-refresh": async (msg, sender) => (sender.tab ? { updated: false, error: "not allowed from a page" } : refresh()),
  };

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender?.id !== api.runtime.id) return false;
    const handler = handlers[msg?.type];
    if (!handler) return false;
    handler(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
    return true;
  });

  api.runtime.onInstalled.addListener(async ({ reason }) => {
    await ready;
    if (reason === "install" && deps.welcomeUrl) await api.tabs.create({ url: deps.welcomeUrl });
    await refresh();
  });
  api.runtime.onStartup.addListener(async () => {
    await ready;
    await refresh();
  });
  api.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== REFRESH_ALARM) return;
    await ready;
    await refresh();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if ((area === "local" && RULESET_KEY in changes) || (area === "sync" && PREFS_KEY in changes)) {
      resyncRules().catch((err) => console.error("tm:block", err));
    }
  });

  api.tabs.onRemoved.addListener((tabId) => clearVerdict(api, tabId));
  api.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (info.status === "loading" && info.url) {
      await clearVerdict(api, tabId);
      await setBadge(api, tabId, "clean");
    }
    // Backstop for pages that got past the first check: on Safari, the
    // guard script; on Chrome, DNR, whose requestDomains does not match
    // host forms such as a trailing dot ("scam.example.").
    const url = info.url ?? tab?.url ?? "";
    if (url && (await shouldBlock(url))) {
      await api.tabs.update(tabId, { url: blockedPageUrl(api, url) });
    }
  });

  return { ready, shouldBlock, refresh };
}
