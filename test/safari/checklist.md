# Safari manual checklist

What `test/safari/smoke.test.js` cannot see: the contents of the closed
shadow root, the popup, the toolbar badge, the permission card and iOS.

## Setup

Fixtures: `node test/e2e/server.js` (port 8787). Any `*.localhost` host name
reaches it, on the Mac and in the iOS Simulator.

Build with the test ruleset, which adds `known-scam.localhost`, a satire
source and a phrase whose text carries markup. Never ship this build.

```bash
npm run safari:build -- --test-ruleset
```

macOS (one time; some settings reset when Safari quits):

1. `safaridriver --enable` (asks for the admin password).
2. Safari → Settings → Advanced → "Show features for web developers".
3. Develop → "Allow Remote Automation" and "Allow Unsigned Extensions"
   (Safari 27: Settings → Developer, "Allow remote automation and external
   agents" and "Allow unsigned extensions").
4. `npm run safari:open`, then Safari → Settings → Extensions → ScamShield on,
   allowed on all websites.

iOS Simulator:

1. `npm run safari:sim`.
2. Settings → Apps → Safari → Extensions → ScamShield on,
   Permissions → All Websites → Allow.

Use a new host name for each check (`dismiss2.localhost`, …): dismiss and
bypass are remembered per site.

## Checks

| # | Fixture URL | Action | Expected | macOS | iOS Simulator |
|---|---|---|---|---|---|
| 1 | `http://known-scam.localhost:8787/` | Open | The blocked page names `known-scam.localhost` | [x] | [x] |
| 2 | `http://<site>.localhost:8787/two-high.html` | Open | Full-page blocker listing "Fake virus alert" and "Asks you to call fake support" | [x] | [x] |
| 3 | same | Tap "I understand the risk — continue", then reload | Page usable; after reload no blocker (a banner may remain) | [x] | [x] |
| 4 | `http://<site>.localhost:8787/one-phrase.html` | Open | Banner "This page may be a scam" with the parcel reasons | [x] | [x] |
| 5 | same | Tap ×, reload, open the URL again | Banner stays hidden | [x] | [x] |
| 6 | `http://<site>.localhost:8787/markup-phrase.html` | Open | Banner shows the reason text literally, including `<img …>` and `<b>`; nothing bold, no broken image | [x] | [x] |
| 7 | `http://<site>.localhost:8787/storage-attack.html` | Open, reload | Banner both times | [x] | [x] |
| 8 | `http://<site>.localhost:8787/remove.html` | Open | The page removes `<tm-root>`; the banner comes back | [x] | [x] |
| 9 | macOS: any warned page | Web Inspector → delete `<tm-root>` | The banner comes back | [x] | n/a |
| 10 | `http://<site>.localhost:8787/late.html` | Open, wait 3 s | No banner at first, banner after the text appears | [x] | [x] |
| 11 | `http://<site>.localhost:8787/frame-top.html` | Open | Banner in the top page for the scam text inside the frame | [x] | [x] |
| 12 | any warned page | Open the ScamShield popup | Lists the phrase warning(s) with "why" text | [x] | [x] |
| 13 | any warned page | Look at the toolbar button | Badge `!` (where Safari shows badges; otherwise the popup text) | [x] | [x] |
| 14 | `http://<site>.localhost:8787/clean.html` | Open | Nothing shown | [x] | [x] |
| 15 | any page, website access not granted | Open the popup | Permission card explaining how to allow access | [ ] | [ ] |
| 16 | iOS: rows 2, 4, 12 | Look at phone width | Text readable without zoom, blocker buttons reachable, popup usable | n/a | [x] |
| 17 | all of the above | Web Inspector console (background page and page) | No errors from the extension | [x] | [ ] |

## Results

iOS Simulator: iPhone 17 Pro, iOS 26.4, checked on 17 Oct 2026.

- Row 15: Safari on iOS answers "not granted" for all websites even when All
  Websites is set to Allow, so the popup showed the permission card on a
  warned tab. The popup now also accepts a verdict for the tab, or access to
  the tab's own site, as proof of access; after that change the card is gone
  with Allow set. The card with access really withheld is covered by the unit
  tests and not yet re-checked on the Simulator.
- Row 17 needs Web Inspector from the Mac's Safari, which needs the macOS
  setup above.

macOS: Safari 27.0.1 on macOS 27.0.1, checked by hand on 17 Oct 2026.

- `npm run test:safari` could not start: safaridriver timed out creating a
  session (see docs/SAFARI_COMPAT.md, "Developer setup on macOS"). Every
  row it covers (1, 2, 4, 6, 7, 10, 14) was checked by hand instead.
- Row 9: removing `<tm-root>` from the Web Inspector console left 0 hosts;
  two seconds later there was 1 again and the banner was back.
- Row 13: the toolbar button shows a red `!` badge on warned pages and none
  after the banner is closed.
- Row 15: not checked; it needs website access taken away.
- Row 17: page console shows only `tm:content loaded` (debug); background
  console shows only `tm:background loaded` and `tm:block 0 rules` (debug).
- Row 1 once showed the in-page known-scam warning instead of `blocked.html`:
  the background worker had stopped after its Web Inspector closed and Safari
  did not restart it. The warning still covered the page.
