'use strict';
// 13.8 (Windows laptop): per-tab side panel options. A panel set with sidePanel.setOptions({tabId, path}) belongs to THAT tab (Chromium: the tab's SidePanelRegistry); the extension-wide options (no tabId, or the manifest's
// side_panel.default_path) are the window's one panel. createSidePanel (extension-apis.cjs) decides which: it tells the host `perTab` and each panel's tab, reads the options for each panel's own tab when they change (closes the ones
// turned off, shows a new path at once, leaves every other tab's alone), closes by tab or window, toggles the toolbar button for the front tab, and tells the extension onOpened once per panel. No Electron: a host shaped like the real one.
const test = require('node:test');
const assert = require('node:assert/strict');
const {createSidePanel} = require('../desktop/browser-services/extension-apis.cjs');

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const ev = () => ({extension: {id: ID, name: 'AI assistant', manifest: {manifest_version: 3, permissions: ['sidePanel']}}});
const settle = () => new Promise(resolve => setImmediate(resolve));
const url = path => `chrome-extension://${ID}/${path}`;

/** The real host's shape (extension-side-panel.cjs): entries by tabKey, list/find/open/close/navigate; main's glue turns `perTab` + the tab into the key. `front` = the key in front. */
function fakeHost() {
  const entries = new Map(), calls = {opened: [], closed: [], navigated: []};
  let front = null;
  const info = panel => ({extensionId: panel.extensionId, url: panel.url, tabKey: panel.tabKey, tabId: panel.tabId, shown: front === panel.tabKey || (front === null && panel.tabKey === 'window') || (panel.tabKey === 'window' && !entries.has(front))});
  return {
    calls, entries, setFront: key => { front = key; },
    open: async details => {
      const tabKey = details.perTab ? 'tab:' + details.tabId : 'window', existing = entries.get(tabKey);
      if (existing && existing.extensionId === details.extensionId) { if (existing.url !== details.url) { existing.url = details.url; calls.navigated.push([tabKey, details.url]); } return {windowId: 7, reused: true}; }
      calls.opened.push([tabKey, details.url, details.tabId]);
      entries.set(tabKey, {extensionId: details.extensionId, url: details.url, tabKey, tabId: details.tabId, onClosed: details.onClosed});
      front ??= tabKey;
      return {windowId: 7};
    },
    close: async ({extensionId, tabKey, all} = {}) => {
      for (const [key, panel] of [...entries]) if ((tabKey === undefined || key === tabKey) && (extensionId === undefined || panel.extensionId === extensionId) && (all || tabKey !== undefined || front === key || [...entries.keys()].length === 1)) {
        entries.delete(key); calls.closed.push(key); panel.onClosed?.({extensionId: panel.extensionId, url: panel.url}); if (!all) break;
      }
    },
    current: () => { for (const panel of entries.values()) if (info(panel).shown) return info(panel); return null; },
    list: () => [...entries.values()].map(info),
    navigate: ({url: to, tabKey}) => { const panel = entries.get(tabKey); if (panel) { panel.url = to; calls.navigated.push([tabKey, to]); } }
  };
}
const make = (extra = {}) => { const host = fakeHost(), events = []; return {host, events, panel: createSidePanel({getExtension: () => ({name: 'AI assistant', manifest: {}, ...extra}), host, emit: (...args) => events.push(args)})}; };
const assistantClick = async (p, tab) => { p.panel.setOptions(ev(), {tabId: tab, path: `sidepanel.html?tabId=${tab}`, enabled: true}); return p.panel.open(ev(), {tabId: tab}); };

test('The AI assistant extension\'s shape: each tab gets its own panel (perTab), opened once each, a press again on a tab changes nothing', async () => {
  const p = make();
  await assistantClick(p, 5); await assistantClick(p, 6); await assistantClick(p, 5); await assistantClick(p, 6);
  assert.deepEqual(p.host.calls.opened.map(c => [c[0], c[1]]), [['tab:5', url('sidepanel.html?tabId=5')], ['tab:6', url('sidepanel.html?tabId=6')]]);
  assert.deepEqual(p.host.calls.navigated, [], 'no panel was re-navigated to another tab\'s page');
  assert.deepEqual(p.events.map(e => e[1]), ['sidePanel.onOpened', 'sidePanel.onOpened'], 'one onOpened per panel');
  assert.deepEqual(p.events.map(e => e[2].tabId), [5, 6]);
});

test('setOptions for one tab leaves every other tab\'s panel alone: turned off it closes that tab\'s only, a new path shows in that tab\'s only', async () => {
  const p = make();
  await assistantClick(p, 5); await assistantClick(p, 6);
  p.panel.setOptions(ev(), {tabId: 6, path: 'other.html', enabled: true}); await settle();
  assert.deepEqual(p.host.calls.navigated, [['tab:6', url('other.html')]], 'tab 6 shows its new path');
  p.panel.setOptions(ev(), {tabId: 5, enabled: false}); await settle();
  assert.deepEqual(p.host.calls.closed, ['tab:5'], 'tab 5\'s panel closed');
  assert.ok(p.host.entries.has('tab:6'), 'tab 6\'s is open');
  p.panel.setOptions(ev(), {tabId: 9, path: 'x.html', enabled: false}); await settle();
  assert.deepEqual(p.host.calls.closed, ['tab:5'], 'a tab with no panel changes nothing');
});

test('extension-wide options are the window\'s panel: opened for a tab with none of its own it is the window\'s, a new global path shows there and in tabs with no options of their own, not in a tab that has its own', async () => {
  const p = make({manifest: {side_panel: {default_path: 'panel.html'}}});
  assert.equal(await p.panel.open(ev(), {tabId: 3}), undefined);
  assert.deepEqual(p.host.calls.opened.map(c => c[0]), ['window'], 'no options of its own: the window\'s panel');
  await assistantClick(p, 4);
  assert.deepEqual(p.host.calls.opened.map(c => c[0]), ['window', 'tab:4']);
  p.panel.setOptions(ev(), {path: 'new.html'}); await settle();
  assert.deepEqual(p.host.calls.navigated, [['window', url('new.html')]], 'the window\'s panel moved; tab 4\'s own did not');
  p.panel.setOptions(ev(), {enabled: false}); await settle();
  assert.deepEqual(p.host.calls.closed, ['window'], 'turned off for the window: its panel closes, tab 4\'s own stays');
  assert.ok(p.host.entries.has('tab:4'));
});

test('close({tabId}) closes that tab\'s panel; with no tab the one in front; nothing open is an error', async () => {
  const p = make();
  await assistantClick(p, 5); await assistantClick(p, 6);
  assert.equal(await p.panel.close(ev(), {tabId: 6}), undefined);
  assert.deepEqual(p.host.calls.closed, ['tab:6']);
  p.host.setFront('tab:5');
  assert.equal(await p.panel.close(ev(), {windowId: 1}), undefined);
  assert.deepEqual(p.host.calls.closed, ['tab:6', 'tab:5']);
  const none = await p.panel.close(ev(), {tabId: 5});
  assert.ok(none && none.__acira_error || none instanceof Error || none?.error || typeof none === 'object', 'closing with nothing open is refused');
});

test('the toolbar button with openPanelOnActionClick toggles the FRONT tab\'s panel: press opens, press closes, another tab has its own', async () => {
  const p = make({manifest: {side_panel: {default_path: 'panel.html'}}});
  p.panel.setPanelBehavior(ev(), {openPanelOnActionClick: true});
  p.panel.setOptions(ev(), {tabId: 5, path: 'tab5.html', enabled: true});
  assert.equal(p.panel.actionClick(ID, {tabId: 5}), true); await settle();
  assert.deepEqual(p.host.calls.opened.map(c => c[0]), ['tab:5']);
  assert.equal(p.panel.actionClick(ID, {tabId: 5}), true); await settle();
  assert.deepEqual(p.host.calls.closed, ['tab:5'], 'the second press closes it');
  assert.equal(p.panel.actionClick(ID, {tabId: 8}), true); await settle();
  assert.deepEqual(p.host.calls.opened.map(c => c[0]), ['tab:5', 'window'], 'tab 8 has no options of its own: the window\'s panel');
});

test('a host that cannot list (the older shape) still works: the tab is the one remembered at open', async () => {
  const entries = {open: 0, closed: 0}; let current = null;
  const host = {open: async d => { entries.open++; current = {extensionId: d.extensionId, url: d.url}; return {windowId: 1}; }, close: async () => { entries.closed++; current = null; }, current: () => current, navigate: () => {}};
  const panel = createSidePanel({getExtension: () => ({name: 'AI assistant', manifest: {}}), host, emit: () => {}});
  panel.setOptions(ev(), {tabId: 5, path: 'p.html', enabled: true}); await panel.open(ev(), {tabId: 5});
  panel.setOptions(ev(), {tabId: 5, path: 'p.html', enabled: true}); await settle();
  assert.equal(entries.closed, 0, 'the panel\'s own tab is read for it');
  panel.setOptions(ev(), {tabId: 6, path: 'q.html', enabled: false}); await settle();
  assert.equal(entries.closed, 0, 'another tab\'s options leave it alone');
});
