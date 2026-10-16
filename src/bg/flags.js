// Dismiss and bypass flags, held by the background in storage.session.
// Content scripts read and write them only through `flag-get` / `flag-set`
// messages, so a page script can neither read nor forge them.
import { registrable } from "../engine/host.js";
import { parseHttpUrl } from "../engine/url.js";

export const FLAG_KINDS = new Set(["dismiss", "bypass"]);

export const flagKey = (kind, reg) => `tm.${kind}.${reg}`;

/** Registrable domain of the page that sent the message, or "". */
export function senderRegistrable(sender) {
  const u = parseHttpUrl(sender?.url ?? "") ?? parseHttpUrl(sender?.tab?.url ?? "");
  return u ? registrable(u.hostname) : "";
}

function check(msg, sender) {
  if (!FLAG_KINDS.has(msg?.kind)) return "unknown flag kind";
  if (typeof msg.registrable !== "string" || msg.registrable === "") return "missing registrable";
  if (msg.registrable !== senderRegistrable(sender)) return "registrable does not match the sender";
  return "";
}

/** `flag-get` → `{set: boolean}` */
export async function handleFlagGet(api, msg, sender) {
  const error = check(msg, sender);
  if (error) return { set: false, error };
  const key = flagKey(msg.kind, msg.registrable);
  const got = await api.storage.session.get(key);
  return { set: got[key] === 1 };
}

/** `flag-set` → `{ok: true}` */
export async function handleFlagSet(api, msg, sender) {
  const error = check(msg, sender);
  if (error) return { ok: false, error };
  await api.storage.session.set({ [flagKey(msg.kind, msg.registrable)]: 1 });
  return { ok: true };
}

/** Read a flag from trusted background code (no sender check). */
export async function isFlagSet(api, kind, reg) {
  const key = flagKey(kind, reg);
  return (await api.storage.session.get(key))[key] === 1;
}
