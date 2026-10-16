import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeWindow, settle } from "./fakes/dom.js";
import { makeFakeApi } from "./fakes/api.js";
import { startPopup } from "../../src/popup/start.js";
import { startBlockedPage, blockedHost } from "../../src/blocked/start.js";
import { reportHref } from "../../src/ui/report.js";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

let win;
beforeEach(() => {
  win = makeFakeWindow({ href: "chrome-extension://ext-id/popup.html" });
  globalThis.document = win.document;
  win.document.body.append(win.document.createElement("main"));
});

const main = () => win.document.querySelector("main");
const byTag = (node, tag) => node.findAll((e) => e.tagName === tag.toUpperCase());
const switches = () => main().findAll((e) => e.getAttribute("role") === "switch");

async function popup({ verdict, prefs, meta, hostAccess = true, target = "chrome", nav } = {}) {
  const api = makeFakeApi();
  api.activeTab = { id: 7, url: "https://shop.example/cart" };
  api.hostAccess = hostAccess;
  if (verdict) await api.storage.session.set({ "tm.verdict.7": verdict });
  if (prefs) await api.storage.sync.set({ "tm.prefs": prefs });
  await api.storage.local.set({ "tm.rulesetMeta": meta ?? { version: 12, fetchedAt: NOW - 2 * HOUR, errors: [] } });
  const ui = await startPopup({ api, doc: win.document, target, nav, now: () => NOW });
  return { api, ui };
}

const sig = (id, source = "text") => ({ id, source, severity: "high", description: `desc ${id}`, why: `why ${id}` });

test("popup page: a phrase-only warning lists its reasons inside a disclosure", async () => {
  await popup({ verdict: { tier: "banner", domain: "shop.example", signals: [sig("gift"), sig("secret")], sourceInfo: null } });
  const status = main().find((e) => e.getAttribute("data-kind"));
  assert.equal(status.getAttribute("data-kind"), "warning");
  assert.match(status.textContent, /shop\.example/);
  const details = byTag(main(), "details")[0];
  assert.match(byTag(details, "summary")[0].textContent, /2 warning signs/);
  assert.deepEqual(byTag(details, "b").map((b) => b.textContent), ["desc gift", "desc secret"]);
  assert.match(main().textContent, /Scam list version 12\. Updated 2 hours ago\./);
});

test("popup page: no verdict yet reads as not checked; it updates when the verdict arrives", async () => {
  const { api } = await popup();
  const kind = () => main().find((e) => e.getAttribute("data-kind")).getAttribute("data-kind");
  assert.equal(kind(), "unchecked");
  await api.storage.session.set({ "tm.verdict.7": { tier: "clean", domain: "shop.example", signals: [], sourceInfo: null } });
  await settle();
  assert.equal(kind(), "clean");
});

test("popup page: toggles are switches; a click writes prefs and the page re-renders", async () => {
  const { api } = await popup({ prefs: { scam: true, bias: false, social: true } });
  assert.deepEqual(switches().map((s) => [s.getAttribute("data-key"), s.getAttribute("aria-checked")]), [
    ["scam", "true"],
    ["bias", "false"],
    ["social", "true"],
  ]);
  switches()[2].click();
  await settle();
  assert.deepEqual((await api.storage.sync.get("tm.prefs"))["tm.prefs"], { scam: true, bias: false, social: false });
  assert.equal(switches()[2].getAttribute("aria-checked"), "false", "a reopened popup reads the stored value");
});

test("popup page: Safari without website access shows the steps, and no request button", async () => {
  await popup({ hostAccess: false, target: "safari", nav: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X)", maxTouchPoints: 5 } });
  const card = main().find((e) => (e.getAttribute("class") ?? "").includes("access"));
  assert.match(card.textContent, /ScamShield cannot check websites yet/);
  assert.deepEqual(byTag(card, "li").map((li) => li.textContent), ["Settings", "Apps", "Safari", "Extensions", "ScamShield", "All Websites", "Allow"]);
  assert.equal(byTag(card, "button").length, 0);
});

test("popup page: Chrome without access offers a button that asks for it", async () => {
  const { api } = await popup({ hostAccess: false });
  const button = byTag(main(), "button").find((b) => b.textContent === "Allow access");
  button.click();
  await settle();
  assert.deepEqual(api.calls.permissionRequests, [{ origins: ["<all_urls>"] }]);
  assert.equal(main().find((e) => (e.getAttribute("class") ?? "").includes("access")), null, "card gone once granted");
});

test("popup page: page text is never parsed as markup", async () => {
  await popup({ verdict: { tier: "banner", domain: "<img src=x onerror=alert(1)>", signals: [sig("<b>x</b>")], sourceInfo: null } });
  assert.equal(main().find((e) => e.tagName === "IMG"), null);
  assert.match(main().textContent, /<img src=x/);
});

// ---- blocked page -------------------------------------------------------

function blockedDom(href) {
  win = makeFakeWindow({ href });
  globalThis.document = win.document;
  const doc = win.document;
  const el = (tag, attrs = {}, ...kids) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...kids);
    return e;
  };
  doc.body.append(
    el("main", {},
      el("p", { class: "domain" }, "Website: ", el("b", { id: "domain" }, "unknown")),
      el("button", { id: "back", type: "button" }, "Go back"),
      el("p", { class: "report" }, el("a", { id: "report" }, "Report a mistake"))),
  );
  return doc;
}
const blockedUrl = (target) => `chrome-extension://ext-id/blocked.html#${encodeURIComponent(target)}`;

test("blocked page: the domain is shown as text, from the hash", () => {
  const doc = blockedDom(blockedUrl("https://login.bad.example/pay?card=1#x"));
  const { host } = startBlockedPage({ api: makeFakeApi(), win });
  assert.equal(host, "login.bad.example");
  assert.equal(doc.querySelector("#domain").textContent, "login.bad.example");
  assert.equal(doc.querySelector("#domain").childNodes.length, 1);
});

test("blocked page: markup or a non-web address in the hash shows no domain", () => {
  for (const target of ["<img src=x onerror=alert(1)>", "javascript:alert(1)", "%E0%A4%A", ""]) {
    assert.equal(blockedHost(`#${target}`), "", target);
  }
  const doc = blockedDom("chrome-extension://ext-id/blocked.html#%3Cb%3Ehi%3C%2Fb%3E");
  startBlockedPage({ api: makeFakeApi(), win });
  assert.equal(doc.querySelector("#domain"), null, "the domain line is removed");
});

test("blocked page: Go back uses history, or closes the tab when there is none", async () => {
  blockedDom(blockedUrl("https://bad.example/"));
  const api = makeFakeApi();
  api.currentTab = { id: 42 };
  startBlockedPage({ api, win });
  win.document.querySelector("#back").click();
  await settle();
  assert.deepEqual(api.calls.tabsRemove, [42], "history.length is 1");

  blockedDom(blockedUrl("https://bad.example/"));
  win.history.length = 3;
  const api2 = makeFakeApi();
  startBlockedPage({ api: api2, win });
  win.document.querySelector("#back").click();
  await settle();
  assert.equal(win.wentBack, 1);
  assert.deepEqual(api2.calls.tabsRemove, []);
});

test("blocked page: there is no control that continues to the blocked site", () => {
  const html = readFileSync(new URL("../../src/blocked/blocked.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /continue|proceed|anyway/i);
  assert.match(html, /id="domain"/);
  assert.match(html, /id="back"/);
  assert.match(html, /id="report"/);
  assert.doesNotMatch(html, /<script>|\son\w+=/i, "no inline script or handlers");
});

test("blocked page: report link carries the domain only; empty base hides it", () => {
  const doc = blockedDom(blockedUrl("https://bad.example/secret-token?x=1"));
  startBlockedPage({ api: makeFakeApi(), win });
  const href = doc.querySelector("#report").getAttribute("href");
  assert.equal(new URL(href).searchParams.get("body"), "Website: bad.example");
  assert.doesNotMatch(href, /secret-token/);

  const doc2 = blockedDom(blockedUrl("https://bad.example/"));
  startBlockedPage({ api: makeFakeApi(), win, reportBase: "" });
  assert.equal(doc2.querySelector("#report"), null);
  assert.equal(reportHref("x.example", "javascript:alert(1)"), null);
});
