// Dismiss and bypass flags, asked of the background by message. The flags
// live in the background's session storage, out of the page's reach; this
// file never touches any storage itself.

const KINDS = new Set(["dismiss", "bypass"]);

/** @param {object} api the extension API (src/platform/api.js) */
export function createFlags(api) {
  async function send(type, kind, registrable) {
    if (!KINDS.has(kind) || !registrable) return undefined;
    try {
      return await api.runtime.sendMessage({ type, kind, registrable });
    } catch {
      return undefined; // background asleep or extension reloaded
    }
  }
  return {
    /** @returns {Promise<boolean>} */
    getFlag: async (kind, registrable) => (await send("flag-get", kind, registrable))?.set === true,
    /** @returns {Promise<boolean>} true when the background stored it */
    setFlag: async (kind, registrable) => (await send("flag-set", kind, registrable))?.ok === true,
  };
}
