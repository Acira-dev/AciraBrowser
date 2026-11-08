import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInitialState, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { mirrorSpan, pageSlidesWithSidebar, rootSidebarSide, sidebarEdgeId, sidebarSideOf } from '../src/ui/sidebarSide';
import { LOCALES } from '../src/i18n/locales';

const require = createRequire(import.meta.url);
const { validateAction } = require('../desktop/validation.cjs');
const catalog = (code: string) => JSON.parse(readFileSync(new URL('../src/i18n/' + code + '.json', import.meta.url), 'utf8')) as Record<string, string>;

test('the side is one value: left by default, right only when asked', () => {
  assert.equal(createInitialState().settings.sidebarSide, 'left');
  assert.equal(sidebarSideOf(undefined), 'left');
  assert.equal(sidebarSideOf({ sidebarSide: 'right' }), 'right');
  assert.equal(sidebarSideOf({ sidebarSide: 'sideways' as never }), 'left');
  assert.equal(rootSidebarSide({ dataset: { sidebarSide: 'right' } } as never), 'right');
  assert.equal(rootSidebarSide({ dataset: {} } as never), 'left');
  assert.equal(rootSidebarSide(undefined), 'left');
});

test('a saved file without the side, or with a bad one, restores to the left; the right survives', () => {
  const saved = JSON.parse(JSON.stringify({ ...createInitialState(), settings: { ...createInitialState().settings, sidebarSide: undefined } }));
  assert.equal(restoreSnapshot(saved).settings.sidebarSide, 'left');
  assert.equal(restoreSnapshot({ ...saved, settings: { ...saved.settings, sidebarSide: 'top' } }).settings.sidebarSide, 'left');
  assert.equal(restoreSnapshot({ ...saved, settings: { ...saved.settings, sidebarSide: 'right' } }).settings.sidebarSide, 'right');
  const right = reduceBrowser(createInitialState(), { type: 'settings.update', patch: { sidebarSide: 'right' } } as never);
  assert.equal(right.settings.sidebarSide, 'right');
});

test('main accepts left and right and nothing else for the side, alone or with other settings', () => {
  const state = createInitialState();
  for (const value of ['left', 'right']) assert.doesNotThrow(() => validateAction({ type: 'settings.update', patch: { sidebarSide: value } }, state), value);
  assert.doesNotThrow(() => validateAction({ type: 'settings.update', patch: { sidebarSide: 'right', sidebarWidth: 260 } }, state));
  for (const value of ['', 'top', 'RIGHT', 1, null, true]) assert.throws(() => validateAction({ type: 'settings.update', patch: { sidebarSide: value } }, state), /Sidebar side/, String(value));
});

test('the page card slides with the docked sidebar: with the sidebar on the left the old rule exactly, on the right its mirror', () => {
  const rect = (x: number, width: number, y = 36, height = 758) => ({ x, y, width, height });
  // the rule as it stood inline in App before the side existed
  const old = (was: ReturnType<typeof rect> | null, page: ReturnType<typeof rect>, reduced: boolean) => {
    const sameWidth = !!was && Math.abs(page.width - was.width) <= 1;
    return !!was && !reduced && Math.abs(page.x - was.x) >= 40 && (Math.abs(page.x + page.width - was.x - was.width) <= 8 || sameWidth) && Math.abs(page.y - was.y) <= 40;
  };
  const xs = [0, 6, 39, 40, 240, 246], widths = [800, 1034, 1040, 1274, 1280];
  let checked = 0;
  for (const wx of xs) for (const ww of widths) for (const px of xs) for (const pw of widths) for (const dy of [0, 39, 41]) for (const reduced of [false, true]) {
    const was = rect(wx, ww), page = rect(px, pw, 36 + dy);
    assert.equal(pageSlidesWithSidebar('left', was, page, reduced), old(was, page, reduced), JSON.stringify({ was, page, reduced }));
    // the mirror: the same move seen in a window 1280 wide is the right sidebar's move
    const m = (b: ReturnType<typeof rect>) => ({ ...b, x: mirrorSpan(b.x, b.width, 1280).x });
    assert.equal(pageSlidesWithSidebar('right', m(was), m(page), reduced), old(was, page, reduced), 'mirror ' + JSON.stringify({ was, page, reduced }));
    checked++;
  }
  assert.ok(checked > 2000);
  assert.equal(pageSlidesWithSidebar('left', null, rect(0, 1280), false), false);
  // docked open on the right: the right edge goes from 1280 to 1040, the left edge stays: a slide; the same move on a left sidebar is not one
  assert.equal(pageSlidesWithSidebar('right', rect(0, 1280, 36, 764), rect(6, 1034), false), true);
  assert.equal(pageSlidesWithSidebar('left', rect(0, 1280, 36, 764), rect(6, 1034), false), false);
});

test('mirroring a span twice gives it back, and a box 6px in from the right edge is 6px in from the left', () => {
  for (const [x, w] of [[0, 240], [6, 1034], [240, 1040], [12.5, 99.25]]) {
    const once = mirrorSpan(x, w, 1280), twice = mirrorSpan(once.x, once.width, 1280);
    assert.deepEqual(twice, { x, width: w });
  }
  assert.deepEqual(mirrorSpan(240, 1034, 1280), { x: 6, width: 1034 });
});

test('the messages that name the edge have a twin for the right, in every language', () => {
  assert.equal(sidebarEdgeId('windowview.edgeSide', 'left'), 'windowview.edgeSide');
  assert.equal(sidebarEdgeId('windowview.edgeSide', 'right'), 'windowview.edgeSideRight');
  const ids = ['sidebar.side', 'sidebar.sideDetail', 'sidebar.sideLeft', 'sidebar.sideRight', 'windowview.edgeSideRight', 'windowview.closedSidebarEdgeRight', 'windowview.closedSidebarEdgeDetailRight', 'windowview.firstRunRight'];
  const en = catalog('en');
  assert.equal(LOCALES.length, 13);
  for (const { code } of LOCALES) {
    const messages = catalog(code);
    for (const id of ids) assert.ok(typeof messages[id] === 'string' && messages[id].length > 0, `${code}: ${id}`);
    for (const [left, right] of [['windowview.edgeSide', 'windowview.edgeSideRight'], ['windowview.closedSidebarEdge', 'windowview.closedSidebarEdgeRight'], ['windowview.closedSidebarEdgeDetail', 'windowview.closedSidebarEdgeDetailRight'], ['windowview.firstRun', 'windowview.firstRunRight']]) {
      assert.notEqual(messages[right], messages[left], `${code}: ${right} names the other edge`);
      assert.equal([...messages[right].matchAll(/\{(\w+)\}/g)].map(m => m[1]).join(), [...en[right].matchAll(/\{(\w+)\}/g)].map(m => m[1]).join(), `${code}: ${right} keeps its parameters`);
    }
  }
});

test('the Left / Right choice is in Settings › Tabs › Sidebar, with a live copy in Appearance › Layout, and Reset puts it back', () => {
  const rows = readFileSync(new URL('../src/features/settings/SidebarRows.tsx', import.meta.url), 'utf8');
  assert.match(rows, /<SettingRow id="sidebar-side"[^>]*>\s*<Select<SidebarSide>[\s\S]*?options=\{\[\{ value: 'left', label: t\('sidebar\.sideLeft'\) \}, \{ value: 'right', label: t\('sidebar\.sideRight'\) \}\]\}/);
  const panel = readFileSync(new URL('../src/features/settings/panels/sidebar.tsx', import.meta.url), 'utf8');
  assert.match(panel, /<SidebarSideRow state=\{state\} dispatch=\{dispatch\} always \/>/, 'Tabs › Sidebar shows it, next to Show sidebar');
  assert.match(panel, /sidebarWidth: SIDEBAR_WIDTH\.initial, sidebarSide: 'left'/, 'the reset of the sidebar layout restores the side');
  const layout = readFileSync(new URL('../src/features/BrowserSettings.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<SidebarSideRow state=\{state\} dispatch=\{dispatch\} \/>/, 'Appearance › Layout keeps a live copy');
  const entries = readFileSync(new URL('../src/features/settings/entries/sidebar.ts', import.meta.url), 'utf8');
  assert.match(entries, /id: 'sidebar-side'[^\n]*group: 'Sidebar'/);
  assert.match(rows, /sidebarEdgeId\('windowview\.edgeSide', side\)/, 'the edge rows name the edge the sidebar is at');
});
