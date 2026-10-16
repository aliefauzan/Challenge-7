// Content script entry: every http(s) page and frame, at document_idle.
import { api } from "../platform/api.js";
import { TARGET } from "../platform/target.js";
import { startContent } from "./page.js";

console.debug(`tm:content loaded target=${TARGET}`);
startContent({ api, win: window }).catch((err) => console.error("tm:content", err));
