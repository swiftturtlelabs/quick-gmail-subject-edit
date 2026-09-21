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

  const handled = new WeakSet();
  let recent = [];
  let disabled = false;
  let warned = false;

  function log(...args) {
    console.debug(LOG_PREFIX, ...args);
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
      close(toggle);
      return false;
    }

    log('found Edit subject in menu opened by', toggle);
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
    if (disabled || handled.has(root)) return false;
    if (dom.findSubjectInput(root)) return false;

    // Gmail's Edit subject discards the reply and rebuilds it as a compose.
    // InboxSDK reimplements the whole action specifically to carry the body
    // across, which tells us the native path does not always preserve it.
    // Firing only on an untouched reply keeps that risk off the table, and
    // matches the goal of revealing the subject as the reply opens.
    if (!dom.isEmpty(root)) return false;

    const toggles = dom.findMenuToggles(root);
    if (toggles.length === 0) {
      warnOnce('no menu toggles found in this compose; cannot open the menu.', root);
      return false;
    }

    handled.add(root);
    if (rateLimited()) return false;

    log(`trying ${toggles.length} menu toggle(s) in`, root);
    for (const toggle of toggles) {
      if (await revealVia(toggle, root)) return true;
      if (dom.findSubjectInput(root)) return true;
    }

    warnOnce(
      'opened every menu in the compose and none contained an Edit subject ' +
        'item. Run tools/recon.js and check watch() against the caret.',
      root
    );
    return false;
  }

  function revealAll() {
    if (disabled) return;
    for (const root of dom.findReplyComposes()) {
      reveal(root);
    }
  }

  NS.revealAll = revealAll;
})();
