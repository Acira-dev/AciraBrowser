'use strict';
// A tab's list is one row of website pages and Acira pages (New Tab, Settings, History...). The website view only ever holds the website pages of
// ONE stretch between Acira pages (a "segment"): nativeHistory() in src/runtime/core.ts replaces just that stretch of the row with the view's own list.
// Restoring every website page of the whole row into the view (what loadPage did on a tab's first load) put the earlier stretches in the view's list
// too, so the merge added them to the row a second time, and once more on every restart: [A, New tab, B] came back as [A, New tab, A, B].

const web = url => /^https?:\/\//i.test(String(url));

/** The website pages of the stretch the entry at `index` is in, as the view's entries, and where in them it is. index -1 when that entry is not a website page. Pure. */
function currentSegment(history, index) {
  if (!Array.isArray(history) || !Number.isInteger(index) || index < 0 || index >= history.length || !web(history[index])) return {entries: [], index: -1};
  let from = index, to = index + 1;
  while (from > 0 && web(history[from - 1])) from -= 1;
  while (to < history.length && web(history[to])) to += 1;
  return {entries: history.slice(from, to).map(url => ({url, title: ''})), index: index - from};
}

module.exports = {currentSegment};
