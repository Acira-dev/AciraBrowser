// Item 32: the sidebar comes in three sizes (Narrow 168, Standard 240, Wide 312). These tests keep the numbers, the snap, the Favorites columns, the stored
// value, main's range, the right-click menu and the Settings row together, on both sides of the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { FAVORITES_ACROSS, SIDEBAR_SIZE_BREAKS, SIDEBAR_SIZE_ORDER, SIDEBAR_SIZES, favoriteColumns, sizeOf, snapSidebarWidth, steppedSize } from '../src/runtime/sidebarSizes';
import * as sidebarSizes from '../src/runtime/sidebarSizes';
import { bookmarkTarget, SIZE_REF } from '../src/ui/bookmarkMenu';
import { Check } from '../src/components/AppIcons';
import { LOCALES } from '../src/i18n/locales';

const require = createRequire(import.meta.url);
const { validateAction } = require('../desktop/validation.cjs');
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const catalog = (code: string) => JSON.parse(read('src/i18n/' + code + '.json')) as Record<string, string>;

test('the three sizes: 168, 240 (today) and 312, 72px apart', () => {
  assert.deepEqual(SIDEBAR_SIZES, { narrow: 168, standard: 240, wide: 312 });
  assert.equal(SIDEBAR_SIZES.standard - SIDEBAR_SIZES.narrow, 72);
  assert.equal(SIDEBAR_SIZES.wide - SIDEBAR_SIZES.standard, 72);
  assert.deepEqual([...SIDEBAR_SIZE_ORDER], ['narrow', 'standard', 'wide']);
  assert.equal(createInitialState().settings.sidebarWidth, SIDEBAR_SIZES.standard, 'a new profile starts on Standard, the width of every earlier build');
});

test('the Favorites tile is the same size at every size: 2, 3 and 4 across fit the width with a 68px tile', () => {
  // 12px of padding each side and 6px gaps (sidebar.css .sb-apps-region, .sb-apps).
  for (const size of SIDEBAR_SIZE_ORDER) {
    const across = FAVORITES_ACROSS[size], tile = (SIDEBAR_SIZES[size] - 24 - 6 * (across - 1)) / across;
    assert.ok(tile >= 67 && tile <= 69.5, `${size}: ${tile}`);
  }
  assert.deepEqual(SIDEBAR_SIZE_ORDER.map((size) => FAVORITES_ACROSS[size]), [2, 3, 4]);
});

test('the midpoints 204 and 276 decide the size, and a release lands on the nearer one', () => {
  assert.deepEqual(SIDEBAR_SIZE_BREAKS, { narrowStandard: 204, standardWide: 276 });
  for (const [width, size] of [[100, 'narrow'], [168, 'narrow'], [203.9, 'narrow'], [204, 'standard'], [240, 'standard'], [275.9, 'standard'], [276, 'wide'], [312, 'wide'], [500, 'wide']] as const) assert.equal(sizeOf(width), size, String(width));
  for (const value of [NaN, Infinity, undefined, null, '240', {}]) assert.equal(sizeOf(value), 'standard', `not a width: ${String(value)}`);
  // Every width is at most 36px from the size it lands on (half the 72px between sizes), and no other size is nearer.
  for (let width = 168; width <= 312; width++) {
    const snapped = snapSidebarWidth(width);
    assert.ok(Math.abs(snapped - width) <= 36, `${width} -> ${snapped}`);
    for (const other of Object.values(SIDEBAR_SIZES)) assert.ok(Math.abs(snapped - width) <= Math.abs(other - width) + 1e-9, `${width}: ${snapped} is not the nearest (${other})`);
  }
});

test('earlier widths (220 to 320, any pixel) become one of the three on first launch; the setting always equals a card', () => {
  for (const [old, size] of [[220, 240], [232, 240], [240, 240], [250, 240], [275, 240], [276, 312], [301, 312], [320, 312]] as const) {
    const saved = JSON.parse(JSON.stringify(persistedSnapshot(createInitialState())));
    saved.settings.sidebarWidth = old;
    assert.equal(restoreSnapshot(saved).settings.sidebarWidth, size, `restore ${old}`);
    assert.equal(reduceBrowser(createInitialState(), { type: 'settings.update', patch: { sidebarWidth: old } } as never).settings.sidebarWidth, size, `update ${old}`);
  }
  const saved = JSON.parse(JSON.stringify(persistedSnapshot(createInitialState())));
  delete saved.settings.sidebarWidth;
  assert.equal(restoreSnapshot(saved).settings.sidebarWidth, 240, 'a file without a width');
  for (const size of SIDEBAR_SIZE_ORDER) {
    const picked = reduceBrowser(createInitialState(), { type: 'settings.update', patch: { sidebarWidth: SIDEBAR_SIZES[size] } } as never);
    assert.equal(restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(picked)))).settings.sidebarWidth, SIDEBAR_SIZES[size], `${size} survives a restart`);
  }
});

test('main accepts 168 to 320 and refuses anything outside', () => {
  const state = createInitialState();
  for (const width of [168, 240, 312, 320]) assert.doesNotThrow(() => validateAction({ type: 'settings.update', patch: { sidebarWidth: width } }, state), String(width));
  for (const width of [167, 160, 321, 0, -1, NaN, '240']) assert.throws(() => validateAction({ type: 'settings.update', patch: { sidebarWidth: width } }, state), () => true, String(width));
});

test('Favorites columns: Narrow 2 and Wide 4 always; Standard 3, and 4 only where it always was (4 and 8 tiles)', () => {
  for (let tiles = 0; tiles <= 12; tiles++) {
    assert.equal(favoriteColumns('narrow', tiles), 2, `narrow ${tiles}`);
    assert.equal(favoriteColumns('wide', tiles), 4, `wide ${tiles}`);
    const before = tiles >= 5 && tiles % 3 !== 0 && tiles % 4 === 0 || tiles === 4 ? 4 : 3; // the rule before the sizes, word for word
    assert.equal(favoriteColumns('standard', tiles), before, `standard ${tiles}: no existing grid moves`);
  }
  assert.deepEqual([4, 8].map((tiles) => favoriteColumns('standard', tiles)), [4, 4]);
  assert.deepEqual([3, 5, 6, 7, 9, 10, 11, 12].map((tiles) => favoriteColumns('standard', tiles)), [3, 3, 3, 3, 3, 3, 3, 3]);
});

test('13.7: the Favorites grid has no limit: every favorite shows, the size only sets the columns (2, 3 or 4 across)', () => {
  assert.deepEqual(FAVORITES_ACROSS, { narrow: 2, standard: 3, wide: 4 });
  assert.equal((sidebarSizes as Record<string, unknown>).FAVORITES_LIMIT, undefined, 'no cap before a "+N" tile');
  // 24 favorites (the most there can be) fill 12, 8 and 6 rows at the three sizes: the grid grows, the list below scrolls as it always did.
  assert.deepEqual(SIDEBAR_SIZE_ORDER.map((size) => Math.ceil(24 / favoriteColumns(size, 24))), [12, 8, 6]);
  for (const size of SIDEBAR_SIZE_ORDER) for (const tiles of [1, 7, 12, 13, 24]) assert.ok(favoriteColumns(size, tiles) >= 2 && favoriteColumns(size, tiles) <= 4, `${size} ${tiles}`);
});

test('arrow keys step through the sizes and stop at the ends', () => {
  assert.equal(steppedSize('narrow', -1), 'narrow');
  assert.equal(steppedSize('narrow', 1), 'standard');
  assert.equal(steppedSize('standard', -1), 'narrow');
  assert.equal(steppedSize('standard', 1), 'wide');
  assert.equal(steppedSize('wide', 1), 'wide');
  assert.equal(steppedSize('wide', -1), 'standard');
});

test('the edge menu: its ref reaches the popup as a word-and-dash id and opens the size menu, with the current size ticked', () => {
  assert.equal(SIZE_REF, 'node:sidebar-size');
  assert.match(SIZE_REF.slice('node:'.length), /^(?:new:)?[\w.-]{1,120}$/, 'main accepts the id (desktop/validation.cjs, the bookmark menu target)');
  assert.deepEqual(bookmarkTarget(SIZE_REF, [], 'p'), { kind: 'size' });
  assert.deepEqual(bookmarkTarget('node:zone-history', [], 'p'), { kind: 'zone', section: 'history' }, 'the section menus are untouched');
  const menu = read('src/components/sidebar/BookmarkMenu.tsx');
  assert.match(menu, /target\.kind==='size'\)return <SizeMenu/);
});

test('the size menu lists Narrow, Standard and Wide, ticks the current one and writes the width of the one chosen', async () => {
  const { SizeMenu } = await import('../src/components/sidebar/SizeMenu');
  const calls: string[] = [], dispatched: unknown[] = [];
  const row = (label: string, Icon: unknown, action: () => void) => { calls.push(label + (Icon === Check ? ' ✓' : '')); (row as unknown as { actions: Array<() => void> }).actions.push(action); return createElement('button', { key: label }, label); };
  (row as unknown as { actions: Array<() => void> }).actions = [];
  for (const [width, ticked] of [[168, 'Narrow'], [240, 'Standard'], [312, 'Wide']] as const) {
    calls.length = 0;
    const state = { settings: { sidebarWidth: width } } as never;
    renderToStaticMarkup(createElement(SizeMenu, { state, dispatch: (action: unknown) => dispatched.push(action), row: row as never, close: () => dispatched.push('closed') }));
    assert.deepEqual(calls.map((call) => call.replace(' ✓', '')), ['Narrow', 'Standard', 'Wide']);
    assert.equal(calls.filter((call) => call.endsWith('✓')).length, 1, 'one tick');
    assert.ok(calls.includes(ticked + ' ✓'), `${ticked} ticked at ${width}`);
  }
  const actions = (row as unknown as { actions: Array<() => void> }).actions.slice(-3);
  dispatched.length = 0; actions[0](); actions[2]();
  assert.deepEqual(dispatched, [{ type: 'settings.update', patch: { sidebarWidth: 168 } }, 'closed', { type: 'settings.update', patch: { sidebarWidth: 312 } }, 'closed']);
});

test('the edge: it opens the menu on a right-click and with the menu key, snaps on release, and mirrors on the right (source)', () => {
  const sidebar = read('src/components/sidebar/AciraSidebar.tsx');
  const handle = sidebar.slice(sidebar.indexOf('function ResizeHandle'), sidebar.indexOf('function ResizeHandle') + 3200);
  assert.match(handle, /onContextMenu=\{event=>\{event\.preventDefault\(\);event\.stopPropagation\(\);openBookmarkMenu\(SIZE_REF/);
  assert.match(handle, /event\.key==='ContextMenu'\|\|event\.shiftKey&&event\.key==='F10'/);
  assert.match(handle, /const target=snapSidebarWidth\(drag\.current\.raw\)/, 'a release lands on the nearest size');
  assert.match(handle, /draggedSidebarWidth\(side,/, 'the drag is the side-aware one');
  assert.match(handle, /sidebarKeyWidth\(side,/);
  // the hook runs before SidebarApps' early returns (React error #310 otherwise: tests/hooks-order.test.ts); the limit follows it
  assert.match(sidebar, /const size=useSidebarSize\(clampSidebarWidth\(state\.settings\.sidebarWidth\)\);/, 'the Favorites grid follows the size, live while the edge is dragged');
  assert.match(sidebar, /const tiles=apps\.length,cols=favoriteColumns\(size,tiles\)/);
  assert.doesNotMatch(sidebar, /tiles%3!==0&&tiles%4===0\|\|tiles===4\?4:3/, 'the column rule lives in runtime/sidebarSizes.ts only');
  const layout = read('src/ui/sidebarLayout.ts');
  assert.match(layout, /setPreviewedSize\(sizeOf\(width\)\)/, 'the preview publishes the size, not every pixel');
});

test('Settings: the Width row is gone, "Sidebar size" has three pictures right under Show sidebar, and search finds it by the words people use', () => {
  const panel = read('src/features/settings/panels/sidebar.tsx');
  assert.doesNotMatch(panel, /id="sidebar-width"|sidebar\.resetWidth|sidebar\.widthDetail/);
  assert.ok(panel.indexOf('id="sidebar-visible"') < panel.indexOf('<SidebarSizeRow') && panel.indexOf('<SidebarSizeRow') < panel.indexOf('<SidebarSideRow'), 'Show sidebar, Sidebar size, then the side');
  const row = read('src/features/settings/SidebarSizeRow.tsx');
  assert.match(row, /id="sidebar-size"/);
  assert.match(row, /data-mini-layout="sidebar"/, 'the miniature mirrors with the sidebar on the right (sidebar-right.css)');
  assert.match(row, /sidebarWidth: SIDEBAR_SIZES\[size\]/);
  const entries = read('src/features/settings/entries/sidebar.ts');
  for (const word of ['narrow', 'wide', 'smaller sidebar', 'thinner sidebar', 'sidebar width', 'sidebar size', 'resize sidebar']) assert.ok(entries.includes(`'${word}'`), word);
  assert.doesNotMatch(entries, /id: 'sidebar-width'/);
});

test('every language has the new words and none keeps the retired ones', () => {
  const ids = ['sidebar.sizeTitle', 'sidebar.sizeDetail', 'sidebar.sizeSearchDetail', 'sidebar.sizeNarrow', 'sidebar.sizeStandard', 'sidebar.sizeWide'];
  const gone = ['sidebar.width', 'sidebar.widthDetail', 'sidebar.resetWidth', 'sidebar.sidebarWidth', 'sidebar.resetTheSidebarToIts'];
  const en = catalog('en');
  for (const { code } of LOCALES) {
    const messages = catalog(code);
    for (const id of ids) assert.ok(messages[id] && messages[id].trim(), `${code} ${id}`);
    for (const id of gone) assert.equal(id in messages, false, `${code} still has ${id}`);
    assert.ok(/(?:Right|right|Rechts|derecho|droit|राइट|destro|右|오른쪽|direito|Правый|sağ|بزر|右键)/.test(messages['acirasidebar.dragToResizeDoubleClick']) || code === 'en', `${code}: the edge's tooltip mentions the right-click`);
    if (code !== 'en') for (const id of ['sidebar.sizeNarrow', 'sidebar.sizeStandard', 'sidebar.sizeWide'] as const) if (!['de', 'fr', 'it', 'tr'].includes(code) || id !== 'sidebar.sizeStandard') assert.notEqual(messages[id], en[id], `${code} ${id} left in English`);
  }
});
