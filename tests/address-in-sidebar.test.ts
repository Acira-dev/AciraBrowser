import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  PILL_DWELL_MS, PILL_LEAVE_MS, PILL_OPEN_EXTRA, addressBlockShown, addressFocusPlan, addressInSidebarWanted, addressStripHeight,
  BLOCK_FIELD, createPillDwell, pillMotion, pointInside, revealedFieldBox, sidebarModeChrome, sidebarModeHeader, type PillTimers,
} from '../src/ui/addressInSidebar';
import { LOCALES } from '../src/i18n/locales';

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

test('the strip above the page: 6 px on the Mac, the toolbar height where the window buttons are over the page', () => {
  assert.equal(addressStripHeight('darwin', 36), 6);
  assert.equal(addressStripHeight('win32', 36), 36);
  assert.equal(addressStripHeight('linux', 36), 36);
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

test('resting on the pill for 350 ms opens it; passing over it does not', () => {
  const { c, state, dwell } = rig();
  dwell.enter(); c.advance(PILL_DWELL_MS - 1); assert.equal(state.open, false); c.advance(1); assert.equal(state.open, true);
  const pass = rig(); pass.dwell.enter(); pass.c.advance(150); pass.dwell.leave(false); pass.c.advance(2000); assert.equal(pass.state.open, false, 'left after 150 ms: nothing opened');
});

test('a click opens at once and closes an open pill; a missed enter is re-armed by a move', () => {
  const a = rig(); a.dwell.toggle(); assert.equal(a.state.open, true); a.dwell.toggle(); assert.equal(a.state.open, false);
  const b = rig(); b.dwell.move(); b.c.advance(PILL_DWELL_MS); assert.equal(b.state.open, true, 'a move with no enter before it still arms the dwell');
});

test('leaving closes it 450 ms later, unless the pointer comes back or something holds it open', () => {
  const a = rig(); a.dwell.enter(); a.c.advance(PILL_DWELL_MS); a.dwell.leave(false);
  a.c.advance(PILL_LEAVE_MS - 1); assert.equal(a.state.open, true); a.c.advance(1); assert.equal(a.state.open, false);
  const back = rig(); back.dwell.enter(); back.c.advance(PILL_DWELL_MS); back.dwell.leave(false); back.c.advance(200); back.dwell.enter(); back.c.advance(2000); assert.equal(back.state.open, true, 'came back in time');
  const held = rig(true); held.dwell.enter(); held.c.advance(PILL_DWELL_MS); held.dwell.leave(false); held.c.advance(5000); assert.equal(held.state.open, true, 'a menu from the row keeps it open');
  held.state.held = false; held.dwell.released(); held.c.advance(PILL_LEAVE_MS); assert.equal(held.state.open, false, 'and it closes once the menu is gone');
});

test('a stray "pointer left" while the pointer is still inside the pill is ignored (the open that came late or never)', () => {
  const { c, state, dwell } = rig(); dwell.enter(); c.advance(100); dwell.leave(true); c.advance(PILL_DWELL_MS); assert.equal(state.open, true);
  const rect = { left: 8, right: 232, top: 66, bottom: 76 };
  assert.equal(pointInside(rect, 120, 71), true); assert.equal(pointInside(rect, 120, 90), false);
});

test('a press outside or Esc closes at once; stop leaves no timer behind', () => {
  const { c, state, dwell } = rig(); dwell.toggle(); dwell.dismiss(); assert.equal(state.open, false);
  dwell.enter(); dwell.stop(); assert.equal(c.pending, 0);
});

test('the setting is accepted by the settings validator and has its words in every language', () => {
  const { validateAction } = require('../desktop/validation.cjs');
  const snapshot = { tabs: [], settings: {}, windowUi: {} };
  assert.doesNotThrow(() => validateAction({ type: 'settings.update', patch: { addressInSidebar: true } }, snapshot));
  assert.throws(() => validateAction({ type: 'settings.update', patch: { addressInSidebar: 'yes' } }, snapshot));
  for (const { code } of LOCALES) {
    const messages = JSON.parse(readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8')) as Record<string, string>;
    for (const id of ['windowview.addressInSidebar', 'windowview.addressInSidebarDetail']) assert.ok(messages[id]?.trim(), `${code}: ${id}`);
  }
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
  // The row lives in SidebarRows (Appearance › Layout and Tabs › Sidebar share it): offered with tabs in the sidebar; in Tabs › Sidebar it stays with tabs on top and says what it needs.
  const rows = read('../src/features/settings/SidebarRows.tsx'), panel = read('../src/features/settings/panels/sidebar.tsx');
  assert.match(rows, /if \(!inSidebar && !always\) return null;/, 'Appearance › Layout offers the row only with tabs in the sidebar');
  assert.match(rows, /sidebar\.addressNeedsSidebarTabs/, 'with tabs on top the Tabs row says what it needs');
  assert.match(settings, /<AddressInSidebarRow state=\{state\} dispatch=\{dispatch\} \/>/);
  assert.match(panel, /<AddressInSidebarRow state=\{state\} dispatch=\{dispatch\} always \/>/, 'Tabs › Sidebar always has the row');
  assert.match(settings, /!\(tabLayout === "sidebar" && s\.addressInSidebar\)/, 'the Seamless top-edge switch is hidden when there is no top edge');
  assert.match(main, /edges:\(\)=>state\.settings\.addressInSidebar&&state\.settings\.verticalTabs\?\{top:false,side:true\}/, 'no top edge in Seamless');
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
