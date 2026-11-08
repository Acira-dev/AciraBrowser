import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { BrowserSnapshot } from '../src/runtime/types';
import { measuredPopupKinds, menuDense, menuDenseFor, popupGeometry, popupContentHeight, popupNaturalHeight } from '../src/ui/popup';

// The checked-in measured menu includes the Windows-only Tor row.
Object.assign(globalThis, { window: { acira: { platform: 'win32' } } });

// Heights measured in the real app by qa/b-popup-heights.mjs (re-run it after changing a popup's rows, padding or content).
interface MeasuredCase { kind: string; label: string; measured: number; state: { tabs: number; web: boolean; bookmarks: number; downloads: number; profiles: number; recent: number; target?: string; workspaces?: number; parent?: string; /** R3-38: the newest workspace is secured and locked (its switcher shows Unlock). */ locked?: boolean } }
const cases: MeasuredCase[] = JSON.parse(fs.readFileSync(new URL('./popup-heights.json', import.meta.url), 'utf8'));

const snapshot = (state: MeasuredCase['state']) => ({
  activeTabId: 'active',
  tabs: Array.from({ length: state.tabs }, (_, index) => ({ id: index ? `tab-${index}` : 'active', contentKind: index || state.web ? 'web' : 'internal' })),
  bookmarks: Array.from({ length: state.bookmarks }, (_, index) => `https://example.com/${index}`),
  downloads: Array.from({ length: state.downloads }, () => ({})),
  // Every ordinary profile has at least one workspace (R4-48: the profile panel lists them; the switcher popover counts them).
  activeBrowserProfileId: 'profile-0',
  browserProfiles: Array.from({ length: state.profiles }, (_, index) => ({ id: `profile-${index}` })),
  workspaces: Array.from({ length: state.workspaces ?? 1 }, (_, index) => ({ id: `workspace-${index}`, name: index ? `W${index}` : '', browserProfileId: 'profile-0', ...(state.locked && index && index === (state.workspaces ?? 1) - 1 ? { secured: true } : {}) })),
  // The rig ends on its newest workspace (not the first), so the switcher it measures shows R3-38's "Lock this workspace" row.
  activeWorkspaceId: `workspace-${(state.workspaces ?? 1) - 1}`,
}) as unknown as BrowserSnapshot;

test('every popup estimate matches the height measured in the app, so its first frame opens at its final size', () => {
  assert.ok(cases.length >= 30, 'the measured set covers every popup kind in several states');
  for (const { kind, label, measured, state } of cases) {
    const estimate = popupContentHeight(kind, popupNaturalHeight(kind, snapshot(state), { recent: state.recent, target: state.target ? { contentKind: state.target } : undefined, parent: state.parent }));
    assert.ok(Math.abs(estimate - measured) <= 1, `${kind} (${label}): estimated ${estimate}px, measured ${measured}px`);
  }
});

test('every kind trusted over a remembered height has been measured', () => {
  const measured = new Set(cases.map(item => item.kind));
  for (const kind of measuredPopupKinds) assert.ok(measured.has(kind), `${kind} has no measured case`);
});

test('the Mac menu estimate includes both supported Tor rows and View/Tabs rows', () => {
  const win = (globalThis as any).window;
  win.acira.platform = 'darwin';
  try { assert.equal(popupNaturalHeight('menu', snapshot(cases[0].state)), 648); }
  finally { win.acira.platform = 'win32'; }
});

test('the palette caps at about 13 rows and scrolls; compact menus may be shorter than panels', () => {
  assert.equal(popupContentHeight('palette', 1834), 514);
  assert.equal(popupContentHeight('palette', 266), 266);
  assert.equal(popupContentHeight('find', 56), 56);
  assert.equal(popupContentHeight('zoom', 44), 44);
});


test('menu density and geometry use the supported platform rows at short heights', () => {
  const win=(globalThis as any).window,anchor={x:840,y:48,width:32,height:24},state=snapshot(cases[0].state);
  try {
    win.acira.platform='darwin';
    assert.equal(menuDenseFor(state,650,anchor),true,'Mac Tor rows require compact density in the558px drop');
    assert.equal(popupGeometry('menu',state,{width:900,height:650},anchor).contentHeight,568);
    assert.equal(menuDenseFor(state,600,anchor),true);
    assert.equal(popupGeometry('menu',state,{width:900,height:600},anchor).contentHeight,568,'compact Mac includes both Tor rows and View/Tabs');
    win.acira.platform='win32';
    assert.equal(menuDenseFor(state,600,anchor),true,'648px Windows menu needs compact rows in508px');
    assert.equal(popupGeometry('menu',state,{width:900,height:600},anchor).contentHeight,568);
    // The full rows need 740px of window under this anchor (Sidebar mode is a Tabs answer now, not a row, so the menu is the 30px shorter it was before); shorter windows take the compact rows.
    assert.equal(menuDenseFor(state,730,anchor),true);
    assert.equal(menuDenseFor(state,760,anchor),false);
  } finally { win.acira.platform='win32'; }
});
