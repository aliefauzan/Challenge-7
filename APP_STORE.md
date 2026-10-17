# App Store listing (Safari extension, macOS and iOS)

Archives: `npm run safari:archive` →
`safari/build/ScamShield-<version>-macOS.xcarchive` and
`safari/build/ScamShield-<version>-iOS.xcarchive`. Upload each from Xcode →
Window → Organizer → Distribute App → App Store Connect.

Bundle ID `com.aliefauzan.scamshield`, extension
`com.aliefauzan.scamshield.Extension`, team `62ZRZ6VZKC`.

## Name

ScamShield

## Subtitle (30 characters max)

Scam warnings for Safari

## Promotional text (170 characters max)

Stop before you pay. ScamShield warns you about scam websites in Safari, in plain words. Nothing about your browsing leaves your device.

## Description

ScamShield is a Safari extension that helps you spot scam websites before it
is too late.

It is made for people who want a calm, clear warning. It also suits family
members who look after an older parent.

WHAT IT DOES

- It stops known scam websites before they open. You see a short explanation instead.
- It reads the words on each page you visit. It looks for signs that scammers use.
- Examples: a fake virus alert, a phone number for "support", or a parcel fee.
- More examples: a request to pay with gift cards, or to move money to a "safe account".
- One warning sign shows a small banner at the top of the page.
- Several strong signs cover the page with a clear warning. You can still continue if you are sure.
- On some news websites, it tells you who runs the site, or that the site is satire.
- On Facebook, it marks risky posts and links.
- Tap the ScamShield button in Safari to see what it found, and why.

Every warning says the same simple thing. Do not pay, call a number, or type a
password. First, call a family member or friend you trust.

YOUR PRIVACY

- All checks happen on your device.
- ScamShield does not collect or send your browsing, your settings or anything you type.
- It only downloads its list of warning signs. That list is the same for everyone.
- No account and no sign-up.

HOW TO TURN IT ON

- iPhone and iPad: Settings → Apps → Safari → Extensions → ScamShield. Turn it on, then set All Websites to Allow.
- Mac: open the ScamShield app and click Open Safari Settings. Turn on ScamShield, then choose Always Allow on Every Website.

## Keywords (100 characters max)

scam,fraud,phishing,safe browsing,senior,elderly,warning,safari extension,parcel scam,tech support

## Category

Primary: Utilities. Secondary: Productivity.

## Age rating

4+ (no objectionable content).

## URLs

- Support URL: https://github.com/aliefauzan/scamshield/issues
- Privacy policy URL: the published copy of [PRIVACY.md](PRIVACY.md)

The repository is private today. Before submitting, publish the privacy policy
and a support page at addresses anyone can open.

## App privacy (privacy label)

Data collection: **Data Not Collected.**

This matches [PRIVACY.md](PRIVACY.md). The extension checks pages on the
device, and keeps its settings and results in browser extension storage on
the device. Its only network request downloads the signed list of warning
signs, which carries no user data. There is no account, no analytics, no
advertising and no third-party SDK.

## Review notes

ScamShield is a Safari web extension. The app only explains how to turn it on.

To test:

1. Install the app and open it once.
2. iOS: Settings → Apps → Safari → Extensions → ScamShield → turn on, then All Websites → Allow. macOS: Safari → Settings → Extensions → ScamShield → turn on, then Always Allow on Every Website.
3. Open a page that contains scam wording. For example, a page that says "Your computer is infected. Call Microsoft support now at 1-800-555-0100."
4. Expected: a full-page warning listing "Fake virus alert" and "Asks you to call fake support". "I understand the risk — continue" lets you through.
5. Tap the ScamShield button in Safari's toolbar (iOS: the puzzle-piece button in the address bar) to see what was found.

No sign-in is needed.

## Screenshots

Ready in [docs/store-screenshots](docs/store-screenshots):

| Device | Size | Files |
|---|---|---|
| iPhone 6.9" (iPhone 17 Pro Max Simulator) | 1320×2868 | `iphone-1-warning.png` full-page warning, `iphone-2-banner.png` banner, `iphone-3-popup.png` popup with reasons, `iphone-4-blocked.png` explanation page for a blocked website |
| iPad 13" (iPad Pro 13-inch Simulator) | 2064×2752 | `ipad-1-warning.png` full-page warning, `ipad-2-popup.png` popup with reasons |
| Mac | 2880×1800 | not taken yet: full-page warning in Safari, banner, the ScamShield app window |

They show the demo pages in `test/e2e/fixtures` (`demo-alert.html`,
`demo-parcel.html`, `demo-news.html`), served by `node test/e2e/server.js`.
The Simulator reaches them at `http://<name>.localhost:8787/…`. The blocked
website shot needs a `--test-ruleset` build, which lists
`known-scam.localhost`.
