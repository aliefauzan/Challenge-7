// Decide which warning, if any, a page gets.

/**
 * @param {import("./types.js").Signal[] | undefined} signals
 * @param {{domain?: string, knownDomain?: boolean, prefs?: {scam?: boolean, bias?: boolean},
 *   dismissed?: boolean, bypassed?: boolean, source?: object | null, blockHighCount?: number}} ctx
 * @returns {import("./types.js").Verdict}
 */
export function decideTier(signals = [], ctx = {}) {
  const prefs = ctx.prefs ?? { scam: true, bias: true };
  const highs = signals.filter((s) => s.severity === "high").length;
  const verdict = (tier) => ({ tier, domain: ctx.domain ?? "", signals, sourceInfo: ctx.source ?? null });

  if (prefs.scam && ctx.knownDomain) return verdict("block");
  if (prefs.scam && highs >= (ctx.blockHighCount ?? 2) && !ctx.bypassed) return verdict("block-bypass");
  if (prefs.scam && signals.length && !ctx.dismissed) return verdict("banner");
  if (prefs.bias && ctx.source && !ctx.dismissed) return verdict("bias");
  return verdict("clean");
}
