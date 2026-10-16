import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRules } from "../../src/engine/ruleset.js";
import { scanPage, createRescanner } from "../../src/content/scan.js";
import { makeFakeWindow } from "./fakes/dom.js";
import bundled from "../../src/data/default-ruleset.json" with { type: "json" };

const payload = { ...bundled, sources: { "news.example": { bias: "left", accuracy: "mixed", label: "News Example", rating: "One-sided." } } };
const { rules } = compileRules(payload);
const FILLER = "Ordinary page text about gardening and weather. ".repeat(6);

test("scan: known scam domain, URL and text signals together", () => {
  const r = scanPage({ href: "https://shop.scamshield-test.example/pay", text: "Your computer is infected! Call Microsoft support now.", rules });
  assert.equal(r.knownDomain, true);
  assert.equal(r.domain, "scamshield-test.example");
  const ids = r.signals.map((s) => s.id);
  assert.ok(ids.includes("known-scam-domain"));
  assert.ok(ids.includes("tech-001"));
  assert.ok(ids.includes("tech-002"));
  assert.equal(r.signals.find((s) => s.id === "known-scam-domain").severity, "high");
});

test("scan: a clean page has no signals; a listed news source is returned", () => {
  const r = scanPage({ href: "https://www.news.example/story", text: FILLER, rules });
  assert.deepEqual(r.signals, []);
  assert.equal(r.knownDomain, false);
  assert.equal(r.source.label, "News Example");
  assert.equal(r.domain, "news.example");
});

test("scan: allowlisted hosts and non-http pages give nothing", () => {
  assert.deepEqual(scanPage({ href: "https://www.ftc.gov/x", text: "Never pay with gift cards. Scammers say: buy a gift card now.", rules }).signals, []);
  const r = scanPage({ href: "about:blank", text: "Your computer is infected", rules });
  assert.deepEqual(r.signals, []);
  assert.equal(r.domain, "");
});

function rescanHarness(opts = {}) {
  const win = makeFakeWindow();
  let text = FILLER;
  const runs = [];
  const r = createRescanner({
    win,
    now: win.now,
    readText: () => text,
    onChange: (t) => {
      runs.push(t);
      return opts.tier?.(t) ?? "clean";
    },
  });
  return { win, r, runs, set: (t) => (text = t) };
}

test("scan: text injected 2 s after load is rescanned", async () => {
  const { win, r, runs, set } = rescanHarness();
  await win.tick(2000);
  set(FILLER + " Your computer has been infected. ".repeat(10));
  r.notify();
  await win.tick(1500);
  assert.equal(runs.length, 1);
  assert.match(runs[0], /infected/);
});

test("scan: small text changes do not trigger a rescan", async () => {
  const { win, r, runs, set } = rescanHarness();
  set(FILLER + "a clock ticked");
  r.notify();
  await win.tick(5000);
  assert.equal(runs.length, 0);
});

test("scan: rescans are throttled to one per 1.5 s", async () => {
  const { win, r, runs, set } = rescanHarness();
  let t = FILLER;
  const grow = () => set((t += "x".repeat(250)));
  // The load scan counts as a run at t=0, so ten changes over the first
  // second fold into one rescan at t=1500 that sees the latest text.
  for (let i = 0; i < 10; i++) {
    grow();
    r.notify();
    await win.tick(100);
  }
  await win.tick(600);
  assert.equal(runs.length, 1);
  assert.equal(runs[0], t);
  grow();
  r.notify();
  await win.tick(1000);
  assert.equal(runs.length, 1, "next rescan waits until t=3000");
  await win.tick(500);
  assert.equal(runs.length, 2);
});

test("scan: rescanning stops after 60 s and once the page is blocked", async () => {
  const late = rescanHarness();
  await late.win.tick(60_001);
  late.set(FILLER + "y".repeat(500));
  late.r.notify();
  await late.win.tick(2000);
  assert.equal(late.runs.length, 0);
  assert.equal(late.r.stopped, true);

  const blocked = rescanHarness({ tier: () => "block" });
  blocked.set(FILLER + "z".repeat(500));
  blocked.r.notify();
  await blocked.win.tick(1500);
  blocked.set(FILLER + "z".repeat(1500));
  blocked.r.notify();
  await blocked.win.tick(3000);
  assert.equal(blocked.runs.length, 1);
  assert.equal(blocked.r.stopped, true);
});
