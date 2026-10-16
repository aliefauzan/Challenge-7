import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { ensureRuleset, refreshRuleset, RULESET_KEY, META_KEY } from "../../src/bg/refresh.js";
import { ENVELOPE_FORMAT } from "../../src/engine/ruleset.js";
import { makePayload } from "./fixtures/payload.js";
import { makeFakeApi } from "./fakes/api.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keys = { k1: Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64") };
const URL_ = "https://rules.example/ruleset.json";

function envelope(payloadObj, kid = "k1") {
  const payload = JSON.stringify(payloadObj);
  return { format: ENVELOPE_FORMAT, kid, payload, sig: sign(null, Buffer.from(payload), privateKey).toString("base64") };
}
const serve = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });
const stored = async (api) => api.storage.local.get([RULESET_KEY, META_KEY]);

test("bg refresh: bundled ruleset is stored when nothing is cached", async () => {
  const api = makeFakeApi();
  assert.equal(await ensureRuleset(api, makePayload({ version: 3 }), 1000), true);
  const got = await stored(api);
  assert.equal(got[RULESET_KEY].version, 3);
  assert.deepEqual(got[META_KEY], { version: 3, source: "bundled", fetchedAt: 1000, errors: [] });
  assert.equal(await ensureRuleset(api, makePayload({ version: 3 })), false, "same version is kept");
  assert.equal(await ensureRuleset(api, makePayload({ version: 4 })), true, "a newer bundled copy replaces it");
});

test("bg refresh: a valid newer envelope is stored as remote", async () => {
  const api = makeFakeApi();
  await ensureRuleset(api, makePayload({ version: 3 }));
  const r = await refreshRuleset(api, { url: URL_, keys, fetch: serve(envelope(makePayload({ version: 7 }))), now: 5 });
  assert.deepEqual(r, { updated: true });
  const got = await stored(api);
  assert.equal(got[RULESET_KEY].version, 7);
  assert.equal(got[META_KEY].source, "remote");
  assert.equal(got[META_KEY].fetchedAt, 5);
});

test("bg refresh: a tampered envelope is rejected and the cached copy kept", async () => {
  const api = makeFakeApi();
  await ensureRuleset(api, makePayload({ version: 3 }));
  const env = envelope(makePayload({ version: 9 }));
  env.payload = env.payload.replace('"scam.com"', '"other.com"');
  const r = await refreshRuleset(api, { url: URL_, keys, fetch: serve(env) });
  assert.equal(r.updated, false);
  assert.match(r.error, /bad signature/);
  const got = await stored(api);
  assert.equal(got[RULESET_KEY].version, 3);
  assert.match(got[META_KEY].errors.at(-1), /bad signature/);
});

test("bg refresh: an older version is rejected, the same version is a quiet no-op", async () => {
  const api = makeFakeApi();
  await ensureRuleset(api, makePayload({ version: 5 }));
  const older = await refreshRuleset(api, { url: URL_, keys, fetch: serve(envelope(makePayload({ version: 4 }))) });
  assert.match(older.error, /not newer/);
  const same = await refreshRuleset(api, { url: URL_, keys, fetch: serve(envelope(makePayload({ version: 5 }))) });
  assert.deepEqual(same, { updated: false });
  assert.equal((await stored(api))[META_KEY].errors.length, 1);
});

test("bg refresh: offline, HTTP errors and timeouts are recorded", async () => {
  const api = makeFakeApi();
  await ensureRuleset(api, makePayload({ version: 3 }));
  const offline = await refreshRuleset(api, { url: URL_, keys, fetch: async () => { throw new TypeError("Failed to fetch"); } });
  assert.match(offline.error, /Failed to fetch/);
  const http = await refreshRuleset(api, { url: URL_, keys, fetch: serve(null, 503) });
  assert.match(http.error, /HTTP 503/);
  const hang = (u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const slow = await refreshRuleset(api, { url: URL_, keys, fetch: hang, timeoutMs: 10 });
  assert.equal(slow.error, "fetch timed out");
  const got = await stored(api);
  assert.equal(got[META_KEY].errors.length, 3);
  assert.equal(got[RULESET_KEY].version, 3);
});

test("bg refresh: no URL means no fetch", async () => {
  const api = makeFakeApi();
  let called = false;
  assert.deepEqual(await refreshRuleset(api, { url: "", keys, fetch: async () => { called = true; } }), { updated: false });
  assert.equal(called, false);
});

test("bg refresh: fetch sends no cookies and bypasses the HTTP cache", async () => {
  const api = makeFakeApi();
  let init;
  await refreshRuleset(api, { url: URL_, keys, fetch: async (u, i) => { init = i; return { ok: true, status: 200, json: async () => envelope(makePayload()) }; } });
  assert.equal(init.cache, "no-cache");
  assert.equal(init.credentials, "omit");
});
