#!/usr/bin/env node
// Builds the Safari extension and its container app.
//
//   npm run safari:build [-- --mac-only | --ios-only] [--signed] [--test-ruleset]
//   npm run safari:open      launch the macOS app (registers the extension with Safari)
//   npm run safari:sim       install and launch the iOS app on the booted Simulator
//   npm run safari:archive [-- --mac-only | --ios-only] [--build-number N]
//                            signed Release archives for App Store Connect
//
// Without --signed, the macOS app is signed to run locally (ad hoc) and the
// Simulator app is not signed, so no Apple account is needed. --signed uses
// the project's team with automatic signing. --test-ruleset bundles the
// end-to-end test ruleset (known-scam.localhost and friends) for
// test/safari and the manual checklist; never ship such a build.
//
// The version shown to users comes from package.json (MARKETING_VERSION).
// The build number (CURRENT_PROJECT_VERSION) is the date and time,
// YYYYMMDD.HHMM, so every archive is numbered higher than the one before;
// --build-number overrides it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = join(ROOT, "safari", "ScamShield", "ScamShield.xcodeproj");
const DERIVED = join(ROOT, "safari", "build");
const MAC_APP = join(DERIVED, "Build", "Products", "Debug", "ScamShield.app");
const SIM_APP = join(DERIVED, "Build", "Products", "Debug-iphonesimulator", "ScamShield.app");
const BUNDLE_ID = "com.aliefauzan.scamshield";
const TEAM = "62ZRZ6VZKC";
const PLATFORMS = [
  { name: "macOS", scheme: "ScamShield (macOS)", destination: "generic/platform=macOS", skip: "--ios-only" },
  { name: "iOS", scheme: "ScamShield (iOS)", destination: "generic/platform=iOS", skip: "--mac-only" },
];

const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

function buildNumber(args) {
  const i = args.indexOf("--build-number");
  if (i >= 0) return args[i + 1];
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
}

const versionSettings = (args) => [`MARKETING_VERSION=${VERSION}`, `CURRENT_PROJECT_VERSION=${buildNumber(args)}`];

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

function xcodebuild(scheme, destination, settings) {
  console.log(`building ${scheme}…`);
  run("xcodebuild", ["-project", PROJECT, "-scheme", scheme, "-configuration", "Debug", "-destination", destination, "-derivedDataPath", DERIVED, "build", ...settings], { quiet: true });
}

async function build(args) {
  const extra = [];
  if (args.includes("--test-ruleset")) {
    const { testRuleset } = await import("../test/e2e/ruleset.js");
    const file = join(DERIVED, "test-ruleset.json");
    mkdirSync(DERIVED, { recursive: true });
    writeFileSync(file, JSON.stringify(testRuleset()));
    extra.push("--ruleset", file);
  }
  run("node", ["scripts/build.mjs", "--target", "safari", ...extra]);
  const signed = args.includes("--signed");
  const version = versionSettings(args);
  if (!args.includes("--ios-only")) {
    xcodebuild("ScamShield (macOS)", "generic/platform=macOS", [...version, ...(signed ? [] : ["CODE_SIGN_IDENTITY=-", "CODE_SIGN_STYLE=Manual", "DEVELOPMENT_TEAM="])]);
    console.log(`built ${MAC_APP}`);
  }
  if (!args.includes("--mac-only")) {
    xcodebuild("ScamShield (iOS)", "generic/platform=iOS Simulator", [...version, ...(signed ? [] : ["CODE_SIGNING_ALLOWED=NO"])]);
    console.log(`built ${SIM_APP}`);
  }
}

// Release archives with the team's automatic signing. Uploading them is a
// separate step in Xcode's Organizer (or xcrun altool) and needs an active
// Apple Developer Program membership.
function archive(args) {
  if (args.includes("--test-ruleset")) {
    console.error("archives always use the bundled ruleset; drop --test-ruleset");
    process.exit(2);
  }
  run("node", ["scripts/build.mjs", "--target", "safari"]);
  const version = versionSettings(args);
  for (const p of PLATFORMS) {
    if (args.includes(p.skip)) continue;
    const out = join(DERIVED, `ScamShield-${VERSION}-${p.name}.xcarchive`);
    console.log(`archiving ${p.scheme}…`);
    run("xcodebuild", ["-project", PROJECT, "-scheme", p.scheme, "-configuration", "Release", "-destination", p.destination, "-derivedDataPath", DERIVED, "-archivePath", out, "-allowProvisioningUpdates", "archive", `DEVELOPMENT_TEAM=${TEAM}`, "CODE_SIGN_STYLE=Automatic", ...version], { quiet: true });
    console.log(`archived ${out} (${version.join(", ")})`);
  }
}

// An archive leaves a second copy of the app under ArchiveIntermediates, and
// macOS registers its extension under the same bundle ID. Safari then lists
// neither copy. Unregister every copy except the one about to be opened.
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
function unregisterOtherCopies() {
  const list = spawnSync("pluginkit", ["-mADvvv", "-i", `${BUNDLE_ID}.Extension`], { encoding: "utf8" }).stdout ?? "";
  for (const [, appex] of list.matchAll(/^\s*Path = (.+\.appex)$/gm)) {
    if (appex.startsWith(`${MAC_APP}/`)) continue;
    spawnSync("pluginkit", ["-r", appex]);
    spawnSync(LSREGISTER, ["-u", dirname(dirname(dirname(appex)))]);
    console.log(`unregistered ${appex}`);
  }
}

function need(path) {
  if (!existsSync(path)) {
    console.error(`${path} is missing: run npm run safari:build first`);
    process.exit(1);
  }
}

const [command = "build", ...args] = process.argv.slice(2);
if (command === "build") await build(args);
else if (command === "archive") archive(args);
else if (command === "open") {
  need(MAC_APP);
  unregisterOtherCopies();
  run("open", [MAC_APP]);
  console.log("opened ScamShield; now turn it on in Safari Settings → Extensions");
} else if (command === "sim") {
  need(SIM_APP);
  run("xcrun", ["simctl", "install", "booted", SIM_APP]);
  run("xcrun", ["simctl", "launch", "booted", BUNDLE_ID]);
  console.log("installed on the booted Simulator; turn it on in Settings → Apps → Safari → Extensions");
} else {
  console.error("usage: node scripts/safari.mjs build|archive|open|sim [--mac-only|--ios-only] [--signed] [--test-ruleset] [--build-number N]");
  process.exit(2);
}
