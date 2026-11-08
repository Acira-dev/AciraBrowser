// The sidebar on the RIGHT meets beta.11's Sidebar mode (tabs and the address block in the sidebar): the live morph, the block's one-layer slide (the hover reveal and Ctrl/Cmd+Shift+E) and the
// strip over the page. The left side is the original and must not change; every rule here is gated on the side. The numbers come from the app (a 1100 px window, 240 px sidebar).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addressStripHeight, captionNotchWanted } from '../src/ui/addressInSidebar';
import { BUTTON_DROP_MS, delayRowChange, moverBox, schedule, totalMs, type LayoutNumbers, type Mover } from '../src/ui/sidebarMorphPlan';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const lay = (col: number): LayoutNumbers => ({ col, hdr: 36, mt: 0, mr: 0, mb: 6, ml: 6, radius: 8, ring: 1 });
const field = (extra: Partial<Mover> = {}): Mover => ({ id: 'address', first: { x: 190, y: 40, width: 720, height: 28 }, last: { x: 860, y: 38, width: 224, height: 28 }, attach0: false, attach1: true, bow: 0, resizes: true, xDelay: 0, yDelay: 0, ...extra });

test('the morph: a piece that rides the sidebar edge follows it to the left on the left and to the right on the right', () => {
  const sch = schedule('in', 1), end = sch.total + 100;
  // Half way through the column's opening (120 of 240 px): the sidebar's edge is 120 px short of its final place, on the left that is 120 px to the left of it, on the right 120 px to the right.
  const left = moverBox(field({ last: { x: 8, y: 38, width: 224, height: 28 } }), lay(0), lay(240), lay(120), sch, end), same = moverBox(field({ last: { x: 8, y: 38, width: 224, height: 28 } }), lay(0), lay(240), lay(120), sch, end, 1);
  assert.equal(left.x, -112, 'the default is the left sidebar, exactly as before');
  assert.equal(same.x, left.x);
  const right = moverBox(field(), lay(0), lay(240), lay(120), sch, end, -1);
  assert.equal(right.x, 860 + 120, 'the right sidebar\'s near edge is still 120 px to the right of its place');
  // Settled (the column at its final width) both rest on their own box.
  assert.equal(moverBox(field(), lay(0), lay(240), lay(240), sch, end, -1).x, 860);
  assert.equal(moverBox(field({ last: { x: 8, y: 38, width: 224, height: 28 } }), lay(0), lay(240), lay(240), sch, end).x, 8);
});

test('the morph engine reads the sidebar\'s column and corner from the side it is on and carries the sign', () => {
  const src = read('../src/ui/sidebarMorph.ts');
  assert.match(src, /import \{ rootSidebarSide \} from '\.\/sidebarSide'/);
  assert.match(src, /col: px\(columns\[right \? 1 : 0\] \?\? '0'\)/, 'the column is the second one on the right');
  assert.match(src, /borderTopRightRadius : style\?\.borderTopLeftRadius/, 'the corner beside the sidebar');
  assert.match(src, /attached: rootSidebarSide\(\) === 'right' \? box\.x >= window\.innerWidth - column - 1/, 'a piece is in the sidebar\'s column at the window\'s right end on the right');
  assert.match(src, /dir: 1 \| -1;/);
  assert.match(src, /moverBox\(mover, m\.first, m\.last, lay, sch, ms, m\.dir\)/);
  assert.match(src, /--sm-rail-x', `\$\{m\.dir === 1 \? lay\.col - m\.last\.col : 0\}`/, 'the sidebar on the right starts at its column\'s edge: no pull');
  assert.match(src, /m\.dir \* \(lay\.col - m\.last\.col\)/, 'the arriving sidebar button');
  assert.equal((src.match(/m\.dir \* \(lay\.col - m\.first\.col\)/g) ?? []).length, 2, 'both ghosts (the old block and the old sidebar) leave toward the side they came from');
});

test('the strip over the page: the Mac\'s buttons are over the sidebar on the left and over the page on the right; Windows\' are a notch (left, or away) or over the sidebar (right), so its strip is always the card\'s margin', () => {
  assert.equal(addressStripHeight('darwin', 36), 6);
  assert.equal(addressStripHeight('darwin', 36, 'left'), 6);
  assert.equal(addressStripHeight('darwin', 36, 'right'), 36);
  assert.equal(addressStripHeight('win32', 36), 6);
  assert.equal(addressStripHeight('win32', 36, 'right'), 6);
  assert.equal(addressStripHeight('linux', 36, 'right'), 6);
  // The notch is for the corner that belongs to the page; a docked right sidebar owns the corner and keeps the room (always shown) for the buttons.
  assert.equal(captionNotchWanted('win32', true, false), true);
  assert.equal(captionNotchWanted('win32', true, false, 'left'), true);
  assert.equal(captionNotchWanted('win32', true, false, 'right'), false);
  assert.equal(captionNotchWanted('darwin', true, false), false);
  // Only a docked sidebar with the block in it has a side: away or floating over the page (the hover reveal) the buttons are over the page whichever side it comes from, and the page must not move.
  const app = read('../src/App.tsx');
  assert.match(app, /sbHeader === 'block' && workspaceOpen \? sidebarSideOf\(s\) : 'left'/);
});

test('the block\'s hide slide on the right: the picture is put at the group\'s right end, with the follow keyframes\' right twins', () => {
  const css = read('../src/styles/sidebar-right.css');
  assert.match(css, /\[data-sidebar-side=right\]\[data-mode-switch='edge'\]:has\(\.browser-shell\[data-sbmode='bare'\]\)::view-transition-old\(acira-toolbar\),\s*:root:root\[data-sidebar-side=right\]\[data-mode-switch='layout'\]\[data-block-slide='out'\]::view-transition-old\(acira-toolbar\) \{ left: auto; right: 0;/);
  assert.match(css, /\[data-sidebar-side=right\]\[data-page-follow\]\[data-mode-switch='layout'\]\[data-block-slide='in'\]::view-transition-new\(acira-toolbar\) \{ animation-name: acira-sidebar-arrive-follow-right; \}/);
  assert.match(css, /\[data-sidebar-side=right\]\[data-page-follow\]\[data-mode-switch='layout'\]\[data-block-slide='out'\]::view-transition-old\(acira-toolbar\) \{ animation-name: acira-sidebar-leave-follow-right; \}/);
  // The slide's start is set for the layout switch on the right (and the edge float's own travel), the block's keyframes take it.
  assert.match(css, /:root\[data-sidebar-side=right\] \{ --sb-slide-from: translateX\(100%\); \}/);
  assert.match(css, /\[data-sidebar-side=right\]\[data-mode-switch='edge'\]\[data-sidebar-overlay\] \{ --sb-slide-from: translateX\(var\(--sf-sidebar-travel, 100%\)\); \}/);
  // Nothing of it applies with the sidebar on the left.
  for (const rule of css.match(/^[^\n{]*(sbmode|block-slide)[^\n{]*\{/gm) ?? []) assert.match(rule, /data-sidebar-side=right/, rule);
});

test('Windows with the sidebar on the right: the sidebar arrives already holding the caption strip and the block\'s room', () => {
  const css = read('../src/styles/sidebar-right.css'), base = read('../src/styles/address-in-sidebar.css');
  assert.match(base, /:where\(:has\(> \.browser-root > \.browser-shell\[data-sbmode='block'\]\)\) > \.ed-rail\.acira-sidebar \{ padding-top: 80px; \}/, 'the left fallback is the original');
  assert.match(css, /html\[data-platform=win32\]\[data-sidebar-side=right\]:root:root:root \.app\.style-acira:where\(:has\(> \.browser-root > \.browser-shell\[data-sbmode='block'\]\)\) > \.ed-rail\.acira-sidebar \{ padding-top: calc\(80px \+ 40px \/ var\(--interface-scale, 1\)\); \}/);
  assert.match(css, /\.ed-rail\.acira-sidebar\.is-expanded::before \{ display: none; \}/, 'the 40 px strip is gone from the first commit, as data-addr-side makes it');
  // The open row (108 px + the strip) is a higher rule than the fallback, as on the left.
  assert.match(css, /\[data-addr-side\]\[data-addr-open\] \{ padding-top: calc\(108px \+ 40px/);
});

test('Windows with the sidebar on the right: a button that ends 40 px lower (under the caption buttons) waits to drop, so the page never covers it; level buttons are unchanged', () => {
  const sch = schedule('in', 1);
  const button = (id: string, first: number[], last: number[]): Mover => ({ id, first: { x: first[0], y: first[1], width: 28, height: 28 }, last: { x: last[0], y: last[1], width: 28, height: 28 }, attach0: false, attach1: false, bow: 0, resizes: false, xDelay: 0, yDelay: 0 });
  // Compact, tabs on top: the buttons sit at y 2 and end at y 44 in the right-hand block on Windows (y 4 on the Mac and on the left)
  const [win, mac] = [[button('back', [18, 2], [938, 44])], [button('back', [18, 2], [938, 4])]];
  delayRowChange(win, sch); delayRowChange(mac, sch);
  assert.equal(win[0].yDelay, Math.round(BUTTON_DROP_MS * sch.scale), 'it travels sideways into the sidebar\'s column first');
  assert.equal(totalMs(sch, win), sch.total, 'and the wait does not make the morph any longer');
  assert.equal(mac[0].yDelay, 0, 'a level button is not delayed');
  // Rising (turning the mode off, the reverse path) is never delayed for a button: only the wide field rises early
  const up = [button('back', [938, 44], [18, 2]), { ...button('address', [868, 78], [377, 3]), resizes: true }];
  delayRowChange(up, sch);
  assert.equal(up[0].yDelay, 0); assert.equal(up[1].yDelay, -sch.moveDelay);
});
