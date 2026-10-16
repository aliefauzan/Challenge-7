import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostsFromFeed, fetchFeeds, FEEDS } from "../../scripts/fetch-feeds.mjs";
import { DomainSet } from "../../src/engine/domains.js";
import { lintSource } from "../../scripts/lint-rules.mjs";
import { compileRules } from "../../src/engine/ruleset.js";
import { scanText } from "../../src/engine/text.js";
import src from "../../data/ruleset.src.json" with { type: "json" };

test("feeds: host names are parsed, normalised and deduplicated", () => {
  const text = [
    "# comment",
    "https://Login.Bad-Bank.example/verify?x=1",
    "http://login.bad-bank.example./other",
    "http://203.0.113.9:8080/payload.exe",
    "plain-host.example",
    "not a url at all %%%",
    "",
  ].join("\n");
  assert.deepEqual(hostsFromFeed(text), ["login.bad-bank.example", "203.0.113.9", "plain-host.example"]);
});

test("feeds: public suffixes and allowlisted domains are dropped", () => {
  const text = ["https://github.io/", "https://phish.github.io/x", "https://docs.google.com/forms/x", "https://evil.example/"].join("\n");
  const allow = new DomainSet(["google.com"]);
  assert.deepEqual(hostsFromFeed(text, { allow }), ["phish.github.io", "evil.example"]);
});

test("feeds: the size cap holds across feeds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-feeds-"));
  const srcFile = join(dir, "src.json");
  writeFileSync(srcFile, JSON.stringify({ allowlist: ["safe.example"] }));
  const bodies = {
    [FEEDS[0].url]: "https://a.example/\nhttps://b.example/\nhttps://safe.example/x\n",
    [FEEDS[1].url]: "https://b.example/\nhttps://c.example/\nhttps://d.example/\n",
  };
  const fakeFetch = async (url) => ({ ok: true, status: 200, text: async () => bodies[url] });
  const report = await fetchFeeds({ out: dir, max: 3, src: srcFile, fetch: fakeFetch });
  assert.deepEqual(report, [{ name: FEEDS[0].name, hosts: 2 }, { name: FEEDS[1].name, hosts: 1 }]);
  const second = readFileSync(join(dir, `${FEEDS[1].name}.txt`), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(second, ["c.example"]);
});

test("feeds: a failing feed is reported and writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-feeds-"));
  const fakeFetch = async () => ({ ok: false, status: 503, text: async () => "" });
  const report = await fetchFeeds({ out: dir, fetch: fakeFetch });
  assert.ok(report.every((r) => r.error === "HTTP 503"));
  assert.equal(existsSync(join(dir, `${FEEDS[0].name}.txt`)), false);
});

test("seed data: at least 40 phrases, each category has two and a reason", () => {
  assert.deepEqual(lintSource(src), []);
  assert.ok(src.scam_phrases.length >= 40);
  const perCategory = {};
  for (const ph of src.scam_phrases) perCategory[ph.category] = (perCategory[ph.category] ?? 0) + 1;
  for (const [id, cat] of Object.entries(src.categories)) {
    assert.ok(cat.why && cat.label, id);
    assert.ok(perCategory[id] >= 2, `${id} has ${perCategory[id] ?? 0} phrases`);
  }
});

test("seed data: everyday text raises no warning", () => {
  const { rules } = compileRules({ ...src, scam_phrases: src.scam_phrases.map(({ examples, ...p }) => p) });
  const everyday = [
    "Your order has shipped and will arrive on Tuesday. Track it in the app.",
    "Your subscription renews on 3 May. You can change your plan in Settings at any time.",
    "We noticed a new sign-in to your account from Chrome on Windows. If this was you, no action is needed.",
    "Scan the QR code at your table to see the menu and order.",
    "Call us on 0800 123 4567 if you have questions about your bill.",
    "Grandma and I went to the park, then I lost my phone for an hour.",
    "The council will cut off water for maintenance on Friday morning.",
    "Withdraw cash at any of our branches without a fee.",
    "Our fraud team will never ask you to move money. Call the number on your card.",
  ].join("\n");
  const signals = scanText(everyday, rules);
  assert.deepEqual(signals.map((s) => s.id), []);
});
