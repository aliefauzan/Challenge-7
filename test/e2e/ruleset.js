// The ruleset the end-to-end tests run with: the bundled one plus what the
// fixtures need. The Chromium harness writes it into storage; the Safari
// test build (npm run safari:build -- --test-ruleset) bundles it instead.
import bundled from "../../src/data/default-ruleset.json" with { type: "json" };

/** Bundled ruleset plus what the fixtures need. */
export function testRuleset() {
  return {
    ...bundled,
    version: 900000,
    scam_domains: [...bundled.scam_domains, "known-scam.localhost"],
    sources: { ...bundled.sources, "news.localhost": { bias: "satire", accuracy: "varies", label: "News Fixture", rating: "Satire. The stories are made up on purpose." } },
    scam_phrases: [
      ...bundled.scam_phrases,
      {
        id: "e2e-markup",
        severity: "medium",
        category: "urgency",
        flags: "i",
        description: "<img src=x onerror=window.pwned=1>",
        why: "<b>bold</b><script>window.pwned=2</script>",
        pattern: "\\be2e markup trigger phrase\\b",
      },
    ],
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.stdout.write(JSON.stringify(testRuleset()) + "\n");
}
