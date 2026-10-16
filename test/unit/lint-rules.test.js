import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lintSource } from "../../scripts/lint-rules.mjs";
import { makePayload } from "./fixtures/payload.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = () => mkdtempSync(join(process.env.TMPDIR || tmpdir(), "ss-test-"));

function source() {
  const p = makePayload();
  p.scam_phrases[0].examples = { match: ["Your computer has been infected!"], nomatch: ["My computer is fine."] };
  return p;
}

test("lint: a clean source passes", () => {
  assert.deepEqual(lintSource(source()), []);
});

test("lint: catastrophic pattern is rejected", () => {
  const p = source();
  p.scam_phrases[0].pattern = "(a+)+$";
  assert.match(lintSource(p).join("\n"), /unsafe/);
});

test("lint: duplicate ids, unknown category, long pattern and bad flags are rejected", () => {
  const p = source();
  p.scam_phrases.push({ ...p.scam_phrases[0] });
  p.scam_phrases.push({ ...p.scam_phrases[0], id: "x-2", category: "nope" });
  p.scam_phrases.push({ ...p.scam_phrases[0], id: "x-3", pattern: "a".repeat(601) });
  p.scam_phrases.push({ ...p.scam_phrases[0], id: "x-4", flags: "g" });
  const errors = lintSource(p).join("\n");
  assert.match(errors, /duplicate id tech-1/);
  assert.match(errors, /x-2.*category/);
  assert.match(errors, /x-3.*600/);
  assert.match(errors, /x-4.*flags/);
});

test("lint: every phrase needs examples that behave", () => {
  const p = source();
  delete p.scam_phrases[0].examples;
  assert.match(lintSource(p).join("\n"), /examples/);
  const q = source();
  q.scam_phrases[0].examples.nomatch.push("your computer is infected");
  assert.match(lintSource(q).join("\n"), /should not match/);
  const r = source();
  r.scam_phrases[0].examples.match.push("all good here");
  assert.match(lintSource(r).join("\n"), /should match/);
});

test("keygen: writes a 0600 key, prints the public key, refuses to overwrite", () => {
  const out = join(scratch(), "k.key");
  const run = spawnSync(process.execPath, ["scripts/keygen.mjs", "--out", out], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /RULESET_PUBLIC_KEY = "[A-Za-z0-9+/]{43}="/);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.match(readFileSync(out, "utf8"), /BEGIN PRIVATE KEY/);
  const again = spawnSync(process.execPath, ["scripts/keygen.mjs", "--out", out], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /exists/);
});

test("keygen: refuses a path inside the repository", () => {
  const out = join(ROOT, "test", "unit", "fixtures", "should-not-exist.key");
  const run = spawnSync(process.execPath, ["scripts/keygen.mjs", "--out", out], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /inside the repository/);
  assert.equal(existsSync(out), false);
});

test("build-ruleset: signs a source file into a verifiable envelope", async () => {
  const dir = scratch();
  const key = join(dir, "k.key");
  const gen = spawnSync(process.execPath, ["scripts/keygen.mjs", "--out", key], { cwd: ROOT, encoding: "utf8" });
  const pub = gen.stdout.match(/RULESET_PUBLIC_KEY = "([^"]+)"/)[1];
  const src = join(dir, "src.json");
  writeFileSync(src, JSON.stringify(source()));
  writeFileSync(join(dir, "feed.txt"), "# comment\nnew-scam.example\nSCAM.com\n\ntrusted-bank.example\n");
  const run = spawnSync(process.execPath, ["scripts/build-ruleset.mjs", "--key", key, "--src", src, "--feeds", dir, "--out", join(dir, "out"), "--prev-version", "7"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const env = JSON.parse(readFileSync(join(dir, "out", "ruleset.json"), "utf8"));
  const { verifyEnvelope } = await import("../../src/engine/ruleset.js");
  const payload = await verifyEnvelope(env, { k1: pub });
  assert.equal(payload.version, 8);
  assert.deepEqual(payload.scam_domains, ["203.0.113.9", "new-scam.example", "scam.com"]);
  assert.equal(payload.scam_phrases[0].examples, undefined);
});

test("build-ruleset: --dry-run writes nothing; lint failure stops the build", () => {
  const dir = scratch();
  const key = join(dir, "k.key");
  spawnSync(process.execPath, ["scripts/keygen.mjs", "--out", key], { cwd: ROOT });
  const src = join(dir, "src.json");
  writeFileSync(src, JSON.stringify(source()));
  const dry = spawnSync(process.execPath, ["scripts/build-ruleset.mjs", "--key", key, "--src", src, "--out", join(dir, "out"), "--dry-run"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(existsSync(join(dir, "out")), false);
  const bad = source();
  bad.scam_phrases[0].pattern = "(a+)+$";
  writeFileSync(src, JSON.stringify(bad));
  const fail = spawnSync(process.execPath, ["scripts/build-ruleset.mjs", "--key", key, "--src", src, "--out", join(dir, "out")], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(fail.status, 0);
  assert.match(fail.stderr, /unsafe/);
});
