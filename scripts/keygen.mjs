#!/usr/bin/env node
// Generates the Ed25519 key pair that signs the published ruleset.
// The private key is written outside the repository with mode 0600;
// the public key is printed for src/config.js.
//   npm run keygen [-- --out ~/.scamshield/ruleset-signing.key]
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const i = process.argv.indexOf("--out");
const out = resolve(i > 0 ? process.argv[i + 1] : join(homedir(), ".scamshield", "ruleset-signing.key"));

function fail(msg) {
  console.error(`keygen: ${msg}`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
const realOutDir = realpathSync(dirname(out));
if (realOutDir === ROOT || realOutDir.startsWith(ROOT + sep)) fail(`refusing to write a private key inside the repository (${out})`);
if (existsSync(out)) fail(`${out} exists; refusing to overwrite`);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(out, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600, flag: "wx" });
const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64");
console.log(`Private key written to ${out} (mode 0600). Back it up somewhere safe.`);
console.log("Put this in src/config.js:");
console.log(`export const RULESET_PUBLIC_KEY = "${raw}";`);
