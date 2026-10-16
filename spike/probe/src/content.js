// Probe content script: frame reach (probe10), closed shadow root (probe11), and
// relays the background report through the page origin when direct fetch fails.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const top = window.top === window;
  const data = { href: location.href, top, at: Date.now() };
  if (top && location.href.includes("blockme-lr")) {
    // probe4 fallback: the content script replaces the page itself.
    location.replace(api.runtime.getURL(`blocked.html#${encodeURIComponent(location.href)}`));
    return;
  }
  if (top) {
    try {
      const host = document.createElement("tm-probe");
      const root = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = "p{color:rgb(1, 2, 3)}";
      const p = document.createElement("p");
      p.textContent = "shadow probe";
      root.append(style, p);
      document.documentElement.append(host);
      data.p11 = { ok: getComputedStyle(p).color === "rgb(1, 2, 3)", color: getComputedStyle(p).color, hostShadowRoot: host.shadowRoot === null ? "hidden" : "visible" };
    } catch (e) {
      data.p11 = { ok: false, error: e.message };
    }
  }
  api.runtime.sendMessage({ type: "cs", data }).then((res) => {
    if (!top || !location.href.startsWith("http://127.0.0.1:8765/")) return;
    fetch("/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "relay", data: res }) });
    const pre = document.getElementById("out");
    if (pre) pre.textContent = JSON.stringify(res, null, 2);
  });
})();
