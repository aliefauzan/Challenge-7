import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { makeFakeApi } from "./fakes/api.js";
import { makeFakeWindow } from "./fakes/dom.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGETS = ["chrome", "safari"];
const BUNDLES = ["background.js", "content.js", "popup.js", "blocked.js"];
const PAGES = ["popup.html", "popup.css", "blocked.html"];
// Keys Safari does not understand; they must stay in manifest.chrome.json.
const CHROME_ONLY_KEYS = ["minimum_chrome_version", "update_url", "key", "oauth2", "chrome_settings_overrides", "chrome_url_overrides"];

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const manifest = (target) => JSON.parse(readFileSync(join(ROOT, "dist", target, "manifest.json"), "utf8"));

test("smoke: build --target all succeeds", () => {
  const run = spawnSync(process.execPath, ["scripts/build.mjs", "--target", "all"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

for (const target of TARGETS) {
  test(`smoke: dist/${target} has manifest, 4 bundles and pages`, () => {
    for (const file of ["manifest.json", ...BUNDLES, ...PAGES]) {
      assert.ok(existsSync(join(ROOT, "dist", target, file)), `missing dist/${target}/${file}`);
    }
  });

  test(`smoke: dist/${target}/manifest.json is a valid MV3 manifest`, () => {
    const m = manifest(target);
    assert.equal(m.manifest_version, 3);
    assert.equal(m.version, pkg.version);
    assert.equal(m.background.service_worker ?? m.background.scripts?.[0], "background.js");
    assert.equal(m.action.default_popup, "popup.html");
    const main = m.content_scripts.find((c) => c.js.includes("content.js"));
    assert.equal(main.run_at, "document_idle");
    assert.equal(main.all_frames, true);
    assert.ok(m.host_permissions.includes("<all_urls>"));
    for (const perm of ["storage", "alarms", "declarativeNetRequest", "tabs"]) {
      assert.ok(m.permissions.includes(perm), `missing permission ${perm}`);
    }
    assert.ok(m.web_accessible_resources.some((r) => r.resources.includes("blocked.html")));
  });

  test(`smoke: dist/${target} bundles carry the right TARGET`, () => {
    for (const bundle of BUNDLES) {
      const logs = [];
      const js = readFileSync(join(ROOT, "dist", target, bundle), "utf8");
      const window = makeFakeWindow();
      runInNewContext(js, { console: { debug: (msg) => logs.push(msg), error() {} }, chrome: makeFakeApi(), structuredClone, window, document: window.document, URL });
      assert.deepEqual(logs, [`tm:${bundle.replace(".js", "")} loaded target=${target}`]);
    }
  });
}

test("smoke: only the Safari build has the document_start guard script", () => {
  const guard = manifest("safari").content_scripts.find((c) => c.js.includes("guard.js"));
  assert.equal(guard.run_at, "document_start");
  assert.equal(guard.all_frames, false);
  assert.ok(existsSync(join(ROOT, "dist", "safari", "guard.js")));
  assert.ok(!existsSync(join(ROOT, "dist", "chrome", "guard.js")));
  assert.ok(!manifest("chrome").content_scripts.some((c) => c.js.includes("guard.js")));
});

test("smoke: Safari manifest has no Chrome-only keys", () => {
  const m = manifest("safari");
  for (const key of CHROME_ONLY_KEYS) assert.ok(!(key in m), `Chrome-only key ${key} in Safari manifest`);
  assert.ok(m.browser_specific_settings?.safari?.strict_min_version, "missing safari.strict_min_version");
});

test("smoke: Chrome manifest has minimum_chrome_version 137 and no Safari keys", () => {
  const m = manifest("chrome");
  assert.equal(m.minimum_chrome_version, "137");
  assert.ok(!("browser_specific_settings" in m));
});

test("smoke: only src/platform/api.js names chrome or browser", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".js") && !path.endsWith(join("platform", "api.js"))) {
        if (/\b(chrome|browser)\s*\./.test(readFileSync(path, "utf8"))) offenders.push(relative(ROOT, path));
      }
    }
  };
  walk(join(ROOT, "src"));
  assert.deepEqual(offenders, []);
});
