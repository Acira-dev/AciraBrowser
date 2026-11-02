/** The key that calls off a tab drag's split drop while the tab is carried (R4-40): the zones, the island and what a release would do go away, nothing in the
 *  split changes. Kept apart from ui/splitDrop.ts (tests/split-escape.test.cjs keeps that file free of key handling). Bound once, for the life of the page. */
let bound = false;
export function onSplitDropCancelKey(callback: () => void) {
  if (bound || typeof window === 'undefined') return;
  bound = true; window.addEventListener('keydown', event => { if (event.key === 'Escape') callback(); }, true);
}
