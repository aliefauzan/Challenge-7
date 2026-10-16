// Per-tab verdicts: stored for the popup, shown as the toolbar badge,
// and cleared when the tab navigates or closes.

export const verdictKey = (tabId) => `tm.verdict.${tabId}`;

const TIERS = new Set(["block", "block-bypass", "banner", "bias", "clean"]);
const BADGES = {
  block: { text: "!", color: "#c62828" },
  "block-bypass": { text: "!", color: "#c62828" },
  banner: { text: "!", color: "#c62828" },
  bias: { text: "i", color: "#546e7a" },
  clean: { text: "", color: null },
};

const isVerdict = (v) => v !== null && typeof v === "object" && TIERS.has(v.tier) && Array.isArray(v.signals);

export async function setBadge(api, tabId, tier) {
  const badge = BADGES[tier] ?? BADGES.clean;
  await api.action.setBadgeText({ tabId, text: badge.text });
  if (badge.color) await api.action.setBadgeBackgroundColor({ tabId, color: badge.color });
}

/** `verdict` from the top frame → stored + badge. */
export async function handleVerdict(api, msg, sender) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number" || sender.frameId !== 0) return { ok: false, error: "verdict must come from a tab's top frame" };
  if (!isVerdict(msg.verdict)) return { ok: false, error: "bad verdict" };
  await api.storage.session.set({ [verdictKey(tabId)]: { ...msg.verdict, url: sender.tab.url ?? sender.url ?? "" } });
  await setBadge(api, tabId, msg.verdict.tier);
  return { ok: true };
}

/** `frame-signals` from a sub-frame → forwarded to frame 0 of the same tab. */
export async function handleFrameSignals(api, msg, sender) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number" || !sender.frameId) return { ok: false, error: "frame-signals must come from a sub-frame" };
  if (!Array.isArray(msg.signals)) return { ok: false, error: "bad signals" };
  const frameUrl = sender.url ?? "";
  const signals = msg.signals.map((s) => ({ ...s, frameUrl }));
  try {
    const reply = await api.tabs.sendMessage(tabId, { type: "frame-signals", signals, frameUrl }, { frameId: 0 });
    if (reply?.ok) return { ok: true };
  } catch {
    // No listener in the top frame yet.
  }
  return { ok: false, error: "top frame not ready" };
}

export async function clearVerdict(api, tabId) {
  await api.storage.session.remove(verdictKey(tabId));
}
