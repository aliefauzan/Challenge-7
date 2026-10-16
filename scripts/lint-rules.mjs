#!/usr/bin/env node
// Lints the hand-curated ruleset source (data/ruleset.src.json):
// safe regexes, length, unique ids, known categories, allowed flags, and
// examples that match / do not match as declared.
//   npm run lint:rules [-- --src path]
import safeRegex from "safe-regex2";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALLOWED_FLAGS, MAX_PATTERN_LENGTH, validatePayload } from "../src/engine/ruleset.js";

/**
 * @param {any} src ruleset source object (payload + per-phrase `examples`)
 * @returns {string[]} errors
 */
export function lintSource(src) {
  const errors = [];
  const { errors: shape } = validatePayload(stripExamples(src));
  errors.push(...shape);
  const seen = new Set();
  for (const ph of src.scam_phrases ?? []) {
    const at = `phrase ${ph.id}`;
    if (seen.has(ph.id)) errors.push(`duplicate id ${ph.id}`);
    seen.add(ph.id);
    if (!src.categories?.[ph.category]) errors.push(`${at}: unknown category ${ph.category}`);
    if (typeof ph.pattern !== "string") continue;
    if (ph.pattern.length > MAX_PATTERN_LENGTH) errors.push(`${at}: pattern longer than ${MAX_PATTERN_LENGTH} chars`);
    if (!ALLOWED_FLAGS.test(ph.flags ?? "")) {
      errors.push(`${at}: flags "${ph.flags}" not allowed`);
      continue;
    }
    let re;
    try {
      re = new RegExp(ph.pattern, ph.flags);
    } catch (e) {
      errors.push(`${at}: ${e.message}`);
      continue;
    }
    if (!safeRegex(re)) errors.push(`${at}: unsafe pattern (possible catastrophic backtracking)`);
    const ex = ph.examples;
    if (!ex || !Array.isArray(ex.match) || !Array.isArray(ex.nomatch) || !ex.match.length || !ex.nomatch.length) {
      errors.push(`${at}: needs examples.match[] and examples.nomatch[]`);
      continue;
    }
    for (const s of ex.match) if (!re.test(s)) errors.push(`${at}: should match ${JSON.stringify(s)}`);
    for (const s of ex.nomatch) if (re.test(s)) errors.push(`${at}: should not match ${JSON.stringify(s)}`);
  }
  return errors;
}

/** Remove the lint-only `examples` from every phrase. */
export function stripExamples(src) {
  return { ...src, scam_phrases: (src.scam_phrases ?? []).map(({ examples, ...rest }) => rest) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--src");
  const path = i > 0 ? process.argv[i + 1] : "data/ruleset.src.json";
  const src = JSON.parse(readFileSync(path, "utf8"));
  const errors = lintSource(src);
  if (errors.length) {
    console.error(`${errors.length} lint error(s) in ${path}:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`${path}: ${src.scam_phrases.length} phrases OK`);
}
