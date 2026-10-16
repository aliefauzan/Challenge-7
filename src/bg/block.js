// Pre-load blocking of known scam domains.
//
// Chrome: declarativeNetRequest redirects main-frame requests to listed
// domains to blocked.html before the request is sent.
// Safari: it accepts redirect rules but ignores them, and its block action
// strands the tab on an error page. So the Safari build installs no rules;
// a document_start content script (content/guard.js) asks `nav-check` and
// leaves the page itself. On both targets a tabs.onUpdated backstop in
// bg/index.js catches the rest.
import { DomainSet } from "../engine/domains.js";
import { parseHttpUrl } from "../engine/url.js";

export const MAX_BLOCK_RULES = 99;
export const MIN_DOMAINS_PER_RULE = 1000;

/** The blocked page URL for one blocked address. */
export const blockedPageUrl = (api, href) => api.runtime.getURL(`blocked.html#${encodeURIComponent(href)}`);

/** @param {{scam_domains?: string[]} | undefined} payload */
export const scamDomainSet = (payload) => new DomainSet(payload?.scam_domains ?? []);

/**
 * True when `href` is an http(s) address on a listed scam domain.
 * @param {string} href
 * @param {DomainSet} scamDomains
 */
export function isBlockedUrl(href, scamDomains) {
  const u = parseHttpUrl(href);
  return Boolean(u) && scamDomains.has(u.hostname);
}

/**
 * DNR rules (Chrome) for every listed domain. Domains are split across at
 * most MAX_BLOCK_RULES rules with IDs 1..n.
 * @param {DomainSet} scamDomains
 * @param {string} blockedPage `api.runtime.getURL("blocked.html")`
 */
export function buildDnrRules(scamDomains, blockedPage) {
  const domains = [...scamDomains.map.keys()].sort();
  if (domains.length === 0) return [];
  const perRule = Math.max(MIN_DOMAINS_PER_RULE, Math.ceil(domains.length / MAX_BLOCK_RULES));
  const rules = [];
  for (let i = 0; i < domains.length; i += perRule) {
    rules.push({
      id: rules.length + 1,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: `${blockedPage}#\\1` } },
      condition: { requestDomains: domains.slice(i, i + perRule), regexFilter: "^(.*)$", resourceTypes: ["main_frame"] },
    });
  }
  return rules;
}

/**
 * Replace the dynamic block rules. With scam protection off, or on Safari,
 * the rule set ends up empty.
 * @returns {Promise<number>} number of rules installed
 */
export async function syncBlockRules(api, { target, payload, prefs }) {
  const existing = await api.declarativeNetRequest.getDynamicRules();
  const wanted = target === "chrome" && prefs?.scam !== false ? buildDnrRules(scamDomainSet(payload), api.runtime.getURL("blocked.html")) : [];
  await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: wanted });
  const domainCount = wanted.reduce((n, r) => n + r.condition.requestDomains.length, 0);
  console.debug(`tm:block ${wanted.length} rules, ${domainCount} domains (${target})`);
  return wanted.length;
}
