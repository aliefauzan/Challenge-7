// Static server for the end-to-end fixtures. Every *.localhost host name
// resolves to 127.0.0.1 in Chromium, so one server plays many sites:
// known-scam.localhost, news.localhost, clean.localhost, frame.localhost…
// The host name only matters to the extension; the path picks the fixture.
//
//   node test/e2e/server.js [port]     (default 8787; prints the base URL)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * @param {number} [port] 0 picks a free port
 * @returns {Promise<{port: number, url: (host: string, path?: string) => string, close: () => Promise<void>}>}
 */
export async function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const name = path === "/" ? "clean.html" : basename(path);
    try {
      const body = await readFile(join(FIXTURES, name.endsWith(".html") ? name : `${name}.html`));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = server.address().port;
  return {
    port: actual,
    url: (host, path = "/") => `http://${host}.localhost:${actual}${path}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.argv[2] ?? 8787));
  console.log(`fixtures on ${s.url("clean")} (any *.localhost host name works)`);
}
