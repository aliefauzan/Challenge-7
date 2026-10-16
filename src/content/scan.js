// Page scanning: domain, URL and text signals from the engine, plus a
// rescanner that catches scam text a page adds after it loads.
import { parseHttpUrl, analyzeUrl } from "../engine/url.js";
import { scanText } from "../engine/text.js";
import { registrable } from "../engine/host.js";

export const RESCAN_THROTTLE_MS = 1500;
export const RESCAN_MIN_DELTA = 200;
export const RESCAN_WINDOW_MS = 60_000;

const KNOWN_DOMAIN_SIGNAL = {
  source: "domain",
  severity: "high",
  id: "known-scam-domain",
  description: "Known scam website",
  why: "This website is on a list of reported scam and phishing sites.",
};

/**
 * @param {{href: string, text: string, rules: import("../engine/types.js").Rules}} page
 * @returns {{host: string, domain: string, knownDomain: boolean, signals: import("../engine/types.js").Signal[], source: object | null}}
 */
export function scanPage({ href, text, rules }) {
  const u = parseHttpUrl(href);
  if (!u) return { host: "", domain: "", knownDomain: false, signals: [], source: null };
  const host = u.hostname;
  const knownDomain = rules.scamDomains.has(host);
  const signals = [
    ...(knownDomain ? [{ ...KNOWN_DOMAIN_SIGNAL }] : []),
    ...analyzeUrl(href, rules),
    ...scanText(text, rules, { host }),
  ];
  return { host, domain: registrable(host), knownDomain, signals, source: rules.sources.get(host) ?? null };
}

/**
 * Re-runs `onChange` when the page text grows or shrinks by more than
 * RESCAN_MIN_DELTA characters, at most once per RESCAN_THROTTLE_MS, for
 * RESCAN_WINDOW_MS after creation. Stops early once `onChange` returns "block".
 * The load-time scan counts as the first run.
 * @param {{win: Window, readText: () => string, onChange: (text: string) => string | Promise<string>,
 *   now?: () => number, throttleMs?: number, minDelta?: number, windowMs?: number}} opts
 */
export function createRescanner({ win, readText, onChange, now = () => Date.now(), throttleMs = RESCAN_THROTTLE_MS, minDelta = RESCAN_MIN_DELTA, windowMs = RESCAN_WINDOW_MS }) {
  const start = now();
  let lastRun = start;
  let lastLength = readText().length;
  let timer = null;
  let stopped = false;

  function stop() {
    stopped = true;
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  }

  async function run() {
    timer = null;
    if (stopped) return;
    if (now() - start > windowMs) return stop();
    lastRun = now();
    const text = readText();
    if (Math.abs(text.length - lastLength) <= minDelta) return;
    lastLength = text.length;
    if ((await onChange(text)) === "block") stop();
  }

  return {
    get stopped() {
      return stopped;
    },
    stop,
    /** Call on every DOM mutation; cheap when nothing needs doing. */
    notify() {
      if (stopped || timer !== null) return;
      if (now() - start > windowMs) return stop();
      timer = win.setTimeout(run, Math.max(0, lastRun + throttleMs - now()));
    },
  };
}
