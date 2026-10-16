// Grep-based guards for the security rules every source file must follow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sources(...dirs) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|mjs|html)$/.test(path)) out.push(path);
    }
  };
  for (const d of dirs) walk(join(ROOT, ...d.split("/")));
  return out;
}

function offenders(files, re) {
  return files
    .filter((f) => re.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
}

test("security: no HTML parsing or dynamic code anywhere in src", () => {
  const re = /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new\s+Function\b|setTimeout\s*\(\s*["'`]|createContextualFragment|DOMParser)/;
  assert.deepEqual(offenders(sources("src"), re), []);
});

test("security: content and UI code never use page storage or storage.session", () => {
  assert.deepEqual(offenders(sources("src/content", "src/ui"), /\b(sessionStorage|localStorage|indexedDB|storage\.session|document\.cookie)\b/), []);
});

test("security: content and UI code write no extension storage", () => {
  // Content may read tm.ruleset and tm.prefs; every write goes through the background.
  assert.deepEqual(offenders(sources("src/content", "src/ui"), /storage\.(local|sync)\.(set|remove|clear)\b/), []);
});

test("security: the only network code is the background ruleset fetch", () => {
  const net = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon)/;
  assert.deepEqual(offenders(sources("src/content", "src/ui", "src/engine", "src/popup", "src/blocked", "src/platform"), net), []);
});

test("security: extension namespaces are named only in src/platform/api.js", () => {
  const files = sources("src").filter((f) => !f.endsWith(join("platform", "api.js")));
  assert.deepEqual(offenders(files, /\b(chrome|browser)\.[a-z]/), []);
});

test("security: every runtime.onMessage listener checks the sender id", () => {
  for (const f of sources("src")) {
    const text = readFileSync(f, "utf8");
    if (!/onMessage\.addListener/.test(text)) continue;
    assert.match(text, /sender\??\.id\s*!==\s*api\.runtime\.id/, `${relative(ROOT, f)} must check sender.id`);
  }
});

test("security: the injected UI uses a closed shadow root on <tm-root>", () => {
  const shadow = readFileSync(join(ROOT, "src", "ui", "shadow.js"), "utf8");
  assert.match(shadow, /attachShadow\(\{\s*mode:\s*"closed"\s*\}\)/);
  assert.match(shadow, /createElement\("tm-root"\)/);
  assert.doesNotMatch(shadow, /mode:\s*"open"/);
});
