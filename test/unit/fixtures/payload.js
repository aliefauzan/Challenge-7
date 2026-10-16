// A minimal valid payload (schema 1) for ruleset tests.
export function makePayload(overrides = {}) {
  return {
    schema: 1,
    version: 5,
    generated: "2026-10-16",
    thresholds: { deep_subdomain_labels: 4, block_high_count: 2, max_text_chars: 100000, max_high_hits: 3 },
    allowlist: ["trusted-bank.example"],
    phrase_allowlist: ["consumer-help.example"],
    scam_domains: ["scam.com", "203.0.113.9"],
    impersonated_brands: ["paypal"],
    lookalike_brands: ["paypal"],
    phishing_context: ["login"],
    categories: { tech_support: { label: "Tech support", why: "Real security alerts never ask you to call a number." } },
    scam_phrases: [
      { id: "tech-1", pattern: "your computer (is|has been) infected", flags: "i", severity: "high", category: "tech_support", description: "Fake virus alert" },
    ],
    sources: { "tabloid.example": { bias: "right", accuracy: "mixed", label: "Tabloid", rating: "Mixed accuracy" } },
    surface_adapters: {
      facebook: { host: "(^|\\.)facebook\\.com$", item_selector: "[role=\"article\"]", dm_host: "(^|\\.)messenger\\.com$", dm_path: "/messages", dm_item_selector: null, skip_link_hosts: "(^|\\.)facebook\\.com$" },
    },
    ...overrides,
  };
}
