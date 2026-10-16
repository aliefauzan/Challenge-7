// Domain membership by suffix walk: a.b.scam.com → b.scam.com → scam.com.
// The walk stops before the public suffix, so an entry can never cover a
// whole TLD or a shared hosting suffix. IP entries match exactly.
import { normalizeHost, isIp, publicSuffix } from "./host.js";

export class DomainSet {
  /**
   * @param {Iterable<string> | Record<string, unknown>} [entries]
   *   A list of domains, or an object mapping domain → value (see `get`).
   */
  constructor(entries = []) {
    /** @type {Map<string, unknown>} */
    this.map = new Map();
    const pairs = Symbol.iterator in Object(entries) ? [...entries].map((d) => [d, true]) : Object.entries(entries);
    for (const [domain, value] of pairs) {
      const host = normalizeHost(domain);
      if (!host || host === publicSuffix(host)) continue;
      this.map.set(host, value);
    }
  }

  get size() {
    return this.map.size;
  }

  /**
   * The listed entry that covers `host`, most specific first, or undefined.
   * @param {string} host
   */
  match(host) {
    const h = normalizeHost(host);
    if (!h) return undefined;
    if (isIp(h)) return this.map.has(h) ? h : undefined;
    const suffix = publicSuffix(h);
    let candidate = h;
    while (candidate && candidate !== suffix) {
      if (this.map.has(candidate)) return candidate;
      const dot = candidate.indexOf(".");
      if (dot < 0) break;
      candidate = candidate.slice(dot + 1);
    }
    return undefined;
  }

  /** @param {string} host */
  has(host) {
    return this.match(host) !== undefined;
  }

  /** @param {string} host */
  get(host) {
    const key = this.match(host);
    return key === undefined ? undefined : this.map.get(key);
  }
}
