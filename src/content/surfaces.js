// Social pages: label risky posts and links in place. Which pages count,
// what a post looks like and which links are the site's own all come from
// `surface_adapters` in the ruleset, so a site redesign is a data update.
import { classifyLink, classifySocialItem, shouldFireItem } from "../engine/classify.js";
import { parseHttpUrl } from "../engine/url.js";
import { chip } from "../ui/chip.js";

export const SURFACE_DEBOUNCE_MS = 800;
const ITEM_ATTR = "data-tm-item";
const FLAG_ATTR = "data-tm-flagged";
const LINK_ATTR = "data-tm-link";

/**
 * The adapter for `href`, if any, and whether the page is a direct-message
 * view ("dm") or anything else on the site ("feed").
 * @param {import("../engine/types.js").Rules} rules
 * @param {string} href
 */
export function pickAdapter(rules, href) {
  const u = parseHttpUrl(href);
  if (!u) return null;
  for (const [name, adapter] of Object.entries(rules.adapters ?? {})) {
    const onDmHost = Boolean(adapter.dmHost?.test(u.hostname));
    if (!onDmHost && !adapter.host?.test(u.hostname)) continue;
    const dm = onDmHost && (!adapter.dmPath || u.pathname.startsWith(adapter.dmPath));
    return { name, adapter, surface: dm ? "dm" : "feed" };
  }
  return null;
}

/**
 * @param {{win: Window, rules: import("../engine/types.js").Rules,
 *   picked: {adapter: object, surface: "feed" | "dm"}}} opts
 */
export function createSurfaces({ win, rules, picked }) {
  const doc = win.document;
  const { adapter, surface } = picked;
  // Direct-message text is scanned only once the ruleset names a verified
  // selector for message items; until then only links are checked there.
  const itemSelector = surface === "dm" ? adapter.dmItemSelector : adapter.itemSelector;
  const skipHost = adapter.skipLinkHosts;
  let observer = null;
  let timer = null;

  function scanItems() {
    if (!itemSelector) return;
    for (const item of doc.querySelectorAll(itemSelector)) {
      if (item.hasAttribute(ITEM_ATTR)) continue;
      item.setAttribute(ITEM_ATTR, "");
      if (item.parentElement?.closest(itemSelector)) continue; // the outer item covers it
      const links = [...item.querySelectorAll("a[href]")].map((a) => a.href);
      const result = classifySocialItem({ text: item.innerText ?? "", links }, rules, { skipLinkHost: skipHost });
      if (!shouldFireItem(result, surface)) continue;
      item.setAttribute(FLAG_ATTR, "");
      item.prepend(chip(result, "item"));
    }
  }

  function scanLinks() {
    for (const a of doc.querySelectorAll("a[href]")) {
      if (a.hasAttribute(LINK_ATTR)) continue;
      a.setAttribute(LINK_ATTR, "");
      if (a.closest(`[${FLAG_ATTR}]`)) continue;
      const result = classifyLink(a.href, rules);
      if (!result) continue;
      const final = parseHttpUrl(result.url ?? "");
      // The site's own pages are skipped unless their wrapping hides the target.
      if (final && skipHost?.test(final.hostname) && result.signal?.id !== "hidden-destination") continue;
      a.after(chip(result, "link"));
    }
  }

  function scan() {
    scanItems();
    scanLinks();
  }

  return {
    scan,
    start() {
      scan();
      if (observer) return;
      // The first change schedules a pass 800 ms later and later changes
      // join it. A plain debounce could wait forever on a feed that never
      // stops changing.
      observer = new win.MutationObserver(() => {
        if (timer !== null) return;
        timer = win.setTimeout(() => {
          timer = null;
          scan();
        }, SURFACE_DEBOUNCE_MS);
      });
      observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
    },
    stop() {
      observer?.disconnect();
      observer = null;
      if (timer !== null) win.clearTimeout(timer);
      timer = null;
    },
  };
}
