// Full-page warning for tiers "block" and "block-bypass". It is a modal
// alert dialog: focus starts on the heading, Tab stays inside, and the page
// behind it cannot scroll.
import { h } from "./dom.js";
import { topSignals } from "./banner.js";
import { reportHref } from "./report.js";

const COPY = {
  block: {
    title: "Stop. This is a known scam website.",
    body: "People have reported this website for stealing money or personal details. ScamShield stopped it from opening.",
  },
  "block-bypass": {
    title: "Stop. This page looks like a scam.",
    body: "This page shows several warning signs that scammers use.",
  },
};

let nextId = 0;

/**
 * @param {import("../engine/types.js").Verdict} verdict
 * @param {{onBack: () => void, onBypass?: () => void}} handlers
 * @returns {{node: HTMLElement, focus: () => void}}
 */
export function blocker(verdict, { onBack, onBypass }) {
  const copy = COPY[verdict.tier] ?? COPY.block;
  const headingId = `tm-block-title-${++nextId}`;
  const heading = h("h1", { id: headingId, tabindex: -1 }, copy.title);
  const back = h("button", { class: "tm-primary", type: "button", onClick: () => onBack() }, "Go back to safety");
  const controls = [back];
  if (verdict.tier === "block-bypass" && onBypass) {
    controls.push(h("button", { class: "tm-risk", type: "button", onClick: () => onBypass() }, "I understand the risk — continue"));
  }
  const reasons = topSignals(verdict.signals);
  const report = reportHref(verdict.domain);

  const node = h(
    "div",
    { class: "tm-blocker", role: "alertdialog", "aria-modal": "true", "aria-labelledby": headingId, "data-tier": verdict.tier },
    h(
      "div",
      { class: "tm-panel" },
      heading,
      verdict.domain ? h("p", { class: "tm-domain" }, "Website: ", h("b", null, verdict.domain)) : null,
      h("p", null, copy.body),
      reasons.length ? h("ul", { class: "tm-reasons" }, reasons.map((s) => h("li", { class: "tm-reason" }, s.description))) : null,
      h("p", { class: "tm-family" }, "Do not pay, call any number, or enter passwords here. If you are unsure, call a family member or friend you trust."),
      h("div", { class: "tm-buttons" }, controls),
      report ? h("p", { class: "tm-report" }, h("a", { class: "tm-link", href: report, target: "_blank", rel: "noopener noreferrer" }, "Report a mistake")) : null,
    ),
  );

  // Keep Tab inside the dialog.
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (event.target === first || event.target === heading)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return { node, focus: () => heading.focus() };
}

/**
 * Stop the page behind the blocker from scrolling.
 * @returns {() => void} restores the page's own overflow
 */
export function lockScroll(doc = document) {
  const els = [doc.documentElement, doc.body].filter(Boolean);
  const saved = els.map((el) => el.style.overflow ?? "");
  for (const el of els) el.style.overflow = "hidden";
  return () => els.forEach((el, i) => (el.style.overflow = saved[i]));
}
