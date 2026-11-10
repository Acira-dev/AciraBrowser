// 13.5, Windows, Seamless + Sidebar + address: what the interface asks of the window's caption (the timeline of what main does with it is tests/caption-seamless-sidebar-mode.test.cjs).
// 13.4 hid the caption there and waited for a top edge that Sidebar mode switches off; 13.5 asks for the notch, as Full does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { captionNotchWanted, NOTCH_HEIGHT } from '../src/ui/addressInSidebar';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('Windows, Seamless with the address bar in the sidebar: the caption is the notch, on either side (nothing is docked to give the buttons room)', () => {
  assert.equal(captionNotchWanted('win32', true, false, 'left', true), true, 'sidebar on the left');
  assert.equal(captionNotchWanted('win32', true, false, 'right', true), true, 'sidebar on the right: Seamless docks nothing there');
  assert.equal(captionNotchWanted('win32', true, true, 'left', true), false, 'a fullscreen window has no caption');
  assert.equal(captionNotchWanted('win32', false, false, 'left', true), false, 'Seamless without the address bar in the sidebar keeps its own top edge');
});

test('nothing else changed: Full keeps its notch on the left and none on the right, and the Mac and Linux never have one', () => {
  assert.equal(captionNotchWanted('win32', true, false), true);
  assert.equal(captionNotchWanted('win32', true, false, 'left'), true);
  assert.equal(captionNotchWanted('win32', true, false, 'right'), false, 'a docked right sidebar has the room (sidebar-right.css)');
  assert.equal(captionNotchWanted('win32', true, true), false);
  for (const platform of ['darwin', 'linux']) for (const side of ['left', 'right'] as const) for (const seamless of [false, true]) assert.equal(captionNotchWanted(platform, true, false, side, seamless), false, `${platform} ${side} seamless=${seamless}`);
  assert.equal(NOTCH_HEIGHT, 34);
});

test('the window view asks with the setting, not the Full header: Seamless has no Sidebar-mode header', () => {
  const app = read('../src/App.tsx');
  assert.match(app, /const captionNotch = captionNotchWanted\(document\.documentElement\.dataset\.platform \|\| 'darwin', addrWanted, windowFullscreen, addrSide, seamless\);/);
  assert.match(app, /\.\.\.\(topBarHidden && !captionNotch \? \{ captionHidden: true, captionFloat: true \} : \{\}\)/, 'the notch hides itself; the "top bar is hidden" caption flags are for the layouts that have a top edge');
  assert.match(app, /\.\.\.\(captionNotch \? \{ captionNotch: true, captionHeight: NOTCH_HEIGHT \} : \{\}\)/);
  assert.doesNotMatch(app, /captionNotchWanted\([^)]*sbChrome/, 'sbChrome is false in Seamless: that was the miss');
});

test('the regression guard\'s Windows caption matrix has the layout, so a stuck hidden caption there is caught in the real interface', () => {
  const lib = read('../qa/regression-guard/lib/caption.mjs');
  assert.match(lib, /name: 'seamless-sidebar-mode', settings: \{ verticalTabs: true, addressInSidebar: true, hideToolbar: false \}, ui: \{ view: 'seamless' \}, expect: \{ notch: true, hidden: false \}/);
});
