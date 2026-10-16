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

// Services that host many people's files or pages on the same host name. A
// feed lists one bad upload there, but a block rule covers the whole host,
// so entries under these domains are dropped rather than blocked.
export const SHARED_HOSTS = [
  "github.com", "githubusercontent.com", "gitlab.com", "bitbucket.org",
  "googleapis.com", "googleusercontent.com", "gstatic.com", "google.com", "goo.gl", "forms.gle", "translate.goog",
  "microsoft.com", "sharepoint.com", "onedrive.com", "1drv.ms", "live.com", "office.com", "office365.com", "windows.net",
  "amazonaws.com", "cloudfront.net", "dropbox.com", "dropboxusercontent.com", "box.com", "mediafire.com", "mega.nz", "wetransfer.com",
  "discord.com", "discordapp.com", "discordapp.net", "telegram.org", "t.me", "whatsapp.com", "wa.me",
  "facebook.com", "fbcdn.net", "instagram.com", "twitter.com", "x.com", "linkedin.com", "youtube.com", "tiktok.com",
  "apple.com", "icloud.com", "adobe.com", "canva.com", "notion.so", "notion.site", "wix.com", "weebly.com", "squarespace.com",
  "wordpress.com", "blogger.com", "medium.com", "archive.org", "ipfs.io", "cloudflare-ipfs.com", "dweb.link",
  "bit.ly", "tinyurl.com", "t.co", "cutt.ly", "rebrand.ly", "is.gd", "ow.ly",
];

// Loopback, private, link-local, shared, multicast and reserved IPv4 ranges.
function isPublicIpv4(host) {
  const o = host.split(".").map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168));
}

/**
 * Host names from a feed of URLs (or bare hosts), one per line.
 * Keeps each host exactly as given (never widened to its parent domain).
 * Drops comments, unparsable lines, public suffixes (a listed "github.io"
 * would block every site under it), shared hosting services, non-public IP
 * addresses and allowlisted domains.
 * @param {string} text
 * @param {{allow?: DomainSet, seen?: Set<string>, limit?: number}} [opts]
 * @returns {string[]} new hosts, in feed order, at most `limit`
 */
// Plain suffix match: some of these (githubusercontent.com) are public
// suffixes themselves, which DomainSet would not store.
const SHARED = new Set(SHARED_HOSTS);
function isShared(host) {
  for (let h = host; h.includes("."); h = h.slice(h.indexOf(".") + 1)) if (SHARED.has(h)) return true;
  return false;
}

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
    if (IPV4.test(host) ? !isPublicIpv4(host) : !getDomain(host, { allowPrivateDomains: true })) continue;
    if (allow.has(host) || isShared(host)) continue;
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
