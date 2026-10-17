// Renders the popup view model (model.js) into elements. Text only, built
// with h(); no extension APIs here, popup.js passes the handlers in.
import { h } from "../ui/dom.js";

// Plain ASCII inside a CSS badge: Safari on iOS has no emoji font in the
// popup and draws symbols such as U+26D4 as an empty box. The check mark for
// a clean page is drawn in CSS.
const STATUS_ICON = {
  blocked: "!",
  warning: "!",
  hidden: "!",
  source: "i",
};

function accessCard(access, { onRequestAccess }) {
  return h(
    "section",
    { class: "card access", "aria-labelledby": "access-title" },
    h("h2", { id: "access-title" }, access.title),
    h("p", null, access.intro),
    access.path.length ? h("ol", { class: "path" }, access.path.map((step) => h("li", null, step))) : null,
    access.note ? h("p", { class: "note" }, access.note) : null,
    access.canRequest ? h("button", { type: "button", class: "primary", onClick: () => onRequestAccess() }, "Allow access") : null,
  );
}

function statusCard(status) {
  const reasons = status.reasons.length
    ? h(
        "details",
        { class: "reasons" },
        h("summary", null, status.reasons.length === 1 ? "Why? 1 warning sign" : `Why? ${status.reasons.length} warning signs`),
        h(
          "ul",
          null,
          status.reasons.map((r) => h("li", null, h("b", null, r.text), r.why ? h("span", null, r.why) : null)),
        ),
      )
    : null;
  return h(
    "section",
    { class: "card status", "data-kind": status.kind, "aria-live": "polite" },
    h("h2", null, h("span", { class: "icon", "aria-hidden": "true" }, STATUS_ICON[status.kind] ?? ""), status.title),
    status.domain ? h("p", { class: "domain" }, "Website: ", h("b", null, status.domain)) : null,
    status.detail ? h("p", null, status.detail) : null,
    reasons,
  );
}

function toggle(t, { onToggle }) {
  return h(
    "button",
    {
      type: "button",
      class: "toggle",
      role: "switch",
      "aria-checked": t.on ? "true" : "false",
      "data-key": t.key,
      onClick: () => onToggle(t.key, !t.on),
    },
    h("span", { class: "toggle-text" }, h("span", { class: "toggle-label" }, t.label), h("span", { class: "toggle-hint" }, t.hint)),
    h("span", { class: "toggle-state", "aria-hidden": "true" }, t.on ? "On" : "Off"),
  );
}

/**
 * @param {ReturnType<import("./model.js").buildPopupView>} view
 * @param {{onToggle: (key: string, on: boolean) => void, onRequestAccess: () => void}} handlers
 */
export function renderPopup(view, handlers) {
  const r = view.ruleset;
  const version = r.version == null ? "Scam list: built in" : `Scam list version ${r.version}`;
  return [
    h("header", null, h("h1", null, "ScamShield")),
    view.access ? accessCard(view.access, handlers) : null,
    statusCard(view.status),
    h("section", { class: "toggles", "aria-label": "Settings" }, view.toggles.map((t) => toggle(t, handlers))),
    h("footer", null, h("p", null, `${version}. ${r.updated}.`), r.errors ? h("p", { class: "note" }, "The last update had a problem. ScamShield keeps using the list it has.") : null),
  ].filter(Boolean);
}
