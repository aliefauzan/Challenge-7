// The page a blocked navigation lands on. The blocked address arrives in
// the URL hash on both targets (raw from a DNR redirect, encoded from the
// Safari guard script). It is shown
// as text only, and there is no way to continue to the blocked site.
import { parseHttpUrl } from "../engine/url.js";
import { decodeHash } from "../popup/model.js";
import { isSafeHttpUrl } from "../ui/dom.js";
import { reportHref } from "../ui/report.js";
import { ask } from "../platform/ask.js";

/** The blocked site's host name, or "" when the hash is not an http(s) address. */
export function blockedHost(hash) {
  return parseHttpUrl(decodeHash(hash))?.hostname ?? "";
}

/**
 * Shows the blocked site's name only when the background confirms it is on
 * the scam list: the page is web-accessible, so a website could open it with
 * a trusted bank's address in the hash. Refuses to render inside a frame.
 * @param {{api: object, win: Window, reportBase?: string}} deps
 * @returns {Promise<{host: string, framed?: boolean}>}
 */
export async function startBlockedPage({ api, win, reportBase }) {
  const doc = win.document;
  if (win.top !== win) {
    doc.body.replaceChildren();
    return { host: "", framed: true };
  }

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

  const hash = new URL(win.location.href).hash;
  let host = blockedHost(hash);
  if (host) {
    const reply = await ask(api, { type: "blocked-check", href: decodeHash(hash) });
    if (reply?.listed !== true) host = "";
  }

  const domainLine = doc.querySelector(".domain");
  if (host) {
    doc.querySelector("#domain").textContent = host;
    domainLine.removeAttribute("hidden");
  } else {
    domainLine.remove();
  }

  const report = doc.querySelector("#report");
  const href = reportHref(host, reportBase);
  if (href && isSafeHttpUrl(href)) report.setAttribute("href", href);
  else report.parentElement?.remove();

  return { host };
}
