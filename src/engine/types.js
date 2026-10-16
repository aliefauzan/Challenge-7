// Shared JSDoc types for the engine. No runtime code.

/**
 * @typedef {{source: "domain"|"url"|"text", severity: "high"|"medium", id: string,
 *   description: string, why: string, frameUrl?: string}} Signal
 * @typedef {{tier: "block"|"block-bypass"|"banner"|"bias"|"clean", domain: string,
 *   signals: Signal[], sourceInfo: object | null}} Verdict
 * @typedef {{kind: "scam"|"source", basis: "link"|"text", url?: string,
 *   signal?: Signal, source?: object}} Classification
 * @typedef {{id: string, re: RegExp, severity: "high"|"medium", category: string,
 *   description: string, why?: string}} CompiledPhrase
 * @typedef {{
 *   thresholds: {deep_subdomain_labels: number, block_high_count: number, max_text_chars: number, max_high_hits: number},
 *   allowlist: import("./domains.js").DomainSet,
 *   phraseAllowlist: import("./domains.js").DomainSet,
 *   scamDomains: import("./domains.js").DomainSet,
 *   impersonatedBrands: Set<string>, lookalikeBrands: Set<string>, phishingContext: Set<string>,
 *   phrases: CompiledPhrase[],
 *   categories: Record<string, {label: string, why: string}>,
 *   sources: import("./domains.js").DomainSet,
 *   adapters?: Record<string, object>, errors?: string[]
 * }} Rules
 */

export {};
