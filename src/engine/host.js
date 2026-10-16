// Host parsing on top of the Public Suffix List (tldts). Private suffixes
// (github.io, netlify.app, …) count as suffixes, so every user site on them is
// its own registrable domain.
import { parse } from "tldts";

const PSL = { allowPrivateDomains: true };

/**
 * Lowercase, strip brackets and a trailing dot, convert unicode to punycode.
 * Returns "" for anything that is not a valid hostname.
 * @param {string} host
 */
export function normalizeHost(host) {
  if (typeof host !== "string" || host === "") return "";
  let h = host.trim().toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[") && h.endsWith("]")) return h.slice(1, -1);
  if (h.includes(":")) return h; // bare IPv6
  try {
    return new URL(`http://${h}/`).hostname;
  } catch {
    return "";
  }
}

/**
 * @param {string} hostname
 * @returns {{hostname: string, registrable: string, mainLabel: string, subdomainLabels: string[], isIp: boolean}}
 */
export function splitHost(hostname) {
  const host = normalizeHost(hostname);
  const r = parse(host, PSL);
  if (r.isIp || !r.domain) {
    return { hostname: host, registrable: host, mainLabel: r.isIp ? "" : host.split(".")[0], subdomainLabels: [], isIp: Boolean(r.isIp) };
  }
  const labels = r.subdomain ? r.subdomain.split(".").filter(Boolean) : [];
  if (labels[0] === "www") labels.shift();
  return { hostname: host, registrable: r.domain, mainLabel: r.domainWithoutSuffix, subdomainLabels: labels, isIp: false };
}

/** @param {string} hostname */
export const registrable = (hostname) => splitHost(hostname).registrable;

/** @param {string} hostname */
export const isIp = (hostname) => Boolean(parse(normalizeHost(hostname), PSL).isIp);

/**
 * Public suffix of a host ("" for IPs and single-label hosts without one).
 * @param {string} hostname
 */
export function publicSuffix(hostname) {
  const r = parse(normalizeHost(hostname), PSL);
  return r.isIp ? "" : (r.publicSuffix ?? "");
}
