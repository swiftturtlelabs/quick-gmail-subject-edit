// Drives Gmail's own "Edit subject" action rather than injecting a subject
// field of our own. Gmail reads the subject from its internal model, not from
// the DOM, so a field we created ourselves could show one subject while Gmail
// sends another.
//
// Two things recon established that shape everything below:
//
//   1. The response-type menu does not exist until its caret is clicked, so we
//      have to open the menu before the "Edit subject" item can be found.
//   2. Gmail acts on mouseup, not click. A bare element.click() does nothing,
//      which is why we replay the full mouse sequence InboxSDK uses.
//
// Note that Gmail's Edit subject replaces the inline reply with a separate
// compose. That is inherent to the action, not something we can opt out of.

(() => {
  const NS = window.GmailSubjectEditor;
  const dom = NS.dom;

  const LOG_PREFIX = '[editable-subject]';

  // Activating the menu item makes Gmail open a compose that has a subject
  // field, which in turn contains its own menu. If our "already editable"
  // guard ever fails to recognise that, we would reveal in a loop and bury the
  // user in compose windows. The limiter makes that self-arresting.
  const MAX_REVEALS = 3;
  const WINDOW_MS = 2000;

  const MENU_BUILD_MS = 400;
  const COMPOSE_BUILD_MS = 2000;

  // Gmail expands an inline reply in stages, and the recipient caret is one of
  // the last parts to render. A single attempt per compose therefore loses the
  // race and, if we then never look again, the reply only works once something
  // else makes Gmail rebuild it, such as clicking into the To: field. So a
  // compose stays eligible until it succeeds or runs out of attempts.
  const MAX_ATTEMPTS = 8;
  const RETRY_MS = 400;

  // root -> { attempts, nextAt, busy, done }
  const state = new WeakMap();
  let recent = [];
  let disabled = false;
  let warned = false;

  // console.log rather than console.debug: Chrome files debug output under the
  // Verbose level, which is off by default, so debug messages are invisible
  // exactly when someone is trying to work out why nothing happened.
  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warnOnce(message, detail) {
    if (warned) return;
    warned = true;
    console.warn(`${LOG_PREFIX} ${message}`, detail || '');
  }

  function rateLimited() {
    const now = Date.now();
    recent = recent.filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_REVEALS) {
      disabled = true;
      console.warn(
        `${LOG_PREFIX} revealed ${MAX_REVEALS} subjects in under ${WINDOW_MS}ms, ` +
          'which usually means a compose was not recognised as already editable. ' +
          'Stopping until the page is reloaded.'
      );
      return true;
    }
    recent.push(now);
    return false;
  }

  function waitFor(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const poll = () => {
        const value = predicate();
        if (value) return resolve(value);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  // initMouseEvent is deprecated but it is what InboxSDK ships and what Gmail
  // demonstrably responds to. The modern MouseEvent constructor produces
  // events Gmail's handlers ignore, so this is not a style choice.
  function simulateMouseEvent(element, name) {
    const event = document.createEvent('MouseEvents');
    event.initMouseEvent(
      name, true, true, window, 0,
      element.offsetLeft, element.offsetTop, 0, 0,
      false, false, false, false, 0, null
    );
    element.dispatchEvent(event);
  }

  function simulateClick(element) {
    for (const name of ['mousedown', 'mouseup', 'click', 'mouseleave', 'mouseout']) {
      simulateMouseEvent(element, name);
    }
    element.blur();
  }

  function isOpen(toggle) {
    return toggle.getAttribute('aria-expanded') === 'true';
  }

  // A compose has several aria-haspopup buttons and only one of them opens the
  // menu we want, so wrong guesses have to be undone. Clicking the toggle
  // again is safer than Escape, which Gmail also uses to close the compose.
  function close(toggle) {
    if (isOpen(toggle)) simulateClick(toggle);
  }

  async function revealVia(toggle, root) {
    simulateClick(toggle);
    const item = await waitFor(() => dom.findEditSubjectItem(root), MENU_BUILD_MS);
    if (!item) {
      // Log what the menu did contain. If a forward's caret offers different
      // items than a reply's, this is where that shows up.
      const opened = Array.from(document.querySelectorAll(dom.MENU_ITEM))
        .filter((el) => el.offsetParent !== null)
        .map((el) => el.textContent.trim());
      log('no Edit subject in the menu from', toggle, '| visible items:', opened);
      close(toggle);
      return false;
    }

    log('found Edit subject in menu opened by', toggle);

    // Checked here rather than per attempt, because the runaway case this
    // guards against is repeated *activation*. Attempts that never find the
    // item change nothing and must not count against the budget.
    if (rateLimited()) return false;
    simulateClick(item);

    const input = await waitFor(() => dom.findSubjectInput(), COMPOSE_BUILD_MS);
    if (input) {
      log('subject field is now editable');
      return true;
    }

    warnOnce(
      'activated the Edit subject item but no subject field appeared. ' +
        'Gmail may have changed its compose markup; re-run tools/recon.js.',
      item
    );
    return false;
  }

  async function reveal(root) {
    if (disabled) return false;

    let s = state.get(root);
    if (!s) {
      s = { attempts: 0, nextAt: 0, busy: false, done: false };
      state.set(root, s);
    }
    if (s.done || s.busy || Date.now() < s.nextAt) return false;

    if (!s.seen) {
      s.seen = true;
      log('compose seen', root);
    }

    if (dom.findSubjectInput(root)) {
      s.done = true;
      log('skipping: it already has a subject field', root);
      return false;
    }

    // Gmail's Edit subject rebuilds the compose. It carries the quoted thread
    // across, but anything the user has typed is theirs to lose, so we only
    // ever act on a compose they have not written in yet.
    //
    // Recognising Gmail's own content by class does not survive contact with
    // forwards: the forwarded message is dropped straight into the body and is
    // not necessarily tagged with the gmail_quote classes while it is still in
    // the editor. So the primary test is a baseline instead. Whatever is in
    // the body the first time we see the compose is Gmail's, because we see it
    // within a few hundred milliseconds of it opening. If nothing has changed
    // since then, the user has not written anything.
    const text = dom.bodyText(root);
    if (s.baseline === undefined) s.baseline = text;

    if (text !== s.baseline && !dom.isUntouched(root)) {
      s.done = true;
      log('skipping: the body has been edited since it opened', root);
      return false;
    }

    // Nothing to click yet. This costs an attempt only in the sense of time,
    // so let the compose finish expanding rather than burning the budget.
    const toggles = dom.findMenuToggles(root);
    if (toggles.length === 0) {
      s.nextAt = Date.now() + RETRY_MS;
      return false;
    }

    if (s.attempts >= MAX_ATTEMPTS) {
      s.done = true;
      warnOnce(
        `gave up after ${MAX_ATTEMPTS} attempts: opened every menu above the ` +
          'compose body and none contained an Edit subject item. Run ' +
          'tools/recon.js and check watch() against the caret.',
        root
      );
      return false;
    }

    s.busy = true;
    s.attempts += 1;
    try {
      log(
        `attempt ${s.attempts}: ${toggles.length} toggle(s) above the body`,
        toggles.map((t) => t.getAttribute('aria-label') || t.textContent.trim() || '(unlabelled)')
      );
      for (const toggle of toggles) {
        if (await revealVia(toggle, root)) {
          s.done = true;
          return true;
        }
        if (dom.findSubjectInput(root)) {
          s.done = true;
          return true;
        }
      }
      s.nextAt = Date.now() + RETRY_MS;
      return false;
    } finally {
      s.busy = false;
    }
  }

  function revealAll() {
    if (disabled) return;
    for (const root of dom.findComposes()) {
      reveal(root);
    }
  }

  NS.revealAll = revealAll;
})();
