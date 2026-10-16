import { api } from "../platform/api.js";
import { TARGET } from "../platform/target.js";
import { startPopup } from "./start.js";

console.debug(`tm:popup loaded target=${TARGET}`);

startPopup({ api, doc: document, target: TARGET, nav: globalThis.navigator ?? {} }).catch((err) => console.error("tm:popup", err));
