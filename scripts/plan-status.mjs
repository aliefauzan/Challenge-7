#!/usr/bin/env node
// Plan status indicator: reads plan/PROGRESS.md and each phase's DoD checkboxes,
// prints progress, and flags status/evidence mismatches.
//   npm run plan:status            print
//   npm run plan:status -- --write also refresh the STATUS block in PROGRESS.md
//   npm run plan:status -- --check exit 1 on any mismatch (for CI)
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLAN = join(dirname(fileURLToPath(import.meta.url)), "..", "plan");
const args = new Set(process.argv.slice(2));
const tty = process.stdout.isTTY && !args.has("--write");
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

const STATUS = {
  "[x]": { label: "done", color: 32, icon: "✅" },
  "[~]": { label: "in progress", color: 33, icon: "🟡" },
  "[!]": { label: "blocked", color: 31, icon: "⛔" },
  "[-]": { label: "dropped", color: 90, icon: "➖" },
  "[ ]": { label: "todo", color: 37, icon: "⬜" },
};

const progressPath = join(PLAN, "PROGRESS.md");
if (!existsSync(progressPath)) {
  console.log("No plan/PROGRESS.md in this checkout; nothing to report.");
  process.exit(0);
}
const progress = readFileSync(progressPath, "utf8");

// Rows look like: | 00 | Scaffold | [~] | start | end | summary | log |
function tableRows(md, idPattern) {
  return md
    .split("\n")
    .filter((l) => idPattern.test(l))
    .map((l) => l.split("|").slice(1, -1).map((s) => s.trim()));
}

const phases = tableRows(progress, /^\|\s*\d{2}\s*\|/).map(([id, title, status, started, finished]) => ({
  id, title, status, started, finished,
}));
const fixes = tableRows(progress, /^\|\s*W\d+\s*\|/).map(([id, , , status, evidence]) => ({ id, status, evidence }));
const features = tableRows(progress, /^\|\s*F\d+\s*\|/).map(([id, , , status, evidence]) => ({ id, status, evidence }));
const safari = tableRows(progress, /^\|\s*S\d+\s*\|/).map(([id, , , status, evidence]) => ({ id, status, evidence }));

const phaseFiles = readdirSync(PLAN).filter((f) => /^phase-\d{2}-.*\.md$/.test(f));
function dodFor(id) {
  const file = phaseFiles.find((f) => f.startsWith(`phase-${id}-`));
  if (!file) return null;
  const md = readFileSync(join(PLAN, file), "utf8");
  const section = md.split(/^## DoD\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const boxes = [...section.matchAll(/^- \[( |x)\]/gm)].map((m) => m[1] === "x");
  return { file, total: boxes.length, done: boxes.filter(Boolean).length };
}

const issues = [];
const bar = (done, total, width = 12) => {
  const n = total ? Math.round((done / total) * width) : 0;
  return "█".repeat(n) + "░".repeat(width - n);
};

const lines = [];
for (const p of phases) {
  const dod = dodFor(p.id);
  const st = STATUS[p.status] ?? STATUS["[ ]"];
  if (!dod) issues.push(`phase ${p.id}: no plan/phase-${p.id}-*.md file`);
  else {
    const all = dod.total > 0 && dod.done === dod.total;
    if (p.status === "[x]" && !all) issues.push(`phase ${p.id}: marked [x] but DoD ${dod.done}/${dod.total}`);
    if (all && p.status !== "[x]") issues.push(`phase ${p.id}: DoD complete but status is ${p.status}`);
    if (p.status === "[x]" && !p.finished) issues.push(`phase ${p.id}: [x] without a Finished time`);
    if (p.status === "[~]" && !p.started) issues.push(`phase ${p.id}: [~] without a Started time`);
  }
  const dodTxt = dod ? `${bar(dod.done, dod.total)} ${dod.done}/${dod.total} DoD` : "no file";
  lines.push(`${st.icon} ${p.id} ${p.title.padEnd(30)} ${c(st.color, st.label.padEnd(11))} ${dodTxt}`);
}

for (const row of [...fixes, ...features, ...safari]) {
  if (row.status === "[x]" && !row.evidence) issues.push(`${row.id}: [x] without evidence`);
}

const count = (rows, s) => rows.filter((r) => r.status === s).length;
const donePhases = count(phases, "[x]");
const pct = phases.length ? Math.round((donePhases / phases.length) * 100) : 0;
const allDod = phases.map((p) => dodFor(p.id)).filter(Boolean);
const dodDone = allDod.reduce((a, d) => a + d.done, 0);
const dodTotal = allDod.reduce((a, d) => a + d.total, 0);
const closed = (rows) => count(rows, "[x]") + count(rows, "[-]");

const summary = [
  `Overall   ${bar(donePhases, phases.length, 20)} ${pct}%  (${donePhases}/${phases.length} phases done)`,
  `DoD       ${bar(dodDone, dodTotal, 20)} ${dodDone}/${dodTotal} checkboxes`,
  `Fixes     ${bar(closed(fixes), fixes.length, 20)} ${closed(fixes)}/${fixes.length} W-items closed`,
  `Features  ${bar(closed(features), features.length, 20)} ${closed(features)}/${features.length} F-items closed`,
  `Safari    ${bar(closed(safari), safari.length, 20)} ${closed(safari)}/${safari.length} S-items closed`,
  `Now       ${phases.filter((p) => p.status === "[~]").map((p) => `${p.id} ${p.title}`).join(", ") || "—"}`,
  `Blocked   ${phases.filter((p) => p.status === "[!]").map((p) => p.id).join(", ") || "—"}`,
];

console.log(c(1, "Plan status"));
console.log(summary.join("\n"));
console.log("");
console.log(lines.join("\n"));
console.log("");
if (issues.length) {
  console.log(c(31, `⚠ ${issues.length} mismatch(es):`));
  for (const i of issues) console.log(`  - ${i}`);
} else {
  console.log(c(32, "✓ status matches DoD evidence"));
}

if (args.has("--write")) {
  const stamp = new Date().toLocaleString("en-GB", { timeZone: "Asia/Makassar", dateStyle: "medium", timeStyle: "short" });
  const block = [
    "<!-- STATUS:START -->",
    "```text",
    ...summary,
    `Updated   ${stamp} WITA by npm run plan:status`,
    ...(issues.length ? [`Warnings  ${issues.length} (run npm run plan:status)`] : []),
    "```",
    "<!-- STATUS:END -->",
  ].join("\n");
  writeFileSync(progressPath, progress.replace(/<!-- STATUS:START -->[\s\S]*?<!-- STATUS:END -->/, block));
  console.log("PROGRESS.md status block updated.");
}

if (args.has("--check") && issues.length) process.exit(1);
