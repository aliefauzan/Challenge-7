// Small inline labels for social pages: a chip at the top of a risky post
// and a badge after a risky link. They sit in the page itself (a shadow
// root per link would be heavy on a long feed), so they hold text nodes
// only and use fixed inline styles.
import { h } from "./dom.js";

const BASE = "all: initial; display: inline-block; margin: 4px 6px; padding: 3px 9px; border-radius: 999px; font: 600 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; vertical-align: middle; white-space: normal;";
const TONES = {
  scam: "background: #c62828; color: #fff;",
  source: "background: #eceff1; color: #263238; border: 1px solid #90a4ae;",
};

const BIAS_SHORT = {
  "far-right": "far-right",
  right: "right-leaning",
  left: "left-leaning",
  "far-left": "far-left",
  conspiracy: "conspiracy",
  "state-affiliated": "state media",
  platform: "user posts",
  satire: "satire",
};

function chipText(result, where) {
  if (result.kind === "scam") {
    const what = result.signal?.description ?? "Looks like a scam";
    return where === "item" ? `⚠ ScamShield: ${what}. Do not click links or send money.` : `⚠ ${what}`;
  }
  const s = result.source ?? {};
  const bias = BIAS_SHORT[s.bias];
  return `News source: ${s.label ?? "listed source"}${bias ? ` (${bias})` : ""}`;
}

/**
 * @param {import("../engine/types.js").Classification} result
 * @param {"item" | "link"} where
 */
export function chip(result, where) {
  const kind = result.kind === "scam" ? "scam" : "source";
  const el = h("span", { "data-tm-chip": kind, role: "note" }, chipText(result, where));
  // Constant strings only; nothing from the ruleset or the page goes in here.
  // An item chip gets its own line above the post; a link badge stays inline.
  el.setAttribute("style", BASE + TONES[kind] + (where === "item" ? "display: table; margin: 0 0 8px;" : ""));
  return el;
}
