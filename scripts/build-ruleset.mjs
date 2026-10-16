#!/usr/bin/env node
// Builds and signs the published ruleset.
//   npm run ruleset -- --key <private key> [--src data/ruleset.src.json]
//     [--feeds data/feeds] [--out dist-ruleset] [--prev-version N]
//     [--bundle] [--dry-run]
// Steps: read the source, merge feed domains (*.txt, one per line), dedupe,
// drop allowlisted domains, lint, bump the version, validate, sign.
import { sign, createPrivateKey } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { lintSource, stripExamples } from "./lint-rules.mjs";
import { validatePayload, ENVELOPE_FORMAT } from "../src/engine/ruleset.js";
import { DomainSet } from "../src/engine/domains.js";
import { normalizeHost } from "../src/engine/host.js";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const fail = (msg) => {
  console.error(`ruleset: ${msg}`);
  process.exit(1);
};

const srcPath = opt("src", "data/ruleset.src.json");
const feedsDir = opt("feeds", "data/feeds");
const outDir = opt("out", "dist-ruleset");
const keyPath = opt("key");
const dryRun = flag("dry-run");
if (!keyPath && !dryRun) fail("--key <private key path> is required (or use --dry-run)");

const src = JSON.parse(readFileSync(srcPath, "utf8"));
const lintErrors = lintSource(src);
if (lintErrors.length) fail(`lint failed:\n  - ${lintErrors.join("\n  - ")}`);

const feedDomains = existsSync(feedsDir)
  ? readdirSync(feedsDir).filter((f) => f.endsWith(".txt")).flatMap((f) =>
      readFileSync(join(feedsDir, f), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")))
  : [];
const allow = new DomainSet(src.allowlist);
const domains = [...new Set([...src.scam_domains, ...feedDomains].map(normalizeHost).filter(Boolean))]
  .filter((d) => !allow.has(d))
  .sort();

const lastPublished = existsSync(join(outDir, "ruleset.json"))
  ? JSON.parse(JSON.parse(readFileSync(join(outDir, "ruleset.json"), "utf8")).payload).version
  : 0;
const prev = Math.max(Number(opt("prev-version", 0)), lastPublished);
const payloadObj = {
  ...stripExamples(src),
  version: Math.max(src.version, prev + 1),
  generated: new Date().toISOString().slice(0, 10),
  scam_domains: domains,
};
const { ok, errors } = validatePayload(payloadObj);
if (!ok) fail(`invalid payload:\n  - ${errors.join("\n  - ")}`);

const payload = JSON.stringify(payloadObj);
const summary = `version ${payloadObj.version}: ${domains.length} domains (${feedDomains.length} from feeds), ${payloadObj.scam_phrases.length} phrases, ${Object.keys(payloadObj.sources).length} sources`;
if (dryRun) {
  if (keyPath) sign(null, Buffer.from(payload), createPrivateKey(readFileSync(keyPath)));
  console.log(`dry run OK, ${summary}`);
  process.exit(0);
}
const sig = sign(null, Buffer.from(payload), createPrivateKey(readFileSync(keyPath))).toString("base64");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "ruleset.json"), JSON.stringify({ format: ENVELOPE_FORMAT, kid: opt("kid", "k1"), payload, sig }) + "\n");
console.log(`wrote ${join(outDir, "ruleset.json")}, ${summary}`);
if (flag("bundle")) {
  mkdirSync("src/data", { recursive: true });
  writeFileSync("src/data/default-ruleset.json", JSON.stringify(payloadObj, null, 2) + "\n");
  console.log("wrote src/data/default-ruleset.json");
}
