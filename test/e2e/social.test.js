// Social feed: chips on risky posts and badges after risky links.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launch, waitFor } from "./harness.js";

let env;
before(async () => {
  env = await launch();
  const body = await readFile(new URL("./fixtures/fb-feed.html", import.meta.url), "utf8");
  await env.ctx.route("https://www.facebook.com/**", (r) => r.fulfill({ contentType: "text/html", body }));
});
after(async () => env?.close());

test("feed: risky posts get a chip, risky links a badge, safe items nothing", async () => {
  const page = await env.ctx.newPage();
  await page.goto("https://www.facebook.com/");
  const count = (sel) => page.locator(sel).count();
  await waitFor(async () => (await count("#post-scam-link [data-tm-chip=scam]")) === 1, { message: "chip on scam link post" });
  await waitFor(async () => (await count("#link-scam + [data-tm-chip=scam]")) === 1, { message: "badge after scam link" });
  await waitFor(async () => (await count("#post-late [data-tm-chip=scam]")) >= 1, { message: "chip on late post" });
  assert.equal(await count("#post-internal [data-tm-chip]"), 0);
  // In a feed, scam wording alone does not flag a post (people quote scams
  // to warn each other); only a risky link does.
  assert.equal(await count("#post-scam-text [data-tm-chip]"), 0);
  assert.equal(await count("#link-internal + [data-tm-chip]"), 0);
  assert.equal(await page.evaluate(() => document.querySelectorAll("tm-root").length) <= 1, true);
  await page.close();
});

test("feed: social checks off removes the chips", async () => {
  await env.setPrefs({ scam: true, bias: true, social: false });
  try {
    const page = await env.ctx.newPage();
    await page.goto("https://www.facebook.com/");
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(await page.locator("[data-tm-chip]").count(), 0);
    await page.close();
  } finally {
    await env.setPrefs({ scam: true, bias: true, social: true });
  }
});

test("no console errors from the extension", () => {
  assert.deepEqual(env.errors, []);
});
