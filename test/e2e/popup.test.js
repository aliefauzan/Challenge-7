// The toolbar popup for a tab with a warning.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, waitFor } from "./harness.js";

let env;
before(async () => (env = await launch()));
after(async () => env?.close());

async function openPopup(forUrl) {
  const popup = await env.ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  // The popup asks for the active tab; point it at the page under test.
  await popup.addInitScript((url) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = () => query({ url });
  }, forUrl);
  await popup.goto(`chrome-extension://${env.id}/popup.html`);
  return popup;
}

test("the popup lists the warning signs found on the page", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("popup", "/one-phrase.html"));
  const verdict = await waitFor(async () => {
    const v = await env.verdict(page);
    return v?.tier === "banner" ? v : null;
  }, { message: "verdict" });

  const popup = await openPopup(page.url());
  await waitFor(async () => (await popup.locator("[data-kind]").count()) === 1, { message: "status" });
  assert.notEqual(await popup.locator("[data-kind]").getAttribute("data-kind"), "clean");
  await popup.locator("summary").click();
  const text = await popup.locator("main").innerText();
  for (const s of verdict.signals) assert.ok(text.includes(s.description), `${s.description} missing in:\n${text}`);
  assert.ok(text.includes("popup.localhost"), text);
  const [scrollWidth, innerWidth] = await popup.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(scrollWidth <= innerWidth);
  await popup.close();
  await page.close();
});

test("popup: a switch writes the preference and stays after reopening", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("popup2", "/clean.html"));
  let popup = await openPopup(page.url());
  const sw = popup.locator('[data-key="bias"]');
  await waitFor(async () => (await sw.count()) === 1, { message: "switch" });
  assert.equal(await sw.getAttribute("aria-checked"), "true");
  await sw.click();
  await waitFor(async () => (await env.sw.evaluate(async () => (await chrome.storage.sync.get("tm.prefs"))["tm.prefs"]?.bias)) === false, { message: "pref saved" });
  await popup.close();
  popup = await openPopup(page.url());
  await waitFor(async () => (await popup.locator('[data-key="bias"]').getAttribute("aria-checked")) === "false", { message: "pref shown" });
  await popup.close();
  await env.setPrefs({ scam: true, bias: true, social: true });
  await page.close();
});

test("no console errors from the extension", () => {
  assert.deepEqual(env.errors, []);
});
