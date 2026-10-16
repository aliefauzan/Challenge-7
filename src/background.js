// Background worker entry: start the background with the real extension api.
import { api } from "./platform/api.js";
import { TARGET } from "./platform/target.js";
import { RULESET_URL, RULESET_PUBLIC_KEY, REFRESH_MINUTES, WELCOME_URL } from "./config.js";
import { startBackground } from "./bg/index.js";
import bundled from "./data/default-ruleset.json";

console.debug(`tm:background loaded target=${TARGET}`);

startBackground(api, {
  target: TARGET,
  bundled,
  rulesetUrl: RULESET_URL,
  keys: { k1: RULESET_PUBLIC_KEY },
  refreshMinutes: REFRESH_MINUTES,
  welcomeUrl: WELCOME_URL,
});
