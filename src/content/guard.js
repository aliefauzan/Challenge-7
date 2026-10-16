// Safari only, top frame, document_start. Safari ignores redirect rules, so
// this script asks the background whether the page is on a known scam
// domain and, if so, leaves it for the blocked page before it renders.
import { api } from "../platform/api.js";

async function guard() {
  if (window.top !== window) return;
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const href = location.href;
  try {
    const reply = await api.runtime.sendMessage({ type: "nav-check", href });
    if (reply?.block) location.replace(api.runtime.getURL(`blocked.html#${encodeURIComponent(href)}`));
  } catch {
    // Background unavailable: the tabs.onUpdated backstop still applies.
  }
}

guard();
