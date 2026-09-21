// Gmail is a single-page app, so composes appear long after load and the
// document is mutated constantly. We debounce aggressively and keep the scan
// itself cheap rather than trying to filter mutation records precisely.

(() => {
  const NS = window.GmailSubjectEditor;

  const DEBOUNCE_MS = 150;
  let timer = null;

  function scan() {
    timer = null;
    NS.revealAll();
  }

  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(scan, DEBOUNCE_MS);
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  schedule();
})();
