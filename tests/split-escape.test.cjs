// Escape must only dismiss transient surfaces / stop a load; it must never exit, reset or dissolve a split view.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { resolveDefaultShortcut } = require('../desktop/shortcuts.cjs');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const key = (k, extra = {}) => ({ type: 'keyDown', key: k, code: k, control: false, shift: false, alt: false, meta: false, ...extra });

test('Escape (any platform) resolves to the plain escape command, never a split command', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.deepEqual(resolveDefaultShortcut(key('Escape'), platform), { action: 'escape' });
  }
});

test('no default shortcut for a modified Escape maps to a split action', () => {
  for (const mods of [{ control: true }, { shift: true }, { alt: true }, { control: true, shift: true }]) {
    const command = resolveDefaultShortcut(key('Escape', mods), 'win32');
    assert.ok(!command || !/^split/.test(command.action), `Escape with ${JSON.stringify(mods)} -> ${command?.action}`);
  }
});

test('native escape handler (split active, nothing open, or picker/popup open) never dispatches split actions', () => {
  const main = read('desktop/main.cjs');
  const start = main.indexOf("case 'escape':{");
  assert.ok(start > 0, 'escape case present');
  const body = main.slice(start, main.indexOf('break;}', main.indexOf('emitBrowser', start)) + 7);
  assert.ok(body.includes('closeOverlay('), 'Escape closes the transient overlay (picker, menu, popup)');
  assert.ok(body.includes('stop()'), 'Escape stops a loading page');
  assert.ok(!/split|dispatch\(/i.test(body), 'escape case must not dispatch or touch split');
});

test('a page inside a split pane still receives Escape natively when no chrome overlay is open', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /if\(owner&&origin==='key'&&command\.action==='escape'&&!layout\.overlay\)return;/);
});

test('renderer escape callback only closes popovers/popups/peek/find/address focus or stops loading', () => {
  const app = read('src/App.tsx');
  const start = app.indexOf('escapeRef.current = () => {');
  const end = app.indexOf('const popupAnchorRef', start);
  assert.ok(start > 0 && end > start);
  const body = app.slice(start, end);
  assert.ok(!/split|dispatch\(/i.test(body), 'escape callback must not dispatch or touch split state');
});

test('split picker and split engine code has no Escape handling that changes the split', () => {
  for (const file of ['src/ui/splitDrop.ts', 'src/components/SplitPicker.tsx', 'src/runtime/splitLayout.ts', 'src/runtime/splitGroups.ts', 'src/runtime/core.ts']) {
    assert.ok(!/Escape|'escape'/.test(read(file)), `${file} must not bind Escape`);
  }
});
