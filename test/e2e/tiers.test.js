// Every tier in a real Chromium with the built extension loaded.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, shadowUi, clickInShadow, waitFor } from "./harness.js";

let env;
before(async () => (env = await launch()));
after(async () => env?.close());

const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

test("known scam domain: the navigation is sent to the blocked page", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("known-scam", "/clean.html")).catch(() => {});
  await waitFor(() => page.url().startsWith(`chrome-extension://${env.id}/blocked.html`), { message: "blocked page" });
  await page.waitForLoadState();
  await waitFor(async () => (await page.locator("#domain").textContent()) === "known-scam.localhost", { message: "domain shown" });
  assert.equal(await page.locator(".domain").isVisible(), true);
  await page.close();
});

test("clean page: nothing is shown and the verdict is clean", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("clean", "/clean.html"));
  const verdict = await waitFor(() => env.verdict(page), { message: "verdict" });
  assert.equal(verdict.tier, "clean");
  assert.equal((await shadowUi(page)).mounted, false);
  await page.close();
});

test("two high signals: block with bypass; continue unlocks the page and survives reload", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("bypass", "/two-high.html"));
  await waitFor(async () => (await shadowUi(page)).tier === "block-bypass", { message: "blocker" });
  assert.equal((await env.verdict(page))?.tier, "block-bypass");
  assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "hidden");

  await clickInShadow(page, /continue/i);
  await waitFor(async () => (await shadowUi(page)).tier !== "block-bypass", { message: "blocker gone" });
  assert.notEqual(await page.evaluate(() => document.documentElement.style.overflow), "hidden");
  await page.mouse.wheel(0, 800);
  await waitFor(() => page.evaluate(() => window.scrollY > 0), { message: "page scrolls" });

  await page.reload();
  await settle();
  assert.notEqual((await shadowUi(page)).tier, "block-bypass");
  await page.close();
});

test("one medium phrase pair: banner; dismiss hides it, also after reload", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("dismiss", "/one-phrase.html"));
  await waitFor(async () => (await shadowUi(page)).tier === "banner", { message: "banner" });
  assert.equal((await env.verdict(page))?.tier, "banner");

  await clickInShadow(page, /dismiss/i);
  await waitFor(async () => !(await shadowUi(page)).tier, { message: "banner gone" });

  await page.reload();
  await settle();
  assert.equal((await shadowUi(page)).tier, null);
  await page.close();
});

test("all checks switched off: nothing is rendered", async () => {
  await env.setPrefs({ scam: false, bias: false, social: false });
  try {
    for (const [host, path] of [["off-a", "/one-phrase.html"], ["off-b", "/two-high.html"]]) {
      const page = await env.ctx.newPage();
      await page.goto(env.server.url(host, path));
      await settle();
      assert.equal((await shadowUi(page)).tier, null, path);
      await page.close();
    }
  } finally {
    await env.setPrefs({ scam: true, bias: true, social: true });
  }
});

test("no console errors from the extension", () => {
  assert.deepEqual(env.errors, []);
});
