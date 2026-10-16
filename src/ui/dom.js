// Element builder for the injected UI. Strings always become text nodes;
// nothing here parses HTML, so text from the ruleset or the page can never
// turn into markup or script.

/** True only for absolute http: and https: URLs. */
export function isSafeHttpUrl(href) {
  if (typeof href !== "string" || href === "") return false;
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Attributes that load or run something, or restyle from a string.
const BLOCKED_ATTRS = new Set(["src", "srcdoc", "srcset", "style", "action", "formaction", "xlink:href"]);

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (typeof child === "string" || typeof child === "number") el.append(document.createTextNode(String(child)));
    else el.append(child);
  }
}

/**
 * @param {string} tag
 * @param {Record<string, unknown> | null} [props] attributes; `onX` functions become listeners
 * @param {...unknown} children nodes, strings, numbers or nested arrays
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    const name = key.toLowerCase();
    if (name.startsWith("on")) {
      if (typeof value === "function") el.addEventListener(name.slice(2), value);
      continue;
    }
    if (BLOCKED_ATTRS.has(name)) continue;
    if (name === "href") {
      if (isSafeHttpUrl(value)) el.setAttribute("href", value);
      continue;
    }
    el.setAttribute(name, value === true ? "" : String(value));
  }
  appendChildren(el, children);
  return el;
}
