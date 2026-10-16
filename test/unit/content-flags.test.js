import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeApi } from "./fakes/api.js";
import { startBackground } from "../../src/bg/index.js";
import { createFlags } from "../../src/content/flags.js";
import bundled from "../../src/data/default-ruleset.json" with { type: "json" };

async function setup(pageUrl = "https://www.page.example/a") {
  const api = makeFakeApi();
  api.sender = { id: api.runtime.id, url: pageUrl, frameId: 0, tab: { id: 3, url: pageUrl } };
  const bg = startBackground(api, { target: "chrome", bundled, rulesetUrl: "", keys: {}, refreshMinutes: 720, welcomeUrl: "" });
  await bg.ready;
  return { api, flags: createFlags(api) };
}

test("content flags: get is false until set, then true, through background messages", async () => {
  const { api, flags } = await setup();
  assert.equal(await flags.getFlag("dismiss", "page.example"), false);
  assert.equal(await flags.setFlag("dismiss", "page.example"), true);
  assert.equal(await flags.getFlag("dismiss", "page.example"), true);
  assert.equal(await flags.getFlag("bypass", "page.example"), false);
  // Stored by the background, in storage.session, under the documented key.
  assert.equal(api.storage.session.data.get("tm.dismiss.page.example"), 1);
});

test("content flags: a page cannot set a flag for another site", async () => {
  const { api, flags } = await setup();
  assert.equal(await flags.setFlag("bypass", "bank.example"), false);
  assert.equal(api.storage.session.data.size, 0);
});

test("content flags: a failed or missing background reply reads as not set", async () => {
  const { api, flags } = await setup();
  api.runtime.sendMessage = async () => {
    throw new Error("Extension context invalidated.");
  };
  assert.equal(await flags.getFlag("dismiss", "page.example"), false);
  assert.equal(await flags.setFlag("dismiss", "page.example"), false);
  api.runtime.sendMessage = async () => undefined;
  assert.equal(await flags.getFlag("dismiss", "page.example"), false);
});

test("content flags: unknown kinds are refused without a message", async () => {
  const { api, flags } = await setup();
  let sent = 0;
  const send = api.runtime.sendMessage;
  api.runtime.sendMessage = (m) => (sent++, send(m));
  assert.equal(await flags.setFlag("allow", "page.example"), false);
  assert.equal(sent, 0);
});
