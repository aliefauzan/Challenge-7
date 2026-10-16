// Safari smoke test: drives Safari through safaridriver (W3C WebDriver over
// plain fetch, no extra dependency) against the end-to-end fixtures.
//
//   npm run safari:build -- --mac-only --test-ruleset && npm run safari:open
//   npm run test:safari
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
import { startServer } from "../e2e/server.js";

const SETUP = [
  "Safari automation or the ScamShield extension is not available.",
  "See the setup section of test/safari/checklist.md:",
  "  1. safaridriver --enable (asks for the admin password)",
  "  2. Safari → Settings → Advanced → Show features for web developers; Develop → Allow Remote Automation",
  "  3. Develop → Allow Unsigned Extensions, then Settings → Extensions → ScamShield on, allowed on all websites",
  "  4. npm run safari:build -- --mac-only --test-ruleset && npm run safari:open",
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
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path}: ${json.value?.error ?? res.status} ${json.value?.message ?? ""}`.trim());
    return json.value;
  }
  let id = null;
  return {
    status: () => call("GET", "/status"),
    async start() {
      const value = await call("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
      id = value.sessionId;
    },
    stop: () => (id ? call("DELETE", `/session/${id}`).catch(() => {}) : undefined),
    go: (url) => call("POST", `/session/${id}/url`, { url }).catch(() => {}),
    url: () => call("GET", `/session/${id}/url`),
    run: (script, ...args) => call("POST", `/session/${id}/execute/sync`, { script, args }),
  };
}

const onBlockedPage = (url) => /^safari-web-extension:\/\/[^/]+\/blocked\.html/.test(url ?? "");
// Host names unique to this run, so a dismiss or bypass from an earlier run
// (or from working through the checklist) cannot hide a warning.
const RUN = Date.now().toString(36);
const site = (name) => `${name}-${RUN}`;

describe("Safari smoke", { skip: process.platform !== "darwin" && "macOS only" }, () => {
  let server, driver, wd;
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
    } catch (err) {
      throw new Error(`${SETUP}\n(${err.message})`);
    }
    // The known-scam probe doubles as the check that the extension runs in
    // the automation window with the test ruleset.
    await wd.go(server.url("known-scam", "/clean.html"));
    const ok = await waitFor(async () => onBlockedPage(await wd.url()), { timeout: 8000, message: "blocked page" }).catch(() => false);
    if (!ok) throw new Error(`${SETUP}\n(known-scam.localhost was not sent to the blocked page: the extension is off in automation windows or the build lacks --test-ruleset)`);
  });

  after(async () => {
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
