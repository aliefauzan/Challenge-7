# Safari compatibility

ScamShield ships one codebase to Chrome and Safari. Before writing the real background and content code, a small probe extension (`spike/probe/`) tested every API the design depends on. This page records what each browser actually did and the fallback the code uses where Safari differs.

Tested on 2026-10-16:

| Browser | Version | How |
|---|---|---|
| Chromium | 156 | Playwright, unpacked extension, headless |
| Safari iOS | 26.4 (iPhone 17 Pro Simulator) | Converted with `safari-web-extension-converter`, installed with `simctl` |
| Safari macOS | 27.0.1 (macOS 27) | Built and registered with Safari; turning it on in Safari Settings is a manual step and was not done in this run |

## Results

| # | Probe | Chrome | Safari iOS | Safari macOS | What the code does |
|---|---|---|---|---|---|
| 1 | `background.service_worker` starts and is woken by an alarm after it stops | yes | yes (worker restarted by the alarm) | pending | Use `service_worker` on both targets |
| 2 | `crypto.subtle.verify("Ed25519", …)` in the worker | yes | yes | pending | WebCrypto only; no bundled Ed25519 library |
| 3 | DNR `updateDynamicRules` with `requestDomains` | yes | yes | pending | `requestDomains` on both targets |
| 4 | DNR `redirect` to the extension's `blocked.html` (`regexSubstitution` or `extensionPath`) | yes, both | **no**, neither (rules are accepted; the page loads normally) | pending | Safari: no DNR redirect. The content script sends the tab to `blocked.html` (see below) |
| 5 | Block happens before the request is sent | yes (the server saw no request) | DNR `block` yes, but Safari shows its own "The URL was blocked by a content blocker" page and the tab cannot be moved to `blocked.html` afterwards | pending | Safari: content script at `document_start` |
| 6 | `storage.session` from the worker | yes | yes | pending | Use `storage.session` |
| 7 | `storage.session.setAccessLevel` exists | yes | yes | pending | Not used: content scripts ask the worker for flags by message |
| 8 | `storage.sync` set/get | yes | yes (cross-device sync not tested) | pending | Code does not depend on sync |
| 9 | `action.setBadgeText` / `setBadgeBackgroundColor` | yes | yes | pending | Badge on both targets |
| 10 | Content script runs in cross-origin iframes (`all_frames`) | yes | yes | pending | `all_frames: true` |
| 11 | Closed `attachShadow` from a content script, with styles | yes | yes | pending | Closed shadow root |
| 12 | `tabs.query` returns `url` for the active tab | yes | yes | pending | Popup reads the active tab URL directly |
| 13 | What the user sees before granting website access | permission granted at install | see below | pending | Onboarding card in the popup and the container app |
| 14 | Same probes on iOS | n/a | this column | n/a | No iOS-only gaps beyond probes 4, 5 and 13 |

## Safari details

### Website access (probe 13)

After the extension is turned on in iOS Settings, "All Websites" defaults to **Ask**. In that state Safari showed no prompt in our tests, the content script did not run, and even DNR `block` rules had no effect. The background worker still ran.

Everything works only after the user sets:

- iOS: Settings → Apps → Safari → Extensions → ScamShield → All Websites → **Allow**
- macOS: Safari → Settings → Extensions → ScamShield → **Always Allow on Every Website…**

The popup checks `permissions.contains({origins: ["<all_urls>"]})` and shows these steps when it is false. The container app shows the same steps.

On iOS 26.4 (Simulator) that call answers `false` even with All Websites set to **Allow** and content scripts running. The popup therefore also counts two other answers as access: a stored verdict for the tab (the content script ran there, which it can only do with access) and `permissions.contains` for the tab's own origin. Only when all three say no does it show the steps.

### Popup on iPhone and iPad

On iOS 26.4 (Simulator) the popup has no emoji font. A symbol such as U+26D4 shows as an empty box, even with "Apple Color Emoji" named in `font-family`. The popup's status icon is therefore plain ASCII (`!`, `i`) inside a CSS circle, and the check mark for a clean page is drawn with CSS borders.

On iPhone the popup is a full-width sheet, so the 380px width cap only applies to mouse pointers (`@media (pointer: coarse)` lifts it). On iPad it is a popover of fixed height; longer content scrolls inside it.

### Loopback hosts

Safari applies no DNR rules to `localhost` or `127.0.0.1`. Tests that need Safari to block must use a public test hostname.

### Blocked page without DNR redirect (probes 4 and 5)

These ways of reaching `blocked.html` were tested on Safari iOS:

| Method | Result |
|---|---|
| DNR `redirect.regexSubstitution` | Rule accepted, page loads normally |
| DNR `redirect.extensionPath` | Rule accepted, page loads normally |
| DNR `block`, then `tabs.update` from `tabs.onUpdated` | Safari's error page stays |
| Content script calls `location.replace(runtime.getURL("blocked.html#…"))` | Works; `blocked.html` reads the URL from the hash |
| Content script messages the worker, worker calls `tabs.update(tabId, {url: runtime.getURL("blocked.html#…")})` | Works |
| `tabs.onUpdated` then `tabs.update`, no DNR rule | Works, but fires only when the page has finished loading |

So on Safari:

1. A small content script runs at `document_start` in the top frame. It asks the worker whether the domain is a known scam domain, and checks the stored list itself if the worker does not answer within a second.
2. If it is, the content script calls `location.replace(runtime.getURL("blocked.html#" + encodeURIComponent(href)))`.
3. The worker keeps a `tabs.onUpdated` backstop that does the same with `tabs.update`, in case the content script did not run.

On Safari the scam page's first request is still sent. The page is never shown, and the user lands on the same explanation page as on Chrome.

On macOS 27.0.1 (Safari 27.0.1), Safari once stopped the extension's background worker when its Web Inspector window closed, then did not start it again. While the worker was gone, the guard's message went unanswered and the backstop did not run. The guard now falls back to the stored scam list in that case (see "Stopped background worker" below), so the page still lands on `blocked.html`. Reloading the extension (rebuilding and opening the app) brings the worker back.

### Developer setup on macOS

- Safari 27 moves the developer switches to Settings → Developer: "Allow remote automation and external agents" and "Allow unsigned extensions". The unsigned switch resets each time Safari quits, and the extension then disappears from Settings → Extensions until the switch is on again.
- An archive leaves a second copy of the app under `ArchiveIntermediates`, and macOS registers its extension with the same bundle ID. Safari then lists neither copy. `npm run safari:open` unregisters every copy except the one it opens.
- Creating a `safaridriver` session can time out ("The session timed out while connecting to a Safari instance"). Quitting Safari lets the next session start it. Only one session can drive Safari at a time; a leftover `safaridriver` process blocks the next one ("already paired with another WebDriver session").
- When Safari already runs the installed app (unsigned extensions allowed), its automation windows run that copy. A copy loaded through WebDriver (`POST /session/{id}/webextension` with `{"type": "path"}`) next to it does not run. `test/safari/smoke.test.js` therefore checks first whether a warning appears, and loads `dist/safari` only when none does.
- When a tab moves to an extension page such as `blocked.html`, Safari gives it a new window handle, and commands on the old handle fail with "no such window". For a moment the handle list can still name the old handle. Navigating away from an extension page can also hang the session, so the test opens each page in a new tab and closes the old ones.
- Extension pages that are not web-accessible (the popup) cannot be opened from WebDriver: Safari shows its error page. A web-accessible extension page (`blocked.html`) can, and can then move to the popup.

### Permissions

- In automation windows Safari answers "not granted" to `permissions.contains({origins: ["<all_urls>"]})`, as Safari on iOS does with All Websites set to Allow, while it answers "granted" for a single site. The popup therefore also asks about the tab's own site, and on Safari shows the permission card over websites only.
- Safari rejects a match pattern with a port (`http://host:8787/*` "is not a valid pattern"). Patterns are built from the host name alone.
- Safari 27 on macOS, Settings → Extensions, for an extension that has no website access yet: under Permissions it says "You have not allowed this extension on any websites yet." with the buttons **Edit Websites…** and **Always Allow on Every Website…**. Once access is given on every website, the second button goes away and a notice says the extension "can read and alter webpages you visit and see your browsing history on all websites". The popup card, the container app and the README use this wording.
- After access is given, Settings → Websites lists no extensions and Edit Websites… does nothing, so there was no way to take access away again for a test of the card.
- Safari refuses to turn on an extension whose manifest has no `description` ("Missing or empty description manifest entry").

### Stopped background worker

The guard script waits at most one second for the worker's `nav-check` answer. Without an answer it reads the stored scam list itself and still leaves for `blocked.html`. The blocked page likewise stops waiting for `blocked-check` after one second and then leaves out the site's name. Checked by closing the worker's Web Inspector until Develop → Web Extension Background Content showed none, then opening `known-scam.localhost`.

### Manifest

Safari rejects a manifest without a non-empty `description`.
