import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeFakeWindow } from "./fakes/dom.js";
import { h, isSafeHttpUrl } from "../../src/ui/dom.js";

beforeEach(() => {
  globalThis.document = makeFakeWindow().document;
});

test("dom: isSafeHttpUrl accepts only http and https", () => {
  assert.equal(isSafeHttpUrl("https://example.com/a?b=1"), true);
  assert.equal(isSafeHttpUrl("http://example.com"), true);
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "//example.com", "", null, undefined, 42]) {
    assert.equal(isSafeHttpUrl(bad), false, String(bad));
  }
});

test("dom: strings become text nodes, never markup", () => {
  const el = h("p", null, "<img src=x onerror=alert(1)>", " & more");
  assert.equal(el.tagName, "P");
  assert.equal(el.textContent, "<img src=x onerror=alert(1)> & more");
  assert.equal(el.findAll(() => true).length, 0, "no element children were parsed out of the string");
});

test("dom: numbers become text; null, false and undefined children are skipped; arrays flatten", () => {
  const el = h("ul", null, [h("li", null, "a"), null, [h("li", null, 2)]], false, undefined);
  assert.equal(el.childNodes.length, 2);
  assert.equal(el.textContent, "a2");
});

test("dom: href is set only for http(s) URLs", () => {
  assert.equal(h("a", { href: "https://ok.example/" }).getAttribute("href"), "https://ok.example/");
  assert.equal(h("a", { href: "javascript:alert(1)" }).hasAttribute("href"), false);
  assert.equal(h("a", { href: "data:text/html,hi" }).hasAttribute("href"), false);
});

test("dom: event handlers are functions only; on* strings and src-like attributes are dropped", () => {
  let clicks = 0;
  const btn = h("button", { onClick: () => clicks++, onmouseover: "alert(1)", src: "https://x.example/", srcdoc: "<b>", style: "color:red" });
  btn.click();
  assert.equal(clicks, 1);
  assert.equal(btn.hasAttribute("onmouseover"), false);
  assert.equal(btn.hasAttribute("src"), false);
  assert.equal(btn.hasAttribute("srcdoc"), false);
  assert.equal(btn.hasAttribute("style"), false);
});

test("dom: class, aria and data attributes pass through; true becomes an empty attribute", () => {
  const el = h("div", { class: "tm-x", "aria-label": "Close", "data-tier": "banner", hidden: true, tabindex: -1 });
  assert.equal(el.getAttribute("class"), "tm-x");
  assert.equal(el.getAttribute("aria-label"), "Close");
  assert.equal(el.getAttribute("data-tier"), "banner");
  assert.equal(el.getAttribute("hidden"), "");
  assert.equal(el.getAttribute("tabindex"), "-1");
});
