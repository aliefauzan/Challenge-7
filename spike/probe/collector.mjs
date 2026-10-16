// Local collector for probe reports. Serves the test pages and appends every
// POST /report body to reports.jsonl.
//   node spike/probe/collector.mjs [port]
import { createServer } from "node:http";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 8765);
const LOG = join(HERE, "reports.jsonl");
const hits = [];
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>${body}`;

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Only the write endpoint accepts cross-origin calls; the read endpoints
  // (/hits, /results) are same-origin so other pages cannot read the reports.
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (req.method === "POST" && url.pathname === "/report") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let data;
      try {
        data = JSON.parse(body || "{}");
      } catch {
        return res.writeHead(400, cors).end();
      }
      appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), from: req.headers["user-agent"], ...data }) + "\n");
      res.writeHead(204, cors).end();
    });
    return;
  }
  if (url.pathname.startsWith("/blockme")) hits.push({ path: url.pathname, at: Date.now(), ua: req.headers["user-agent"] });
  res.writeHead(200, { "content-type": url.pathname === "/hits" || url.pathname === "/results" ? "application/json" : "text/html" });
  if (url.pathname === "/hits") return res.end(JSON.stringify(hits));
  if (url.pathname === "/results") return res.end(existsSync(LOG) ? readFileSync(LOG) : "");
  if (url.pathname === "/top") {
    return res.end(page("Probe top", `<h1>Probe</h1>
<iframe src="http://localhost:${PORT}/frame" width="300" height="60"></iframe>
<p><a id="re" href="http://localhost:${PORT}/blockme-re?x=1">regexSubstitution</a> ·
<a id="ep" href="http://localhost:${PORT}/blockme-ep">extensionPath</a> ·
<a id="rd" href="http://localhost:${PORT}/blockme-rd">block</a></p><pre id="out">waiting for content script…</pre>`));
  }
  if (url.pathname === "/frame") return res.end(page("Probe frame", "<p>cross-origin frame</p>"));
  res.end(page("Probe target", `<h1>Reached ${url.pathname}</h1>`));
}).listen(PORT, "127.0.0.1", () => console.log(`collector on http://127.0.0.1:${PORT}`));
