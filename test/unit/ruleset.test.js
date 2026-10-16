import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { validatePayload, compileRules, verifyEnvelope, ENVELOPE_FORMAT } from "../../src/engine/ruleset.js";
import { makePayload } from "./fixtures/payload.js";

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64");
  return { privateKey, raw };
}
function envelope(payloadObj, privateKey, kid = "k1") {
  const payload = JSON.stringify(payloadObj);
  return { format: ENVELOPE_FORMAT, kid, payload, sig: sign(null, Buffer.from(payload), privateKey).toString("base64") };
}

test("ruleset: valid payload passes validation", () => {
  assert.deepEqual(validatePayload(makePayload()), { ok: true, errors: [] });
});

test("ruleset: validation rejects wrong schema and bad shapes", () => {
  assert.equal(validatePayload(makePayload({ schema: 2 })).ok, false);
  assert.equal(validatePayload(makePayload({ version: 0 })).ok, false);
  assert.equal(validatePayload(makePayload({ generated: "yesterday" })).ok, false);
  assert.equal(validatePayload(makePayload({ scam_domains: "scam.com" })).ok, false);
  assert.equal(validatePayload(makePayload({ thresholds: { deep_subdomain_labels: 4 } })).ok, false);
  assert.equal(validatePayload(makePayload({ categories: { x: { label: 1 } } })).ok, false);
  assert.equal(validatePayload(makePayload({ sources: { "a.example": { bias: "right" } } })).ok, false);
  assert.equal(validatePayload(makePayload({ surface_adapters: [] })).ok, false);
  const badPhrase = makePayload();
  badPhrase.scam_phrases[0].severity = "critical";
  assert.equal(validatePayload(badPhrase).ok, false);
  assert.equal(validatePayload(null).ok, false);
  assert.equal(validatePayload(makePayload({ surface_adapters: undefined })).ok, true);
});

test("ruleset: compile keeps good patterns and drops a bad one with an error", () => {
  const p = makePayload();
  p.scam_phrases.push({ id: "bad-1", pattern: "([unclosed", flags: "i", severity: "high", category: "tech_support", description: "x" });
  p.scam_phrases.push({ id: "bad-2", pattern: "abc", flags: "gi", severity: "high", category: "tech_support", description: "x" });
  p.scam_phrases.push({ id: "bad-3", pattern: "a".repeat(601), flags: "", severity: "medium", category: "tech_support", description: "x" });
  const { rules, errors } = compileRules(p);
  assert.deepEqual(rules.phrases.map((x) => x.id), ["tech-1"]);
  assert.equal(errors.length, 3);
  assert.match(errors.join("\n"), /bad-1/);
  assert.match(errors.join("\n"), /bad-2.*flags/);
  assert.deepEqual(rules.errors, errors);
});

test("ruleset: phrase without why gets its category why", () => {
  const { rules } = compileRules(makePayload());
  assert.match(rules.phrases[0].why, /call a number/);
});

test("ruleset: compiled rules have domain sets and thresholds", () => {
  const { rules } = compileRules(makePayload());
  assert.equal(rules.scamDomains.has("a.scam.com"), true);
  assert.equal(rules.allowlist.has("www.trusted-bank.example"), true);
  assert.equal(rules.sources.get("www.tabloid.example").label, "Tabloid");
  assert.equal(rules.thresholds.deep_subdomain_labels, 4);
  assert.equal(rules.impersonatedBrands.has("paypal"), true);
  assert.equal(rules.adapters.facebook.host.test("www.facebook.com"), true);
  assert.equal(rules.adapters.facebook.dmItemSelector, null);
});

test("ruleset: an adapter with a bad regex is dropped with an error", () => {
  const p = makePayload();
  p.surface_adapters.facebook.host = "(";
  const { rules, errors } = compileRules(p);
  assert.equal(rules.adapters.facebook, undefined);
  assert.match(errors[0], /facebook/);
});

test("ruleset: a valid envelope round-trips", async () => {
  const { privateKey, raw } = keyPair();
  const payload = await verifyEnvelope(envelope(makePayload(), privateKey), { k1: raw });
  assert.equal(payload.version, 5);
});

test("ruleset: tampered payload is rejected", async () => {
  const { privateKey, raw } = keyPair();
  const env = envelope(makePayload(), privateKey);
  env.payload = env.payload.replace("scam.com", "scam.org");
  await assert.rejects(verifyEnvelope(env, { k1: raw }), /signature/);
});

test("ruleset: wrong key, unknown kid and wrong format are rejected", async () => {
  const signer = keyPair();
  const other = keyPair();
  const env = envelope(makePayload(), signer.privateKey);
  await assert.rejects(verifyEnvelope(env, { k1: other.raw }), /signature/);
  await assert.rejects(verifyEnvelope({ ...env, kid: "k9" }, { k1: signer.raw }), /kid/);
  await assert.rejects(verifyEnvelope({ ...env, format: "other" }, { k1: signer.raw }), /format/);
  await assert.rejects(verifyEnvelope({ ...env, sig: "!!" }, { k1: signer.raw }), /signature/);
  await assert.rejects(verifyEnvelope(null, { k1: signer.raw }), /format/);
});

test("ruleset: downgrade and same version are rejected", async () => {
  const { privateKey, raw } = keyPair();
  const env = envelope(makePayload({ version: 5 }), privateKey);
  await assert.rejects(verifyEnvelope(env, { k1: raw }, { minVersion: 5 }), /version/);
  await assert.rejects(verifyEnvelope(env, { k1: raw }, { minVersion: 9 }), /version/);
  assert.equal((await verifyEnvelope(env, { k1: raw }, { minVersion: 4 })).version, 5);
});

test("ruleset: a signed but invalid payload is rejected", async () => {
  const { privateKey, raw } = keyPair();
  await assert.rejects(verifyEnvelope(envelope(makePayload({ schema: 3 }), privateKey), { k1: raw }), /invalid payload/);
  const env = envelope(makePayload(), privateKey);
  env.payload = "not json";
  env.sig = sign(null, Buffer.from(env.payload), privateKey).toString("base64");
  await assert.rejects(verifyEnvelope(env, { k1: raw }), /JSON/);
});
