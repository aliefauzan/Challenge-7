#!/usr/bin/env node
// Builds the Safari extension and its container app.
//
//   npm run safari:build [-- --mac-only | --ios-only] [--signed]
//   npm run safari:open      launch the macOS app (registers the extension with Safari)
//   npm run safari:sim       install and launch the iOS app on the booted Simulator
//
// Without --signed, the macOS app is signed to run locally (ad hoc) and the
// Simulator app is not signed, so no Apple account is needed. --signed uses
// the project's team with automatic signing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = join(ROOT, "safari", "ScamShield", "ScamShield.xcodeproj");
const DERIVED = join(ROOT, "safari", "build");
const MAC_APP = join(DERIVED, "Build", "Products", "Debug", "ScamShield.app");
const SIM_APP = join(DERIVED, "Build", "Products", "Debug-iphonesimulator", "ScamShield.app");
const BUNDLE_ID = "com.aliefauzan.scamshield";

function run(cmd, args, { quiet = false } = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: quiet ? "pipe" : "inherit" });
  if (res.status !== 0) {
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const errors = out.split("\n").filter((l) => /error:|BUILD FAILED|\*\* .* FAILED \*\*/.test(l));
    console.error(errors.length ? errors.slice(0, 20).join("\n") : out.split("\n").slice(-30).join("\n"));
    console.error(`failed: ${cmd} ${args.join(" ")}`);
    process.exit(res.status || 1);
  }
  return res.stdout ?? "";
}

function xcodebuild(scheme, destination, signing) {
  console.log(`building ${scheme}…`);
  run("xcodebuild", ["-project", PROJECT, "-scheme", scheme, "-configuration", "Debug", "-destination", destination, "-derivedDataPath", DERIVED, "build", ...signing], { quiet: true });
}

function build(args) {
  run("node", ["scripts/build.mjs", "--target", "safari"]);
  const signed = args.includes("--signed");
  if (!args.includes("--ios-only")) {
    xcodebuild("ScamShield (macOS)", "generic/platform=macOS", signed ? [] : ["CODE_SIGN_IDENTITY=-", "CODE_SIGN_STYLE=Manual", "DEVELOPMENT_TEAM="]);
    console.log(`built ${MAC_APP}`);
  }
  if (!args.includes("--mac-only")) {
    xcodebuild("ScamShield (iOS)", "generic/platform=iOS Simulator", signed ? [] : ["CODE_SIGNING_ALLOWED=NO"]);
    console.log(`built ${SIM_APP}`);
  }
}

function need(path) {
  if (!existsSync(path)) {
    console.error(`${path} is missing: run npm run safari:build first`);
    process.exit(1);
  }
}

const [command = "build", ...args] = process.argv.slice(2);
if (command === "build") build(args);
else if (command === "open") {
  need(MAC_APP);
  run("open", [MAC_APP]);
  console.log("opened ScamShield; now turn it on in Safari Settings → Extensions");
} else if (command === "sim") {
  need(SIM_APP);
  run("xcrun", ["simctl", "install", "booted", SIM_APP]);
  run("xcrun", ["simctl", "launch", "booted", BUNDLE_ID]);
  console.log("installed on the booted Simulator; turn it on in Settings → Apps → Safari → Extensions");
} else {
  console.error("usage: node scripts/safari.mjs build|open|sim [--mac-only|--ios-only] [--signed]");
  process.exit(2);
}
