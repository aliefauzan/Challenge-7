// The Safari guard's work, kept apart from guard.js so tests can run it with
// a fake API. Safari ignores redirect rules, so this asks the background
// whether the page is on a known scam domain and, if so, leaves it for the
// blocked page before it renders.
import { ask } from "../platform/ask.js";
import { blockedPageUrl, isBlockedUrl, scamDomainSet } from "../bg/block.js";

const RULESET_KEY = "tm.ruleset";
const PREFS_KEY = "tm.prefs";

// The background stores the checked ruleset; when it does not answer, the
// stored list decides, as the background would.
async function listedInStorage(api, href) {
  try {
    const payload = (await api.storage.local.get(RULESET_KEY))[RULESET_KEY];
    if (!Array.isArray(payload?.scam_domains)) return false;
    const prefs = (await api.storage.sync.get(PREFS_KEY).catch(() => ({})))[PREFS_KEY];
    if (prefs?.scam === false) return false;
    return isBlockedUrl(href, scamDomainSet(payload));
  } catch {
    return false;
  }
}

/**
 * @param {{api: object, win: Window, ms?: number}} deps
 * @returns {Promise<boolean>} true when the page was sent to the blocked page
 */
export async function guardPage({ api, win, ms }) {
  if (win.top !== win) return false;
  const href = win.location.href;
  if (!/^https?:$/.test(win.location.protocol)) return false;
  const reply = await ask(api, { type: "nav-check", href }, ms);
  const block = reply ? reply.block === true : await listedInStorage(api, href);
  if (block) win.location.replace(blockedPageUrl(api, href));
  return block;
}
