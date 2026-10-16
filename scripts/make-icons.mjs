// Draws the ScamShield shield icon and writes PNGs with a tiny encoder
// (node:zlib only, no image libraries).
//
//   node scripts/make-icons.mjs --out dist/icons          # 16, 32, 48, 128 (transparent)
//   node scripts/make-icons.mjs --out AppIcon --app       # 512, 1024 (opaque, for the app)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_SIZES = [16, 32, 48, 128];
export const APP_SIZES = [512, 1024];

// ---- PNG encoding -------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba width*height*4 bytes, not premultiplied
 * @param {{opaque?: boolean}} [opts] opaque drops the alpha channel (RGB PNG)
 */
export function encodePng(width, height, rgba, { opaque = false } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // RGB or RGBA
  const channels = opaque ? 3 : 4;
  const stride = width * channels + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = y * stride + 1 + x * channels;
      for (let c = 0; c < channels; c++) raw[to + c] = rgba[from + c];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- Drawing ------------------------------------------------------------

// Shield outline in a unit square, clockwise: a flat-ish top with raised
// corners, straight sides, and two curves meeting at the bottom point.
function shieldPolygon() {
  const pts = [[0.5, 0.06], [0.86, 0.17], [0.86, 0.46]];
  const curve = (p0, c, p1) => {
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const a = (1 - t) ** 2, b = 2 * (1 - t) * t, d = t * t;
      pts.push([a * p0[0] + b * c[0] + d * p1[0], a * p0[1] + b * c[1] + d * p1[1]]);
    }
  };
  curve([0.86, 0.46], [0.84, 0.8], [0.5, 0.95]);
  curve([0.5, 0.95], [0.16, 0.8], [0.14, 0.46]);
  pts.push([0.14, 0.17]);
  return pts;
}

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

const CHECK = [[0.32, 0.52], [0.45, 0.66], [0.7, 0.37]];
const onCheck = (x, y, width) => distToSegment(x, y, CHECK[0], CHECK[1]) < width || distToSegment(x, y, CHECK[1], CHECK[2]) < width;

const lerp = (a, b, t) => a + (b - a) * t;
const BLUE_TOP = [47, 111, 224];
const BLUE_BOTTOM = [22, 58, 138];
const WHITE = [255, 255, 255];

/**
 * Render one icon. Extension icons: blue shield, white check, transparent
 * corners. App icons: opaque blue background, white shield, blue check,
 * because app icons may not be transparent.
 * @returns {Uint8Array} RGBA
 */
export function drawIcon(size, { app = false } = {}) {
  const poly = shieldPolygon();
  const ss = size <= 128 ? 4 : 3; // samples per axis
  const rgba = new Uint8Array(size * size * 4);
  // Small sizes get a bolder check so it stays visible.
  const checkWidth = size <= 16 ? 0.11 : size <= 32 ? 0.09 : 0.075;
  const inset = app ? 0.12 : 0; // shield margin inside the app icon square
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = (px + (sx + 0.5) / ss) / size;
          const uy = (py + (sy + 0.5) / ss) / size;
          const x = (ux - inset) / (1 - 2 * inset);
          const y = (uy - inset) / (1 - 2 * inset);
          const gradient = BLUE_TOP.map((c, i) => lerp(c, BLUE_BOTTOM[i], app ? uy : y));
          let color = null;
          if (inPolygon(x, y, poly)) color = onCheck(x, y, checkWidth) ? (app ? gradient : WHITE) : app ? WHITE : gradient;
          else if (app) color = gradient;
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return rgba;
}

/** Write icon-<size>.png files into `outdir`. */
export function writeIcons(outdir, sizes = EXTENSION_SIZES, opts = {}) {
  mkdirSync(outdir, { recursive: true });
  const files = [];
  for (const size of sizes) {
    const file = join(outdir, `icon-${size}.png`);
    writeFileSync(file, encodePng(size, size, drawIcon(size, opts), { opaque: Boolean(opts.app) }));
    files.push(file);
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = args[args.indexOf("--out") + 1];
  if (!args.includes("--out") || !out) {
    console.error("usage: node scripts/make-icons.mjs --out <dir> [--app]");
    process.exit(2);
  }
  const app = args.includes("--app");
  for (const f of writeIcons(out, app ? APP_SIZES : EXTENSION_SIZES, { app })) console.log(`wrote ${f}`);
}
