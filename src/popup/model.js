// Popup view model. Pure: it takes what popup.js read from the browser and
// returns the words and states to show. No extension APIs, no DOM.
import { parseHttpUrl } from "../engine/url.js";

const HOUR = 3_600_000;

const TOGGLES = [
  { key: "scam", label: "Scam protection", hint: "Warns you about scam pages and blocks known scam websites." },
  { key: "bias", label: "News source notes", hint: "Tells you who runs some news websites." },
  { key: "social", label: "Social media checks", hint: "Marks risky posts and links on social media." },
];

const BIAS_TEXT = {
  "far-right": "Far-right bias.",
  right: "Right-leaning bias.",
  left: "Left-leaning bias.",
  "far-left": "Far-left bias.",
  conspiracy: "Spreads conspiracy theories.",
  "state-affiliated": "Run or paid for by a government.",
  platform: "Anyone can post here.",
  satire: "Satire: the stories are jokes.",
};

/** "ios" | "macos" | "chrome", from the build target and navigator details. */
export function platformOf(target, nav = {}) {
  if (target !== "safari") return "chrome";
  const ua = nav.userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return "ios";
  return "macos";
}

export function updatedText(fetchedAt, now) {
  if (typeof fetchedAt !== "number") return "Not updated yet";
  const hours = Math.floor(Math.max(0, now - fetchedAt) / HOUR);
  if (hours < 1) return "Updated less than an hour ago";
  if (hours < 48) return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Updated ${Math.floor(hours / 24)} days ago`;
}

function accessCard(target, platform) {
  const title = "ScamShield cannot check websites yet";
  if (target !== "safari") {
    return { title, intro: "Allow ScamShield to read the websites you visit.", path: [], canRequest: true };
  }
  if (platform === "ios") {
    return {
      title,
      intro: "Safari needs your permission first. Open the Settings app and go to:",
      path: ["Settings", "Apps", "Safari", "Extensions", "ScamShield", "All Websites", "Allow"],
      note: "If it says Ask, Safari will not ask you. Choose Allow.",
      canRequest: false,
    };
  }
  return {
    title,
    intro: "Safari needs your permission first. In Safari, go to:",
    path: ["Safari", "Settings", "Extensions", "ScamShield", "Always Allow on Every Website…"],
    note: "Look under Permissions. The button is below \"You have not allowed this extension on any websites yet.\"",
    canRequest: false,
  };
}

// Related signals often share one explanation; show it once, under the
// first signal that has it.
function reasonsOf(signals = []) {
  const seen = new Set();
  return signals.map((s) => {
    const why = s.why && !seen.has(s.why) ? s.why : null;
    if (s.why) seen.add(s.why);
    return { text: s.description, why };
  });
}

/** Decode a URL hash; DNR redirects put the address in raw, guard.js encodes it. */
export function decodeHash(hash) {
  const raw = String(hash ?? "").replace(/^#/, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The blocked address when `url` is our own blocked page, else null. */
export function blockedPageAddress(url) {
  const m = /^[a-z-]+-extension:\/\/[^/]+\/blocked\.html#(.+)$/.exec(url ?? "");
  return m ? decodeHash(m[1]) : null;
}

const blockedPageHost = (url) => {
  const address = blockedPageAddress(url);
  return address == null ? null : (parseHttpUrl(address)?.hostname ?? null);
};

function statusOf({ tab, verdict, prefs, hasAccess, blockedListed }) {
  // Any website can open the blocked page with any address in it, so the
  // site is named only when the background confirmed it is on the list.
  const blockedHost = blockedListed === true ? blockedPageHost(tab?.url) : null;
  if (blockedHost) {
    return { kind: "blocked", title: "ScamShield blocked a scam website", detail: "You are safe. The website did not open.", domain: blockedHost, reasons: [] };
  }
  const page = parseHttpUrl(tab?.url ?? "");
  if (!page) {
    return { kind: "unchecked", title: "Nothing to check here", detail: "ScamShield checks websites. This is a page of the browser itself.", domain: "", reasons: [] };
  }
  const domain = verdict?.domain || page.hostname;
  if (!hasAccess) {
    return { kind: "no-access", title: "Not checked", detail: "ScamShield needs permission to check this page.", domain, reasons: [] };
  }
  if (!verdict) {
    return { kind: "unchecked", title: "Not checked yet", detail: "Reload the page if this does not change.", domain, reasons: [] };
  }
  const reasons = reasonsOf(verdict.signals);
  switch (verdict.tier) {
    case "block":
    case "block-bypass":
      return { kind: "blocked", title: "This page is a scam", detail: "Do not pay, call, or type passwords here.", domain, reasons };
    case "banner":
      return { kind: "warning", title: "Warning signs on this page", detail: "Stop and talk to someone you trust before you pay or call.", domain, reasons };
    case "bias": {
      const s = verdict.sourceInfo ?? {};
      const detail = [BIAS_TEXT[s.bias], s.rating].filter(Boolean).join(" ");
      return { kind: "source", title: `About this source: ${s.label ?? domain}`, detail, domain, reasons: [] };
    }
    default:
      if (reasons.length) {
        return { kind: "hidden", title: "You hid the warning on this site", detail: "These warning signs are still here.", domain, reasons };
      }
      if (prefs.scam === false) {
        return { kind: "off", title: "Scam protection is off", detail: "Turn it on below to check pages again.", domain, reasons: [] };
      }
      return { kind: "clean", title: "No warning signs found", detail: "Still be careful with money and passwords.", domain, reasons: [] };
  }
}

/**
 * @param {{target: string, platform: string, tab: {id: number, url?: string} | null,
 *   verdict: object | null, prefs: object, meta: object | null, hasAccess: boolean, now: number,
 *   blockedListed?: boolean}} input
 */
export function buildPopupView(input) {
  const prefs = { scam: true, bias: true, social: true, ...(input.prefs ?? {}) };
  // Safari can answer "not granted" for every website while access is
  // granted (see start.js), and a page of the browser itself has no site of
  // its own to ask about, so on Safari the card shows on websites only.
  const onWebsite = Boolean(parseHttpUrl(input.tab?.url ?? ""));
  const showAccess = !input.hasAccess && (input.target !== "safari" || onWebsite);
  return {
    access: showAccess ? accessCard(input.target, input.platform) : null,
    status: statusOf({ ...input, prefs }),
    toggles: TOGGLES.map((t) => ({ ...t, on: prefs[t.key] !== false })),
    ruleset: {
      version: input.meta?.version ?? null,
      updated: updatedText(input.meta?.fetchedAt, input.now),
      errors: input.meta?.errors?.length ?? 0,
    },
  };
}
