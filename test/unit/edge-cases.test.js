// Edge cases: legit pages that ask for an email, phone number or code and
// must stay clean, scam pages that must warn, and the cases the rules get
// wrong today. Each fixture in test/e2e/fixtures/case-*.html is run through
// the same scan and tier logic the content script uses, with the host name
// the page is opened on. The same fixtures are opened in Safari for the
// screenshots in the flow document.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileRules } from "../../src/engine/ruleset.js";
import { scanPage } from "../../src/content/scan.js";
import { decideTier } from "../../src/engine/tier.js";
import bundled from "../../src/data/default-ruleset.json" with { type: "json" };

const { rules } = compileRules(bundled);

/** Visible text of a fixture's body, one line per element, like innerText. */
function fixtureText(name) {
  const html = readFileSync(new URL(`../e2e/fixtures/${name}.html`, import.meta.url), "utf8");
  const body = html.slice(html.indexOf("<body>"), html.indexOf("</body>"));
  return body
    .replace(/<[^>]*>/g, "\n")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function verdict(href, text) {
  const s = scanPage({ href, text, rules });
  const { tier } = decideTier(s.signals, {
    domain: s.domain,
    knownDomain: s.knownDomain,
    source: s.source,
    prefs: { scam: true, bias: true, social: true },
    dismissed: false,
    bypassed: false,
    blockHighCount: rules.thresholds.block_high_count,
  });
  return { tier, ids: s.signals.map((x) => x.id).sort() };
}

const page = (host, name) => verdict(`http://${host}.localhost:8787/${name}.html`, fixtureText(name));

describe("legit pages stay clean", () => {
  test("parcel tracking asks for a tracking number, email or phone", () => {
    assert.deepEqual(page("parcel-tracking", "case-parcel-track"), { tier: "clean", ids: [] });
  });
  test("sign-in page asks for an email or phone", () => {
    assert.deepEqual(page("accounts-sign-in", "case-sign-in"), { tier: "clean", ids: [] });
    assert.deepEqual(verdict("https://accounts.google.com/signin", fixtureText("case-sign-in")), { tier: "clean", ids: [] });
  });
  test("missed delivery notice with nothing to pay", () => {
    assert.deepEqual(page("parcel-depot", "case-missed-you"), { tier: "clean", ids: [] });
  });
  test("bank one-time code page that says never share the code", () => {
    assert.deepEqual(page("bank-code", "case-bank-code"), { tier: "clean", ids: [] });
  });
  test("shop selling gift cards without a pay-with-gift-card request", () => {
    assert.deepEqual(page("gift-shop", "case-gift-shop"), { tier: "clean", ids: [] });
  });
  test("account locked after wrong passwords, no sign-in link in the same sentence", () => {
    assert.deepEqual(page("account-help", "case-account-locked"), { tier: "clean", ids: [] });
  });
  test("Indonesian tracking page asks for a receipt number, email or phone", () => {
    assert.deepEqual(page("cek-resi", "case-cek-resi"), { tier: "clean", ids: [] });
  });
  test("courier asking for import duty on its own site (allowlisted)", () => {
    assert.deepEqual(verdict("https://www.dhl.com/duty", fixtureText("case-customs")), { tier: "clean", ids: [] });
  });
  test("consumer advice quoting scam lines on an advice site (phrase allowlist)", () => {
    assert.deepEqual(verdict("https://consumer.ftc.gov/scams", fixtureText("case-news-quote")), { tier: "clean", ids: [] });
  });
  test("router admin page on a private address", () => {
    const text = "Router settings\nSign in with the admin password printed under your router.";
    assert.deepEqual(verdict("http://192.168.1.1/", text), { tier: "clean", ids: [] });
    assert.deepEqual(verdict("http://127.0.0.1:8787/", text), { tier: "clean", ids: [] });
  });
});

describe("scam pages warn", () => {
  test("one strong sign (prize) shows a banner, not a full-page warning", () => {
    assert.deepEqual(page("prize-win", "case-prize"), { tier: "banner", ids: ["prize-001"] });
  });
  test("three medium signs (parcel held, fee, do not close) show a banner", () => {
    assert.deepEqual(page("parcel-hold", "case-parcel-hold"), { tier: "banner", ids: ["delivery-001", "delivery-002", "tech-003"] });
  });
  test("courier customs text on a look-alike host shows a banner", () => {
    assert.deepEqual(page("dhl.customs-payment", "case-customs"), { tier: "banner", ids: ["brand-subdomain", "delivery-003"] });
  });
  test("brand name in a subdomain plus a login word gives the full-page warning", () => {
    assert.deepEqual(page("paypal.account-check", "case-brand-login"), { tier: "block-bypass", ids: ["brand-subdomain", "lookalike-brand"] });
  });
  test("fake virus alert in capitals gives the full-page warning", () => {
    assert.deepEqual(page("virus-alert", "case-virus-caps"), { tier: "block-bypass", ids: ["tech-001", "tech-002"] });
  });
  test("fee paid in gift cards gives the full-page warning", () => {
    assert.deepEqual(page("gift-fee", "case-gift-fee"), { tier: "block-bypass", ids: ["gift-001", "gift-002"] });
  });
  test("'new number' family message shows a banner", () => {
    assert.deepEqual(page("chat-mum", "case-new-number"), { tier: "banner", ids: ["family-002"] });
  });
  test("known scam domain blocks with no way through", () => {
    assert.equal(verdict("https://pay.scamshield-test.example/", "Track your parcel").tier, "block");
  });
});

// What the rules get wrong today. These assert the current behaviour so a
// change to the rules shows up here; see "What it cannot do" in the README.
describe("known gaps", () => {
  test("missed: Indonesian parcel-fee scam (English-only phrases)", () => {
    assert.deepEqual(page("paket-tertahan", "case-paket-tertahan"), { tier: "clean", ids: [] });
  });
  test("missed: digits in place of letters", () => {
    assert.deepEqual(page("virus-alert-typo", "case-virus-typo"), { tier: "clean", ids: [] });
  });
  test("missed: scam text drawn in an image", () => {
    assert.deepEqual(page("virus-alert-image", "case-scam-image"), { tier: "clean", ids: [] });
  });
  test("missed: fake mail sign-in with no scam wording", () => {
    assert.deepEqual(page("mail-sign-in.account-verify", "case-fake-mail-login"), { tier: "clean", ids: [] });
  });
  test("false alarm: bank advice that names the scam it warns about", () => {
    assert.deepEqual(page("bank-advice", "case-bank-advice"), { tier: "block-bypass", ids: ["safe-001", "secret-001"] });
  });
  test("false alarm: news story quoting a scam call", () => {
    assert.deepEqual(page("daily-news", "case-news-quote"), { tier: "block-bypass", ids: ["tech-001", "tech-002"] });
  });
  test("false alarm: shop inviting you to buy a gift card", () => {
    assert.deepEqual(page("flower-shop", "case-flower-shop"), { tier: "banner", ids: ["gift-001"] });
  });
});
