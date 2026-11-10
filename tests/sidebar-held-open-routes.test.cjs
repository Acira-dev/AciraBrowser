'use strict';
// 13.5, Sidebar + address in Full: the ways to close the sidebar other than its button. main.cjs's OWN toggleSidebar (Ctrl/Cmd+Shift+E, Ctrl+S with "Ctrl+S toggles the sidebar" on, the
// "Toggle sidebar" command from the command bar and from the address list, all one registry command) is cut out of the source and run against a fake window state, so the test judges
// the real code. On 13.4 it closes the sidebar (and a menu with it), which is what was reported on 9 Nov 2026.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('../desktop/runtime.cjs');

const text = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const start = text.indexOf('const toggleSidebar=()=>'), end = text.indexOf('\n', start);
assert.ok(start > 0 && end > start, 'main.cjs still has toggleSidebar');

function run(settings, windowUi) {
  const calls = [];
  const active = { id: 'tab-1', contentKind: 'web' };
  const sandbox = {
    state: { settings, windowUi, tabs: [active], activeTabId: 'tab-1' }, active,
    effectiveView: runtime.effectiveView, workspaceIsOpen: runtime.workspaceIsOpen, sidebarHeldOpenIn: runtime.sidebarHeldOpenIn,
    closeOverlay: () => calls.push('closeOverlay'), dispatch: action => calls.push(action),
    edgePoller: { pin: (...args) => calls.push(['pin', args[1], args[2]]), pinned: () => false }, edgeItem: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(text.slice(start, end) + ';globalThis.__toggle=toggleSidebar;', sandbox);
  sandbox.__toggle();
  return JSON.parse(JSON.stringify(calls)); // plain objects of this realm (the vm makes its own)
}
const ui = (view, open) => ({ focusMode: view === 'focus', view, workspaceOpen: open, webWorkspaceOpen: open, split: null });
const address = { verticalTabs: true, addressInSidebar: true, windowView: 'full' };

test('the toggle does nothing in Sidebar + address in Full, Compact and Focus: no close, no menu dismissed', () => {
  for (const view of ['full', 'compact', 'focus']) assert.deepEqual(run({ ...address, windowView: view }, ui(view, true)), [], view);
});

test('where the sidebar can be toggled it still is', () => {
  const sidebar = { verticalTabs: true, addressInSidebar: false, windowView: 'full' };
  assert.deepEqual(run(sidebar, ui('full', true)), ['closeOverlay', { type: 'ui.update', patch: { workspaceOpen: false, webWorkspaceOpen: false } }]);
  assert.deepEqual(run(sidebar, ui('full', false)), ['closeOverlay', { type: 'ui.update', patch: { workspaceOpen: true, webWorkspaceOpen: true } }]);
  assert.deepEqual(run({ ...address, windowView: 'seamless' }, ui('seamless', false)), [['pin', 'side', true]], 'Seamless pins its edge sidebar, as before');
});

test('an installed web app\'s window (main marks it) is not held open: it shows no sidebar, so the toggle is not turned away there either', () => {
  const app = { ...ui('full', false), app: true };
  const calls = run(address, app);
  assert.deepEqual(calls.filter(call => call !== 'closeOverlay').map(call => call.patch && call.patch.workspaceOpen), [true], 'the command opens it as it did (nothing holds an app window\'s sidebar shut or open: the old behaviour)');
});

test('main: a window that takes another window\'s settings (applyShared writes state.settings without the reducer) opens its own sidebar when the layout became Sidebar + address; web app windows are marked', () => {
  const at = text.indexOf('applyShared(shared){'), end = text.indexOf('broadcast();queueSave();', at);
  assert.ok(at > 0 && end > at, 'applyShared is still there');
  const body = text.slice(at, end);
  assert.match(body, /for\(const key of sharedFields\)state\[key\]=/, 'it does assign the shared fields directly: that is why it needs the rule itself');
  assert.match(body, /state\.windowUi=withSidebarHeldOpen\(state\.settings,state\.windowUi\);state\.revision\+\+;/, 'and then holds the sidebar open, before the revision and the broadcast');
  assert.match(text, /if\(webApp\)state\.windowUi=\{\.\.\.state\.windowUi,app:true,focusMode:true,workspaceOpen:false,webWorkspaceOpen:false\};/, 'an installed app\'s window is marked and closed, and the marker is what exempts it');
  // no other writer of the windows' settings or sidebar flags outside the reducer (the two direct writes are a new private/Tor window, which starts from createInitialState: open)
  const writers = text.match(/state\.windowUi *= *\{[^;]{0,80}/g) || [];
  assert.equal(writers.length, 1, 'the one place main writes windowUi by hand is the web app window');
  assert.match(writers[0], /app:true/);
});
