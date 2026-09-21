# Quick Subject Edit

A Chrome extension that makes the subject line editable when you start a reply
or forward in Gmail, without going hunting for the menu item that does it.

Gmail can already do this. It is just buried: you have to open the caret next
to the recipient, spot "Edit subject" among the reply and forward options, and
click it. This extension does that for you the moment the compose opens.

## What to expect

**Gmail turns the compose into a separate window.** That is Gmail's own
behaviour for "Edit subject", not something the extension adds, and it cannot
be opted out of while still using Gmail's real subject field. The quoted thread
and the forwarded message come across intact.

**It only acts on a compose you have not written in yet.** If you have already
started typing, it leaves the compose alone. Quoted replies and forwarded
messages do not count as having written in it.

## Install

From the Chrome Web Store, or to run it from source:

1. Go to `chrome://extensions` and turn on Developer mode.
2. Choose **Load unpacked** and select this folder.
3. Open Gmail. If it was already open, reload the tab.

After editing any file, click the reload arrow on the extension's card **and**
reload the Gmail tab. Chrome re-reads the files on the first, but the old
content script keeps running in the page until the second.

## How it works

Everything runs in a content script on `https://mail.google.com/*`. There is no
background worker, no network access and no storage.

Rather than injecting a subject field of its own, the extension drives Gmail's
existing "Edit subject" action. Gmail reads the subject from its internal model
rather than from the DOM, so a field the extension created itself could display
one subject while Gmail sent another.

Three pieces of Gmail behaviour shape the implementation, each of which cost a
round of debugging to find:

- **The response-type menu is built on demand.** It does not exist at page load,
  so the caret has to be opened before the "Edit subject" item can be found at
  all. Scanning for the item up front finds nothing, forever.
- **Gmail acts on `mouseup`, not `click`.** A bare `element.click()` does
  nothing. Activation replays the full mouse sequence via `initMouseEvent`,
  matching what InboxSDK does for the same menu item.
- **A compose renders in stages.** The recipient caret arrives late, well after
  the body and the send toolbar, so a single attempt loses the race. Composes
  are retried on a throttle until they succeed or the budget runs out.

Only menu toggles positioned *above* the compose body are ever activated. Below
the body is the send and formatting toolbar, where the buttons attach files and
open Drive, so there is deliberately no fallback that widens the search.

Selectors prefer ARIA roles and Gmail's own attributes, such as `g_editable`,
over obfuscated class names. Where a class-based selector is unavoidable it is
only ever a fallback behind an attribute match. All of them live in
`src/content/gmail-dom.js` so that a Gmail redesign means editing one file.

## Layout

| Path | Purpose |
| --- | --- |
| `src/content/gmail-dom.js` | Every Gmail selector, plus the DOM predicates built on them |
| `src/content/reveal-subject.js` | Finds the menu, activates it, decides when to leave a compose alone |
| `src/content/index.js` | Debounced `MutationObserver` that drives the scan |
| `tools/recon.js` | Console tool for checking assumptions against live Gmail |

## When Gmail breaks it

Gmail's markup changes without notice, and this extension depends on it.

Set `DEBUG = true` in `src/content/reveal-subject.js` to turn on the running
commentary. It logs every compose it sees and, for any it skips, the reason.
If a menu opens without an "Edit subject" item, it logs the items that menu did
contain, which is usually enough to tell what moved.

For anything deeper, paste `tools/recon.js` into the DevTools console on a Gmail
tab. It reports whether the menu item is findable, whether the label and
positional selectors agree, and has a `watch()` that logs the moment an
"Edit subject" item enters the DOM — run it and click the caret to see how the
menu is really built. Its `probeClick()` and `probeSequence()` helpers activate
the item and report what changed, including whether your draft survived. Both
are destructive, so reload the thread between runs.

## Privacy

No data is collected, stored or transmitted. See [PRIVACY.md](PRIVACY.md).
