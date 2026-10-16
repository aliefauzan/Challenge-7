import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeFakeWindow } from "./fakes/dom.js";
import { createRoot } from "../../src/ui/shadow.js";
import { scamBanner, biasBanner, SCAM_HELP_URL } from "../../src/ui/banner.js";
import { blocker, lockScroll } from "../../src/ui/blocker.js";

let win;
beforeEach(() => {
  win = makeFakeWindow();
  globalThis.document = win.document;
});

const sig = (id, severity, extra = {}) => ({ source: "text", severity, id, description: `desc ${id}`, why: `why ${id}`, ...extra });
const verdict = (tier, signals, extra = {}) => ({ tier, domain: "page.example", signals, sourceInfo: null, ...extra });
const byTag = (root, tag) => root.findAll((e) => e.tagName === tag.toUpperCase());
const byClass = (root, cls) => root.findAll((e) => (e.getAttribute("class") ?? "").split(" ").includes(cls));

test("shadow: one closed <tm-root> host on documentElement, with scoped styles", () => {
  const root = createRoot({ doc: win.document, MutationObserver: win.MutationObserver });
  root.mount(win.document.createElement("div"));
  const hosts = win.document.documentElement.childNodes.filter((n) => n.tagName === "TM-ROOT");
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].shadowRoot, undefined, "closed shadow root is not reachable from the page");
  assert.match(hosts[0].getAttribute("style"), /all:\s*initial/);
  assert.equal(byTag(hosts[0], "style").length, 1);
  root.mount(win.document.createElement("div"));
  assert.equal(win.document.documentElement.childNodes.filter((n) => n.tagName === "TM-ROOT").length, 1);
});

test("shadow: clear() detaches the host; a page that removes it gets it back at most 3 times", () => {
  const root = createRoot({ doc: win.document, MutationObserver: win.MutationObserver });
  root.mount(win.document.createElement("div"));
  for (let i = 0; i < 3; i++) {
    root.host.remove();
    assert.equal(root.host.isConnected, true, `re-attach ${i + 1}`);
  }
  root.host.remove();
  assert.equal(root.host.isConnected, false, "gives up after 3 re-attaches");

  const other = createRoot({ doc: win.document, MutationObserver: win.MutationObserver });
  other.mount(win.document.createElement("div"));
  other.clear();
  assert.equal(other.host.isConnected, false);
  assert.equal(other.mounted, false);
});

test("banner: red for any high signal, amber otherwise; at most 3 reasons, highs first", () => {
  const red = scamBanner(verdict("banner", [sig("m1", "medium"), sig("m2", "medium"), sig("h1", "high"), sig("m3", "medium")]), {});
  assert.match(red.getAttribute("class"), /tm-red/);
  assert.equal(red.getAttribute("role"), "alert");
  const reasons = byClass(red, "tm-reason").map((e) => e.textContent);
  assert.deepEqual(reasons, ["desc h1", "desc m1", "desc m2"]);

  const amber = scamBanner(verdict("banner", [sig("m1", "medium")]), {});
  assert.match(amber.getAttribute("class"), /tm-amber/);
});

test("banner: the why disclosure toggles and shows each reason's explanation", () => {
  const b = scamBanner(verdict("banner", [sig("h1", "high"), sig("h1", "high", { description: "dup" })]), {});
  const toggle = byTag(b, "button").find((x) => x.textContent === "Why was this flagged?");
  const panel = byClass(b, "tm-why")[0];
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hasAttribute("hidden"), true);
  assert.equal(toggle.getAttribute("aria-controls"), panel.getAttribute("id"));
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(panel.hasAttribute("hidden"), false);
  assert.match(panel.textContent, /why h1/);
  toggle.click();
  assert.equal(panel.hasAttribute("hidden"), true);
});

test("banner: family line, FTC link and dismiss", () => {
  let dismissed = 0;
  const b = scamBanner(verdict("banner", [sig("h1", "high")]), { onDismiss: () => dismissed++ });
  assert.match(b.textContent, /call a family member/i);
  const link = byTag(b, "a").find((a) => a.getAttribute("href") === SCAM_HELP_URL);
  assert.ok(link, "FTC help link");
  assert.match(SCAM_HELP_URL, /^https:\/\/consumer\.ftc\.gov\//);
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  byTag(b, "button").find((x) => /dismiss/i.test(x.getAttribute("aria-label") ?? x.textContent)).click();
  assert.equal(dismissed, 1);
});

test("banner: remote strings stay text", () => {
  const b = scamBanner(verdict("banner", [sig("x", "high", { description: "<b>bold</b>", why: "<script>alert(1)</script>" })]), {});
  assert.equal(b.findAll((e) => e.textContent === "bold").length, 0, "no element was parsed out of the description");
  assert.equal(byTag(b, "script").length, 0);
  assert.match(b.textContent, /<b>bold<\/b>/);
});

test("bias banner: label, rating, and headline search links on article pages", () => {
  const source = { bias: "far-right", accuracy: "mixed", label: "Example News", rating: "Often misleading headlines." };
  const v = verdict("bias", [], { sourceInfo: source });
  const b = biasBanner(v, { headline: "Mayor & council vote" });
  assert.equal(b.getAttribute("role"), "status");
  assert.match(b.textContent, /Example News/);
  assert.match(b.textContent, /Often misleading headlines\./);
  assert.match(b.textContent, /Far-right/);
  assert.match(b.textContent, /mixed/i);
  const hrefs = byTag(b, "a").map((a) => a.getAttribute("href"));
  assert.equal(hrefs.length, 2);
  for (const href of hrefs) {
    assert.match(href, /^https:\/\//);
    assert.ok(href.includes(encodeURIComponent("Mayor & council vote")), href);
  }
  assert.equal(byTag(biasBanner(v, { headline: "" }), "a").length, 0, "no links without a headline");
});

test("blocker: block has no way past; heading is focusable; buttons reachable", () => {
  let back = 0;
  const { node, focus } = blocker(verdict("block", [sig("known-scam-domain", "high", { source: "domain" })]), { onBack: () => back++, onBypass: () => assert.fail("no bypass on block") });
  assert.equal(node.getAttribute("role"), "alertdialog");
  assert.equal(node.getAttribute("aria-modal"), "true");
  const heading = byTag(node, "h1")[0];
  assert.equal(node.getAttribute("aria-labelledby"), heading.getAttribute("id"));
  assert.equal(heading.getAttribute("tabindex"), "-1");
  const buttons = byTag(node, "button");
  assert.deepEqual(buttons.map((b) => b.textContent), ["Go back to safety"]);
  assert.match(node.textContent, /page\.example/);
  focus();
  assert.equal(win.document.activeElement, heading);
  buttons[0].click();
  assert.equal(back, 1);
});

test("blocker: a report link names only the domain and opens in a new tab", () => {
  const { node } = blocker(verdict("block", [sig("known-scam-domain", "high", { source: "domain" })]), { onBack() {} });
  const [link] = byTag(node, "a");
  assert.equal(link.textContent, "Report a mistake");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  const url = new URL(link.getAttribute("href"));
  assert.equal(url.protocol, "https:");
  assert.equal(url.searchParams.get("body"), "Website: page.example");
});

test("blocker: block-bypass offers the risk button; Tab wraps inside the dialog", () => {
  let bypass = 0;
  const { node } = blocker(verdict("block-bypass", [sig("h1", "high"), sig("h2", "high")]), { onBack() {}, onBypass: () => bypass++ });
  const [backBtn, riskBtn] = byTag(node, "button");
  assert.equal(riskBtn.textContent, "I understand the risk — continue");
  riskBtn.click();
  assert.equal(bypass, 1);

  // Tab from the last control returns to the first; Shift+Tab from the first goes to the last.
  const tab = node.dispatch("keydown", { key: "Tab", shiftKey: false, target: riskBtn });
  assert.equal(tab.defaultPrevented, true);
  assert.equal(win.document.activeElement, backBtn);
  const shiftTab = node.dispatch("keydown", { key: "Tab", shiftKey: true, target: backBtn });
  assert.equal(shiftTab.defaultPrevented, true);
  assert.equal(win.document.activeElement, riskBtn);
  const mid = node.dispatch("keydown", { key: "Tab", shiftKey: false, target: backBtn });
  assert.equal(mid.defaultPrevented, false, "normal Tab order between the buttons");
});

test("blocker: scroll lock restores the page's own overflow", () => {
  win.document.documentElement.style.overflow = "scroll";
  const unlock = lockScroll(win.document);
  assert.equal(win.document.documentElement.style.overflow, "hidden");
  assert.equal(win.document.body.style.overflow, "hidden");
  unlock();
  assert.equal(win.document.documentElement.style.overflow, "scroll");
  assert.equal(win.document.body.style.overflow, "");
});
