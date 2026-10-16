// Keeps a trusted ruleset in storage.local. The bundled copy is the floor;
// a remote copy replaces it only when its signature verifies and its
// version is newer. Every failure is recorded and the cached copy is kept.
import { verifyEnvelope, validatePayload } from "../engine/ruleset.js";

export const RULESET_KEY = "tm.ruleset";
export const META_KEY = "tm.rulesetMeta";
const MAX_ERRORS = 10;

async function readCached(api) {
  const got = await api.storage.local.get([RULESET_KEY, META_KEY]);
  return { ruleset: got[RULESET_KEY], meta: got[META_KEY] };
}

async function recordError(api, meta, message) {
  const errors = [...(meta?.errors ?? []), `${new Date().toISOString()} ${message}`].slice(-MAX_ERRORS);
  await api.storage.local.set({ [META_KEY]: { ...meta, errors } });
}

/**
 * Store the bundled ruleset when nothing is cached, or when an extension
 * update ships a bundled version newer than the cached one.
 * @returns {Promise<boolean>} true if the bundled copy was stored
 */
export async function ensureRuleset(api, bundled, now = Date.now()) {
  const { ruleset } = await readCached(api);
  if (ruleset && validatePayload(ruleset).ok && ruleset.version >= bundled.version) return false;
  await api.storage.local.set({
    [RULESET_KEY]: bundled,
    [META_KEY]: { version: bundled.version, source: "bundled", fetchedAt: now, errors: [] },
  });
  return true;
}

/**
 * Fetch, verify and store the remote ruleset.
 * @param {object} api
 * @param {{url: string, keys: Record<string, string>, fetch?: typeof fetch, timeoutMs?: number, now?: number}} opts
 * @returns {Promise<{updated: boolean, error?: string}>}
 */
export async function refreshRuleset(api, opts) {
  if (!opts.url) return { updated: false };
  const doFetch = opts.fetch ?? globalThis.fetch;
  const { ruleset, meta } = await readCached(api);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await doFetch(opts.url, { cache: "no-cache", credentials: "omit", signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const envelope = await res.json();
    // The same version is "up to date", not an error; an older one is rejected.
    const cachedVersion = ruleset?.version ?? 0;
    const payload = await verifyEnvelope(envelope, opts.keys, { minVersion: Math.max(cachedVersion - 1, 0) });
    if (payload.version === cachedVersion) return { updated: false };
    await api.storage.local.set({
      [RULESET_KEY]: payload,
      [META_KEY]: { version: payload.version, source: "remote", fetchedAt: opts.now ?? Date.now(), errors: meta?.errors ?? [] },
    });
    return { updated: true };
  } catch (err) {
    const message = err?.name === "AbortError" ? "fetch timed out" : String(err?.message ?? err);
    await recordError(api, meta, message);
    return { updated: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
