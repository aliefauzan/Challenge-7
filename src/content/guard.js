// Safari only, top frame, document_start. Safari ignores redirect rules, so
// this script asks the background whether the page is on a known scam
// domain and, if so, leaves it for the blocked page before it renders.
import { api } from "../platform/api.js";
import { guardPage } from "./nav-guard.js";

guardPage({ api, win: window }).catch(() => {
  // The tabs.onUpdated backstop and the content script's warning still apply.
});
