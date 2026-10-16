// The content script end to end against the real background code, a fake
// extension API and a fake DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeApi } from "./fakes/api.js";
import { makeFakeWindow, addText, settle } from "./fakes/dom.js";
import { startBackground } from "../../src/bg/index.js";
import { verdictKey } from "../../src/bg/verdicts.js";
import { startContent } from "../../src/content/page.js";
import bundled from "../../src/data/default-ruleset.json" with { type: "json" };

const FILLER = "Ordinary page text about gardening and the weather this week. ".repeat(5);
const SCAM_TEXT = "Warning! Your computer has been infected. Do not close this window.";
const TWO_HIGHS = "Your computer is infected. Call Microsoft support at once.";

async function boot({ href = "https://page.example/", text = FILLER, payload = bundled, prefs, subFrame = false, before } = {}) {
  const win = makeFakeWindow({ href, top: subFrame ? {} : null });
  globalThis.document = win.document;
  if (text) addText(win, text);
  const api = makeFakeApi();
  api.sender = { id: api.runtime.id, url: href, frameId: subFrame ? 2 : 0, tab: { id: 1, url: href } };
  const bg = startBackground(api, { target: "chrome", bundled: payload, rulesetUrl: "", keys: {}, refreshMinutes: 720, welcomeUrl: "" });
  await bg.ready;
  if (prefs) await api.storage.sync.set({ "tm.prefs": prefs });
  await before?.(api, win);
  const content = await startContent({ api, win, now: win.now });
  await settle();
  return { win, api, content };
}

const ui = (content) => (content.root.host.isConnected ? content.root.host : null);
const tierShown = (content) => ui(content)?.find((e) => e.hasAttribute("data-tier"))?.getAttribute("data-tier") ?? "none";
const stored = (api) => api.storage.session.data.get(verdictKey(1));
const buttons = (content) => ui(content).findAll((e) => e.tagName === "BUTTON");

test("content: scam wording shows the banner and reports the verdict", async () => {
  const { api, content } = await boot({ text: FILLER + SCAM_TEXT });
  assert.equal(tierShown(content), "banner");
  assert.equal(stored(api).tier, "banner");
  assert.deepEqual(stored(api).signals.map((s) => s.id).sort(), ["tech-001", "tech-003"]);
  assert.deepEqual(api.calls.badgeText.at(-1), { tabId: 1, text: "!" });
});

test("content: a clean page shows nothing and reports clean", async () => {
  const { api, content } = await boot();
  assert.equal(ui(content), null);
  assert.equal(stored(api).tier, "clean");
});

test("content: scam text added 2 s after load is caught", async () => {
  const { win, api, content } = await boot();
  assert.equal(tierShown(content), "none");
  await win.tick(2000);
  addText(win, SCAM_TEXT + " " + FILLER);
  await win.tick(1500);
  assert.equal(tierShown(content), "banner");
  assert.equal(stored(api).tier, "banner");
});

test("content: a known scam domain gets the blocker with no way past", async () => {
  const { win, content } = await boot({ href: "https://login.scamshield-test.example/" });
  assert.equal(tierShown(content), "block");
  const dialog = ui(content).find((e) => e.getAttribute("role") === "alertdialog");
  assert.ok(dialog);
  assert.equal(win.document.activeElement?.tagName, "H1", "heading has focus");
  assert.deepEqual(buttons(content).map((b) => b.textContent), ["Go back to safety"]);
  assert.equal(win.document.documentElement.style.overflow, "hidden");
  buttons(content)[0].click();
  assert.deepEqual(win.replaced, ["about:blank"], "no history: leave for a blank page");
});

test("content: two high signals give block-bypass; continuing sets the bypass flag", async () => {
  const { win, api, content } = await boot({ text: FILLER + TWO_HIGHS });
  assert.equal(tierShown(content), "block-bypass");
  buttons(content).find((b) => b.textContent.startsWith("I understand the risk")).click();
  await settle();
  assert.equal(api.storage.session.data.get("tm.bypass.page.example"), 1);
  assert.equal(tierShown(content), "banner", "the warning stays, as a banner");
  assert.equal(win.document.documentElement.style.overflow ?? "", "", "scroll unlocked");
  assert.equal(stored(api).tier, "banner");
});

test("content: dismissing hides the banner but keeps reporting the signals", async () => {
  const { api, content } = await boot({ text: FILLER + SCAM_TEXT });
  buttons(content).find((b) => b.getAttribute("aria-label") === "Dismiss this warning").click();
  await settle();
  assert.equal(ui(content), null);
  assert.equal(api.storage.session.data.get("tm.dismiss.page.example"), 1);
  assert.equal(stored(api).tier, "clean");
  assert.equal(stored(api).signals.length, 2);
});

test("content: a dismissed site stays quiet on the next page load", async () => {
  const { content } = await boot({
    text: FILLER + SCAM_TEXT,
    before: (api) => api.storage.session.set({ "tm.dismiss.page.example": 1 }),
  });
  assert.equal(ui(content), null);
});

test("content: scam protection off means no warning", async () => {
  const { api, content } = await boot({ text: FILLER + TWO_HIGHS, prefs: { scam: false, bias: true, social: true } });
  assert.equal(ui(content), null);
  assert.equal(stored(api).tier, "clean");
});

test("content: a listed news source on an article page gets the bias banner", async () => {
  const payload = { ...bundled, version: bundled.version, sources: { "page.example": { bias: "left", accuracy: "mixed", label: "Page News", rating: "Leans one way." } } };
  const { content } = await boot({
    payload,
    before: (api, win) => {
      const meta = win.document.createElement("meta");
      meta.setAttribute("property", "og:title");
      meta.setAttribute("content", "Council approves new park");
      win.document.head.append(meta);
      const type = win.document.createElement("meta");
      type.setAttribute("property", "og:type");
      type.setAttribute("content", "article");
      win.document.head.append(type);
    },
  });
  assert.equal(tierShown(content), "bias");
  const links = ui(content).findAll((e) => e.tagName === "A").map((a) => a.getAttribute("href"));
  assert.equal(links.length, 2);
  assert.ok(links.every((l) => l.includes(encodeURIComponent("Council approves new park"))));
});

test("content: a sub-frame shows no UI and forwards its text signals to the top frame", async () => {
  const { api, content } = await boot({ subFrame: true, text: FILLER + SCAM_TEXT });
  assert.equal(content.root, null);
  const sent = api.calls.tabsSendMessage.at(-1);
  assert.equal(sent.message.type, "frame-signals");
  assert.deepEqual(sent.options, { frameId: 0 });
  assert.deepEqual(sent.message.signals.map((s) => s.id).sort(), ["tech-001", "tech-003"]);
  assert.equal(stored(api), undefined, "sub-frames never send a verdict");
});

test("content: a clean sub-frame sends nothing", async () => {
  const { api } = await boot({ subFrame: true });
  assert.deepEqual(api.calls.tabsSendMessage, []);
});

test("content: the top frame merges forwarded frame signals", async () => {
  const { api, content } = await boot();
  const msg = { type: "frame-signals", frameUrl: "https://ads.example/f", signals: [{ source: "text", severity: "high", id: "tech-001", description: "Fake virus alert", why: "x", frameUrl: "https://ads.example/f" }] };
  api.runtime.onMessage.fire(msg, { id: "someone-else" }, () => {});
  await settle();
  assert.equal(ui(content), null, "messages from other senders are ignored");
  api.runtime.onMessage.fire(msg, { id: api.runtime.id }, () => {});
  await settle();
  assert.equal(tierShown(content), "banner");
  assert.equal(stored(api).signals[0].frameUrl, "https://ads.example/f");
});

test("content: an in-page navigation clears the warning and rescans", async () => {
  const { win, api, content } = await boot({ text: FILLER + SCAM_TEXT });
  assert.equal(tierShown(content), "banner");
  win.document.body.replaceChildren();
  addText(win, FILLER);
  win.location.href = "https://page.example/next";
  await win.tick(1000);
  assert.equal(ui(content), null);
  assert.equal(stored(api).tier, "clean");
});

test("content: turning scam protection off in the popup clears the warning", async () => {
  const { api, content } = await boot({ text: FILLER + SCAM_TEXT });
  await api.storage.sync.set({ "tm.prefs": { scam: false, bias: true, social: true } });
  await settle();
  assert.equal(ui(content), null);
});
