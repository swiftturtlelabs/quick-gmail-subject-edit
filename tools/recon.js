// Phase 0 recon. Paste into the DevTools console on a Gmail tab with a reply
// open, before trusting anything the extension does. Everything at load time
// only reads the DOM; the probes mutate and are called explicitly.
//
// What we need this to answer:
//   1. Is the "Edit subject" item in the DOM while its menu is closed?
//   2. Does the text match find it, and does the positional selector agree?
//   3. Does a plain .click() activate it at all?
//   4. Does the full mouse sequence activate it when .click() does not?
//   5. When it does activate, does the inline reply survive, or is it torn
//      down and replaced by a separate compose? That decides whether driving
//      this menu item can ever deliver an editable subject *in place*.
//
// Run probeClick() first. Only if it reports nothing happened, reload the
// thread and run probeSequence(). Each probe is one-shot and destructive.

(() => {
  const SUBJECT_INPUT = 'input[name="subjectbox"]';
  const MENU_ITEM = 'div[role="menu"] [role="menuitem"]';
  const POSITIONAL =
    'div.J-M.jQjAxd.HX[role="menu"] > div.SK.AX > [role="menuitem"]:nth-last-child(2)';
  const COMPOSE_ROOT = 'form, div[role="dialog"], table.iN, div.iN, div.AD';
  const BODY = 'div[g_editable="true"], div[contenteditable="true"][role="textbox"]';

  const byLabel = Array.from(document.querySelectorAll(MENU_ITEM)).filter((el) =>
    /^\s*edit subject\s*$/i.test(el.textContent)
  );
  const byPosition = Array.from(document.querySelectorAll(POSITIONAL));

  console.log('subject inputs already present:', document.querySelectorAll(SUBJECT_INPUT).length);
  console.log('menu items in document:', document.querySelectorAll(MENU_ITEM).length);
  console.log('matched by label:', byLabel.length, byLabel);
  console.log('matched by position:', byPosition.length, byPosition);
  console.log(
    'label and position agree:',
    byLabel.length === byPosition.length && byLabel.every((el, i) => el === byPosition[i])
  );

  byLabel.forEach((item, i) => {
    const root = item.closest(COMPOSE_ROOT);
    console.log(`item ${i}: compose root =`, root, '| root tag =', root && root.tagName);
  });

  // The menu holding the item is normally closed. If Gmail only services an
  // item while its menu is open, no amount of event synthesis on the item
  // alone will work, so record the state we activated it from.
  const target = byLabel[0] || byPosition[0];
  if (target) {
    const menu = target.closest('div[role="menu"]');
    console.log(
      'menu is currently visible:',
      !!(menu && menu.offsetParent !== null),
      '| aria-expanded on menu:',
      menu && menu.getAttribute('aria-expanded')
    );
  }

  // InboxSDK's sequence, which is the only one known to drive Gmail menu
  // items reliably. Note that Gmail acts on mouseup, not click.
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

  function snapshot(root) {
    const body = root && root.querySelector(BODY);
    return {
      subjects: document.querySelectorAll(SUBJECT_INPUT).length,
      dialogs: document.querySelectorAll('div[role="dialog"]').length,
      composeRootStillAttached: !!(root && root.isConnected),
      bodyText: body ? body.innerText.trim() : null,
    };
  }

  async function probe(activate, label) {
    if (!target) return console.warn('nothing to activate');
    const root = target.closest(COMPOSE_ROOT);

    // Type something first so we can tell whether activation preserves the
    // draft or silently discards it. Content loss is the difference between
    // a feature and a bug report.
    const body = root && root.querySelector(BODY);
    if (body && !body.innerText.trim()) {
      console.log('tip: type something into the reply first to test content preservation');
    }

    const before = snapshot(root);
    activate(target);
    await new Promise((r) => setTimeout(r, 800));
    const after = snapshot(root);

    console.log(`--- ${label} ---`);
    console.log('before:', before);
    console.log('after:', after);
    console.log('a subject field appeared:', after.subjects > before.subjects);
    console.log('reply popped out into a new window:', after.dialogs > before.dialogs);
    console.log(
      'original inline reply was torn down:',
      before.composeRootStillAttached && !after.composeRootStillAttached
    );
    console.log(
      'draft body survived:',
      before.bodyText === null ? 'unknown' : before.bodyText === after.bodyText
    );
  }

  window.probeClick = () => probe((el) => el.click(), 'plain .click()');
  window.probeSequence = () => probe(simulateClick, 'full mouse sequence');

  // Reports the moment an "Edit subject" item enters or leaves the DOM. Run
  // this, then click the caret next to the recipient. If the item only shows
  // up at that click, the menu is built on demand and nothing can find it
  // beforehand, which is the case the extension is currently built around.
  window.watch = () => {
    let last = -1;
    const tick = () => {
      const n = Array.from(document.querySelectorAll(MENU_ITEM)).filter((el) =>
        /^\s*edit subject\s*$/i.test(el.textContent)
      ).length;
      if (n !== last) {
        console.log(`edit-subject items in DOM: ${last} -> ${n}`, new Date().toLocaleTimeString());
        last = n;
      }
    };
    tick();
    new MutationObserver(tick).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    console.log('watching. now click the caret next to the recipient.');
  };

  console.log('run watch(), then open the reply caret. probeClick()/probeSequence() are destructive.');
})();
