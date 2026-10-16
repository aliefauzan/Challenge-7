import { test } from "node:test";
import assert from "node:assert/strict";
import { DomainSet } from "../../src/engine/domains.js";

test("engine/domains: subdomain of a listed domain matches (suffix walk)", () => {
  const set = new DomainSet(["scam.com"]);
  assert.equal(set.has("scam.com"), true);
  assert.equal(set.has("x.y.scam.com"), true);
  assert.equal(set.has("www.scam.com"), true);
  assert.equal(set.has("notscam.com"), false);
  assert.equal(set.has("scam.com.evil.org"), false);
});

test("engine/domains: never matches on a public suffix entry", () => {
  const set = new DomainSet(["co.uk", "github.io"]);
  assert.equal(set.has("bank.co.uk"), false);
  assert.equal(set.has("someone.github.io"), false);
  assert.equal(set.size, 0);
});

test("engine/domains: a listed private-suffix site does not cover its neighbours", () => {
  const set = new DomainSet(["evil.github.io"]);
  assert.equal(set.has("evil.github.io"), true);
  assert.equal(set.has("login.evil.github.io"), true);
  assert.equal(set.has("good.github.io"), false);
});

test("engine/domains: IPs match exactly only", () => {
  const set = new DomainSet(["203.0.113.9"]);
  assert.equal(set.has("203.0.113.9"), true);
  assert.equal(set.has("203.0.113.90"), false);
});

test("engine/domains: entries are normalized; get returns the most specific value", () => {
  const map = new DomainSet({ "Example.com.": "outer", "news.example.com": "inner" });
  assert.equal(map.get("a.news.example.com"), "inner");
  assert.equal(map.get("shop.example.com"), "outer");
  assert.equal(map.get("other.com"), undefined);
  assert.equal(map.match("a.news.example.com"), "news.example.com");
  assert.equal(map.has(""), false);
  assert.equal(new DomainSet().size, 0);
});
