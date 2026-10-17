// Safari smoke test: drives Safari through safaridriver (W3C WebDriver over
// plain fetch, no extra dependency) against the end-to-end fixtures.
//
//   npm run safari:build -- --mac-only --test-ruleset && npm run safari:open
//   npm run test:safari
//
// When Safari already runs the installed ScamShield app in automation
// windows, the test uses it, so build and open the app with the test ruleset.
// Otherwise the test loads dist/safari into its session as a temporary
// extension (WebDriver "Install WebExtension") and removes it at the end; a
// copy loaded next to a running installed app does not run. If the session
// times out, quit Safari and run again.
//
// macOS only; skipped elsewhere. The extension's UI lives in a closed shadow
// root, so every assertion reads the page DOM only: whether <tm-root> is on
// the page, whether the page scroll is locked by the blocker, where the tab
// ended up, and whether injected markup ran. What automation cannot see is in
// test/safari/checklist.md.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { startServer } from "../e2e/server.js";

const EXTENSION = fileURLToPath(new URL("../../dist/safari", import.meta.url));

const SETUP = [
  "Safari automation or the ScamShield extension is not available.",
  "See the setup section of test/safari/checklist.md:",
  "  1. safaridriver --enable (asks for the admin password)",
  "  2. Safari → Settings → Developer → Allow remote automation; Allow unsigned extensions",
  "  3. If the session times out: quit Safari and run again, so safaridriver starts it",
  "  4. npm run safari:build -- --mac-only --test-ruleset (dist/safari and the app with the test ruleset)",
  "  5. If Safari runs the installed app: npm run safari:open after that build",
].join("\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

async function waitFor(fn, { timeout = 8000, interval = 150, message = "condition" } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${message}`);
    await sleep(interval);
  }
}

/** A minimal W3C WebDriver client for one session. */
function webdriver(base) {
  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path}: ${json.value?.error ?? res.status} ${json.value?.message ?? ""}`.trim());
    return json.value;
  }
  let id = null;
  const handles = () => call("GET", `/session/${id}/window/handles`);
  const use = (handle) => call("POST", `/session/${id}/window`, { handle });
  // When a tab moves to an extension page, Safari gives it a new window
  // handle and commands on the old one fail with "no such window".
  // Just after the switch the list can still name the retired handle, so
  // try each one, and try again shortly if none answers.
  async function current(fn) {
    for (let tries = 0; ; tries++) {
      try {
        return await fn();
      } catch (err) {
        if (!/no such window/.test(err.message) || tries === 10) throw err;
        for (const h of [...(await handles())].reverse()) {
          if (await use(h).then(() => true, () => false)) break;
        }
        await sleep(300);
      }
    }
  }
  return {
    status: () => call("GET", "/status"),
    async start() {
      const value = await call("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
      id = value.sessionId;
    },
    stop: () => (id ? call("DELETE", `/session/${id}`).catch(() => {}) : undefined),
    install: async (path) => (await call("POST", `/session/${id}/webextension`, { type: "path", path })).extension,
    uninstall: (ext) => call("DELETE", `/session/${id}/webextension/${encodeURIComponent(ext)}`).catch(() => {}),
    // Each page opens in a new tab and the old tabs close: navigating away
    // from an extension page can hang the session.
    async go(url) {
      // Just after a redirect the list can still name the retired handle,
      // so try each one until a tab opens.
      let old, handle;
      for (let tries = 0; !handle; tries++) {
        old = await handles();
        for (const h of [...old].reverse()) {
          handle = await use(h)
            .then(() => call("POST", `/session/${id}/window/new`, { type: "tab" }))
            .then((res) => res.handle, () => null);
          if (handle) break;
        }
        if (!handle && tries === 10) throw new Error("no window to open a tab from");
        if (!handle) await new Promise((r) => setTimeout(r, 300));
      }
      for (const h of old) await use(h).then(() => call("DELETE", `/session/${id}/window`)).catch(() => {});
      await use(handle);
      await call("POST", `/session/${id}/url`, { url }).catch(() => {});
    },
    url: () => current(() => call("GET", `/session/${id}/url`)),
    run: (script, ...args) => current(() => call("POST", `/session/${id}/execute/sync`, { script, args })),
  };
}

const onBlockedPage = (url) => /^safari-web-extension:\/\/[^/]+\/blocked\.html/.test(url ?? "");
// Host names unique to this run, so a dismiss or bypass from an earlier run
// (or from working through the checklist) cannot hide a warning.
const RUN = Date.now().toString(36);
const site = (name) => `${name}-${RUN}`;

describe("Safari smoke", { skip: process.platform !== "darwin" && "macOS only" }, () => {
  let server, driver, wd, ext;
  const hasRoot = () => wd.run("return document.querySelectorAll('tm-root').length === 1");
  const scrollLocked = () => wd.run("return document.documentElement.style.overflow === 'hidden'");

  before(async () => {
    server = await startServer(0);
    const port = await freePort();
    driver = spawn("safaridriver", ["-p", String(port)], { stdio: "ignore" });
    driver.on("error", () => {});
    wd = webdriver(`http://127.0.0.1:${port}`);
    try {
      await waitFor(async () => (await wd.status())?.ready !== undefined, { timeout: 5000, message: "safaridriver" });
      await wd.start();
      // A ScamShield that Safari already runs in automation windows (the
      // installed app, while unsigned extensions are allowed) is used as is:
      // a second copy would race it.
      await wd.go(server.url(site("probe"), "/one-phrase.html"));
      const installed = await waitFor(hasRoot, { timeout: 3000, message: "installed extension" }).catch(() => false);
      if (!installed) ext = await wd.install(EXTENSION);
    } catch (err) {
      throw new Error(`${SETUP}\n(${err.message})`);
    }
    // The known-scam probe doubles as the check that the extension runs in
    // the automation window with the test ruleset.
    await wd.go(server.url("known-scam", "/clean.html"));
    const ok = await waitFor(async () => onBlockedPage(await wd.url()), { timeout: 8000, message: "blocked page" }).catch(() => false);
    if (!ok) {
      const at = await wd.url().catch((err) => err.message);
      throw new Error(`${SETUP}\n(known-scam.localhost was not sent to the blocked page, the tab is at ${at}: the running copy lacks the test ruleset; build with --test-ruleset and run npm run safari:open)`);
    }
  });

  after(async () => {
    if (ext) await wd.uninstall(ext);
    await wd?.stop();
    driver?.kill();
    await server?.close();
  });

  test("known scam domain: the tab is sent to the blocked page", async () => {
    await wd.go(server.url("known-scam", "/two-high.html"));
    await waitFor(async () => onBlockedPage(await wd.url()), { message: "blocked page" });
    assert.match(await wd.url(), /blocked\.html/);
  });

  test("two high signals: the blocker is on the page and scrolling is locked", async () => {
    await wd.go(server.url(site("two-high"), "/two-high.html"));
    await waitFor(hasRoot, { message: "<tm-root>" });
    await waitFor(scrollLocked, { message: "scroll lock" });
  });

  test("one medium phrase pair: a banner, page scroll untouched", async () => {
    await wd.go(server.url(site("one-phrase"), "/one-phrase.html"));
    await waitFor(hasRoot, { message: "<tm-root>" });
    assert.equal(await scrollLocked(), false);
  });

  test("page storage written before the scan does not switch the warning off", async () => {
    await wd.go(server.url(site("storage"), "/storage-attack.html"));
    assert.ok((await wd.run("return window.__wrote")) > 100);
    await waitFor(hasRoot, { message: "<tm-root>" });
    await wd.run("location.reload()");
    await sleep(500);
    await waitFor(hasRoot, { message: "<tm-root> after reload" });
  });

  test("markup in ruleset text never runs", async () => {
    await wd.go(server.url(site("markup"), "/markup-phrase.html"));
    await waitFor(hasRoot, { message: "<tm-root>" });
    await sleep(500);
    assert.equal(await wd.run("return typeof window.pwned"), "undefined");
  });

  test("text added two seconds after load raises a warning", async () => {
    await wd.go(server.url(site("late"), "/late.html"));
    assert.equal(await hasRoot(), false);
    await waitFor(hasRoot, { message: "late <tm-root>" });
  });

  test("clean page: nothing is added", async () => {
    await wd.go(server.url(site("clean"), "/clean.html"));
    await sleep(2000);
    assert.equal(await wd.run("return document.querySelectorAll('tm-root').length"), 0);
    assert.equal(await scrollLocked(), false);
  });
});
