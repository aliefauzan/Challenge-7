const api = globalThis.browser ?? globalThis.chrome;
(async () => {
  const [t] = await api.tabs.query({ active: true, currentWindow: true });
  const perm = await api.permissions.contains({ origins: ["<all_urls>"] }).catch((e) => e.message);
  const local = await api.storage.local.get(null);
  const out = { probe12: { ok: Boolean(t?.url), url: t?.url ?? null }, allUrls: perm, local };
  document.getElementById("out").textContent = JSON.stringify(out, null, 2);
  fetch("http://127.0.0.1:8765/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "popup", data: out }) }).catch(() => {});
})();
