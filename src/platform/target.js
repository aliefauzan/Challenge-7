// Build target, replaced by esbuild `define` (scripts/build.mjs).
// Falls back to "chrome" when the source runs unbundled, e.g. in Node tests.
/* global __TM_TARGET__ */
export const TARGET = typeof __TM_TARGET__ === "undefined" ? "chrome" : __TM_TARGET__;
