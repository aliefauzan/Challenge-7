// Small hand-written ruleset used by the engine tests. It is already in the
// compiled shape the engine consumes (the payload compiler builds the same
// shape from JSON).
import { DomainSet } from "../../../src/engine/domains.js";

export const thresholds = {
  deep_subdomain_labels: 4,
  block_high_count: 2,
  max_text_chars: 2000,
  max_high_hits: 3,
};

const phrase = (id, source, severity, category, description, why) => ({
  id,
  re: new RegExp(source, "i"),
  severity,
  category,
  description,
  why,
});

export function makeRules(overrides = {}) {
  return {
    thresholds: { ...thresholds, ...(overrides.thresholds ?? {}) },
    allowlist: new DomainSet(["trusted-bank.example", "news.example"]),
    phraseAllowlist: new DomainSet(["consumer-help.example"]),
    scamDomains: new DomainSet(["scam.com", "fake-parcel.net", "203.0.113.9"]),
    impersonatedBrands: new Set(["amazon", "paypal", "ups", "apple"]),
    lookalikeBrands: new Set(["paypal", "netflix"]),
    phishingContext: new Set(["login", "verify", "secure", "account", "my", "support", "refund"]),
    phrases: [
      phrase("t-tech", "your (computer|device) (is|has been) (infected|locked)", "high", "tech_support", "Fake virus alert", "Real security software never asks you to call a phone number."),
      phrase("t-gift", "pay(ment)? (with|using|in) (gift|itunes|google play) cards?", "high", "gift_card", "Gift card payment request", "No real company or agency takes payment in gift cards."),
      phrase("t-secret", "do ?n[o']?t tell (anyone|your family)", "high", "isolation", "Asks you to keep it secret", ""),
      phrase("t-fee", "small (delivery|redelivery|customs) fee", "medium", "delivery", "Parcel fee request", ""),
      phrase("t-prize", "you('ve| have) (won|been selected)", "high", "prize", "Prize claim", "If you have to pay to get a prize, it is not a prize."),
    ],
    categories: {
      isolation: { label: "Isolation", why: "Scammers ask for secrecy so nobody can warn you." },
      delivery: { label: "Delivery", why: "Couriers do not ask for small fees by text or pop-up." },
    },
    sources: new DomainSet({
      "tabloid.example": { bias: "right", accuracy: "mixed", label: "Tabloid Example", rating: "Mixed accuracy" },
      "satire.example": { bias: "satire", accuracy: "varies", label: "Satire Example", rating: "Satire site" },
    }),
    ...overrides,
  };
}
