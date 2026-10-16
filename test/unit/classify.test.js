import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrapRedirect, classifyLink, classifySocialItem, shouldFireItem } from "../../src/engine/classify.js";
import { makeRules } from "./fixtures/rules.js";

const rules = makeRules();

test("engine/classify: unwraps social and search redirect links", () => {
  const target = "https://scam.com/claim?x=1";
  assert.equal(unwrapRedirect(`https://l.facebook.com/l.php?u=${encodeURIComponent(target)}&h=AT0`), target);
  assert.equal(unwrapRedirect(`https://lm.facebook.com/l.php?u=${encodeURIComponent(target)}`), target);
  assert.equal(unwrapRedirect(`https://www.google.com/url?q=${encodeURIComponent(target)}&sa=D`), target);
  assert.equal(unwrapRedirect("https://example.com/a"), "https://example.com/a");
  assert.equal(unwrapRedirect("https://l.facebook.com/l.php?u=javascript%3Aalert(1)"), "https://l.facebook.com/l.php?u=javascript%3Aalert(1)");
  assert.equal(unwrapRedirect("::"), "::");
});

test("engine/classify: only real Google hosts are unwrapped", () => {
  const target = encodeURIComponent("https://clean.example/");
  assert.equal(unwrapRedirect(`https://www.google.co.id/url?q=${target}`), "https://clean.example/");
  assert.equal(unwrapRedirect(`https://google.evil.com/url?q=${target}`), `https://google.evil.com/url?q=${target}`);
  assert.equal(unwrapRedirect(`https://mail.google.com/url?q=${target}`), `https://mail.google.com/url?q=${target}`);
  assert.equal(classifyLink(`https://google.scam.com/url?q=${target}`, rules).kind, "scam");
});

test("engine/classify: nested wrappers are unwrapped and every hop is checked", () => {
  const inner = `https://www.google.com/url?q=${encodeURIComponent("https://fake-parcel.net/pay")}`;
  const outer = `https://l.facebook.com/l.php?u=${encodeURIComponent(inner)}`;
  assert.equal(unwrapRedirect(outer), "https://fake-parcel.net/pay");
  assert.equal(classifyLink(outer, rules).kind, "scam");
  let deep = "https://fake-parcel.net/pay";
  for (let i = 0; i < 8; i++) deep = `https://l.facebook.com/l.php?u=${encodeURIComponent(deep)}`;
  assert.notEqual(unwrapRedirect(deep), "https://fake-parcel.net/pay");
  const viaScamWrapper = `https://scam.com/go?u=${encodeURIComponent("https://clean.example/")}`;
  assert.equal(classifyLink(viaScamWrapper, rules).kind, "scam");
});

test("engine/classify: skip hosts apply to the final destination", () => {
  const wrapped = `https://l.facebook.com/l.php?u=${encodeURIComponent("https://fake-parcel.net/pay")}`;
  const item = { text: "", links: [wrapped] };
  assert.equal(classifySocialItem(item, rules, { skipLinkHost: /(^|\.)facebook\.com$/ }).kind, "scam");
});

test("engine/classify: link priority is scam domain, then URL signal, then source", () => {
  assert.equal(classifyLink("https://x.scam.com/", rules).kind, "scam");
  assert.equal(classifyLink("https://x.scam.com/", rules).signal.source, "domain");
  assert.equal(classifyLink("https://paypal-login.net/", rules).signal.source, "url");
  const src = classifyLink("https://www.tabloid.example/story", rules);
  assert.equal(src.kind, "source");
  assert.equal(src.source.label, "Tabloid Example");
  assert.equal(classifyLink("https://clean.example/", rules), null);
  assert.equal(classifyLink("mailto:a@b.c", rules), null);
});

test("engine/classify: known scam link wins even on an allowlisted host", () => {
  const r = makeRules({ allowlist: rules.scamDomains });
  assert.equal(classifyLink("https://scam.com/", r).kind, "scam");
});

test("engine/classify: social item uses links first, then text", () => {
  const byLink = classifySocialItem({ text: "hello", links: ["https://fake-parcel.net/pay"] }, rules);
  assert.equal(byLink.kind, "scam");
  assert.equal(byLink.basis, "link");
  const byText = classifySocialItem({ text: "You have won a car!", links: [] }, rules);
  assert.equal(byText.basis, "text");
  const bySource = classifySocialItem({ text: "news", links: ["https://satire.example/a"] }, rules);
  assert.equal(bySource.kind, "source");
  assert.equal(classifySocialItem({ text: "", links: [] }, rules), null);
});

test("engine/classify: skip hosts are ignored for links", () => {
  const item = { text: "", links: ["https://scam.com/x"] };
  assert.equal(classifySocialItem(item, rules, { skipLinkHost: /(^|\.)scam\.com$/ }), null);
});

test("engine/classify: text-based items only fire on direct messages", () => {
  const text = { kind: "scam", basis: "text" };
  const link = { kind: "scam", basis: "link" };
  const source = { kind: "source", basis: "link" };
  assert.equal(shouldFireItem(text, "feed"), false);
  assert.equal(shouldFireItem(text, "dm"), true);
  assert.equal(shouldFireItem(link, "feed"), true);
  assert.equal(shouldFireItem(source, "feed"), true);
  assert.equal(shouldFireItem(null, "dm"), false);
});
