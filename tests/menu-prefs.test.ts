// This measured fixture describes the incoming Windows menu.
Object.assign(globalThis,{window:{acira:{platform:'win32'}}});
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMenuLayout, isDefaultMenuLayout, menuHeight, menuSections, moveMenuItem, moveMenuItemToList, normalizeMenuLayout, reorderMenuList, setMenuItemHidden, type MenuLayout } from '../src/ui/menuPrefs';
import { menuDense, menuFullHeight, menuLayoutRows, popupNaturalHeight, submenuHeaderHeight } from '../src/ui/popup';
import type { BrowserSnapshot } from '../src/runtime/types';

const state = { activeTabId: 'a', tabs: [{ id: 'a', contentKind: 'web', browserProfileId: '' }], bookmarks: [], downloads: [], browserProfiles: [{}] } as unknown as BrowserSnapshot;

test('the default composition is the measured menu: 588px for the main menu, 360px for More tools (Seamless is its own toggle beside Focus, R3-68)', () => {
  assert.equal(menuHeight(defaultMenuLayout, 'main'), 588);
  assert.equal(menuHeight(defaultMenuLayout, 'more'), 360);
  assert.equal(menuHeight(defaultMenuLayout, 'main', 26), 516, 'the dense menu at 26px rows is the measured 516px');
  assert.equal(popupNaturalHeight('menu', state), 588 + 2 * 30, 'plus the two Layout rows: View and Tabs (R4-16, R4-19; Sidebar mode is a Tabs answer, not a row of its own)');
  assert.equal(popupNaturalHeight('more-tools', state), 360);
});

test('every row is in exactly one list and the default layout is stable under normalising', () => {
  const layout = normalizeMenuLayout(undefined);
  assert.deepEqual(layout, defaultMenuLayout);
  assert.equal(isDefaultMenuLayout(layout), true);
  const all = [...layout.main, ...layout.more, ...layout.hidden];
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 27);
});

test('normalising drops unknown rows, keeps the first of a duplicate and puts missing rows back where they belong', () => {
  const messy = normalizeMenuLayout({ main: ['history', 'nope', 'newTab', 'history'], more: ['history', 'vpn'], hidden: ['rewind'] });
  assert.equal(messy.main[0], 'history');
  assert.ok(messy.main.indexOf('newTab') > messy.main.indexOf('history'), 'the saved order is kept');
  assert.equal(messy.main[1], 'recentlyClosed', 'a missing row lands after its nearest default predecessor');
  assert.equal(messy.more.includes('history' as never), false);
  assert.equal(messy.hidden.join(), 'rewind');
  assert.deepEqual(messy.more, defaultMenuLayout.more, 'a lone saved row sits among its restored neighbours');
  const all = [...messy.main, ...messy.more, ...messy.hidden];
  assert.equal(all.length, 27, 'every row is accounted for');
  assert.deepEqual(normalizeMenuLayout(null), defaultMenuLayout);
  assert.deepEqual(normalizeMenuLayout('x'), defaultMenuLayout);
});

test('reorder, move between lists, hide and show', () => {
  let layout: MenuLayout = defaultMenuLayout;
  layout = moveMenuItem(layout, 'history', -1);
  assert.deepEqual(layout.main.slice(11, 13), ['history', 'bookmarks']);
  assert.equal(moveMenuItem(layout, 'newTab', -1), layout, 'the first row cannot move up');
  layout = reorderMenuList(layout, 'main', [...layout.main].reverse());
  assert.equal(layout.main[0], 'downloads');
  layout = moveMenuItemToList(layout, 'downloads', 'more');
  assert.equal(layout.main.includes('downloads'), false);
  assert.ok(layout.more.includes('downloads'));
  layout = setMenuItemHidden(layout, 'rewind', true);
  assert.deepEqual(layout.hidden, ['rewind']);
  assert.equal([...layout.main, ...layout.more].includes('rewind'), false);
  layout = setMenuItemHidden(layout, 'rewind', false);
  assert.deepEqual(layout.hidden, []);
  assert.ok(layout.main.includes('rewind'), 'a shown row returns to the list it came from');
  assert.equal(isDefaultMenuLayout(layout), false);
});

test('a hairline is drawn wherever the group changes, and the popup height follows the count (R3-43)', () => {
  const sections = menuSections(['newTab', 'newPrivateTab', 'history', 'newWindow']);
  assert.deepEqual(sections.map(section => section.length), [2, 1, 1], 'groups: tabs, library, windows');
  const hideTor = setMenuItemHidden(setMenuItemHidden(defaultMenuLayout, 'newTorTab', true), 'newTorWindow', true);
  assert.equal(menuHeight(hideTor, 'main'), 588 - 2 * 30, 'two fewer rows, same separators');
  const moved = moveMenuItemToList(defaultMenuLayout, 'downloads', 'more');
  assert.equal(menuHeight(moved, 'main'), 588 - 30);
  assert.equal(menuHeight(moved, 'more'), 360 + 30 + 9, 'with no row of its own kind there, Downloads opens a new section at the foot: one row and one hairline more');
  const empty: MenuLayout = { main: [], more: [], hidden: [...defaultMenuLayout.main, ...defaultMenuLayout.more] };
  assert.equal(menuHeight(empty, 'main'), 12 + 30, 'with nothing in More tools its row is not drawn; Settings stays');
  assert.equal(menuHeight({ ...defaultMenuLayout, more: [] }, 'more'), 12);
});

test('a submenu opened from the menu starts with a back row: More tools and Downloads gain one, the others already have a title bar', () => {
  assert.equal(popupNaturalHeight('more-tools', state, { parent: 'menu' }), 360 + submenuHeaderHeight);
  assert.equal(popupNaturalHeight('downloads', state, { parent: 'menu' }), popupNaturalHeight('downloads', state) + submenuHeaderHeight);
  assert.equal(popupNaturalHeight('bookmarks', state, { parent: 'menu' }), popupNaturalHeight('bookmarks', state));
  assert.equal(popupNaturalHeight('recent-closed', state, { parent: 'menu' }), popupNaturalHeight('recent-closed', state), 'Recently closed keeps its title bar: the back row replaces the title');
  assert.equal(popupNaturalHeight('menu', state, { parent: 'menu' }), 588 + 2 * 30);
});

test('a layout saved before Recently closed replaced "Reopen closed tab" keeps that row\'s place and choice', () => {
  const moved = normalizeMenuLayout({ main: ['newTab', 'reopen', 'history'], more: ['allTabs'], hidden: [] });
  const order = ['newTab', 'recentlyClosed', 'history'].map(id => (moved.main as string[]).indexOf(id));
  assert.ok(order[0] >= 0 && order[0] < order[1] && order[1] < order[2], 'the saved place is kept under the new id');
  assert.equal(moved.main.filter(id => id === 'recentlyClosed').length, 1);
  assert.equal((moved.main as string[]).includes('reopen'), false);
  const hidden = normalizeMenuLayout({ main: ['newTab'], more: [], hidden: ['reopen'] });
  assert.deepEqual(hidden.hidden, ['recentlyClosed'], 'a hidden row stays hidden');
  const both = normalizeMenuLayout({ main: ['reopen', 'recentlyClosed'] });
  assert.equal(both.main.filter(id => id === 'recentlyClosed').length, 1, 'the old and new id never both appear');
  const all = [...both.main, ...both.more, ...both.hidden];
  assert.equal(new Set(all).size, 27);
  assert.ok(defaultMenuLayout.main.includes('recentlyClosed') && !(defaultMenuLayout.main as string[]).includes('reopen'), 'the default layout carries the new row');
});

test('R4-16 + R4-19: the Layout rows ride with the page group and the menu still fits without scrolling', () => {
  assert.equal(menuLayoutRows(defaultMenuLayout.main), 2, 'View and Tabs (Sidebar mode is a Tabs answer, not a row)');
  assert.equal(menuLayoutRows(defaultMenuLayout.main.filter(id => !['find', 'zoom', 'split'].includes(id))), 0, 'no page group, no rows');
  assert.equal(menuFullHeight, popupNaturalHeight('menu', state));
  // 1080p at 150% (about 680 CSS px of window): the dense rows still fit under the menu button (72 + 648 x 26/30 + 20 = 654 of 700).
  assert.equal(menuDense(680), true);
  assert.ok(72 + popupNaturalHeight('menu', state) * 26 / 30 + 20 <= 680 + 20);
});
