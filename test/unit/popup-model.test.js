import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPopupView, platformOf, updatedText } from "../../src/popup/model.js";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const tab = (url = "https://shop.example/cart") => ({ id: 7, url });
const sig = (id, source = "text", severity = "medium") => ({ source, severity, id, description: `desc ${id}`, why: `why ${id}` });
const base = (over = {}) => ({
  target: "chrome",
  platform: "chrome",
  tab: tab(),
  verdict: null,
  prefs: { scam: true, bias: true, social: true },
  meta: { version: 12, source: "bundled", fetchedAt: NOW - 3 * HOUR, errors: [] },
  hasAccess: true,
  now: NOW,
  ...over,
});

test("popup model: a phrase-only warning is shown with its reasons", () => {
  const v = buildPopupView(base({ verdict: { tier: "banner", domain: "shop.example", signals: [sig("gift-001", "text", "high"), sig("secret-002")], sourceInfo: null } }));
  assert.equal(v.status.kind, "warning");
  assert.deepEqual(v.status.reasons.map((r) => r.text), ["desc gift-001", "desc secret-002"]);
  assert.equal(v.status.reasons[0].why, "why gift-001");
  assert.equal(v.status.domain, "shop.example");
});

test("popup model: a shared explanation is shown once", () => {
  const same = (id) => ({ ...sig(id), why: "same why" });
  const v = buildPopupView(base({ verdict: { tier: "banner", domain: "a.example", signals: [same("a"), same("b"), sig("c")], sourceInfo: null } }));
  assert.deepEqual(v.status.reasons.map((r) => r.why), ["same why", null, "why c"]);
});

test("popup model: a raw (unencoded) blocked address still names the site", () => {
  const v = buildPopupView(base({ tab: tab("chrome-extension://abc/blocked.html#https://bad.example/a%zz?x=1") }));
  assert.equal(v.status.domain, "bad.example");
});

test("popup model: a dismissed or bypassed page still lists its signals", () => {
  const v = buildPopupView(base({ verdict: { tier: "clean", domain: "shop.example", signals: [sig("tech-003")], sourceInfo: null } }));
  assert.equal(v.status.kind, "hidden");
  assert.match(v.status.title, /hid/i);
  assert.deepEqual(v.status.reasons.map((r) => r.text), ["desc tech-003"]);
});

test("popup model: blocked tiers, source context and clean pages", () => {
  const blocked = buildPopupView(base({ verdict: { tier: "block", domain: "bad.example", signals: [sig("known-scam-domain", "domain", "high")], sourceInfo: null } }));
  assert.equal(blocked.status.kind, "blocked");
  assert.equal(buildPopupView(base({ verdict: { tier: "block-bypass", domain: "x.example", signals: [sig("a", "text", "high"), sig("b", "url", "high")], sourceInfo: null } })).status.kind, "blocked");

  const source = buildPopupView(base({ verdict: { tier: "bias", domain: "news.example", signals: [], sourceInfo: { bias: "satire", accuracy: "varies", label: "The Joke", rating: "Made-up stories." } } }));
  assert.equal(source.status.kind, "source");
  assert.match(source.status.title, /The Joke/);
  assert.match(source.status.detail, /Made-up stories\./);

  const clean = buildPopupView(base({ verdict: { tier: "clean", domain: "shop.example", signals: [], sourceInfo: null } }));
  assert.equal(clean.status.kind, "clean");
});

test("popup model: browser pages and pages without a verdict are not checked yet", () => {
  for (const url of ["chrome://newtab/", "about:blank", "safari-web-extension://x/popup.html", "", undefined]) {
    assert.equal(buildPopupView(base({ tab: tab(url) })).status.kind, "unchecked", String(url));
  }
  assert.equal(buildPopupView(base()).status.kind, "unchecked");
  assert.equal(buildPopupView(base({ tab: null })).status.kind, "unchecked");
});

test("popup model: on the blocked page the popup names the blocked site", () => {
  const url = `chrome-extension://abc/blocked.html#${encodeURIComponent("https://login.bad.example/pay?x=1")}`;
  const v = buildPopupView(base({ tab: tab(url) }));
  assert.equal(v.status.kind, "blocked");
  assert.equal(v.status.domain, "login.bad.example");
});

test("popup model: scam protection off is said plainly", () => {
  const v = buildPopupView(base({ prefs: { scam: false, bias: true, social: true }, verdict: { tier: "clean", domain: "shop.example", signals: [], sourceInfo: null } }));
  assert.equal(v.status.kind, "off");
});

test("popup model: no website access shows the steps for the current browser", () => {
  assert.equal(buildPopupView(base()).access, null);

  const ios = buildPopupView(base({ target: "safari", platform: "ios", hasAccess: false }));
  assert.equal(ios.access.title, "ScamShield cannot check websites yet");
  assert.deepEqual(ios.access.path, ["Settings", "Apps", "Safari", "Extensions", "ScamShield", "All Websites", "Allow"]);
  assert.equal(ios.access.canRequest, false);
  assert.equal(ios.status.kind, "no-access");

  const mac = buildPopupView(base({ target: "safari", platform: "macos", hasAccess: false }));
  assert.deepEqual(mac.access.path, ["Safari", "Settings", "Extensions", "ScamShield", "Always Allow on Every Website"]);

  const chrome = buildPopupView(base({ hasAccess: false }));
  assert.equal(chrome.access.canRequest, true);
});

test("popup model: toggles mirror prefs, defaults on", () => {
  const v = buildPopupView(base({ prefs: { scam: true, bias: false } }));
  assert.deepEqual(v.toggles.map((t) => [t.key, t.on]), [["scam", true], ["bias", false], ["social", true]]);
  for (const t of v.toggles) assert.ok(t.label && t.hint);
});

test("popup model: ruleset version and age", () => {
  const v = buildPopupView(base());
  assert.equal(v.ruleset.version, 12);
  assert.equal(v.ruleset.updated, "Updated 3 hours ago");
  assert.equal(updatedText(NOW - 10 * 60_000, NOW), "Updated less than an hour ago");
  assert.equal(updatedText(NOW - HOUR, NOW), "Updated 1 hour ago");
  assert.equal(updatedText(NOW - 50 * HOUR, NOW), "Updated 2 days ago");
  assert.equal(updatedText(undefined, NOW), "Not updated yet");
  assert.equal(buildPopupView(base({ meta: null })).ruleset.version, null);
});

test("popup model: platform detection", () => {
  assert.equal(platformOf("chrome", { userAgent: "Mozilla/5.0 (Macintosh) Chrome/156", maxTouchPoints: 0 }), "chrome");
  assert.equal(platformOf("safari", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X)", maxTouchPoints: 5 }), "ios");
  assert.equal(platformOf("safari", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }), "ios", "iPad reports as a Mac with touch");
  assert.equal(platformOf("safari", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 }), "macos");
});

test("popup model: every sentence of copy has at most 20 words", () => {
  const views = [
    base({ verdict: { tier: "banner", domain: "a.example", signals: [sig("x")], sourceInfo: null } }),
    base({ verdict: { tier: "clean", domain: "a.example", signals: [sig("x")], sourceInfo: null } }),
    base({ verdict: { tier: "block", domain: "a.example", signals: [], sourceInfo: null } }),
    base({ verdict: { tier: "clean", domain: "a.example", signals: [], sourceInfo: null } }),
    base({ target: "safari", platform: "ios", hasAccess: false }),
    base({ target: "safari", platform: "macos", hasAccess: false }),
    base({ prefs: { scam: false } }),
    base(),
  ].map(buildPopupView);
  const strings = [];
  const collect = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  views.forEach(collect);
  for (const s of strings) {
    for (const sentence of s.split(/(?<=[.!?])\s+/)) {
      assert.ok(sentence.split(/\s+/).filter(Boolean).length <= 20, `too long: "${sentence}"`);
    }
  }
});
