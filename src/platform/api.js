// The only file that names the browser's extension namespace.
// Safari exposes `browser` (and a `chrome` alias); Chrome exposes `chrome`.
// Both return promises from MV3 APIs, so no callback wrappers are needed.
export const api = globalThis.browser ?? globalThis.chrome;
