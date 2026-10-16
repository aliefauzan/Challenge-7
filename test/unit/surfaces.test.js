import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileRules } from "../../src/engine/ruleset.js";
import { pickAdapter, createSurfaces } from "../../src/content/surfaces.js";
import { startContent } from "../../src/content/page.js";
import { startBackground } from "../../src/bg/index.js";
import { makeFakeApi } from "./fakes/api.js";
import { makeFakeWindow, settle } from "./fakes/dom.js";
import bundled from "../../src/data/default-ruleset.json" with { type: "json" };

const NEWS = { "news.example": { bias: "left", accuracy: "mixed", label: "News Example", rating: "One-sided." } };
const payloadWith = (adapter = {}) => ({
  ...bundled,
  sources: NEWS,
  surface_adapters: { facebook: { ...bundled.surface_adapters.facebook, ...adapter } },
});
const rulesFor = (adapter) => compileRules(payloadWith(adapter)).rules;

const WRAPPED_SCAM = `https://l.facebook.com/l.php?u=${encodeURIComponent("https://shop.scamshield-test.example/sale")}&h=AT0`;
const SCAM_TEXT = "Your computer has been infected. Call Microsoft support now.";

function el(doc, tag, attrs = {}, ...children) {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

/** A feed shaped like the fixture in test/e2e/fixtures/fb-feed.html. */
function feed(win) {
  const doc = win.document;
  const article = (id, ...kids) => el(doc, "div", { role: "article", id }, ...kids);
  const inner = article("inner", el(doc, "p", {}, "Shared post"), el(doc, "a", { href: "https://news.example/a" }, "news"));
  doc.body.append(
    article("wrapped-scam", el(doc, "p", {}, "Huge sale, 90% off!"), el(doc, "a", { href: WRAPPED_SCAM }, "shop now")),
    article("text-only", el(doc, "p", {}, SCAM_TEXT)),
    article("internal", el(doc, "a", { href: "https://www.facebook.com/groups/garden" }, "Garden group")),
    article("outer", el(doc, "p", {}, "Look"), inner),
    el(doc, "div", { id: "sidebar" },
      el(doc, "a", { href: "https://news.example/story", id: "news-link" }, "story"),
      el(doc, "a", { href: "https://scamshield-test.example/x", id: "scam-link" }, "prize"),
      el(doc, "a", { href: "https://www.facebook.com/profile", id: "fb-link" }, "me"),
      el(doc, "a", { href: "/relative/path", id: "rel-link" }, "rel")),
  );
  return doc;
}

const byId = (doc, id) => doc.find((e) => e.getAttribute("id") === id);
const chipsIn = (node) => node.findAll((e) => e.hasAttribute("data-tm-chip"));
const badgeAfter = (a) => {
  const sibs = a.parentNode.childNodes;
  const next = sibs[sibs.indexOf(a) + 1];
  return next?.hasAttribute?.("data-tm-chip") ? next : null;
};

function surfacesOn(href, adapter) {
  const win = makeFakeWindow({ href });
  globalThis.document = win.document;
  const doc = feed(win);
  const rules = rulesFor(adapter);
  const picked = pickAdapter(rules, href);
  const s = createSurfaces({ win, rules, picked });
  return { win, doc, s, rules, picked };
}

test("surfaces: adapter picked by host; messenger /messages is the dm surface", () => {
  const rules = rulesFor();
  assert.equal(pickAdapter(rules, "https://www.facebook.com/").surface, "feed");
  assert.equal(pickAdapter(rules, "https://www.facebook.com/").name, "facebook");
  assert.equal(pickAdapter(rules, "https://www.messenger.com/messages/t/1").surface, "dm");
  assert.equal(pickAdapter(rules, "https://www.messenger.com/").surface, "feed");
  assert.equal(pickAdapter(rules, "https://example.com/"), null);
  assert.equal(pickAdapter(rules, "https://facebook.com.evil.example/"), null);
  assert.equal(pickAdapter(rules, "about:blank"), null);
});

test("surfaces: a wrapped scam link flags its feed item with a chip at the top", () => {
  const { doc, s } = surfacesOn("https://www.facebook.com/");
  s.scan();
  const item = byId(doc, "wrapped-scam");
  assert.equal(item.hasAttribute("data-tm-flagged"), true);
  const chip = item.childNodes[0];
  assert.equal(chip.getAttribute("data-tm-chip"), "scam");
  assert.match(chip.textContent, /Known scam website/);
  // The link inside a flagged item gets no second badge.
  assert.equal(badgeAfter(item.querySelectorAll("a[href]")[0]), null);
});

test("surfaces: text-only scam wording does not fire on the feed", () => {
  const { doc, s } = surfacesOn("https://www.facebook.com/");
  s.scan();
  assert.deepEqual(chipsIn(byId(doc, "text-only")), []);
  assert.equal(byId(doc, "text-only").hasAttribute("data-tm-item"), true, "scanned once and marked");
});

test("surfaces: internal links and nested items are skipped", () => {
  const { doc, s } = surfacesOn("https://www.facebook.com/");
  s.scan();
  assert.deepEqual(chipsIn(byId(doc, "internal")), []);
  assert.equal(badgeAfter(byId(doc, "fb-link")), null);
  // The outer item owns the inner one's link; the inner item is not chipped on its own.
  const outer = byId(doc, "outer");
  assert.equal(chipsIn(outer).length, 1);
  assert.equal(chipsIn(outer)[0].parentNode, outer);
});

test("surfaces: loose links get scam and news-source badges", () => {
  const { doc, s } = surfacesOn("https://www.facebook.com/");
  s.scan();
  assert.equal(badgeAfter(byId(doc, "scam-link")).getAttribute("data-tm-chip"), "scam");
  const news = badgeAfter(byId(doc, "news-link"));
  assert.equal(news.getAttribute("data-tm-chip"), "source");
  assert.match(news.textContent, /News Example/);
  assert.equal(badgeAfter(byId(doc, "rel-link")), null);
  // A second pass adds nothing.
  const before = chipsIn(doc).length;
  s.scan();
  assert.equal(chipsIn(doc).length, before);
});

test("surfaces: chips are text only and carry no links or markup", () => {
  const { doc, s } = surfacesOn("https://www.facebook.com/");
  s.scan();
  for (const chip of chipsIn(doc)) {
    assert.deepEqual(chip.findAll(() => true), [], "no child elements");
    assert.ok(chip.textContent.length > 0);
  }
});

test("surfaces: selectors come from the ruleset", () => {
  const { doc, s } = surfacesOn("https://www.facebook.com/", { item_selector: "[data-post]" });
  s.scan();
  assert.equal(byId(doc, "wrapped-scam").hasAttribute("data-tm-item"), false, "role=article is not hard-coded");
  const src = readFileSync(new URL("../../src/content/surfaces.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /role=|article|facebook|messenger/i);
});

test("surfaces: DM text scanning is off while dm_item_selector is null", () => {
  const off = surfacesOn("https://www.messenger.com/messages/t/1");
  off.s.scan();
  assert.equal(off.doc.findAll((e) => e.hasAttribute("data-tm-item")).length, 0);

  const on = surfacesOn("https://www.messenger.com/messages/t/1", { dm_item_selector: "[role=\"article\"]" });
  on.s.scan();
  const chip = chipsIn(byId(on.doc, "text-only"))[0];
  assert.equal(chip.getAttribute("data-tm-chip"), "scam", "text basis fires in direct messages");
});

test("surfaces: new feed items are scanned 800 ms after the page settles", async () => {
  const { win, doc, s } = surfacesOn("https://www.facebook.com/");
  s.start();
  await settle();
  const late = el(doc, "div", { role: "article", id: "late" }, el(doc, "a", { href: "https://scamshield-test.example/win" }, "claim"));
  doc.body.append(late);
  await win.tick(799);
  assert.equal(late.hasAttribute("data-tm-flagged"), false);
  await win.tick(1);
  assert.equal(late.hasAttribute("data-tm-flagged"), true);
  s.stop();
  const later = el(doc, "div", { role: "article", id: "later" }, el(doc, "a", { href: "https://scamshield-test.example/win" }, "claim"));
  doc.body.append(later);
  await win.tick(2000);
  assert.equal(later.hasAttribute("data-tm-item"), false, "stopped");
});

async function bootFeed(prefs) {
  const href = "https://www.facebook.com/";
  const win = makeFakeWindow({ href });
  globalThis.document = win.document;
  feed(win);
  const api = makeFakeApi();
  api.sender = { id: api.runtime.id, url: href, frameId: 0, tab: { id: 1, url: href } };
  const bg = startBackground(api, { target: "chrome", bundled: payloadWith(), rulesetUrl: "", keys: {}, refreshMinutes: 720, welcomeUrl: "" });
  await bg.ready;
  if (prefs) await api.storage.sync.set({ "tm.prefs": prefs });
  const content = await startContent({ api, win, now: win.now });
  await settle();
  return { win, api, content, doc: win.document };
}

test("surfaces: on a social site the page gets chips, not a page-wide banner for post text", async () => {
  const { doc, content } = await bootFeed();
  assert.equal(content.root.host.isConnected, false, "post text does not raise a page banner");
  assert.equal(byId(doc, "wrapped-scam").hasAttribute("data-tm-flagged"), true);
});

test("surfaces: social protection off adds no chips", async () => {
  const { doc } = await bootFeed({ scam: true, bias: true, social: false });
  assert.equal(chipsIn(doc).length, 0);
});
