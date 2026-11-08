import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  PILL_DWELL_MS, PILL_LEAVE_MS, PILL_LINE, PILL_OPEN_EXTRA, PILL_REST_MS, PILL_REST_RADIUS, addressBlockShown, addressFocusPlan, addressInSidebarWanted, addressStripHeight,
  BLOCK_FIELD, createPillDwell, pillMotion, pointInside, pressKeepsFieldFocus, revealedFieldBox, sidebarModeChrome, sidebarModeHeader, type PillTimers,
} from '../src/ui/addressInSidebar';

const require = createRequire(import.meta.url);

test('the setting only applies with tabs in the sidebar, and only when it is on', () => {
  assert.equal(addressInSidebarWanted(true, true), true);
  assert.equal(addressInSidebarWanted(true, false), false, 'tabs on top: nothing changes');
  assert.equal(addressInSidebarWanted(false, true), false);
  assert.equal(addressInSidebarWanted(undefined, true), false, 'off unless true');
});

test('the block is drawn while the sidebar is on screen, in every view (Focus included); with it away there is no toolbar row to fall back to', () => {
  const on = { wanted: true, sidebarOpen: true, edgeSide: false, asked: false };
  assert.equal(addressBlockShown(on), true);
  assert.equal(addressBlockShown({ ...on, wanted: false }), false);
  assert.equal(addressBlockShown({ ...on, sidebarOpen: false }), false, 'sidebar closed: no block (and, in Sidebar mode, no toolbar row either)');
  assert.equal(addressBlockShown({ ...on, sidebarOpen: false, edgeSide: true }), true, 'a sidebar sliding in at the edge carries it');
  assert.equal(addressBlockShown({ ...on, sidebarOpen: false, asked: true }), true, 'Ctrl/Cmd+L asked for the sidebar');
});

test('Sidebar mode leaves no top bar in any view but Seamless (which never had one): the header is the block\'s strip or, with the sidebar away, only the strip', () => {
  // outside Seamless the rule is the setting itself: Full, Compact and Focus alike
  assert.equal(sidebarModeChrome(true, false), true);
  assert.equal(sidebarModeChrome(true, true), false, 'Seamless keeps its own edges');
  assert.equal(sidebarModeChrome(false, false), false, 'the setting off: the toolbar as ever');
  assert.equal(sidebarModeHeader(true, true), 'block', 'sidebar on screen: the address block stands over it');
  assert.equal(sidebarModeHeader(true, false), 'bare', 'sidebar away: nothing above the page but the strip');
  assert.equal(sidebarModeHeader(false, true), undefined);
  assert.equal(sidebarModeHeader(false, false), undefined);
});

test('App draws it: the chrome is the standard one in every view, nothing tucks the sidebar away, the toolbar is not drawn when the sidebar is away', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), css = readFileSync(new URL('../src/styles/address-in-sidebar.css', import.meta.url), 'utf8');
  assert.match(app, /const effectiveMode = sbChrome \|\| \(reveal && !compactView\) \? 'standard' : mode;/, 'Compact and Focus draw the standard chrome in Sidebar mode');
  assert.match(app, /sidebarTabs: railPrefs\.tabs && !addrWanted/, 'Compact and Focus no longer tuck the sidebar behind a toolbar button that is not there');
  assert.match(app, /enabled: compactView && compactEligible && !sbChrome/, 'the compact row never expands or plays its own transition');
  assert.match(app, /data-sbmode=\{sbHeader\}/);
  assert.match(css, /\[data-sbmode='bare'\] > \.acira-persistent-toolbar \{ visibility: hidden/, 'the toolbar stays in the tree, undrawn');
  assert.match(css, /\[data-sbmode='bare'\]\) \.browser-root \.browser-body > \.page-area \{ margin: 0 6px 6px;/, 'the page is Seamless\'s card');
});

test('the strip above the page is the page card\'s own 6 px margin on every platform (Windows: the caption buttons sit in a notch, not in an empty strip)', () => {
  assert.equal(addressStripHeight('darwin', 36), 6);
  assert.equal(addressStripHeight('win32', 36), 6, 'Windows: the page goes to the top, the caption buttons sit in the notch');
  assert.equal(addressStripHeight('linux', 36), 6, 'Linux keeps its system title bar above the window');
});

test('Ctrl/Cmd+L: focus where the field is, open a closed sidebar, or ask Seamless for its edge', () => {
  const base = { wanted: true, seamless: false, sidebarOpen: true, edgeSide: false };
  assert.equal(addressFocusPlan(base), 'focus');
  assert.equal(addressFocusPlan({ ...base, sidebarOpen: false }), 'open-sidebar');
  assert.equal(addressFocusPlan({ ...base, seamless: true, sidebarOpen: false }), 'reveal-edge');
  assert.equal(addressFocusPlan({ ...base, seamless: true, sidebarOpen: false, edgeSide: true }), 'focus', 'already sliding in');
  assert.equal(addressFocusPlan({ ...base, wanted: false, sidebarOpen: false }), 'focus', 'setting off: the toolbar field as ever');
});

test('the morph uses the house spring in and its exit out, scaled by the animation speed; a scale of 0 is instant', () => {
  const premium = pillMotion(1.7), fast = pillMotion(1);
  assert.ok(premium.openMs > premium.closeMs, 'the way out is shorter');
  assert.ok(fast.openMs < premium.openMs);
  assert.match(premium.openEase, /^linear\(/);
  assert.equal(pillMotion(0).openMs, 0);
  assert.equal(pillMotion(0).closeMs, 0);
  assert.equal(PILL_OPEN_EXTRA, 28);
});

function clock() {
  let now = 0, next = 1; const pending = new Map<number, { at: number; run: () => void }>();
  const timers: PillTimers = { set(run, ms) { const id = next++; pending.set(id, { at: now + ms, run }); return id; }, clear(id) { pending.delete(id as number); } };
  return { timers, advance(ms: number) { const end = now + ms; for (;;) { const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; pending.delete(due[0]); due[1].run(); } now = end; }, get pending() { return pending.size; } };
}
function rig(held = false) {
  const c = clock(); const state = { open: false, held };
  const dwell = createPillDwell({ isOpen: () => state.open, setOpen: o => { state.open = o; }, held: () => state.held, timers: c.timers });
  return { c, state, dwell };
}

/** Walks a pointer through the pill: each step is [ms since the last sample, x, y]; the fake clock runs between the samples and the samples carry their own time stamps. */
function walk(r: ReturnType<typeof rig>, from: { x: number; y: number }, steps: [number, number, number][], enter = true) {
  let t = 0; if (enter) r.dwell.enter({ x: from.x, y: from.y, t });
  for (const [dt, x, y] of steps) { r.c.advance(dt); t += dt; r.dwell.move({ x, y, t }); }
  return t;
}

test('beta.12 numbers: a rest of 100 ms opens it (350 before), the pill is longer (96 px, 124 under the pointer; 72 and 92 before) with a taller hit area (14 px; 10 before)', () => {
  assert.equal(PILL_REST_MS, 100); assert.ok(PILL_REST_MS < 350, 'sooner than the old flat delay');
  assert.equal(PILL_DWELL_MS, 350, 'the old delay stays as the ceiling');
  assert.equal(PILL_REST_RADIUS, 4);
  assert.deepEqual(PILL_LINE, { width: 96, height: 4, hoverWidth: 124, zone: 14, layout: 10, open: 32 });
  assert.ok(PILL_LINE.width > 72 && PILL_LINE.hoverWidth > 92 && PILL_LINE.zone > 10);
  assert.equal(PILL_LINE.layout, 10, 'the pill still takes 10 px of the sidebar\'s layout: nothing below it moves');
  assert.equal(PILL_OPEN_EXTRA, 28);
});

test('a pointer that settles on the pill opens it after a rest, not after a long delay', () => {
  const a = rig(); a.dwell.enter(); a.c.advance(PILL_REST_MS - 1); assert.equal(a.state.open, false); a.c.advance(1); assert.equal(a.state.open, true, 'enter with no movement: open after the rest');
  // arrives at speed (6 px every 16 ms) and stops dead: the rest counts from the last big movement
  const b = rig(); walk(b, { x: 100, y: 60 }, [[16, 100, 66], [16, 100, 72], [16, 100, 78]]); assert.equal(b.state.open, false);
  b.c.advance(PILL_REST_MS - 1); assert.equal(b.state.open, false); b.c.advance(1); assert.equal(b.state.open, true, '100 ms after the last movement');
  // a pixel or two of the hand's own jitter is not movement
  const c = rig(); walk(c, { x: 100, y: 70 }, [[16, 101, 70], [16, 100, 71], [16, 99, 70], [16, 100, 69], [16, 101, 71], [16, 100, 70]]); c.c.advance(PILL_REST_MS); assert.equal(c.state.open, true, 'jitter inside the rest radius still rests');
});

test('a pointer just passing over the pill opens nothing, at any speed that is not a rest', () => {
  // 600 px/s straight across (the 14 px pill takes 23 ms), then gone
  const fast = rig(); walk(fast, { x: 100, y: 60 }, [[8, 100, 65], [8, 100, 70], [8, 100, 75], [8, 100, 80]]); fast.dwell.leave(false); fast.c.advance(3000); assert.equal(fast.state.open, false);
  // 70 px/s (1.12 px per 16 ms), across the whole 14 px in 200 ms: the rest restarts every 4 px, so the 100 ms never completes
  const slow = rig(); const steps: [number, number, number][] = []; for (let i = 1; i <= 13; i++) steps.push([16, 100, 66 + i * 1.12 * 1]);
  const t = walk(slow, { x: 100, y: 66 }, steps); assert.ok(t >= 200, 'a long crossing'); assert.equal(slow.state.open, false, 'still on the pill, still moving: closed');
  slow.dwell.leave(false); slow.c.advance(3000); assert.equal(slow.state.open, false, 'left: never opened');
  // 40 px/s drifting sideways inside the pill (4 px every 100 ms) is moving, until the old delay: the ceiling
  const drift = rig(); walk(drift, { x: 100, y: 70 }, [[90, 104, 70], [90, 108, 70], [90, 112, 70]]); assert.equal(drift.state.open, false);
  drift.c.advance(PILL_DWELL_MS - 270 - 1); assert.equal(drift.state.open, false); drift.c.advance(1); assert.equal(drift.state.open, true, 'a pointer that never rests still opens it at the old delay, no later');
});

test('passing over is not swallowed at the pill\'s bottom edge: a "left" reported at the edge is a left', () => {
  const rect = { left: 8, right: 232, top: 66, bottom: 76 };
  assert.equal(pointInside(rect, 120, 75), true); assert.equal(pointInside(rect, 120, 76), false, 'the pixel row under the bottom edge is outside');
  assert.equal(pointInside(rect, 232, 70), false); assert.equal(pointInside(rect, 8, 66), true);
  const r = rig(); walk(r, { x: 120, y: 69 }, [[10, 120, 74]]); r.dwell.leave(pointInside(rect, 120, 76)); r.c.advance(3000);
  assert.equal(r.state.open, false, 'the leave at y = 76 closed the dwell: the row did not open under a pointer that was gone');
});

test('a press on the pill or the row keeps the keyboard in the address field; only a text field of the row takes it', () => {
  const stub = (inside: boolean) => ({ closest: (selector: string) => (inside && /input/.test(selector) ? {} : null) });
  assert.equal(pressKeepsFieldFocus(stub(false)), true, 'a button of the row: the press is not default-handled, the field keeps its caret and selection');
  assert.equal(pressKeepsFieldFocus(stub(true)), false, 'a text field in the row would take it');
  assert.equal(pressKeepsFieldFocus(null), true);
});

test('the field in use does not hide the pill: only the open suggestion list does, and the row is solid', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const css = read('../src/styles/address-in-sidebar.css'), more = read('../src/components/AddressMore.tsx'), app = read('../src/App.tsx');
  assert.doesNotMatch(css, /:has\(\.address-bar:focus-within\)[^{]*\.sb-addr-shape/, 'a focused field no longer hides the pill (the row opened invisible, then popped in when the focus left)');
  assert.match(css, /\.sb-addr-more\[data-suggesting\] \.sb-addr-shape \{ opacity: 0; \}/, 'the suggestion list hangs over the pill\'s place: the pill steps aside for it');
  assert.match(css, /\.sb-addr-more\[data-suggesting\] \.sb-addr-pill \{ pointer-events: none; \}/);
  assert.match(css, /transition: opacity \.12s/, 'and it fades, it does not pop');
  assert.match(css, /rgb\(var\(--sidebar-rgb, var\(--chrome-rgb\)\) \/ clamp\(0, calc\(var\(--addr-t\) \* 5\), 1\)\)/, 'a plate of the sidebar\'s colour under the ink: nothing shows through the row');
  assert.match(css, /--addr-t: 0; --addr-w0: 96px;/); assert.match(css, /\.sb-addr-more:hover \{ --addr-w0: 124px;/); assert.match(css, /--addr-t: 1; --addr-w0: 124px;/);
  assert.match(css, /\.sb-addr-pill \{[^}]*height: 10px;/, 'the button is the pill\'s 10 px of layout: a popup that hangs from a closed pill hangs from the same box as before');
  assert.match(css, /\.sb-addr-pill::after \{ content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 4px; \}/, 'and its hit area reaches 4 px further down, 14 px in all (PILL_LINE.zone)');
  assert.match(more, /onMouseDown=\{event => \{ if \(pressKeepsFieldFocus\(event\.target as Element\)\) event\.preventDefault\(\); \}\}/);
  assert.match(more, /data-suggesting=\{suggesting \|\| undefined\}/);
  assert.match(more, /useEffect\(\(\) => \{ if \(suggesting\) dwell\.dismiss\(\); \}, \[suggesting, dwell\]\)/, 'a row open under the suggestion list closes with it');
  assert.match(more, /dwell\.enter\(sample\(event\)\)/); assert.match(more, /dwell\.move\(sample\(event\)\)/, 'the dwell is given the pointer\'s samples');
  assert.match(app, /suggesting=\{overlay === 'suggestions'\}/);
});

test('a click opens at once and closes an open pill; a missed enter is re-armed by a move', () => {
  const a = rig(); a.dwell.toggle(); assert.equal(a.state.open, true); a.dwell.toggle(); assert.equal(a.state.open, false);
  const b = rig(); b.dwell.move({ x: 100, y: 70, t: 0 }); b.c.advance(PILL_REST_MS); assert.equal(b.state.open, true, 'a move with no enter before it still arms the dwell');
});

test('leaving closes it 450 ms later, unless the pointer comes back or something holds it open', () => {
  const a = rig(); a.dwell.enter(); a.c.advance(PILL_DWELL_MS); a.dwell.leave(false);
  a.c.advance(PILL_LEAVE_MS - 1); assert.equal(a.state.open, true); a.c.advance(1); assert.equal(a.state.open, false);
  const back = rig(); back.dwell.enter(); back.c.advance(PILL_DWELL_MS); back.dwell.leave(false); back.c.advance(200); back.dwell.enter(); back.c.advance(2000); assert.equal(back.state.open, true, 'came back in time');
  const held = rig(true); held.dwell.enter(); held.c.advance(PILL_DWELL_MS); held.dwell.leave(false); held.c.advance(5000); assert.equal(held.state.open, true, 'a menu from the row keeps it open');
  held.state.held = false; held.dwell.released(); held.c.advance(PILL_LEAVE_MS); assert.equal(held.state.open, false, 'and it closes once the menu is gone');
});

test('a stray "pointer left" while the pointer is still inside the pill is ignored (the open that came late or never)', () => {
  const { c, state, dwell } = rig(); dwell.enter(); c.advance(50); dwell.leave(true); c.advance(PILL_DWELL_MS); assert.equal(state.open, true);
  const rect = { left: 8, right: 232, top: 66, bottom: 76 };
  assert.equal(pointInside(rect, 120, 71), true); assert.equal(pointInside(rect, 120, 90), false);
});

test('a press outside or Esc closes at once; stop leaves no timer behind', () => {
  const { c, state, dwell } = rig(); dwell.toggle(); dwell.dismiss(); assert.equal(state.open, false);
  dwell.enter(); dwell.stop(); assert.equal(c.pending, 0);
});

test('the setting is accepted by the settings validator', () => {
  const { validateAction } = require('../desktop/validation.cjs');
  const snapshot = { tabs: [], settings: {}, windowUi: {} };
  assert.doesNotThrow(() => validateAction({ type: 'settings.update', patch: { addressInSidebar: true } }, snapshot));
  assert.throws(() => validateAction({ type: 'settings.update', patch: { addressInSidebar: 'yes' } }, snapshot));
  assert.doesNotThrow(() => validateAction({ type: 'sidebar.mode', tabs: true, address: true, open: true }, snapshot), 'the layout choice moves both in one action');
  assert.throws(() => validateAction({ type: 'sidebar.mode', tabs: true, address: 'yes' }, snapshot));
});

test('the sidebar store: a block that goes takes its open row with it, and listeners hear only real changes', async () => {
  const { publishAddressSidebar, readAddressSidebar } = await import('../src/ui/addressSidebarStore');
  publishAddressSidebar({ block: false, open: false });
  publishAddressSidebar({ block: true, open: true });
  assert.deepEqual(readAddressSidebar(), { block: true, open: true });
  publishAddressSidebar({ open: false });
  assert.deepEqual(readAddressSidebar(), { block: true, open: false });
  publishAddressSidebar({ block: true, open: true }); publishAddressSidebar({ block: false });
  assert.deepEqual(readAddressSidebar(), { block: false, open: false }, 'the row cannot stay open without the block');
  const before = readAddressSidebar(); publishAddressSidebar({ block: false });
  assert.equal(readAddressSidebar(), before, 'nothing changed, nothing replaced');
});

test('wiring: the setting reaches the toolbar, the sidebar, the Settings row and the Seamless edge rules', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const app = read('../src/App.tsx'), sidebar = read('../src/components/sidebar/AciraSidebar.tsx'), css = read('../src/styles/address-in-sidebar.css'), settings = read('../src/features/BrowserSettings.tsx'), main = read('../desktop/main.cjs');
  assert.match(app, /addressInSidebarWanted\(s\.addressInSidebar, railPrefs\.tabs\)/, 'only with tabs in the sidebar');
  assert.match(app, /<AddressMore label=/, 'the pill and its row are drawn in the toolbar');
  assert.match(app, /addressFocusPlan\(/, 'Ctrl/Cmd+L follows the plan');
  assert.match(app, /askTop = seamless && !addrWanted/, 'Seamless asks for the sidebar, not the top bar, with the setting on');
  assert.match(sidebar, /data-addr-side=\{addressSide\.block\|\|undefined\} data-addr-open=\{addressSide\.open\|\|undefined\}/);
  assert.match(css, /@property --addr-t/);
  assert.match(css, /\.ed-rail\.acira-sidebar\[data-addr-side\]\[data-addr-open\] \{ padding-top: 108px;/, 'the content makes way for the open row');
  assert.match(css, /--addr-open-dur[^;]*;/, 'the sidebar uses the morph\'s own time');
  // Where the address bar lives is the third answer of the Tabs choice (tests/sidebar-mode.test.ts), in Appearance › Layout and Tabs alike: it has no row of its own any more.
  assert.match(settings, /<TabLayoutRow layout=\{tabLayout\} onChange=\{chooseTabLayout\} columns=\{4\} \/>/);
  assert.match(settings, /tabLayout !== "sidebar-address"/, 'the Seamless top-edge switch is hidden when there is no top edge');
  assert.match(main, /edges:\(\)=>state\.settings\.addressInSidebar&&state\.settings\.verticalTabs\?\{top:false,side:true\}/, 'no top edge in Seamless');
});

test('the open row\'s buttons sit evenly inside the row: 2 px in from its rounded ends, as they are above and below, so a hover box never touches the row\'s edge', () => {
  const css = readFileSync(new URL('../src/styles/address-in-sidebar.css', import.meta.url), 'utf8');
  // 28 px buttons in a 32 px row leave 2 px above and below; the row's padding leaves the same 2 px at its left and right ends (Home and the … button were flush with them, measured in the app)
  assert.match(css, /\.sb-addr-more-in \{ box-sizing: border-box; padding: 0 2px; \}/, 'the row holds its buttons 2 px in from both ends');
  assert.match(css, /\.sb-addr-more-in \{[^}]*height: 32px/, 'the row is 32 px high');
  assert.match(css, /\.sb-addr-more-in > \.toolbar-actions > :is\(\.icon-button, \.profile-button\) \{ width: 28px; min-width: 28px; height: 28px/, 'the buttons are 28 px, the size of every other toolbar highlight');
});

test('a popup that hangs from a toolbar button, with no toolbar drawn (Sidebar mode, sidebar away), hangs from where the field stands once the sidebar is out', () => {
  // the numbers are the block's own (address-in-sidebar.css): a 36 px top row, 2 px of margin above the field, 8 px of padding, and the field 28 px tall (measured in the app: 8, 38, 224 x 28 at 240 px)
  const css = readFileSync(new URL('../src/styles/address-in-sidebar.css', import.meta.url), 'utf8');
  assert.match(css, /\.acira-leading-controls \{[^}]*height: 36px/, 'the top row');
  assert.match(css, /> \.address-bar \{[^}]*margin: 2px 0 0 !important/, 'the field sits 2 px under it');
  assert.match(css, /padding: 0 8px !important/, '8 px in from the sidebar\'s sides');
  assert.deepEqual(revealedFieldBox(240), { x: 8, y: 38, width: 224, height: 28 });
  assert.equal(revealedFieldBox(320).width, 304, 'it follows the sidebar\'s width');
  assert.equal(BLOCK_FIELD.top, 36 + 2);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /if \(document\.querySelector\('\.browser-shell\[data-sbmode="bare"\]'\) && \(!node \|\| node\.closest\('\.browser-shell\[data-sbmode="bare"\]'\)\)\) return revealedFieldBox\(clampSidebarWidth\(state\.settings\.sidebarWidth\)\);/,
    'every popup that would hang from the undrawn toolbar (or from nothing: the zoom level before its indicator exists) takes the box');
  assert.match(app, /!node\.getClientRects\(\)\.length \|\| node\.closest\('\.browser-shell\[data-sbmode="bare"\]'\)\) return;/, 'the menu\'s settle loop does not pull its anchor back to the undrawn button');
});

test('on Windows and Linux the three arrows take the block\'s left corner (no traffic lights to clear); the Mac keeps them clear of the lights, the sidebar button stays at the right end', () => {
  const css = readFileSync(new URL('../src/styles/address-in-sidebar.css', import.meta.url), 'utf8');
  // the Mac's rule: mid-row, clear of the traffic lights
  assert.match(css, /\.expanded-navigation \.navigation-controls \{ position: absolute; left: 50%; top: 50%; transform: translate\(-50%, -50%\);/, 'the base (Mac) placement is the middle of the row');
  // everywhere but the Mac: the left corner, 8 px in (the toolbar's own padding), vertically centred as before
  const rule = css.match(/:root:root:root:not\(\[data-platform=darwin\]\) \.browser-root\.addr-side \.acira-persistent-toolbar \.expanded-navigation \.navigation-controls \{([^}]*)\}/);
  assert.ok(rule, 'a rule that applies to every platform but the Mac');
  assert.match(rule![1], /left: 0;/);
  assert.match(rule![1], /transform: translateY\(-50%\);/);
  // the sidebar button keeps the far right, on every platform
  assert.match(css, /\.expanded-navigation \.sidebar-toggle-control \{ order: 2; margin-left: auto; \}/);
});
