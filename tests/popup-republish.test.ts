import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPopupTransition } from '../src/ui/popupTransition';
import { overlayTiedToTab, nextOverlayId } from '../src/ui/interactionPolicy';

// 13.4: a popup that is requested while its kind is already open (a second right-click on a page while its menu is up) used to wedge the interface. The request mints the
// popup's new id, but that id reaches main only in the layout the next render sends, and a render happens only when something it reads changed. With the kind unchanged nothing
// changed: the new id was never sent, main's later dismissal of the old id no longer matched the interface's id, and the popup state stayed open for good (no later right-click
// on that page opened anything). This stand-in has React's one relevant rule: updates collected in one tick are one render, and a render needs a changed value.
function interfaceStandIn() {
  let state: string | null = null, rendered: string | null = null, serial = 0, renderedSerial = 0, current: number | undefined, sent: number | undefined, renders = 0;
  const published: Array<number | undefined> = [];
  const transition = createPopupTransition(kind => { state = kind; }, () => { serial += 1; });
  return {
    transition,
    /** What `open()` does in a commit: a new id for the popup that is being requested. */
    mint: () => { current = nextOverlayId(); },
    /** The interface's id is dropped with the kind (releaseOverlayId, once a render saw no kind). */
    release: () => { if (rendered === null) current = undefined; },
    /** One tick's worth of updates become one render; the layout effect then sends the popup that is open, with its id. */
    flush: () => { if (state !== rendered || serial !== renderedSerial) { rendered = state; renderedSerial = serial; renders += 1; sent = rendered !== null ? current : undefined; published.push(sent); } },
    get current() { return current; },
    get sent() { return sent; },
    get state() { return state; },
    get renders() { return renders; },
    published,
  };
}

test('a popup requested while its kind is open is sent to main with its new id (a second right-click while a page menu is up)', () => {
  const ui = interfaceStandIn();
  ui.transition.request('page-context', ui.mint, true); ui.flush();
  const first = ui.current;
  assert.equal(ui.sent, first, 'the first menu is sent with its id');
  ui.transition.request('page-context', ui.mint, true); ui.flush();
  assert.notEqual(ui.current, first, 'the second request has an id of its own');
  assert.equal(ui.sent, ui.current, 'and main is sent that id, so a dismissal of it matches');
  assert.equal(ui.state, 'page-context');
});

test('main\'s dismissal of the old menu and the next right-click landing in one tick still send the new menu', () => {
  const ui = interfaceStandIn();
  ui.transition.request('page-context', ui.mint, true); ui.flush();
  const old = ui.current;
  // overlay-dismissed (old id): the interface closes its state; page-context (new menu): it opens again, before a render ran in between
  assert.equal(old !== undefined, true);
  ui.transition.set(null);
  ui.transition.request('page-context', ui.mint, true);
  ui.flush();
  assert.equal(ui.state, 'page-context');
  assert.notEqual(ui.current, old);
  assert.equal(ui.sent, ui.current, 'the new menu was sent: without a render it would stay unsent and the state wedged on a menu main never heard of');
});

test('every request that commits renders, every other change is as before', () => {
  const ui = interfaceStandIn();
  ui.transition.request('menu', ui.mint, false); ui.flush();
  assert.equal(ui.renders, 1);
  ui.transition.request('menu', ui.mint, false); ui.flush();
  assert.equal(ui.state, null, 'asking for the open kind without an id toggles it shut');
  assert.equal(ui.renders, 2);
  ui.transition.request('tab-context', ui.mint, true); ui.flush();
  ui.transition.request('bookmark-context', ui.mint, true); ui.flush();
  assert.equal(ui.state, 'bookmark-context', 'another kind replaces the open one');
  assert.equal(ui.sent, ui.current);
  const before = ui.renders;
  ui.transition.set(null); ui.flush();
  assert.equal(ui.renders, before + 1);
  assert.equal(ui.sent, undefined, 'closed: nothing is sent');
});

test('App passes the transition its republish and the layout effect that sends popups depends on it', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /createPopupTransition\(publishOverlay, \(\) => setPopupSerial\(count => count \+ 1\)\)/);
  assert.match(app, /native, overlay, popupSerial, contextId, address, addressAnchor/, 'the effect that builds the popup layout re-runs for every request');
});

test('a page menu goes when its tab is gone from the window, like the other menus that belong to one tab', () => {
  for (const kind of ['page-context', 'tab-context', 'group-context', 'group-preview', 'split-context']) assert.equal(overlayTiedToTab(kind), true, kind);
  for (const kind of ['menu', 'bookmarks', 'downloads', 'tabs', 'suggestions', 'zoom', 'toast', null]) assert.equal(overlayTiedToTab(kind), false, String(kind));
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /useLayoutEffect\(\(\) => \{ if \(!overlayTiedToTab\(overlay\)\)\s*return; const owner = state\.tabs\.find\(item => item\.id === contextId\);/);
});

test('losing the window\'s focus, a resize or a move closes a page menu as it does every menu', () => {
  const { closesOnWindowChange } = createRequire(import.meta.url)('../desktop/native-policy.cjs');
  assert.equal(closesOnWindowChange({ id: 7, kind: 'page-context' }), true);
  assert.equal(closesOnWindowChange({ id: 7, kind: 'toast' }), false);
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /for\(const event of \['blur','minimize','hide'\]\)mainWindow\.on\(event,\(\)=>\{[^}]*if\(!dialogDepth&&closesOnWindowChange\(layout\.overlay\)\)closeOverlay\(false\);\}\)/);
});
