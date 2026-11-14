'use strict';
// 13.8 (Windows laptop): a SECOND press of an AI assistant extension's toolbar button did not close its side panel. In Chromium it does not either: the extension never calls setPanelBehavior, its toolbar click is
// action.onClicked -> sidePanel.setOptions({tabId, path, enabled: true}) + sidePanel.open({tabId}), and open() on a panel that is already showing does nothing (SidePanelCoordinator::Show: "If the side panel is
// already showing, cancel all loads and do nothing"). The extension closes its panel with Ctrl/Cmd+E: the worker finds the panel with runtime.getContexts, messages it, and the page calls window.close().
// What Acira did instead: the click closed the panel and opened a NEW one (the page reloaded, onClosed + onOpened every press), and the shortcut could not reach the panel it meant to close.
// Cause: setOptions asked the open panel which TAB it belongs to (`now.tabId`), but the host never says (current() has no tabId), so the options were read without a tab: an extension that only has
// per-tab options (no manifest side_panel, no global path) looked like "no panel available" and setOptions CLOSED the panel it was about to be used for. No Electron: the host is a fake shaped like the real one.
const test = require('node:test');
const assert = require('node:assert/strict');
const {createSidePanel} = require('../desktop/browser-services/extension-apis.cjs');

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const ev = (id = ID) => ({extension: {id, name: 'AI assistant', manifest: {manifest_version: 3, permissions: ['sidePanel']}}});
const settle = () => new Promise(resolve => setImmediate(resolve));
const url = (path, id = ID) => `chrome-extension://${id}/${path}`;

/** The real host's shape (desktop/browser-services/extension-side-panel.cjs): current() = {extensionId, url, webContents}, open() answers {opened} or {reused}; main's glue adds windowId. */
function fakeHost() {
  let current = null, closedFns = [];
  const calls = {opened: 0, reused: 0, closed: 0, navigated: []};
  return {
    calls,
    open: async details => {
      if (current && current.extensionId === details.extensionId) { calls.reused++; if (current.url !== details.url) { current.url = details.url; calls.navigated.push(details.url); } return {windowId: 7, reused: true}; }
      calls.opened++; current = {extensionId: details.extensionId, url: details.url}; closedFns = [details.onClosed]; return {windowId: 7};
    },
    close: async () => { if (!current) return; const fns = closedFns; const was = current; current = null; closedFns = []; calls.closed++; for (const fn of fns) fn?.({extensionId: was.extensionId, url: was.url}); },
    current: () => current ? {...current, windowId: 7} : null,           // no tabId: the real host does not keep one
    navigate: ({url: to}) => { if (current) { current.url = to; calls.navigated.push(to); } },
    peek: () => current
  };
}

test('The AI assistant extension\'s shape (per-tab options only, no manifest path): the next setOptions for the open panel\'s tab leaves it open; a second press is a no-op: no close, no new panel, no new onOpened', async () => {
  const host = fakeHost(), events = [];
  const panel = createSidePanel({getExtension: () => ({name: 'AI assistant', manifest: {}}), host, emit: (...args) => events.push(args)});
  const e = ev(), tabOptions = {tabId: 5, path: 'sidepanel.html?tabId=5', enabled: true};
  // the toolbar click, as the extension's worker runs it
  panel.setOptions(e, tabOptions);
  assert.equal(await panel.open(e, {tabId: 5}), undefined);
  assert.equal(host.calls.opened, 1);
  assert.deepEqual(events.map(item => item[1]), ['sidePanel.onOpened']);
  for (let press = 2; press <= 4; press++) {
    panel.setOptions(e, tabOptions);                                        // the extension sets the options again on every click
    await settle();
    assert.ok(host.peek(), `press ${press}: setOptions did not close the open panel`);
    assert.equal(await panel.open(e, {tabId: 5}), undefined);
    assert.equal(host.calls.closed, 0, `press ${press}: nothing was closed`);
    assert.equal(host.calls.opened, 1, `press ${press}: no second panel`);
  }
  assert.deepEqual(events.map(item => item[1]), ['sidePanel.onOpened'], 'onOpened is told once, onClosed not at all (Chromium: on_opened_dispatched_)');
  assert.deepEqual(host.calls.navigated, [], 'the page is not reloaded');
});

test('and the shortcut can close it: the worker\'s getContexts finds the panel, setOptions leaves it alone, the page then closes itself (the panel host hears it as a close)', async () => {
  const host = fakeHost(), events = [];
  const panel = createSidePanel({getExtension: () => ({name: 'AI assistant', manifest: {}}), host, emit: (...args) => events.push(args)});
  const e = ev(), tabOptions = {tabId: 5, path: 'sidepanel.html?tabId=5', enabled: true};
  panel.setOptions(e, tabOptions); await panel.open(e, {tabId: 5});
  // Ctrl/Cmd+E, in the extension's order: getContexts (the panel is there), setOptions, open (no-op), then the message reaches the SAME panel
  const before = host.peek();
  panel.setOptions(e, tabOptions); await panel.open(e, {tabId: 5}); await settle();
  assert.equal(host.peek(), before, 'the panel the worker found is still the one that gets the message');
  await host.close();                                                       // the page's window.close(): the host closes and tells onClosed
  assert.deepEqual(events.map(item => item[1]), ['sidePanel.onOpened', 'sidePanel.onClosed']);
  // the next press opens a panel again
  panel.setOptions(e, tabOptions); await panel.open(e, {tabId: 5});
  assert.equal(host.calls.opened, 2);
});

test('options of ANOTHER tab, or the panel\'s tab disabled / re-pathed, are read for the tab the panel was opened for', async () => {
  const host = fakeHost(), events = [];
  const panel = createSidePanel({getExtension: () => ({name: 'Test', manifest: {side_panel: {default_path: 'panel.html'}}}), host, emit: (...args) => events.push(args)});
  const e = ev();
  panel.setOptions(e, {tabId: 5, path: 'a.html', enabled: true}); await panel.open(e, {tabId: 5});
  assert.equal(host.peek().url, url('a.html'));
  panel.setOptions(e, {tabId: 6, path: 'b.html', enabled: true});           // another tab's options: this panel is not touched
  panel.setOptions(e, {tabId: 6, enabled: false}); await settle();
  assert.ok(host.peek(), 'another tab turned off: this panel stays');
  assert.equal(host.peek().url, url('a.html'), 'and is not sent to the global page');
  panel.setOptions(e, {tabId: 5, path: 'a2.html'}); await settle();
  assert.equal(host.peek().url, url('a2.html'), 'its own tab\'s new path shows at once, not the extension-wide page (panel.html)');
  panel.setOptions(e, {tabId: 5, enabled: false}); await settle();        // the classic way to close a side panel: turn it off for its tab
  assert.equal(host.peek(), null, 'turned off for its own tab: closed');
  assert.deepEqual(events.map(item => item[1]), ['sidePanel.onOpened', 'sidePanel.onClosed']);
});

test('a panel opened by window (no tab) and the extension-wide options behave as before; a late onClosed of a replaced panel does not forget the new one\'s tab', async () => {
  const host = fakeHost();
  const panel = createSidePanel({getExtension: () => ({name: 'Test', manifest: {side_panel: {default_path: 'panel.html'}}}), host, emit() {}});
  const e = ev();
  await panel.open(e, {windowId: 7});
  panel.setOptions(e, {path: 'other.html'}); await settle();
  assert.equal(host.peek().url, url('other.html'), 'a new extension-wide path shows at once');
  panel.setOptions(e, {enabled: false}); await settle();
  assert.equal(host.peek(), null, 'turning the panel off everywhere closes it');
  // tab 5's panel closes slowly (its onClosed arrives after tab 6's panel is open); tab 6's options must still apply
  const lateClosed = [];
  const slow = {
    ...fakeHost(),
    open: async details => { lateClosed.push(details.onClosed); return {windowId: 7}; },
    close: async () => {}, current: () => ({extensionId: ID, url: url('p.html'), windowId: 7}), navigate() {}
  };
  const second = createSidePanel({getExtension: () => ({name: 'Test', manifest: {}}), host: slow, emit() {}});
  second.setOptions(e, {tabId: 5, path: 'p.html', enabled: true}); await second.open(e, {tabId: 5});
  second.setOptions(e, {tabId: 6, path: 'p.html', enabled: true}); await second.open(e, {tabId: 6});
  lateClosed[0]({extensionId: ID, url: url('p.html')});                       // the first panel's onClosed, late
  const closedBefore = [];
  slow.close = async () => { closedBefore.push('closed'); };
  second.setOptions(e, {tabId: 6, enabled: false}); await settle();
  assert.deepEqual(closedBefore, ['closed'], 'tab 6\'s panel is still known as tab 6\'s: turning tab 6 off closes it');
});
