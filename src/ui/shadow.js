// One <tm-root> host per page with a closed shadow root. The page cannot
// reach inside it, its CSS cannot restyle it, and if a page script removes
// the host it is put back (a few times, so two scripts cannot loop forever).
import { STYLES } from "./styles.js";

export const MAX_REATTACH = 3;

/**
 * @param {{doc?: Document, MutationObserver?: typeof MutationObserver, maxReattach?: number}} [opts]
 */
export function createRoot({ doc = document, MutationObserver = globalThis.MutationObserver, maxReattach = MAX_REATTACH } = {}) {
  const host = doc.createElement("tm-root");
  // Inline !important beats any page stylesheet rule on the host.
  host.setAttribute("style", "all: initial !important; display: block !important;");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = STYLES;
  const slot = doc.createElement("div");
  shadow.append(style, slot);

  let mounted = false;
  let reattaches = 0;
  let observer = null;

  const attach = () => {
    if (!host.isConnected) doc.documentElement.append(host);
  };

  function watch() {
    if (observer || !MutationObserver) return;
    observer = new MutationObserver(() => {
      if (!mounted || host.isConnected) return;
      if (reattaches >= maxReattach) {
        observer.disconnect();
        return;
      }
      reattaches++;
      attach();
    });
    observer.observe(doc.documentElement, { childList: true });
  }

  return {
    host,
    get mounted() {
      return mounted;
    },
    get reattaches() {
      return reattaches;
    },
    /** Show `node` as the only UI on the page. */
    mount(node) {
      slot.replaceChildren(node);
      mounted = true;
      attach();
      watch();
    },
    /** Remove all UI and take the host off the page. */
    clear() {
      mounted = false;
      slot.replaceChildren();
      host.remove();
    },
  };
}
