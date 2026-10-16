// Address for "Report a mistake" links. Only the website's domain goes
// into the report, never the full address (it can hold tokens or names).
import { REPORT_URL } from "../config.js";
import { isSafeHttpUrl } from "./dom.js";

/**
 * @param {string} [domain]
 * @param {string} [base] defaults to REPORT_URL
 * @returns {string | null} null when reporting is turned off
 */
export function reportHref(domain, base = REPORT_URL) {
  if (!isSafeHttpUrl(base)) return null;
  const url = new URL(base);
  if (domain) url.searchParams.set("body", `Website: ${domain}`);
  return url.href;
}
