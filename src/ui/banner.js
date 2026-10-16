// Warning banners: the scam banner (tier "banner") and the news-source
// banner (tier "bias"). Every string from the ruleset goes in as text.
import { h } from "./dom.js";

export const SCAM_HELP_URL = "https://consumer.ftc.gov/articles/how-avoid-scam";
export const MAX_REASONS = 3;

const FAMILY_LINE = "Stop before you pay, call a number, or type a password. Call a family member or friend you trust and ask them first.";

const BIAS_LABELS = {
  "far-right": "Far-right bias",
  right: "Right-leaning bias",
  left: "Left-leaning bias",
  "far-left": "Far-left bias",
  conspiracy: "Spreads conspiracy theories",
  "state-affiliated": "Government-run or government-funded",
  platform: "Shares posts from anyone",
  satire: "Satire: stories are made up as jokes",
};

let nextId = 0;
const uid = (prefix) => `tm-${prefix}-${++nextId}`;

/** Highest-severity signals first, one per id. */
export function topSignals(signals, max = MAX_REASONS) {
  const seen = new Set();
  const unique = signals.filter((s) => !seen.has(s.id) && seen.add(s.id));
  const rank = (s) => (s.severity === "high" ? 0 : 1);
  return unique
    .map((s, i) => [s, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .slice(0, max)
    .map(([s]) => s);
}

function closeButton(onDismiss) {
  return h("button", { class: "tm-close", type: "button", "aria-label": "Dismiss this warning", onClick: () => onDismiss?.() }, "×");
}

function helpLink(href, text) {
  return h("a", { class: "tm-link", href, target: "_blank", rel: "noopener noreferrer" }, text);
}

/** "Why was this flagged?" button and the panel it opens. */
function whyDisclosure(signals) {
  const panelId = uid("why");
  const panel = h(
    "ul",
    { class: "tm-why", id: panelId, hidden: true },
    signals.map((s) => h("li", null, h("b", null, s.description), s.why)),
  );
  const toggle = h("button", { class: "tm-disclose", type: "button", "aria-expanded": "false", "aria-controls": panelId }, "Why was this flagged?");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    if (open) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
  });
  return { toggle, panel };
}

/**
 * @param {import("../engine/types.js").Verdict} verdict
 * @param {{onDismiss?: () => void}} handlers
 */
export function scamBanner(verdict, { onDismiss } = {}) {
  const reasons = topSignals(verdict.signals);
  const red = reasons.some((s) => s.severity === "high");
  const titleId = uid("title");
  const why = whyDisclosure(reasons);
  return h(
    "div",
    { class: `tm-banner ${red ? "tm-red" : "tm-amber"}`, role: "alert", "aria-labelledby": titleId, "data-tier": "banner" },
    h("div", { class: "tm-head" }, h("h2", { class: "tm-title", id: titleId }, red ? "This page may be a scam" : "Be careful on this page"), closeButton(onDismiss)),
    h("ul", { class: "tm-reasons" }, reasons.map((s) => h("li", { class: "tm-reason" }, s.description))),
    h("p", { class: "tm-family" }, FAMILY_LINE),
    h("div", { class: "tm-actions" }, why.toggle, helpLink(SCAM_HELP_URL, "How to spot a scam (FTC)")),
    why.panel,
  );
}

/** Search links for a headline: fact checks and other outlets' coverage. */
export function headlineLinks(headline) {
  const q = headline.trim().slice(0, 200);
  if (!q) return [];
  return [
    { text: "Has this been fact-checked?", href: `https://www.google.com/search?q=${encodeURIComponent(q)}+fact+check` },
    { text: "See how other news outlets cover this", href: `https://news.google.com/search?q=${encodeURIComponent(q)}` },
  ];
}

/**
 * @param {import("../engine/types.js").Verdict} verdict tier "bias", with sourceInfo
 * @param {{headline?: string, onDismiss?: () => void}} opts
 */
export function biasBanner(verdict, { headline = "", onDismiss } = {}) {
  const src = verdict.sourceInfo ?? {};
  const titleId = uid("title");
  const lines = [BIAS_LABELS[src.bias], src.accuracy ? `Factual accuracy: ${src.accuracy}` : null].filter(Boolean);
  return h(
    "div",
    { class: "tm-banner tm-bias", role: "status", "aria-labelledby": titleId, "data-tier": "bias" },
    h("div", { class: "tm-head" }, h("h2", { class: "tm-title", id: titleId }, `About this source: ${src.label ?? verdict.domain}`), closeButton(onDismiss)),
    lines.length ? h("p", { class: "tm-meta" }, lines.join(" · ")) : null,
    src.rating ? h("p", { class: "tm-meta" }, src.rating) : null,
    h("div", { class: "tm-actions" }, headlineLinks(headline).map((l) => helpLink(l.href, l.text))),
  );
}
