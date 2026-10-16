import { test } from "node:test";
import assert from "node:assert/strict";
import { handleVerdict, handleFrameSignals, verdictKey } from "../../src/bg/verdicts.js";
import { startBackground, REFRESH_ALARM } from "../../src/bg/index.js";
import { makePayload } from "./fixtures/payload.js";
import { makeFakeApi, sendMessage } from "./fakes/api.js";

const top = (url, tabId = 3) => ({ id: "ext-id", url, frameId: 0, tab: { id: tabId, url } });
const sub = (url, tabId = 3) => ({ id: "ext-id", url, frameId: 5, tab: { id: tabId, url: "https://top.example/" } });
const signal = { source: "text", severity: "high", id: "t-1", description: "Fake virus alert", why: "x" };

test("bg verdicts: a top-frame verdict is stored and sets the badge", async () => {
  const api = makeFakeApi();
  const verdict = { tier: "banner", domain: "a.example", signals: [signal], sourceInfo: null };
  assert.deepEqual(await handleVerdict(api, { verdict }, top("https://a.example/")), { ok: true });
  assert.equal(api.storage.session.data.get(verdictKey(3)).tier, "banner");
  assert.equal(api.storage.session.data.get(verdictKey(3)).url, "https://a.example/");
  assert.deepEqual(api.calls.badgeText.at(-1), { tabId: 3, text: "!" });
  assert.deepEqual(api.calls.badgeColor.at(-1), { tabId: 3, color: "#c62828" });

  await handleVerdict(api, { verdict: { ...verdict, tier: "bias", signals: [] } }, top("https://a.example/"));
  assert.deepEqual(api.calls.badgeText.at(-1), { tabId: 3, text: "i" });
  await handleVerdict(api, { verdict: { ...verdict, tier: "clean", signals: [] } }, top("https://a.example/"));
  assert.deepEqual(api.calls.badgeText.at(-1), { tabId: 3, text: "" });
});

test("bg verdicts: a text-only verdict is kept whole for the popup", async () => {
  const api = makeFakeApi();
  await handleVerdict(api, { verdict: { tier: "banner", domain: "a.example", signals: [signal], sourceInfo: null } }, top("https://a.example/"));
  assert.deepEqual(api.storage.session.data.get(verdictKey(3)).signals, [signal]);
});

test("bg verdicts: sub-frames and bad verdicts are refused", async () => {
  const api = makeFakeApi();
  assert.equal((await handleVerdict(api, { verdict: { tier: "block", signals: [] } }, sub("https://ad.example/"))).ok, false);
  assert.equal((await handleVerdict(api, { verdict: { tier: "evil", signals: [] } }, top("https://a.example/"))).ok, false);
  assert.equal(api.storage.session.data.size, 0);
});

test("bg verdicts: frame signals are relayed to frame 0 with the frame URL", async () => {
  const api = makeFakeApi();
  assert.deepEqual(await handleFrameSignals(api, { signals: [signal] }, sub("https://ad.example/f")), { ok: true });
  const sent = api.calls.tabsSendMessage[0];
  assert.equal(sent.tabId, 3);
  assert.deepEqual(sent.options, { frameId: 0 });
  assert.equal(sent.message.type, "frame-signals");
  assert.equal(sent.message.signals[0].frameUrl, "https://ad.example/f");
  assert.equal((await handleFrameSignals(api, { signals: [signal] }, top("https://a.example/"))).ok, false);
});

async function started(target = "chrome", opts = {}) {
  const api = makeFakeApi();
  const bg = startBackground(api, { target, bundled: makePayload(), rulesetUrl: "", keys: {}, refreshMinutes: 720, welcomeUrl: "", ...opts });
  await bg.ready;
  return { api, bg };
}

test("bg main: boot stores the bundled ruleset, installs rules and the refresh alarm", async () => {
  const { api } = await started();
  assert.equal((await api.storage.local.get("tm.ruleset"))["tm.ruleset"].version, 5);
  assert.equal((await api.declarativeNetRequest.getDynamicRules()).length, 1);
  assert.equal(api.alarms.all.get(REFRESH_ALARM).periodInMinutes, 720);
});

test("bg main: messages from another extension or of unknown type are ignored", async () => {
  const { api } = await started();
  assert.equal(await sendMessage(api, { type: "flag-set", kind: "dismiss", registrable: "a.example" }, { ...top("https://a.example/"), id: "other" }), undefined);
  assert.equal(await sendMessage(api, { type: "nope" }, top("https://a.example/")), undefined);
  assert.equal(api.storage.session.data.size, 0);
  assert.deepEqual(await sendMessage(api, { type: "flag-set", kind: "dismiss", registrable: "a.example" }, top("https://a.example/")), { ok: true });
});

test("bg main: nav-check blocks listed domains in the top frame only", async () => {
  const { api } = await started("safari");
  assert.deepEqual(await sendMessage(api, { type: "nav-check" }, top("https://www.scam.com/pay")), { block: true });
  assert.deepEqual(await sendMessage(api, { type: "nav-check" }, top("https://fine.example/")), { block: false });
  assert.deepEqual(await sendMessage(api, { type: "nav-check" }, sub("https://scam.com/")), { block: false });
  await api.storage.sync.set({ "tm.prefs": { scam: false } });
  assert.deepEqual(await sendMessage(api, { type: "nav-check" }, top("https://scam.com/")), { block: false });
});

test("bg main: Safari backstop sends a listed page to blocked.html; Chrome leaves it to DNR", async () => {
  const safari = await started("safari");
  assert.deepEqual(await safari.api.declarativeNetRequest.getDynamicRules(), []);
  await Promise.all(safari.api.tabs.onUpdated.fire(9, { status: "complete", url: "https://scam.com/x" }, { id: 9, url: "https://scam.com/x" }));
  assert.deepEqual(safari.api.calls.tabsUpdate, [{ tabId: 9, url: "chrome-extension://ext-id/blocked.html#https%3A%2F%2Fscam.com%2Fx" }]);

  const chrome = await started("chrome");
  await Promise.all(chrome.api.tabs.onUpdated.fire(9, { status: "complete", url: "https://scam.com/x" }, { id: 9, url: "https://scam.com/x" }));
  assert.deepEqual(chrome.api.calls.tabsUpdate, []);
});

test("bg main: navigation and tab close clear the stored verdict", async () => {
  const { api } = await started();
  await api.storage.session.set({ [verdictKey(4)]: { tier: "banner", signals: [] }, [verdictKey(5)]: { tier: "bias", signals: [] } });
  await Promise.all(api.tabs.onUpdated.fire(4, { status: "loading", url: "https://next.example/" }, { id: 4 }));
  assert.equal(api.storage.session.data.has(verdictKey(4)), false);
  assert.deepEqual(api.calls.badgeText.at(-1), { tabId: 4, text: "" });
  await Promise.all(api.tabs.onRemoved.fire(5));
  assert.equal(api.storage.session.data.has(verdictKey(5)), false);
});

test("bg main: turning scam protection off removes the Chrome rules", async () => {
  const { api } = await started();
  await api.storage.sync.set({ "tm.prefs": { scam: false } });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(await api.declarativeNetRequest.getDynamicRules(), []);
});

test("bg main: install opens the welcome page once; update does not", async () => {
  const { api } = await started("chrome", { welcomeUrl: "https://scamshield.example/welcome" });
  await Promise.all(api.runtime.onInstalled.fire({ reason: "install" }));
  await Promise.all(api.runtime.onInstalled.fire({ reason: "update" }));
  assert.deepEqual(api.calls.tabsCreate, [{ url: "https://scamshield.example/welcome" }]);
});

test("bg main: ruleset-refresh is refused from web pages", async () => {
  const { api } = await started();
  const r = await sendMessage(api, { type: "ruleset-refresh" }, top("https://a.example/"));
  assert.equal(r.updated, false);
  assert.match(r.error, /not allowed/);
});
