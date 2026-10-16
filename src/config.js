// Runtime configuration. Empty RULESET_URL disables the remote fetch; the
// bundled ruleset is used instead.
export const RULESET_URL = "";
// Base64 raw Ed25519 public key that signs the ruleset envelope. Generate one with `npm run keygen`.
export const RULESET_PUBLIC_KEY = "54GBozjhyb/1W59SAZOAp1IwsrPCG07n4IgTAx/2Of8=";
export const REFRESH_MINUTES = 720;
export const WELCOME_URL = "";
// Where "Report a mistake" links go (blocked page and full-page warning).
// Empty hides the link.
export const REPORT_URL = "https://github.com/aliefauzan/scamshield/issues/new?labels=false-positive&title=Wrongly+blocked";
