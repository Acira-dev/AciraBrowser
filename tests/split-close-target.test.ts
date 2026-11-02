import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import type { BrowserSnapshot } from '../src/runtime/types';

/** Founder bug (27 Oct): after Peek › Open in split view, closing the new pane closed "the other one". Closing or removing a pane
 *  always acts on that pane, and the page left on screen is the split's other pane — never a tab picked by tab order. */
function split(panes = 2) {
  let s = createInitialState(); const original = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.navigate', tabId: original, url: 'https://original.test/' });
  // A tab to the right of where the new pane lands: the tab-order fallback would pick it.
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://neighbour.test/', background: true, afterId: original });
  const neighbour = s.tabs.at(-1)!.id;
  // Peek promotes into a background tab right after its source, then splits them.
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://peeked.test/', background: true, afterId: original });
  const peeked = s.tabs.find(tab => tab.url === 'https://peeked.test/')!.id;
  s = reduceBrowser(s, { type: 'split.open', tabIds: [original, peeked] });
  let third: string | undefined;
  if (panes === 3) { s = reduceBrowser(s, { type: 'tab.new', url: 'https://third.test/', background: true }); third = s.tabs.at(-1)!.id; s = reduceBrowser(s, { type: 'split.add', tabId: third }); }
  assert.deepEqual(s.tabs.map(tab => tab.id).slice(0, 3), [original, peeked, neighbour], 'order: original, peeked, neighbour');
  return { s, original, peeked, neighbour, third };
}
const shown = (s: BrowserSnapshot) => s.windowUi.split ? s.windowUi.split.tabIds : [s.activeTabId];

test('closing the active pane of a two-pane split closes that tab and shows the other pane (not the next tab in the strip)', () => {
  const { s: start, original, peeked, neighbour } = split();
  const s = reduceBrowser(reduceBrowser(start, { type: 'tab.select', id: peeked }), { type: 'tab.close', id: peeked });
  assert.equal(s.tabs.some(tab => tab.id === peeked), false, 'the peeked tab is the one closed');
  assert.ok(s.tabs.some(tab => tab.id === original) && s.tabs.some(tab => tab.id === neighbour), 'the others stay open');
  assert.equal(s.activeTabId, original, 'the original page is shown');
  assert.equal(s.windowUi.split, null, 'the split ends cleanly back to one page');
  assert.deepEqual(shown(s), [original]);
});

test('the reverse: closing the original (active) pane leaves the peeked page', () => {
  const { s: start, original, peeked } = split();
  const s = reduceBrowser(start, { type: 'tab.close', id: original });
  assert.equal(s.tabs.some(tab => tab.id === original), false);
  assert.equal(s.activeTabId, peeked);
  assert.equal(s.windowUi.split, null);
});

test('closing the pane that is not active closes only it and keeps the active page', () => {
  const { s: start, original, peeked } = split();
  const s = reduceBrowser(start, { type: 'tab.close', id: peeked });
  assert.equal(s.tabs.some(tab => tab.id === peeked), false);
  assert.equal(s.activeTabId, original);
  assert.equal(s.windowUi.split, null);
});

test('closing the active pane of a three-pane split keeps the other two panes split', () => {
  const { s: start, original, peeked, third } = split(3);
  const s = reduceBrowser(reduceBrowser(start, { type: 'tab.select', id: peeked }), { type: 'tab.close', id: peeked });
  assert.deepEqual(s.windowUi.split?.tabIds, [original, third], 'the rest re-tile');
  assert.ok([original, third].includes(s.activeTabId));
});

test('a pane\'s × on the active pane of a two-pane split leaves the other pane on screen', () => {
  const { s: start, original, peeked } = split();
  // Pressing the × first selects its pane (the pane's pointerdown); the × then removes that pane.
  const s = reduceBrowser(reduceBrowser(start, { type: 'tab.select', id: peeked }), { type: 'split.remove', tabId: peeked });
  assert.equal(s.windowUi.split, null);
  assert.equal(s.activeTabId, original, 'the page left on screen is the other pane, not the one whose × was pressed');
  assert.equal(s.tabs.length, start.tabs.length, 'Remove from split view keeps every tab open');
  const back = reduceBrowser(start, { type: 'split.remove', tabId: original });
  assert.equal(back.activeTabId, peeked, 'and the reverse');
});

test('closing a tab that is not in the split keeps the split and the active pane', () => {
  const { s: start, original, peeked, neighbour } = split();
  const s = reduceBrowser(start, { type: 'tab.close', id: neighbour });
  assert.deepEqual(s.windowUi.split?.tabIds, [original, peeked]);
  assert.equal(s.activeTabId, original);
});

test('a tab without a split still falls back to its opener, then its neighbour', () => {
  let s = createInitialState(); const first = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://b.test/' }); const b = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://c.test/', afterId: first }); const c = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.close', id: c });
  assert.equal(s.activeTabId, first, 'opener');
  s = reduceBrowser(reduceBrowser(s, { type: 'tab.select', id: first }), { type: 'tab.close', id: first });
  assert.equal(s.activeTabId, b);
});
