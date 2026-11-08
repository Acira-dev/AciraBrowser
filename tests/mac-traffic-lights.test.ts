import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addressStripHeight, captionNotchWanted } from '../src/ui/addressInSidebar';
import { SIDEBAR_SIZES, sizeOf } from '../src/runtime/sidebarSizes';

// The Mac's window buttons (desktop/platform.cjs trafficLightPosition {12,12}: three 12 px buttons 20 px apart) end at x 64. Nothing may be drawn over them, in any layout, and
// the Windows-only rules of beta.13 (the caption notch, the nav row in the corner, the Windows strip) must never change the Mac. Measured on the real Mac platform
// (previews/beta13/review/mac-traffic-lights.png): the smallest clearance in every layout is 8 px (Sidebar mode, Narrow) or more.
const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const LIGHTS_RIGHT = 64;

test('the Mac keeps the strip it always had: 6 px beside a left sidebar, the toolbar\'s height only beside a right one (the buttons are over the page column then)', () => {
  assert.equal(addressStripHeight('darwin', 36), 6);
  assert.equal(addressStripHeight('darwin', 36, 'left'), 6);
  assert.equal(addressStripHeight('darwin', 36, 'right'), 36);
  assert.equal(captionNotchWanted('darwin', true, false), false, 'the notch is Windows\'');
  assert.equal(captionNotchWanted('darwin', true, false, 'right'), false);
  assert.equal(captionNotchWanted('linux', true, false), false);
});

test('every rule of the Windows items is gated to Windows (or to not-Mac) in the stylesheets and in main', () => {
  const nav = read('../src/styles/address-in-sidebar.css');
  const rule = /^(.*navigation-controls \{ left: 0; transform: translateY\(-50%\); \})$/m.exec(nav)?.[1] ?? '';
  assert.match(rule, /^:root:root:root:not\(\[data-platform=darwin\]\) /, 'the arrows in the corner: not on the Mac');
  const right = read('../src/styles/sidebar-right.css');
  for (const line of right.split('\n').filter(l => /win32/.test(l))) assert.match(line, /\[data-platform=win32\]/, 'a Windows rule names its platform: ' + line.slice(0, 80));
  for (const line of right.split('\n').filter(l => /^\s*:root:root:root\[data-platform=darwin\]/.test(l))) assert.match(line, /\[data-sidebar-side=right\]/, 'the Mac rules of the right sidebar need the right side');
  const main = read('../desktop/main.cjs');
  assert.match(main, /const notch=process\.platform==='win32'&&layout\.captionNotch===true;/);
  assert.match(main, /hidden=process\.platform==='win32'&&\(notch\?/);
  const app = read('../src/App.tsx');
  assert.match(app, /captionNotchWanted\(document\.documentElement\.dataset\.platform \|\| 'darwin'/);
});

test('Narrow with the address bar in the sidebar, on the Mac: the three arrows start right of the window buttons and end before the sidebar button', () => {
  const css = read('../src/styles/address-in-sidebar.css');
  const group = /\[data-platform=darwin\] \.app\[data-sidebar-size=narrow\] [^{]*\.navigation-controls \{ left: (\d+)px; transform: translateY\(-50%\); \}/.exec(css);
  assert.ok(group, 'the rule exists and is gated to the Mac and to Narrow');
  assert.match(css, /\[data-platform=darwin\] \.app\[data-sidebar-size=narrow\] [^{]*\.navigation-controls > \* \{ width: 20px;/);
  const toggle = /\[data-platform=darwin\] \.app\[data-sidebar-size=narrow\] [^{]*\.sidebar-toggle-control \{ width: (\d+)px;/.exec(css);
  assert.ok(toggle);
  const inner = 8, left = Number(group![1]) + inner, arrowsEnd = left + 3 * 20, toggleLeft = SIDEBAR_SIZES.narrow - 8 - Number(toggle![1]);
  assert.ok(left >= LIGHTS_RIGHT + 8, `arrows start at ${left}, buttons end at ${LIGHTS_RIGHT}`);
  assert.ok(arrowsEnd <= toggleLeft, `arrows end at ${arrowsEnd}, the sidebar button starts at ${toggleLeft}`);
  // Standard and Wide are the centred row, as before: 78 and 114 measured (14 and 50 px clear).
  for (const [width, first] of [[SIDEBAR_SIZES.standard, 78], [SIDEBAR_SIZES.wide, 114]]) assert.equal(width / 2 - 42, first);
});

test('the app says which size the sidebar is, from the one number', () => {
  assert.equal(sizeOf(168), 'narrow'); assert.equal(sizeOf(240), 'standard'); assert.equal(sizeOf(312), 'wide');
  // On the .app element, from the render (not an effect on the root: an attribute written on <html> from an effect made the Focus Cmd+Shift+E close check of the regression guard flaky).
  assert.match(read('../src/App.tsx'), /data-sidebar-size=\{sizeOf\(state\.settings\.sidebarWidth\)\}/);
  assert.doesNotMatch(read('../src/App.tsx'), /dataset\.sidebarSize/);
});
