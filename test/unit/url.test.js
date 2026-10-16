import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeUrl } from "../../src/engine/url.js";
import { makeRules } from "./fixtures/rules.js";

const rules = makeRules();
const ids = (url, r = rules) => analyzeUrl(url, r).map((s) => s.id);

test("engine/url: brand as a whole subdomain label of another domain", () => {
  assert.deepEqual(ids("https://amazon.evil.co.uk/"), ["brand-subdomain"]);
  assert.deepEqual(ids("https://www.amazon.co.uk/deals"), []);
  assert.deepEqual(ids("https://smile.amazon.com/"), []);
});

test("engine/url: brand inside a longer label is not a hit", () => {
  assert.deepEqual(ids("https://groups.example.com/"), []);
});

test("engine/url: lookalike hyphen token needs a context word", () => {
  assert.deepEqual(ids("https://paypal-login.net/"), ["lookalike-brand"]);
  assert.deepEqual(ids("https://secure.netflix-billing.com/"), ["lookalike-brand"]);
  assert.deepEqual(ids("https://paypal-fans.org/"), []);
  assert.deepEqual(ids("https://www.paypal.com/login"), []);
});

test("engine/url: deep subdomain uses the ruleset threshold", () => {
  assert.deepEqual(ids("https://login.secure.account.verify.example.com/"), ["deep-subdomain"]);
  assert.deepEqual(ids("https://a.b.c.example.com/"), []);
  const strict = makeRules({ thresholds: { deep_subdomain_labels: 3 } });
  assert.deepEqual(ids("https://a.b.c.example.com/", strict), ["deep-subdomain"]);
});

test("engine/url: public IP host is flagged; private and loopback are not", () => {
  assert.deepEqual(ids("http://198.51.100.7/login"), ["ip-host"]);
  assert.deepEqual(ids("http://192.168.0.1/"), []);
  assert.deepEqual(ids("http://10.0.0.1/"), []);
  assert.deepEqual(ids("http://127.0.0.1:8080/"), []);
  assert.deepEqual(ids("http://172.20.1.1/"), []);
});

test("engine/url: allowlisted registrable domain gets no URL signals", () => {
  assert.deepEqual(ids("https://login.secure.account.verify.trusted-bank.example/"), []);
});

test("engine/url: non-http URLs and garbage are ignored", () => {
  assert.deepEqual(ids("chrome://extensions"), []);
  assert.deepEqual(ids("not a url"), []);
});

test("engine/url: signals carry severity, description and why", () => {
  const [s] = analyzeUrl("https://paypal-login.net/", rules);
  assert.equal(s.source, "url");
  assert.equal(s.severity, "high");
  assert.ok(s.description.length > 0);
  assert.ok(s.why.length > 0);
});
