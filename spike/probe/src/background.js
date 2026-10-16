// Probe background: runs worker-side API checks and forwards every report to
// the local collector. Classic script so it also works as background.scripts.
const api = globalThis.browser ?? globalThis.chrome;
const COLLECTOR = "http://127.0.0.1:8765";
const report = { ua: navigator.userAgent, probes: {} };
const set = (id, ok, note) => (report.probes[id] = { ok, note: String(note ?? "") });

async function send(kind, data) {
  try {
    await fetch(`${COLLECTOR}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, data }) });
    return true;
  } catch (e) {
    return false;
  }
}
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function run() {
  const boot = ((await api.storage.local.get("boots")).boots ?? 0) + 1;
  await api.storage.local.set({ boots: boot });
  report.boots = boot;
  report.kind = typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope ? "service_worker" : "page";

  // probe1: the worker started. Alarm fire is reported later.
  set("probe1", true, `started as ${report.kind}, boot ${boot}`);
  try {
    await api.alarms.create("p1", { delayInMinutes: 0.5 });
  } catch (e) {
    set("probe1", false, `alarms.create: ${e.message}`);
  }

  // probe2: Ed25519 verify with a known-good vector.
  try {
    const key = await crypto.subtle.importKey("raw", b64(VECTOR.pub), { name: "Ed25519" }, false, ["verify"]);
    const msg = new TextEncoder().encode(VECTOR.msg);
    const good = await crypto.subtle.verify("Ed25519", key, b64(VECTOR.sig), msg);
    const bad = await crypto.subtle.verify("Ed25519", key, b64(VECTOR.sig), new TextEncoder().encode(VECTOR.msg + "x"));
    set("probe2", good === true && bad === false, `good=${good} tampered=${bad}`);
  } catch (e) {
    set("probe2", false, e.message);
  }

  // probe3 + probe4: dynamic rules.
  const ext = api.runtime.getURL("blocked.html");
  const rules = [
    { id: 1, priority: 1, action: { type: "block" }, condition: { requestDomains: ["localhost"], urlFilter: "blockme-rd", resourceTypes: ["main_frame"] } },
    { id: 2, priority: 2, action: { type: "redirect", redirect: { regexSubstitution: `${ext}#\\0` } }, condition: { regexFilter: "^http://localhost:8765/blockme-re.*", resourceTypes: ["main_frame"] } },
    { id: 3, priority: 2, action: { type: "redirect", redirect: { extensionPath: "/blocked.html?path=1" } }, condition: { requestDomains: ["localhost"], urlFilter: "blockme-ep", resourceTypes: ["main_frame"] } },
    // Same three on a public HTTPS host, in case loopback is exempt.
    { id: 4, priority: 1, action: { type: "block" }, condition: { requestDomains: ["example.com"], urlFilter: "blockme-rd", resourceTypes: ["main_frame"] } },
    { id: 5, priority: 2, action: { type: "redirect", redirect: { regexSubstitution: `${ext}#\\0` } }, condition: { regexFilter: "^https://example\\.com/blockme-re.*", resourceTypes: ["main_frame"] } },
    { id: 6, priority: 2, action: { type: "redirect", redirect: { extensionPath: "/blocked.html?path=1" } }, condition: { requestDomains: ["example.com"], urlFilter: "blockme-ep", resourceTypes: ["main_frame"] } },
    // urlFilter-only block, no requestDomains.
    { id: 7, priority: 1, action: { type: "block" }, condition: { urlFilter: "||example.org^", resourceTypes: ["main_frame"] } },
  ];
  for (const r of rules) {
    try {
      await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [r.id], addRules: [r] });
      report.probes[`rule${r.id}`] = { ok: true, note: "accepted" };
    } catch (e) {
      report.probes[`rule${r.id}`] = { ok: false, note: e.message };
    }
  }
  try {
    const got = await api.declarativeNetRequest.getDynamicRules();
    set("probe3", report.probes.rule1.ok && got.some((r) => r.id === 1), `dynamic rules now ${got.map((r) => r.id).join(",")}`);
  } catch (e) {
    set("probe3", false, e.message);
  }
  report.extUrl = ext;

  // probe6 / probe7 / probe8: storage areas.
  try {
    await api.storage.session.set({ probe: 1 });
    set("probe6", (await api.storage.session.get("probe")).probe === 1, "set/get ok");
  } catch (e) {
    set("probe6", false, e.message);
  }
  try {
    if (typeof api.storage.session.setAccessLevel !== "function") throw new Error("missing");
    await api.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    set("probe7", true, "callable");
  } catch (e) {
    set("probe7", false, e.message);
  }
  try {
    await api.storage.sync.set({ probe: 2 });
    set("probe8", (await api.storage.sync.get("probe")).probe === 2, "set/get ok (cross-device sync not tested)");
  } catch (e) {
    set("probe8", false, e.message);
  }

  // probe9: badge.
  try {
    await api.action.setBadgeText({ text: "!" });
    let color = "ok";
    try {
      await api.action.setBadgeBackgroundColor({ color: "#c62828" });
    } catch (e) {
      color = `color failed: ${e.message}`;
    }
    set("probe9", true, `text ok, ${color}`);
  } catch (e) {
    set("probe9", false, e.message);
  }

  report.direct = await send("bg", report);
}

// probe5 combo: DNR blocks example.org before any request; the worker then moves
// the tab to the explanation page.
api.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const url = info.url ?? tab.url ?? "";
  if (!/^https?:\/\/example\.net\//.test(url)) return;
  await send("onUpdated", { status: info.status, url, hasUrl: Boolean(info.url) });
  try {
    await api.tabs.update(tabId, { url: api.runtime.getURL(`blocked.html#${encodeURIComponent(url)}`) });
  } catch (e) {
    await send("onUpdated-err", { error: e.message });
  }
});

api.alarms.onAlarm.addListener(async (a) => {
  const fired = { name: a.name, at: Date.now(), boots: (await api.storage.local.get("boots")).boots };
  await api.storage.local.set({ alarm: fired });
  report.alarm = fired;
  await send("alarm", fired);
});

api.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === "cs" && msg.data.href.includes("blockme-tu")) {
      // probe4 fallback: the worker sends the tab to the extension page.
      try {
        await api.tabs.update(sender.tab.id, { url: api.runtime.getURL(`blocked.html#${encodeURIComponent(msg.data.href)}`) });
        await send("tu", { ok: true });
      } catch (e) {
        await send("tu", { ok: false, error: e.message });
      }
    }
    if (msg.type === "cs") {
      let active = null;
      try {
        const [t] = await api.tabs.query({ active: true, lastFocusedWindow: true });
        active = { hasUrl: Boolean(t?.url), url: t?.url ?? null };
      } catch (e) {
        active = { error: e.message };
      }
      const data = { ...msg.data, senderTabUrl: sender.tab?.url ?? null, senderFrameId: sender.frameId, activeTab: active };
      await send("cs", data);
      reply({ report, alarm: (await api.storage.local.get("alarm")).alarm ?? null });
    } else if (msg.type === "blocked") {
      await send("blocked", msg.data);
      reply({ ok: true });
    }
  })();
  return true;
});

run();
