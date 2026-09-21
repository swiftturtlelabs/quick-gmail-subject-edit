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

  // Composes that have no subject field, i.e. replies and forwards. Anchored
  // on the body rather than the menu, because the body is present from the
  // moment the compose opens whereas the menu is not.
  function findReplyComposes() {
    const roots = new Set();
    for (const body of document.querySelectorAll(COMPOSE_BODY)) {
      const root = findComposeRoot(body);
      if (root && !findSubjectInput(root)) roots.add(root);
    }
    return Array.from(roots);
  }

  // Only the toggles above the body, which is where the recipient-line caret
  // lives. Everything below the body is the send/formatting toolbar, and
  // opening those menus just makes menus flash on screen and then reports a
  // false "no Edit subject anywhere" once the real caret has not rendered yet.
  function findMenuToggles(root) {
    const scope = root || document;
    const all = Array.from(scope.querySelectorAll(MENU_TOGGLE));
    const body = scope.querySelector(COMPOSE_BODY);
    if (!body) return all;
    return all.filter(
      (toggle) =>
        body.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_PRECEDING
    );
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

  // Quoted replies, forwarded messages and signatures are all content Gmail
  // put there, not the user. A forward in particular arrives with its whole
  // body pre-filled, so testing the body verbatim would class every forward as
  // already written-in and skip it. Strip Gmail's own blocks and see whether
  // anything the user typed is left.
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
    findReplyComposes,
    findMenuToggles,
    findEditSubjectItem,
    isUntouched,
  };
})();
