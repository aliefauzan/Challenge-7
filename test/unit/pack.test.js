import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync, crc32 } from "node:zlib";
import { zip } from "../../scripts/pack.mjs";

// Reads the local file entries back, the way an unzip tool would.
function entries(buf) {
  const out = [];
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    const crc = buf.readUInt32LE(at + 14);
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString("utf8");
    const body = buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    out.push({ name, data, crc, method });
    at += 30 + nameLen + size;
  }
  return out;
}

test("pack: every file comes back byte for byte with a matching checksum", () => {
  const files = [
    { name: "manifest.json", data: Buffer.from('{"version":"1.2.3"}'.repeat(20)) },
    { name: "icons/icon-16.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ];
  const back = entries(zip(files));
  assert.deepEqual(back.map((e) => e.name), files.map((f) => f.name));
  for (const [i, e] of back.entries()) {
    assert.deepEqual(e.data, files[i].data);
    assert.equal(e.crc, crc32(files[i].data));
  }
  assert.equal(back[0].method, 8, "compressible file is deflated");
  assert.equal(back[1].method, 0, "tiny file is stored");
});

test("pack: the end record counts the entries and the output is stable", () => {
  const files = [{ name: "a.js", data: Buffer.from("x") }];
  const a = zip(files);
  assert.equal(a.readUInt32LE(a.length - 22), 0x06054b50);
  assert.equal(a.readUInt16LE(a.length - 22 + 10), 1);
  assert.deepEqual(a, zip(files));
});
