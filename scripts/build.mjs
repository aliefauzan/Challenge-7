#!/usr/bin/env node
// Builds the extension for one or both targets (R1 "Build").
//   node scripts/build.mjs --target chrome|safari|all   (default: all)
//   node scripts/build.mjs --watch                      rebuild on change
//   node scripts/build.mjs --ruleset <file.json>        bundle another ruleset (test builds)
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeIcons, EXTENSION_SIZES } from "./make-icons.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = {
  chrome: { esbuildTarget: "chrome137", entries: {} },
  // Safari ignores redirect rules; a document_start guard script blocks instead.
  safari: { esbuildTarget: "safari17", entries: { guard: "src/content/guard.js" } },
};
const ENTRIES = {
  background: "src/background.js",
  content: "src/content/main.js",
  popup: "src/popup/popup.js",
  blocked: "src/blocked/blocked.js",
};
const STATIC = ["src/popup/popup.html", "src/popup/popup.css", "src/blocked/blocked.html", "src/blocked/blocked.css"];

function parseArgs(argv) {
  const args = { target: "all", watch: false, ruleset: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--watch") args.watch = true;
    else if (argv[i] === "--target") args.target = argv[++i];
    else if (argv[i] === "--ruleset") args.ruleset = resolve(argv[++i]);
    else if (argv[i].startsWith("--target=")) args.target = argv[i].slice("--target=".length);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (args.target !== "all" && !TARGETS[args.target]) {
    throw new Error(`unknown target "${args.target}" (use chrome, safari or all)`);
  }
  return args;
}

const readJson = (file) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Objects merge key by key; arrays and scalars from the override replace the base.
function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

function writeStatic(target) {
  const outdir = join(ROOT, "dist", target);
  const manifest = merge(readJson("manifest.base.json"), readJson(`manifest.${target}.json`));
  manifest.version = readJson("package.json").version;
  writeFileSync(join(outdir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const file of STATIC) copyFileSync(join(ROOT, file), join(outdir, file.split("/").pop()));
}

// Icons are drawn once per build run, not on every watch rebuild.
const drawn = new Set();
function writeExtensionIcons(target) {
  if (drawn.has(target)) return;
  writeIcons(join(ROOT, "dist", target, "icons"), EXTENSION_SIZES);
  drawn.add(target);
}

// Points the background's bundled-ruleset import at another file.
function rulesetPlugin(file) {
  return {
    name: "tm-ruleset",
    setup(build) {
      build.onResolve({ filter: /\/data\/default-ruleset\.json$/ }, () => ({ path: file }));
    },
  };
}

function options(target, ruleset) {
  return {
    absWorkingDir: ROOT,
    entryPoints: { ...ENTRIES, ...TARGETS[target].entries },
    outdir: join("dist", target),
    bundle: true,
    format: "iife",
    target: TARGETS[target].esbuildTarget,
    define: { __TM_TARGET__: JSON.stringify(target) },
    minifySyntax: true, // folds TARGET branches; names and whitespace stay readable
    logLevel: "warning",
    plugins: [
      ...(ruleset ? [rulesetPlugin(ruleset)] : []),
      {
        name: "tm-static",
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length === 0) {
              writeStatic(target);
              writeExtensionIcons(target);
            }
          });
        },
      },
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = args.target === "all" ? Object.keys(TARGETS) : [args.target];
  for (const target of targets) {
    const outdir = join(ROOT, "dist", target);
    rmSync(outdir, { recursive: true, force: true });
    mkdirSync(outdir, { recursive: true });
  }
  if (args.watch) {
    for (const target of targets) {
      const ctx = await esbuild.context(options(target, args.ruleset));
      await ctx.watch();
    }
    console.log(`watching ${targets.join(", ")} (Ctrl-C to stop)`);
    return;
  }
  for (const target of targets) {
    await esbuild.build(options(target, args.ruleset));
    console.log(`built dist/${target}${args.ruleset ? ` with ruleset ${args.ruleset}` : ""}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
