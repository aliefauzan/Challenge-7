import { api } from "../platform/api.js";
import { TARGET } from "../platform/target.js";
import { startBlockedPage } from "./start.js";

console.debug(`tm:blocked loaded target=${TARGET}`);

try {
  startBlockedPage({ api, win: window });
} catch (err) {
  console.error("tm:blocked", err);
}
