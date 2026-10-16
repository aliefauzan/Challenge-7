// URL-structure signals: brand impersonation, lookalike names, deep
// subdomains and bare public IP hosts.
import { splitHost } from "./host.js";

const PRIVATE_V4 = [/^10\./, /^127\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];

/**
 * @param {string} url
 * @returns {URL | null} only http(s) URLs
 */
export function parseHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @param {import("./types.js").Rules} rules
 * @returns {import("./types.js").Signal[]}
 */
export function analyzeUrl(url, rules) {
  const u = parseHttpUrl(url);
  if (!u) return [];
  const host = splitHost(u.hostname);
  if (rules.allowlist.has(host.hostname)) return [];
  const signals = [];

  if (host.isIp) {
    if (!host.hostname.includes(":") && !PRIVATE_V4.some((re) => re.test(host.hostname))) {
      signals.push({
        source: "url", severity: "medium", id: "ip-host",
        description: "Website uses a bare number address",
        why: "Real companies use a name, not a string of numbers, for their websites.",
      });
    }
    return signals;
  }

  const brand = host.subdomainLabels.find((label) => rules.impersonatedBrands.has(label) && label !== host.mainLabel);
  if (brand) {
    signals.push({
      source: "url", severity: "high", id: "brand-subdomain",
      description: `Pretends to be ${brand}`,
      why: `The real ${brand} website does not live under ${host.registrable}. Scammers put a brand name in front of their own address.`,
    });
  }

  const tokens = host.hostname.split(/[.-]/);
  const lookalike = tokens.find((t) => rules.lookalikeBrands.has(t) && t !== host.mainLabel);
  if (lookalike && tokens.some((t) => rules.phishingContext.has(t))) {
    signals.push({
      source: "url", severity: "high", id: "lookalike-brand",
      description: `Look-alike ${lookalike} address`,
      why: `This address mixes "${lookalike}" with words like "login" or "verify", a common trick for fake sign-in pages.`,
    });
  }

  if (host.subdomainLabels.length >= rules.thresholds.deep_subdomain_labels) {
    signals.push({
      source: "url", severity: "medium", id: "deep-subdomain",
      description: "Unusually long web address",
      why: "Very long addresses can hide the real website name at the end.",
    });
  }
  return signals;
}
