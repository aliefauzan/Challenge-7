const api = globalThis.browser ?? globalThis.chrome;
const data = { href: location.href, hash: decodeURIComponent(location.hash.slice(1)), search: location.search };
document.getElementById("out").textContent = JSON.stringify(data, null, 2);
api.runtime.sendMessage({ type: "blocked", data });
