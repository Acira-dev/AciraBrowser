'use strict';
// Back over a page that moved on by itself. A page that sends you on without a click or key press (a timer setting location.href, a
// meta refresh) leaves a history entry that Back would land on and be sent forward from again, so Back looks dead. Chromium marks
// such entries "skippable" and its own Back steps over them (navigationHistory.goBack); a redirect after a click is never skipped
// and a server redirect leaves no entry. When the page says it cannot go back although it has earlier entries, every one of them
// was skipped that way: Acira's own history then goes to the nearest earlier app page (the New Tab page the tab started on), never
// to the page that would send it straight back. With no such page there is nothing the person saw, and Back stays off, as in Chrome.

/** How many steps Back takes in the tab's own history: null when the page's own Back applies, 0 when there is nowhere to go. Pure. */
function stepsBackOverSkipped(history, index, pageCanGoBack, pageIndex) {
  if (pageCanGoBack || !(pageIndex > 0) || !Array.isArray(history)) return null;
  for (let at = Math.min(index, history.length) - 1; at >= 0; at -= 1) if (String(history[at]).startsWith('acira://')) return index - at;
  return 0;
}

module.exports = {stepsBackOverSkipped};
