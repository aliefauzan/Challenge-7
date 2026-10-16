// A hostile page against the extension: storage writes, markup in rule
// text, removing the UI, late text and frames.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, shadowUi, waitFor } from "./harness.js";

let env;
before(async () => (env = await launch()));
after(async () => env?.close());

const banner = (page, message = "banner") => waitFor(async () => ((await shadowUi(page)).tier === "banner" ? shadowUi(page) : null), { message });

test("page storage written before the scan does not switch the warning off", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("storage", "/storage-attack.html"));
  assert.ok((await page.evaluate(() => window.__wrote)) > 100);
  await banner(page);
  await page.reload();
  await banner(page, "banner after reload");
  await page.close();
});

test("markup in ruleset text is shown as text and never runs", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("markup", "/markup-phrase.html"));
  const ui = await banner(page);
  assert.ok(ui.text.includes("<img src=x onerror=window.pwned=1>"), ui.text);
  assert.ok(!ui.tags.includes("img") && !ui.tags.includes("script"), ui.tags.join(","));
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await page.evaluate(() => typeof window.pwned), "undefined");
  await page.close();
});

test("removing <tm-root> from the page: the UI is put back", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("remove", "/remove.html"));
  await waitFor(() => page.evaluate(() => window.__removed === 1), { message: "page removed the host" });
  await banner(page, "banner re-attached");
  assert.equal(await page.evaluate(() => document.querySelectorAll("tm-root").length), 1);
  await page.close();
});

test("text added two seconds after load raises the banner", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("late", "/late.html"));
  assert.equal((await shadowUi(page)).tier, null);
  await banner(page, "late banner");
  await page.close();
});

test("scam text inside a cross-site frame shows the banner in the top page", async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.server.url("frames", "/frame-top.html"));
  await waitFor(() => page.frames().some((f) => f.url().includes("frame.localhost")), { message: "frame loaded" });
  await banner(page, "banner in top frame");
  const verdict = await env.verdict(page);
  assert.ok(verdict.signals.some((s) => s.frameUrl?.includes("frame.localhost")), JSON.stringify(verdict.signals));
  await page.close();
});

test("no console errors from the extension", () => {
  assert.deepEqual(env.errors, []);
});
