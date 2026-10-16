import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText } from "../../src/engine/text.js";
import { makeRules } from "./fixtures/rules.js";

const rules = makeRules();

test("engine/text: finds phrases and attaches why", () => {
  const out = scanText("Warning! Your computer has been infected. Call now.", rules);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "t-tech");
  assert.equal(out[0].source, "text");
  assert.equal(out[0].severity, "high");
  assert.match(out[0].why, /phone number/);
});

test("engine/text: phrase without why falls back to its category why", () => {
  const [s] = scanText("Please don't tell your family about this.", rules);
  assert.equal(s.id, "t-secret");
  assert.match(s.why, /secrecy/);
});

test("engine/text: stops after max_high_hits highs", () => {
  const text = "your device is locked. pay with gift cards. do not tell anyone. you have won!";
  const out = scanText(text, rules);
  assert.equal(out.filter((s) => s.severity === "high").length, 3);
});

test("engine/text: only scans the first max_text_chars characters", () => {
  const text = "x".repeat(2000) + " your computer is infected";
  assert.deepEqual(scanText(text, rules), []);
  assert.equal(scanText(text.slice(1990), rules).length, 1);
});

test("engine/text: skips education sites on the phrase allowlist and allowlisted domains", () => {
  const text = "Example scam: your computer has been infected";
  assert.deepEqual(scanText(text, rules, { host: "www.consumer-help.example" }), []);
  assert.deepEqual(scanText(text, rules, { host: "trusted-bank.example" }), []);
  assert.equal(scanText(text, rules, { host: "random.example" }).length, 1);
});

test("engine/text: empty or non-string text is safe", () => {
  assert.deepEqual(scanText("", rules), []);
  assert.deepEqual(scanText(undefined, rules), []);
});

test("engine/text: medium-only page", () => {
  const out = scanText("Your parcel is waiting. Pay a small customs fee to release it.", rules);
  assert.deepEqual(out.map((s) => [s.id, s.severity]), [["t-fee", "medium"]]);
  assert.match(out[0].why, /Couriers/);
});
