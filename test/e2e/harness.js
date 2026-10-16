// Shared set-up for the Chromium end-to-end tests: loads dist/chrome into a
// fresh persistent context, swaps in a test ruleset, and reads the closed
// shadow root through the DevTools protocol (page scripts cannot see it,
// which is the point; the tests still need to).
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bundled from "../../src/data/default-ruleset.json" with { type: "json" };
import { startServer } from "./server.js";

const EXT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "chrome");

/** Bundled ruleset plus what the fixtures need. */
export function testRuleset() {
  return {
    ...bundled,
    version: 900000,
    scam_domains: [...bundled.scam_domains, "known-scam.localhost"],
    sources: { ...bundled.sources, "news.localhost": { bias: "satire", accuracy: "varies", label: "News Fixture", rating: "Satire. The stories are made up on purpose." } },
    scam_phrases: [
      ...bundled.scam_phrases,
      {
        id: "e2e-markup",
        severity: "medium",
        category: "urgency",
        flags: "i",
        description: "<img src=x onerror=window.pwned=1>",
        why: "<b>bold</b><script>window.pwned=2</script>",
        pattern: "\\be2e markup trigger phrase\\b",
      },
    ],
  };
}

export async function waitFor(fn, { timeout = 8000, interval = 100, message = "condition" } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${message}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * @returns {Promise<{ctx, sw, id: string, server, errors: string[], close: () => Promise<void>,
 *   verdict: (page) => Promise<object|undefined>, setPrefs: (p: object) => Promise<void>}>}
 */
export async function launch() {
  if (!existsSync(join(EXT, "manifest.json"))) throw new Error("dist/chrome missing: run npm run build -- --target chrome");
  const server = await startServer(0);
  const ctx = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;

  // Errors logged by the extension: background, content scripts, its pages.
  const errors = [];
  const watch = (page) =>
    page.on("console", (msg) => {
      if (msg.type() === "error" && /tm:|chrome-extension:/.test(`${msg.text()} ${msg.location()?.url ?? ""}`)) errors.push(msg.text());
    });
  ctx.on("page", watch);
  sw.on?.("console", (msg) => msg.type() === "error" && errors.push(`sw: ${msg.text()}`));

  // Wait for the first boot, then install the test ruleset.
  await waitFor(() => sw.evaluate(async () => Boolean((await chrome.storage.local.get("tm.ruleset"))["tm.ruleset"])), { message: "bundled ruleset" });
  await sw.evaluate(async (payload) => {
    await chrome.storage.local.set({ "tm.ruleset": payload, "tm.rulesetMeta": { version: payload.version, source: "test", fetchedAt: Date.now(), errors: [] } });
  }, testRuleset());
  await waitFor(
    () => sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).some((r) => r.condition.requestDomains?.includes("known-scam.localhost"))),
    { message: "block rules for the test ruleset" },
  );

  return {
    ctx,
    sw,
    id,
    server,
    errors,
    async close() {
      await ctx.close();
      await server.close();
    },
    /** The stored verdict for the tab showing `page`. */
    verdict: (page) =>
      sw.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url === url);
        if (!tab) return undefined;
        const key = `tm.verdict.${tab.id}`;
        return (await chrome.storage.session.get(key))[key];
      }, page.url()),
    setPrefs: (prefs) => sw.evaluate((p) => chrome.storage.sync.set({ "tm.prefs": p }), prefs),
  };
}

/** Flattened DOM of the page including closed shadow roots, via CDP. */
async function piercedNodes(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    return { cdp, root };
  } catch (err) {
    await cdp.detach();
    throw err;
  }
}

function walk(node, visit, inShadow = false) {
  visit(node, inShadow);
  for (const c of node.children ?? []) walk(c, visit, inShadow);
  for (const s of node.shadowRoots ?? []) walk(s, visit, true);
}

const attrs = (n) => Object.fromEntries((n.attributes ?? []).reduce((acc, v, i, a) => (i % 2 ? acc : [...acc, [v, a[i + 1]]]), []));
const textOf = (n) => {
  let s = "";
  walk(n, (m) => (s += m.nodeType === 3 ? m.nodeValue : ""));
  return s;
};

/**
 * What the extension shows: text inside <tm-root>'s shadow, its UI kind
 * (data-tier of the top element) and element tags found inside it.
 */
export async function shadowUi(page) {
  const { cdp, root } = await piercedNodes(page);
  try {
    let host = null;
    walk(root, (n) => {
      if (n.nodeName === "TM-ROOT") host = n;
    });
    if (!host || !host.shadowRoots?.length) return { mounted: false, text: "", tier: null, tags: [] };
    const shadow = host.shadowRoots[0];
    let tier = null;
    const tags = [];
    walk(shadow, (n) => {
      if (n.nodeType !== 1) return;
      tags.push(n.nodeName.toLowerCase());
      const a = attrs(n);
      if (!tier && a["data-tier"]) tier = a["data-tier"];
    });
    return { mounted: tags.length > 1, text: textOf(shadow), tier, tags };
  } finally {
    await cdp.detach();
  }
}

/** Click an element inside the closed shadow root whose text or aria-label matches. */
export async function clickInShadow(page, match) {
  const { cdp, root } = await piercedNodes(page);
  try {
    let target = null;
    walk(root, (n, inShadow) => {
      if (target || !inShadow || n.nodeType !== 1 || !/^(BUTTON|A|SUMMARY)$/.test(n.nodeName)) return;
      if (match.test(textOf(n)) || match.test(attrs(n)["aria-label"] ?? "")) target = n;
    });
    if (!target) throw new Error(`no shadow control matching ${match}`);
    const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: target.backendNodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
  } finally {
    await cdp.detach();
  }
}
