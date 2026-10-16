import { test } from "node:test";
import assert from "node:assert/strict";
import { splitHost, registrable, isIp, normalizeHost } from "../../src/engine/host.js";

test("engine/host: splits a ccTLD host with the public suffix list", () => {
  assert.deepEqual(splitHost("amazon.evil.co.uk"), {
    hostname: "amazon.evil.co.uk", registrable: "evil.co.uk", mainLabel: "evil", subdomainLabels: ["amazon"], isIp: false,
  });
  assert.equal(splitHost("amazon.co.uk").registrable, "amazon.co.uk");
  assert.equal(splitHost("amazon.co.uk").mainLabel, "amazon");
});

test("engine/host: normalizes case, trailing dot and a leading www label", () => {
  const h = splitHost("WWW.Example.COM.");
  assert.equal(h.hostname, "www.example.com");
  assert.equal(h.registrable, "example.com");
  assert.deepEqual(h.subdomainLabels, []);
});

test("engine/host: private suffixes keep each user site separate", () => {
  assert.equal(registrable("evil.github.io"), "evil.github.io");
  assert.equal(registrable("a.b.evil.github.io"), "evil.github.io");
});

test("engine/host: IPv4 and bracketed IPv6", () => {
  assert.equal(isIp("192.168.0.1"), true);
  const v6 = splitHost("[2001:db8::1]");
  assert.equal(v6.isIp, true);
  assert.equal(v6.hostname, "2001:db8::1");
  assert.equal(v6.registrable, "2001:db8::1");
  assert.deepEqual(v6.subdomainLabels, []);
});

test("engine/host: hosts without a registrable domain fall back to the hostname", () => {
  assert.equal(registrable("localhost"), "localhost");
  assert.equal(registrable("known-scam.localhost"), "known-scam.localhost");
});

test("engine/host: unicode hosts become punycode", () => {
  assert.equal(normalizeHost("äpple.com"), "xn--pple-koa.com");
  assert.equal(normalizeHost(""), "");
  assert.equal(normalizeHost("bad host"), "");
});
