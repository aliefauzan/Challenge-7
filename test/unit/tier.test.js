import { test } from "node:test";
import assert from "node:assert/strict";
import { decideTier } from "../../src/engine/tier.js";

const high = { source: "text", severity: "high", id: "h" };
const med = { source: "url", severity: "medium", id: "m" };
const on = { scam: true, bias: true, social: true };
const base = { domain: "x.example", knownDomain: false, prefs: on, dismissed: false, bypassed: false, source: null, blockHighCount: 2 };
const tier = (signals, ctx = {}) => decideTier(signals, { ...base, ...ctx }).tier;

test("engine/tier: known domain blocks with no bypass, even when bypassed", () => {
  assert.equal(tier([{ ...high, source: "domain" }], { knownDomain: true, bypassed: true, dismissed: true }), "block");
});

test("engine/tier: two highs block with bypass; bypass drops to banner", () => {
  assert.equal(tier([high, high]), "block-bypass");
  assert.equal(tier([high, high], { bypassed: true }), "banner");
  assert.equal(tier([high, high], { bypassed: true, dismissed: true }), "clean");
  assert.equal(tier([high, high], { blockHighCount: 3 }), "banner");
});

test("engine/tier: any signal shows a banner unless dismissed", () => {
  assert.equal(tier([med]), "banner");
  assert.equal(tier([high]), "banner");
  assert.equal(tier([med], { dismissed: true }), "clean");
});

test("engine/tier: bias banner for a known source with no scam signal", () => {
  const source = { label: "S", bias: "right" };
  assert.equal(tier([], { source }), "bias");
  assert.equal(tier([], { source, dismissed: true }), "clean");
  assert.equal(tier([], { source, prefs: { ...on, bias: false } }), "clean");
  assert.equal(tier([med], { source }), "banner");
});

test("engine/tier: scam pref off disables tiers 1-3", () => {
  const prefs = { ...on, scam: false };
  assert.equal(tier([high, high], { knownDomain: true, prefs }), "clean");
  assert.equal(tier([med], { prefs, source: { label: "S" } }), "bias");
});

test("engine/tier: verdict keeps signals and context even when quiet", () => {
  const v = decideTier([med], { ...base, dismissed: true });
  assert.equal(v.tier, "clean");
  assert.deepEqual(v.signals, [med]);
  assert.equal(v.domain, "x.example");
  assert.equal(decideTier(undefined, {}).tier, "clean");
});
