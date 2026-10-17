import { test } from "node:test";
import assert from "node:assert/strict";
import { guardPage } from "../../src/content/nav-guard.js";
import { ask } from "../../src/platform/ask.js";
import { makePayload } from "./fixtures/payload.js";
import { makeFakeApi } from "./fakes/api.js";

function fakeWin(href, { top = true } = {}) {
  const win = { replaced: [], location: { href, protocol: new URL(href).protocol, replace: (u) => win.replaced.push(u) } };
  win.top = top ? win : {};
  return win;
}

async function setup({ reply, payload = makePayload(), prefs } = {}) {
  const api = makeFakeApi();
  api.runtime.sendMessage = reply;
  await api.storage.local.set({ "tm.ruleset": payload });
  if (prefs) await api.storage.sync.set({ "tm.prefs": prefs });
  return api;
}

const never = () => new Promise(() => {});

test("ask: gives the reply, or null when the background throws or never answers", async () => {
  assert.deepEqual(await ask({ runtime: { sendMessage: async () => ({ ok: 1 }) } }, {}), { ok: 1 });
  assert.equal(await ask({ runtime: { sendMessage: async () => { throw new Error("gone"); } } }, {}), null);
  assert.equal(await ask({ runtime: { sendMessage: () => { throw new Error("sync"); } } }, {}), null);
  assert.equal(await ask({ runtime: { sendMessage: never } }, {}, 20), null);
});

test("nav guard: follows the background's answer", async () => {
  const api = await setup({ reply: async () => ({ block: true }) });
  const win = fakeWin("https://safe.example/");
  assert.equal(await guardPage({ api, win }), true);
  assert.deepEqual(win.replaced, [`chrome-extension://ext-id/blocked.html#${encodeURIComponent("https://safe.example/")}`]);

  const api2 = await setup({ reply: async () => ({ block: false }) });
  const win2 = fakeWin("https://scam.com/pay");
  assert.equal(await guardPage({ api: api2, win: win2 }), false, "the background's no wins over the stored list");
  assert.deepEqual(win2.replaced, []);
});

test("nav guard: with the background silent, the stored list decides", async () => {
  for (const reply of [never, async () => { throw new Error("gone"); }, async () => undefined]) {
    const api = await setup({ reply });
    const win = fakeWin("https://www.scam.com/pay?x=1");
    assert.equal(await guardPage({ api, win, ms: 20 }), true);
    assert.equal(win.replaced.length, 1);
    assert.match(win.replaced[0], /blocked\.html#https%3A%2F%2Fwww\.scam\.com%2Fpay%3Fx%3D1$/);
    const clean = fakeWin("https://shop.example/");
    assert.equal(await guardPage({ api, win: clean, ms: 20 }), false);
  }
});

test("nav guard: silent background, scam protection off or no ruleset: page stays", async () => {
  const off = await setup({ reply: never, prefs: { scam: false } });
  assert.equal(await guardPage({ api: off, win: fakeWin("https://scam.com/"), ms: 20 }), false);
  const none = await setup({ reply: never, payload: { schema: 1 } });
  assert.equal(await guardPage({ api: none, win: fakeWin("https://scam.com/"), ms: 20 }), false);
});

test("nav guard: frames and non-web pages are left alone", async () => {
  const api = await setup({ reply: async () => ({ block: true }) });
  assert.equal(await guardPage({ api, win: fakeWin("https://scam.com/", { top: false }) }), false);
  assert.equal(await guardPage({ api, win: fakeWin("file:///tmp/scam.com.html") }), false);
});
