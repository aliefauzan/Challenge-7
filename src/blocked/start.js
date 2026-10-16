// The page a blocked navigation lands on. The blocked address arrives in
// the URL hash on both targets (raw from a DNR redirect, encoded from the
// Safari guard script). It is shown
// as text only, and there is no way to continue to the blocked site.
import { parseHttpUrl } from "../engine/url.js";
import { decodeHash } from "../popup/model.js";
import { isSafeHttpUrl } from "../ui/dom.js";
import { reportHref } from "../ui/report.js";

/** The blocked site's host name, or "" when the hash is not an http(s) address. */
export function blockedHost(hash) {
  return parseHttpUrl(decodeHash(hash))?.hostname ?? "";
}

/**
 * @param {{api: object, win: Window, reportBase?: string}} deps
 */
export function startBlockedPage({ api, win, reportBase }) {
  const doc = win.document;
  const host = blockedHost(new URL(win.location.href).hash);

  const domain = doc.querySelector("#domain");
  if (host) domain.textContent = host;
  else domain.parentElement?.remove();

  doc.querySelector("#back").addEventListener("click", async () => {
    if (win.history.length > 1) {
      win.history.back();
      return;
    }
    // Nothing to go back to: close the tab instead.
    try {
      const tab = await api.tabs.getCurrent();
      if (tab?.id != null) await api.tabs.remove(tab.id);
    } catch (err) {
      console.error("tm:blocked", err);
    }
  });

  const report = doc.querySelector("#report");
  const href = reportHref(host, reportBase);
  if (href && isSafeHttpUrl(href)) report.setAttribute("href", href);
  else report.parentElement?.remove();

  return { host };
}
