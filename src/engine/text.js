// Page-text phrase scan.

/**
 * @param {unknown} text
 * @param {import("./types.js").Rules} rules
 * @param {{host?: string}} [ctx]
 * @returns {import("./types.js").Signal[]}
 */
export function scanText(text, rules, ctx = {}) {
  if (typeof text !== "string" || text === "") return [];
  if (ctx.host && (rules.phraseAllowlist.has(ctx.host) || rules.allowlist.has(ctx.host))) return [];
  const { max_text_chars: maxChars, max_high_hits: maxHigh } = rules.thresholds;
  const sample = text.length > maxChars ? text.slice(0, maxChars) : text;
  const signals = [];
  let highs = 0;
  for (const p of rules.phrases) {
    if (!p.re.test(sample)) continue;
    signals.push({
      source: "text", severity: p.severity, id: p.id, description: p.description,
      why: p.why || rules.categories[p.category]?.why || "This wording is common in scams.",
    });
    if (p.severity === "high" && ++highs >= maxHigh) break;
  }
  return signals;
}
