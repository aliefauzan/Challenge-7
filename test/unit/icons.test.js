import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drawIcon, encodePng, writeIcons, EXTENSION_SIZES } from "../../scripts/make-icons.mjs";

function readPng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
  const chunks = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    chunks.push({ type: buf.toString("ascii", at + 4, at + 8), data: buf.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  const ihdr = chunks[0].data;
  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  return { types: chunks.map((c) => c.type), width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4), colorType: ihdr[9], raw: inflateSync(idat) };
}

test("icons: extension icons are RGBA PNGs at 16, 32, 48 and 128", () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-icons-"));
  const files = writeIcons(dir, EXTENSION_SIZES);
  assert.equal(files.length, 4);
  for (const [i, size] of EXTENSION_SIZES.entries()) {
    const png = readPng(readFileSync(files[i]));
    assert.deepEqual(png.types, ["IHDR", "IDAT", "IEND"]);
    assert.equal(png.width, size);
    assert.equal(png.height, size);
    assert.equal(png.colorType, 6);
    assert.equal(png.raw.length, (size * 4 + 1) * size);
  }
});

test("icons: corners are transparent, the centre is solid", () => {
  const size = 48;
  const rgba = drawIcon(size);
  const alpha = (x, y) => rgba[(y * size + x) * 4 + 3];
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(size - 1, 0), 0);
  assert.equal(alpha(size / 2, size / 2), 255);
});

test("icons: app icons are opaque RGB, as app stores require", () => {
  const size = 64;
  const png = readPng(encodePng(size, size, drawIcon(size, { app: true }), { opaque: true }));
  assert.equal(png.colorType, 2);
  assert.equal(png.raw.length, (size * 3 + 1) * size);
  const rgba = drawIcon(size, { app: true });
  for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255);
});
