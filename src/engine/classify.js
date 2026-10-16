// Link and social-item classification.
import { analyzeUrl, parseHttpUrl } from "./url.js";
import { scanText } from "./text.js";

const REDIRECTS = [
  { host: /^l[m]?\.facebook\.com$/, path: "/l.php", param: "u" },
  { host: /^(www\.)?google\.[a-z.]+$/, path: "/url", param: "q" },
  { host: /^(www\.)?google\.[a-z.]+$/, path: "/url", param: "url" },
];

/**
 * Return the destination of a known redirect wrapper, or the input unchanged.
 * @param {string} href
 */
export function unwrapRedirect(href) {
  const u = parseHttpUrl(href);
  if (!u) return href;
  for (const r of REDIRECTS) {
    if (!r.host.test(u.hostname) || u.pathname !== r.path) continue;
    const target = u.searchParams.get(r.param);
    if (target && parseHttpUrl(target)) return target;
  }
  return href;
}

/**
 * @param {string} href
 * @param {import("./types.js").Rules} rules
 * @returns {import("./types.js").Classification | null}
 */
export function classifyLink(href, rules) {
  const u = parseHttpUrl(unwrapRedirect(href));
  if (!u) return null;
  if (rules.scamDomains.has(u.hostname)) {
    return {
      kind: "scam", basis: "link", url: u.href,
      signal: {
        source: "domain", severity: "high", id: "known-scam-domain",
        description: "Known scam website",
        why: "This website is on a list of reported scam and phishing sites.",
      },
    };
  }
  const signals = analyzeUrl(u.href, rules);
  if (signals.length) {
    return { kind: "scam", basis: "link", url: u.href, signal: signals.find((s) => s.severity === "high") ?? signals[0] };
  }
  const source = rules.sources.get(u.hostname);
  if (source) return { kind: "source", basis: "link", url: u.href, source };
  return null;
}

/**
 * @param {{text?: string, links?: string[]}} item
 * @param {import("./types.js").Rules} rules
 * @param {{skipLinkHost?: RegExp}} [opts]
 */
export function classifySocialItem(item, rules, opts = {}) {
  const links = (item.links ?? []).filter((href) => {
    const u = parseHttpUrl(unwrapRedirect(href));
    return u && !(opts.skipLinkHost && opts.skipLinkHost.test(u.hostname));
  });
  const results = links.map((href) => classifyLink(href, rules)).filter(Boolean);
  const scam = results.find((r) => r.kind === "scam");
  if (scam) return scam;
  const textSignals = scanText(item.text ?? "", rules).filter((s) => s.severity === "high");
  if (textSignals.length) return { kind: "scam", basis: "text", signal: textSignals[0] };
  return results.find((r) => r.kind === "source") ?? null;
}

/**
 * Link-based results fire on every surface; text-based ones only in direct
 * messages, where scam text is aimed at one person.
 * @param {import("./types.js").Classification | null} result
 * @param {"feed" | "dm"} surface
 */
export function shouldFireItem(result, surface) {
  if (!result) return false;
  return result.basis === "link" || surface === "dm";
}
