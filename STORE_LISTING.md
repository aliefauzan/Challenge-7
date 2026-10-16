# Chrome Web Store listing

Package: `npm run pack` → `scamshield-<version>-chrome.zip`.

## Name

ScamShield

## Short description (132 characters max)

Warns you about scam websites before you lose money or data. Plain words, no sign-up, nothing leaves your computer.

## Category

Productivity → Tools (or Privacy & Security, where offered)

## Language

English

## Detailed description

ScamShield helps you spot scam websites before it is too late.

It is made for people who want a calm, clear warning. It also suits family
members who look after an older parent.

What it does:

- It stops known scam websites before they open. You see a short explanation instead.
- It reads the words on each page you visit. It looks for signs that scammers use.
- Examples: a fake virus alert, a phone number for "support", or a parcel fee.
- More examples: a request to pay with gift cards, or to move money to a "safe account".
- One warning sign shows a small banner at the top of the page.
- Several strong signs cover the page with a clear warning. You can still continue if you are sure.
- On some news websites, it tells you who runs the site, or that the site is satire.
- On Facebook, it marks risky posts and links.
- Click the ScamShield button to see what it found on the page, and why.

Every warning says the same simple thing. Do not pay, call a number, or type a
password. First, call a family member or friend you trust.

Your privacy:

- All checks happen on your computer.
- ScamShield does not collect or send your browsing, your settings or anything you type.
- It only downloads its list of warning signs. That list is the same for everyone.
- No account and no sign-up.

You can turn each check on or off from the ScamShield button.

## Single purpose

ScamShield warns users about scam web pages. It blocks known scam websites
and shows warnings on pages that contain common scam wording.

## Permission justifications

| Permission | Why ScamShield needs it |
|---|---|
| Host permission `<all_urls>` | Scams can appear on any website. ScamShield reads the text of each page you open to look for scam warning signs, and it runs on every site for that reason. The check happens on your computer; nothing is sent anywhere. |
| `declarativeNetRequest` | Stops a known scam website before it loads. The browser sends the tab to ScamShield's explanation page instead of the scam page. |
| `tabs` | Reads the address of the current tab so the popup can show results for that page. Also used to send a tab to the explanation page and to clear a tab's result when it closes. |
| `storage` | Keeps the list of warning signs, your on/off settings, and each open tab's result, on your device only. |
| `alarms` | Checks for an updated list of warning signs about twice a day. |

Remote code: none. ScamShield downloads a data file (the signed list of
warning signs), never code.

## Data usage answers

- Does the extension collect or use any user data? **No.**
- Personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity, website content: **not collected**.
- Certifications: the data is not sold, not used for anything unrelated to the single purpose, and not used for credit decisions.

Privacy policy URL: the published copy of [PRIVACY.md](PRIVACY.md).

## Screenshots to capture (1280×800)

1. The full-page warning on a fake virus-alert page, with both reasons listed.
2. The banner on a parcel-fee page.
3. The popup open on a warned page, listing what was found and why.
4. The explanation page shown instead of a known scam website.
5. The popup on a normal page, with the three on/off switches.

Use the test pages from `test/e2e/fixtures` served by `node test/e2e/server.js`.
For screenshot 4, use a build with the test ruleset, which lists
`known-scam.localhost`.

## Small promo tile (440×280)

The ScamShield shield icon on a plain background with the words
"Stop before you pay".
