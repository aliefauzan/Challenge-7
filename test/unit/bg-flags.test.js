import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleFlagGet, handleFlagSet, senderRegistrable } from "../../src/bg/flags.js";
import { makeFakeApi } from "./fakes/api.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const page = (url) => ({ id: "ext-id", url, frameId: 0, tab: { id: 7, url } });

test("bg flags: set then get on the sender's own site", async () => {
  const api = makeFakeApi();
  const sender = page("https://shop.example.co.uk/item");
  assert.deepEqual(await handleFlagGet(api, { kind: "dismiss", registrable: "example.co.uk" }, sender), { set: false });
  assert.deepEqual(await handleFlagSet(api, { kind: "dismiss", registrable: "example.co.uk" }, sender), { ok: true });
  assert.deepEqual(await handleFlagGet(api, { kind: "dismiss", registrable: "example.co.uk" }, sender), { set: true });
  assert.deepEqual(await handleFlagGet(api, { kind: "bypass", registrable: "example.co.uk" }, sender), { set: false });
  assert.equal(api.storage.session.data.get("tm.dismiss.example.co.uk"), 1);
});

test("bg flags: one site cannot set or read another site's flags", async () => {
  const api = makeFakeApi();
  const r = await handleFlagSet(api, { kind: "bypass", registrable: "victim.example" }, page("https://evil.example/"));
  assert.equal(r.ok, false);
  assert.equal(api.storage.session.data.size, 0);
  await api.storage.session.set({ "tm.bypass.victim.example": 1 });
  assert.equal((await handleFlagGet(api, { kind: "bypass", registrable: "victim.example" }, page("https://evil.example/"))).set, false);
});

test("bg flags: unknown kinds and missing domains are rejected", async () => {
  const api = makeFakeApi();
  const sender = page("https://a.example/");
  assert.equal((await handleFlagSet(api, { kind: "allow", registrable: "a.example" }, sender)).ok, false);
  assert.equal((await handleFlagSet(api, { kind: "dismiss" }, sender)).ok, false);
  assert.equal(api.storage.session.data.size, 0);
});

test("bg flags: sender registrable uses the PSL and ignores non-http pages", () => {
  assert.equal(senderRegistrable(page("https://user.github.io/x")), "user.github.io");
  assert.equal(senderRegistrable({ url: "chrome-extension://x/popup.html" }), "");
  assert.equal(senderRegistrable({ tab: { url: "https://www.example.com/" } }), "example.com");
});

test("bg flags: content code never touches extension or page storage for flags", () => {
  const offenders = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".js") && /\b(storage\.(session|local|sync)|sessionStorage|localStorage)\b/.test(readFileSync(path, "utf8"))) offenders.push(path);
    }
  };
  walk(join(ROOT, "src", "content"));
  walk(join(ROOT, "src", "ui"));
  assert.deepEqual(offenders, []);
});
