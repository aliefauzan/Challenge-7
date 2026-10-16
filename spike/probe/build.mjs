// Builds the probe for Chrome and Safari. A fresh Ed25519 test vector is
// embedded so the worker can check verify() without network access.
import { generateKeyPairSync, sign } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const msg = "probe vector";
const vector = {
  msg,
  pub: Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64"),
  sig: sign(null, Buffer.from(msg), privateKey).toString("base64"),
};
const base = {
  manifest_version: 3,
  name: "ScamShield Probe",
  description: "Checks which extension APIs this browser supports.",
  version: "0.0.1",
  action: { default_popup: "popup.html" },
  permissions: ["storage", "alarms", "declarativeNetRequest", "tabs"],
  host_permissions: ["<all_urls>"],
  background: { service_worker: "background.js" },
  content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"], run_at: "document_idle", all_frames: true }],
  web_accessible_resources: [{ resources: ["blocked.html"], matches: ["<all_urls>"] }],
};
const targets = {
  chrome: { ...base, minimum_chrome_version: "137" },
  safari: { ...base, browser_specific_settings: { safari: { strict_min_version: "17.0" } } },
};
for (const [t, manifest] of Object.entries(targets)) {
  const out = join(HERE, `dist-${t}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(HERE, "src"), out, { recursive: true });
  const bg = readFileSync(join(out, "background.js"), "utf8");
  writeFileSync(join(out, "background.js"), `const VECTOR = ${JSON.stringify(vector)};\n${bg}`);
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`built ${out}`);
}
