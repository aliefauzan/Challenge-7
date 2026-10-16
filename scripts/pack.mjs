#!/usr/bin/env node
// Zips dist/chrome for the Chrome Web Store.
//   npm run pack       builds dist/chrome first, writes scamshield-<version>-chrome.zip
//
// A small zip writer (stored or deflated entries), so no extra dependency
// is needed. Entries are sorted and carry a fixed timestamp, so the same build
// always gives the same zip.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist", "chrome");

// 1 Jan 2020 00:00 in MS-DOS time and date fields.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

function files(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    })
    .sort();
}

/**
 * @param {{name: string, data: Buffer}[]} entries
 * @returns {Buffer}
 */
export function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const deflate = packed.length < data.length;
    const body = deflate ? packed : data;
    const crc = crc32(data);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(deflate ? 8 : 0, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += head.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const built = spawnSync("node", ["scripts/build.mjs", "--target", "chrome"], { cwd: ROOT, stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status || 1);
  const { version } = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
  const entries = files(DIST).map((path) => ({ name: relative(DIST, path).split(sep).join("/"), data: readFileSync(path) }));
  const out = join(ROOT, `scamshield-${version}-chrome.zip`);
  writeFileSync(out, zip(entries));
  console.log(`wrote ${relative(ROOT, out)} (${entries.length} files, version ${version})`);
}
