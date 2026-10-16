// Ruleset trust: schema validation, per-pattern compilation and Ed25519
// envelope verification. Runs unchanged in Node, Chrome and Safari.
import { DomainSet } from "./domains.js";

export const ENVELOPE_FORMAT = "scamshield-ruleset";
export const MAX_PATTERN_LENGTH = 600;
export const ALLOWED_FLAGS = /^[imsu]*$/;
export const DEFAULT_THRESHOLDS = { deep_subdomain_labels: 4, block_high_count: 2, max_text_chars: 100000, max_high_hits: 3 };

const STRING_LISTS = ["allowlist", "phrase_allowlist", "scam_domains", "impersonated_brands", "lookalike_brands", "phishing_context"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const isPosInt = (v) => Number.isInteger(v) && v > 0;

/**
 * Check every field of a schema 1 payload. Structural errors reject the whole
 * payload; bad regex patterns are handled later by `compileRules`.
 * @param {unknown} p
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validatePayload(p) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!isObj(p)) return { ok: false, errors: ["payload is not an object"] };
  if (p.schema !== 1) err(`unsupported schema ${JSON.stringify(p.schema)}`);
  if (!isPosInt(p.version)) err("version must be a positive integer");
  if (!isStr(p.generated) || !/^\d{4}-\d{2}-\d{2}$/.test(p.generated)) err("generated must be YYYY-MM-DD");
  if (!isObj(p.thresholds)) err("thresholds must be an object");
  else for (const k of Object.keys(DEFAULT_THRESHOLDS)) if (!isPosInt(p.thresholds[k])) err(`thresholds.${k} must be a positive integer`);
  for (const k of STRING_LISTS) if (!Array.isArray(p[k]) || !p[k].every(isStr)) err(`${k} must be a string array`);
  if (!isObj(p.categories)) err("categories must be an object");
  else for (const [id, c] of Object.entries(p.categories)) if (!isObj(c) || !isStr(c.label) || !isStr(c.why)) err(`categories.${id} needs label and why`);
  if (!Array.isArray(p.scam_phrases)) err("scam_phrases must be an array");
  else p.scam_phrases.forEach((ph, i) => {
    const where = `scam_phrases[${i}]`;
    if (!isObj(ph)) return err(`${where} is not an object`);
    for (const k of ["id", "pattern", "flags", "category", "description"]) if (!isStr(ph[k])) err(`${where}.${k} must be a string`);
    if (ph.severity !== "high" && ph.severity !== "medium") err(`${where}.severity must be high or medium`);
    if (ph.why !== undefined && !isStr(ph.why)) err(`${where}.why must be a string`);
  });
  if (!isObj(p.sources)) err("sources must be an object");
  else for (const [d, s] of Object.entries(p.sources)) {
    if (!isObj(s) || !["bias", "accuracy", "label", "rating"].every((k) => isStr(s[k]))) err(`sources.${d} needs bias, accuracy, label and rating`);
  }
  if (p.surface_adapters !== undefined && !isObj(p.surface_adapters)) err("surface_adapters must be an object");
  return { ok: errors.length === 0, errors };
}

function compilePhrase(ph, categories) {
  if (!ALLOWED_FLAGS.test(ph.flags)) throw new Error(`flags "${ph.flags}" not allowed (use i, m, s, u)`);
  if (ph.pattern.length > MAX_PATTERN_LENGTH) throw new Error(`pattern longer than ${MAX_PATTERN_LENGTH} chars`);
  return {
    id: ph.id, re: new RegExp(ph.pattern, ph.flags), severity: ph.severity, category: ph.category,
    description: ph.description, why: ph.why || categories[ph.category]?.why || "",
  };
}

function compileAdapter(a) {
  const re = (s) => (s ? new RegExp(s) : null);
  return {
    host: re(a.host), itemSelector: a.item_selector ?? null, dmHost: re(a.dm_host), dmPath: a.dm_path ?? null,
    dmItemSelector: a.dm_item_selector ?? null, skipLinkHosts: re(a.skip_link_hosts),
  };
}

/**
 * Build the engine's rule object. One bad pattern or adapter is dropped and
 * reported; the rest of the set is kept.
 * @param {any} payload a payload that passed validatePayload
 * @returns {{rules: import("./types.js").Rules, errors: string[]}}
 */
export function compileRules(payload) {
  const errors = [];
  const phrases = [];
  for (const ph of payload.scam_phrases) {
    try {
      phrases.push(compilePhrase(ph, payload.categories));
    } catch (e) {
      errors.push(`phrase ${ph.id}: ${e.message}`);
    }
  }
  const adapters = {};
  for (const [name, a] of Object.entries(payload.surface_adapters ?? {})) {
    try {
      adapters[name] = compileAdapter(a);
    } catch (e) {
      errors.push(`adapter ${name}: ${e.message}`);
    }
  }
  const lower = (list) => new Set(list.map((s) => s.toLowerCase()));
  const rules = {
    thresholds: { ...DEFAULT_THRESHOLDS, ...payload.thresholds },
    allowlist: new DomainSet(payload.allowlist),
    phraseAllowlist: new DomainSet(payload.phrase_allowlist),
    scamDomains: new DomainSet(payload.scam_domains),
    impersonatedBrands: lower(payload.impersonated_brands),
    lookalikeBrands: lower(payload.lookalike_brands),
    phishingContext: lower(payload.phishing_context),
    phrases,
    categories: payload.categories,
    sources: new DomainSet(payload.sources),
    adapters,
    errors,
  };
  return { rules, errors };
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Verify a signed envelope and return its validated payload object.
 * @param {any} envelope `{format, kid, payload: string, sig}`
 * @param {Record<string, string>} keys kid → base64 raw Ed25519 public key
 * @param {{minVersion?: number}} [opts] reject payloads whose version is ≤ minVersion
 */
export async function verifyEnvelope(envelope, keys, opts = {}) {
  if (!isObj(envelope) || envelope.format !== ENVELOPE_FORMAT) throw new Error("bad envelope format");
  const keyB64 = keys[envelope.kid];
  if (!isStr(keyB64) || keyB64 === "") throw new Error(`unknown kid ${JSON.stringify(envelope.kid)}`);
  if (!isStr(envelope.payload) || !isStr(envelope.sig)) throw new Error("bad envelope format");
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("raw", b64ToBytes(keyB64), { name: "Ed25519" }, false, ["verify"]);
    ok = await crypto.subtle.verify("Ed25519", key, b64ToBytes(envelope.sig), new TextEncoder().encode(envelope.payload));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("bad signature");
  let payload;
  try {
    payload = JSON.parse(envelope.payload);
  } catch {
    throw new Error("payload is not valid JSON");
  }
  const { ok: valid, errors } = validatePayload(payload);
  if (!valid) throw new Error(`invalid payload: ${errors.slice(0, 3).join("; ")}`);
  if (payload.version <= (opts.minVersion ?? 0)) throw new Error(`version ${payload.version} is not newer than ${opts.minVersion}`);
  return payload;
}
