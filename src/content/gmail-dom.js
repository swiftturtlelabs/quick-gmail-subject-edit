// Every Gmail selector used by this extension lives in this file. Gmail's class
// names are obfuscated and change without notice, so keeping them in one place
// means a UI change only ever requires editing here.
//
// Where a choice exists, prefer ARIA and Gmail's own functional attributes over
// class names. Recon showed the obfuscated-class selectors below are the first
// thing to break, so they are only ever used as fallbacks behind an
// attribute-based match.

window.GmailSubjectEditor = window.GmailSubjectEditor || {};

(() => {
  const NS = window.GmailSubjectEditor;

  // Present in every compose that has an editable subject. This name has been
  // stable for years and is the signal we use to decide whether a compose is
  // already in the state we want.
  const SUBJECT_INPUT = 'input[name="subjectbox"]';

  // The rich-text body of a compose. g_editable is Gmail's own attribute and
  // has outlived several redesigns; the role/contenteditable pair is the
  // standards-based backstop. This is our anchor for "a compose exists here",
  // because it is the one part of a compose that is always rendered.
  const COMPOSE_BODY =
    'div[g_editable="true"], div[contenteditable="true"][role="textbox"]';

  // Nearest-ancestor candidates for the compose a body or menu belongs to.
  // Ordered by nothing in particular; closest() resolves to whichever is
  // nearest.
  const COMPOSE_ROOT = 'form, div[role="dialog"], table.iN, div.iN, div.AD';

  // Gmail builds the response-type menu the first time its caret is clicked,
  // so the menu does not exist at page load and cannot be searched for up
  // front. We have to find the caret and open it. Every Gmail menu button
  // carries aria-haspopup, which is what makes this findable without classes.
  const MENU_TOGGLE =
    '[role="button"][aria-haspopup="true"], [role="button"][aria-haspopup="menu"]';

  const MENU_ITEM = 'div[role="menu"] [role="menuitem"]';

  // Text matching survives class-name churn but not localisation, so we fall
  // back to the positional selector InboxSDK uses for the same menu item.
  // Their :nth-last-child(2) works because "Edit subject" sits immediately
  // above "Pop out reply" at the bottom of the response-type menu.
  const EDIT_SUBJECT_LABEL = /^\s*edit subject\s*$/i;
  const EDIT_SUBJECT_POSITIONAL =
    'div.J-M.jQjAxd.HX[role="menu"] > div.SK.AX > [role="menuitem"]:nth-last-child(2)';

  function findSubjectInput(scope) {
    return (scope || document).querySelector(SUBJECT_INPUT);
  }

  function findComposeRoot(element) {
    return element.closest(COMPOSE_ROOT);
  }

  // Every compose on the page, anchored on the body rather than the menu
  // because the body is present from the moment the compose opens whereas the
  // menu is not. Deliberately unfiltered: the caller decides what to skip and
  // says why, so a compose we ignore is still visible in the log.
  function findComposes() {
    const roots = new Set();
    for (const body of document.querySelectorAll(COMPOSE_BODY)) {
      const root = findComposeRoot(body);
      if (root) roots.add(root);
    }
    return Array.from(roots);
  }

  // How far above the compose root to look for the caret, and how many of the
  // nearest candidates to try once found.
  const MAX_CLIMB = 6;
  const MAX_CANDIDATES = 3;

  // The recipient-line caret that opens the response-type menu.
  //
  // It is not inside the compose root. For an inline reply, closest() lands on
  // table.iN, which contains the body and the send toolbar but not the
  // recipient row, so every menu button in there is one of Attach files,
  // Insert photo, Insert files using Drive and friends. Activating those is
  // how you end up with file pickers instead of a subject field, so nothing
  // below the body is ever a candidate.
  //
  // Rather than naming the container the caret does live in, which would be
  // another obfuscated class waiting to change, climb until an ancestor holds
  // a menu button positioned above the body, then take the ones nearest to it.
  // Nearest matters: climb far enough and the buttons on the other messages in
  // the thread also qualify, and those are not what we want to be opening.
  function findMenuToggles(root) {
    const body = (root || document).querySelector(COMPOSE_BODY);
    if (!body) return [];

    let scope = root;
    for (let i = 0; scope && i < MAX_CLIMB; i += 1) {
      const above = Array.from(scope.querySelectorAll(MENU_TOGGLE)).filter(
        (toggle) =>
          body.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_PRECEDING
      );
      // querySelectorAll gives document order, so the last entries are the
      // ones closest to the body.
      if (above.length > 0) return above.reverse().slice(0, MAX_CANDIDATES);
      scope = scope.parentElement;
    }
    return [];
  }

  // Normalised so that reflow-driven whitespace churn does not read as an edit.
  function bodyText(root) {
    const body = root && root.querySelector(COMPOSE_BODY);
    return body ? body.textContent.replace(/\s+/g, ' ').trim() : null;
  }

  // Menus are sometimes reparented out of the compose, so this searches the
  // given scope first and falls back to the document.
  function findEditSubjectItem(scope) {
    const search = (where) => {
      const byLabel = Array.from(where.querySelectorAll(MENU_ITEM)).find((item) =>
        EDIT_SUBJECT_LABEL.test(item.textContent)
      );
      return byLabel || where.querySelector(EDIT_SUBJECT_POSITIONAL);
    };
    return (scope && search(scope)) || search(document);
  }

  // Second opinion on "has the user written anything", behind the baseline
  // comparison in reveal-subject.js. Quoted replies, forwarded messages and
  // signatures are all content Gmail put there, so strip them and see whether
  // anything is left. This does not catch a forward on its own, because Gmail
  // does not reliably tag forwarded content with these classes while it is
  // still in the editor; it exists to cover the case where we first see a
  // compose too late for the baseline to mean anything.
  //
  // textContent rather than innerText because the clone is detached, which
  // makes innerText fall back to textContent anyway but only after a layout.
  const GMAIL_OWN_CONTENT =
    '.gmail_quote, .gmail_quote_container, .gmail_extra, .gmail_signature, ' +
    '.gmail_attr, blockquote';

  function isUntouched(root) {
    const body = root && root.querySelector(COMPOSE_BODY);
    if (!body) return false;
    const clone = body.cloneNode(true);
    for (const block of clone.querySelectorAll(GMAIL_OWN_CONTENT)) block.remove();
    return clone.textContent.trim() === '';
  }

  NS.dom = {
    SUBJECT_INPUT,
    COMPOSE_BODY,
    COMPOSE_ROOT,
    MENU_TOGGLE,
    MENU_ITEM,
    EDIT_SUBJECT_LABEL,
    EDIT_SUBJECT_POSITIONAL,
    findSubjectInput,
    findComposeRoot,
    findComposes,
    findMenuToggles,
    findEditSubjectItem,
    isUntouched,
    bodyText,
  };
})();
