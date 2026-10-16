#!/usr/bin/env node
// Downloads public phishing and malware URL feeds and writes their host
// names, one per line, into data/feeds/<feed>.txt for build-ruleset.mjs.
//   npm run feeds [-- --out data/feeds] [--max 20000] [--dry-run]
// Check each feed's terms of use before any commercial use.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDomain } from "tldts";
import { DomainSet } from "../src/engine/domains.js";
import { normalizeHost } from "../src/engine/host.js";

export const FEEDS = [
  { name: "openphish", url: "https://openphish.com/feed.txt", label: "OpenPhish community feed" },
  { name: "urlhaus", url: "https://urlhaus.abuse.ch/downloads/text_online/", label: "URLhaus online URLs (abuse.ch)" },
];
export const DEFAULT_MAX = 20000;
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30000;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Host names from a feed of URLs (or bare hosts), one per line.
 * Drops comments, unparsable lines, public suffixes (a listed "github.io"
 * would block every site under it) and allowlisted domains.
 * @param {string} text
 * @param {{allow?: DomainSet, seen?: Set<string>, limit?: number}} [opts]
 * @returns {string[]} new hosts, in feed order, at most `limit`
 */
export function hostsFromFeed(text, { allow = new DomainSet([]), seen = new Set(), limit = Infinity } = {}) {
  const out = [];
  for (const raw of text.split("\n")) {
    if (out.length >= limit) break;
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let host;
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(line) ? line : `http://${line}`).hostname;
    } catch {
      continue;
    }
    host = normalizeHost(host);
    if (!host || seen.has(host)) continue;
    if (!IPV4.test(host) && !getDomain(host, { allowPrivateDomains: true })) continue;
    if (allow.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

async function download(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "scamshield-ruleset-builder" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error(`feed larger than ${MAX_BYTES} bytes`);
  return text;
}

/**
 * @param {{out?: string, max?: number, dryRun?: boolean, src?: string, fetch?: typeof fetch}} opts
 * @returns {Promise<{name: string, hosts: number, error?: string}[]>}
 */
export async function fetchFeeds({ out = "data/feeds", max = DEFAULT_MAX, dryRun = false, src = "data/ruleset.src.json", fetch: fetchImpl } = {}) {
  const allow = new DomainSet(JSON.parse(readFileSync(src, "utf8")).allowlist ?? []);
  const seen = new Set();
  const report = [];
  if (!dryRun) mkdirSync(out, { recursive: true });
  for (const feed of FEEDS) {
    try {
      const text = await download(feed.url, fetchImpl);
      const hosts = hostsFromFeed(text, { allow, seen, limit: Math.max(0, max - seen.size) });
      report.push({ name: feed.name, hosts: hosts.length });
      if (!dryRun) {
        const header = [`# ${feed.label}`, `# ${feed.url}`, `# fetched ${new Date().toISOString()}, ${hosts.length} hosts`];
        writeFileSync(join(out, `${feed.name}.txt`), [...header, ...hosts].join("\n") + "\n");
      }
    } catch (err) {
      // One failing feed leaves its previous file in place.
      report.push({ name: feed.name, hosts: 0, error: String(err?.message ?? err) });
    }
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, def) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : def);
  const dryRun = args.includes("--dry-run");
  const report = await fetchFeeds({ out: opt("out", "data/feeds"), max: Number(opt("max", DEFAULT_MAX)), dryRun });
  for (const r of report) console.log(`${r.name}: ${r.error ? `failed (${r.error})` : `${r.hosts} hosts`}`);
  console.log(dryRun ? "dry run: nothing written" : `wrote ${opt("out", "data/feeds")}`);
  if (report.every((r) => r.error)) process.exit(1);
}
