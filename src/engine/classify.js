// Link and social-item classification.
import { parse } from "tldts";
import { analyzeUrl, parseHttpUrl } from "./url.js";
import { scanText } from "./text.js";

const MAX_HOPS = 5;

const isFacebookWrapper = (u) => /^lm?\.facebook\.com$/.test(u.hostname) && u.pathname === "/l.php";

// Google's own domains only: "google" directly under an ICANN public suffix
// (google.com, google.co.id, google.com.au), optionally with www. A suffix
// from the private section of the list (google.netlify.app) or any other
// subdomain (google.evil.com, mail.google.com) is not unwrapped.
function isGoogleWrapper(u) {
  if (u.pathname !== "/url") return false;
  const p = parse(u.hostname, { allowPrivateDomains: true });
  return p.isIcann === true && !p.isIp && p.domainWithoutSuffix === "google" && (p.subdomain === "" || p.subdomain === "www");
}

function unwrapOnce(u) {
  if (isFacebookWrapper(u)) return u.searchParams.get("u");
  if (isGoogleWrapper(u)) return u.searchParams.get("q") ?? u.searchParams.get("url");
  return null;
}

/**
 * Every URL in a chain of known redirect wrappers, outermost first, ending at
 * the final destination (at most 5 hops). Non-http input gives [].
 * @param {string} href
 * @returns {URL[]}
 */
export function redirectChain(href) {
  return walk(href).chain;
}

// `truncated` is true when the last hop is still a wrapper because the hop
// limit was reached; the real destination is then unknown.
function walk(href) {
  let u = parseHttpUrl(href);
  const chain = [];
  while (u && chain.length <= MAX_HOPS) {
    chain.push(u);
    const next = unwrapOnce(u);
    u = next ? parseHttpUrl(next) : null;
  }
  return { chain, truncated: u !== null };
}

/**
 * Return the final destination of a chain of known redirect wrappers, or the
 * input unchanged.
 * @param {string} href
 */
export function unwrapRedirect(href) {
  const chain = redirectChain(href);
  return chain.length > 1 ? chain[chain.length - 1].href : href;
}

/**
 * @param {string} href
 * @param {import("./types.js").Rules} rules
 * @returns {import("./types.js").Classification | null}
 */
export function classifyLink(href, rules) {
  const { chain, truncated } = walk(href);
  if (!chain.length) return null;
  const u = chain[chain.length - 1];
  // A listed domain anywhere in the chain counts, including the wrapper itself.
  if (chain.some((hop) => rules.scamDomains.has(hop.hostname))) {
    return {
      kind: "scam", basis: "link", url: u.href,
      signal: {
        source: "domain", severity: "high", id: "known-scam-domain",
        description: "Known scam website",
        why: "This website is on a list of reported scam and phishing sites.",
      },
    };
  }
  // Fail closed: a link wrapped too many times to resolve hides its target.
  if (truncated) {
    return {
      kind: "scam", basis: "link", url: u.href,
      signal: {
        source: "url", severity: "high", id: "hidden-destination",
        description: "Link hides where it goes",
        why: "This link is wrapped many times so you cannot see where it really leads.",
      },
    };
  }
  const signals = chain.flatMap((hop) => analyzeUrl(hop.href, rules));
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
    const { chain, truncated } = walk(href);
    const last = chain[chain.length - 1];
    return last && (truncated || !(opts.skipLinkHost && opts.skipLinkHost.test(last.hostname)));
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
