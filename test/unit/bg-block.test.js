import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDnrRules, syncBlockRules, isBlockedUrl, scamDomainSet, blockedPageUrl, MAX_BLOCK_RULES } from "../../src/bg/block.js";
import { makePayload } from "./fixtures/payload.js";
import { makeFakeApi } from "./fakes/api.js";

const PAGE = "chrome-extension://ext-id/blocked.html";

test("bg block: one redirect rule covers a small list", () => {
  const rules = buildDnrRules(scamDomainSet(makePayload()), PAGE);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.requestDomains, ["203.0.113.9", "scam.com"]);
  assert.deepEqual(rules[0].condition.resourceTypes, ["main_frame"]);
  assert.equal(rules[0].condition.regexFilter, "^(.*)$");
  assert.equal(rules[0].action.redirect.regexSubstitution, `${PAGE}#\\1`);
});

test("bg block: a 50k-domain list splits into at most 99 rules with unique IDs", () => {
  const domains = Array.from({ length: 50000 }, (_, i) => `scam-${i}.example`);
  const rules = buildDnrRules(scamDomainSet({ scam_domains: domains }), PAGE);
  assert.ok(rules.length <= MAX_BLOCK_RULES);
  assert.equal(rules.length, 50);
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  assert.equal(rules.reduce((n, r) => n + r.condition.requestDomains.length, 0), 50000);
  const huge = buildDnrRules(scamDomainSet({ scam_domains: Array.from({ length: 200000 }, (_, i) => `s${i}.example`) }), PAGE);
  assert.equal(huge.length, MAX_BLOCK_RULES);
});

test("bg block: empty list gives no rules", () => {
  assert.deepEqual(buildDnrRules(scamDomainSet({ scam_domains: [] }), PAGE), []);
});

test("bg block: Chrome installs rules and replaces old ones", async () => {
  const api = makeFakeApi();
  await api.declarativeNetRequest.updateDynamicRules({ addRules: [{ id: 1 }, { id: 42 }] });
  assert.equal(await syncBlockRules(api, { target: "chrome", payload: makePayload(), prefs: { scam: true } }), 1);
  const rules = await api.declarativeNetRequest.getDynamicRules();
  assert.deepEqual(rules.map((r) => r.id), [1]);
  assert.equal(rules[0].action.type, "redirect");
});

test("bg block: Safari and scam-off install no rules", async () => {
  for (const opts of [{ target: "safari", prefs: { scam: true } }, { target: "chrome", prefs: { scam: false } }]) {
    const api = makeFakeApi();
    await api.declarativeNetRequest.updateDynamicRules({ addRules: [{ id: 1 }] });
    assert.equal(await syncBlockRules(api, { ...opts, payload: makePayload() }), 0);
    assert.deepEqual(await api.declarativeNetRequest.getDynamicRules(), []);
  }
});

test("bg block: isBlockedUrl matches listed domains and their subdomains only", () => {
  const set = scamDomainSet(makePayload());
  assert.equal(isBlockedUrl("https://scam.com/", set), true);
  assert.equal(isBlockedUrl("https://login.scam.com/x?y", set), true);
  assert.equal(isBlockedUrl("http://203.0.113.9/", set), true);
  assert.equal(isBlockedUrl("https://notscam.com/", set), false);
  assert.equal(isBlockedUrl("https://scam.com.evil.example/", set), false);
  assert.equal(isBlockedUrl("ftp://scam.com/", set), false);
  assert.equal(isBlockedUrl("not a url", set), false);
});

test("bg block: blocked page URL carries the encoded address in the hash", () => {
  const api = makeFakeApi();
  assert.equal(blockedPageUrl(api, "https://scam.com/a?b=1#c"), "chrome-extension://ext-id/blocked.html#https%3A%2F%2Fscam.com%2Fa%3Fb%3D1%23c");
});
