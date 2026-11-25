// This measured fixture describes the incoming Windows menu.
Object.assign(globalThis,{window:{acira:{platform:'win32'}}});
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMenuLayout, isDefaultMenuLayout, menuHeight, menuItemGroups, menuItemLabel, menuSections, moveMenuItem, moveMenuItemToList, normalizeMenuLayout, platformMenuLayout, reorderMenuList, setMenuItemHidden, type MenuLayout } from '../src/ui/menuPrefs';
import { menuDense, menuFullHeight, menuLayoutRows, popupNaturalHeight, submenuHeaderHeight } from '../src/ui/popup';
import type { BrowserSnapshot } from '../src/runtime/types';

const state = { activeTabId: 'a', tabs: [{ id: 'a', contentKind: 'web', browserProfileId: '' }], bookmarks: [], downloads: [], browserProfiles: [{}] } as unknown as BrowserSnapshot;

test('the default composition is 618px for the main menu (the measured 588px and the transfer row), More tools with both new rows (Seamless is its own toggle beside Focus, R3-68; Beta 14 R added Take screenshot and S added Zap element, page tools beside Print and Save page)', () => {
  assert.equal(menuHeight(defaultMenuLayout, 'main'), 588 + 30, '"Move or copy this profile to another computer…" is one more 30px row in the library group: no new hairline');
  assert.equal(menuHeight(defaultMenuLayout, 'more'), 450, 'Beta 14: the Task manager row beside Developer tools is one more 30px row, no new hairline');
  assert.equal(menuHeight(defaultMenuLayout, 'main', 26), 516 + 26, 'the dense menu at 26px rows: the measured 516px and the row');
  assert.equal(popupNaturalHeight('menu', state), 588 + 30 + 2 * 30, 'plus the two Layout rows: View and Tabs (R4-16, R4-19; Sidebar mode is a Tabs answer, not a row of its own)');
  assert.equal(popupNaturalHeight('more-tools', state), 450);
});

test('every row is in exactly one list and the default layout is stable under normalising', () => {
  const layout = normalizeMenuLayout(undefined);
  assert.deepEqual(layout, defaultMenuLayout);
  assert.equal(isDefaultMenuLayout(layout), true);
  const all = [...layout.main, ...layout.more, ...layout.hidden];
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 31);
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
  assert.equal(all.length, 31, 'every row is accounted for');
  assert.deepEqual(normalizeMenuLayout(null), defaultMenuLayout);
  assert.deepEqual(normalizeMenuLayout('x'), defaultMenuLayout);
});

test('reorder, move between lists, hide and show', () => {
  let layout: MenuLayout = defaultMenuLayout;
  layout = moveMenuItem(layout, 'history', -1);
  assert.deepEqual(layout.main.slice(11, 13), ['history', 'bookmarks']);
  assert.equal(moveMenuItem(layout, 'newTab', -1), layout, 'the first row cannot move up');
  layout = reorderMenuList(layout, 'main', [...layout.main].reverse());
  assert.equal(layout.main[0], 'transfer', 'reversed: the last row of the menu is now the transfer row');
  assert.equal(layout.main[1], 'downloads');
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
  assert.equal(menuHeight(hideTor, 'main'), 588 + 30 - 2 * 30, 'two fewer rows, same separators');
  const moved = moveMenuItemToList(defaultMenuLayout, 'downloads', 'more');
  assert.equal(menuHeight(moved, 'main'), 588, 'Downloads leaves, the transfer row stays: 618 - 30');
  assert.equal(menuHeight(moved, 'more'), 450 + 30 + 9, 'with no row of its own kind there, Downloads opens a new section at the foot: one row and one hairline more');
  const empty: MenuLayout = { main: [], more: [], hidden: [...defaultMenuLayout.main, ...defaultMenuLayout.more] };
  assert.equal(menuHeight(empty, 'main'), 12 + 30, 'with nothing in More tools its row is not drawn; Settings stays');
  assert.equal(menuHeight({ ...defaultMenuLayout, more: [] }, 'more'), 12);
});

test('a submenu opened from the menu starts with a back row: More tools and Downloads gain one, the others already have a title bar', () => {
  assert.equal(popupNaturalHeight('more-tools', state, { parent: 'menu' }), 450 + submenuHeaderHeight);
  assert.equal(popupNaturalHeight('downloads', state, { parent: 'menu' }), popupNaturalHeight('downloads', state) + submenuHeaderHeight);
  assert.equal(popupNaturalHeight('bookmarks', state, { parent: 'menu' }), popupNaturalHeight('bookmarks', state));
  assert.equal(popupNaturalHeight('recent-closed', state, { parent: 'menu' }), popupNaturalHeight('recent-closed', state), 'Recently closed keeps its title bar: the back row replaces the title');
  assert.equal(popupNaturalHeight('menu', state, { parent: 'menu' }), 588 + 30 + 2 * 30);
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
  assert.equal(new Set(all).size, 31);
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

test('beta.14: "Move or copy this profile to another computer…" is the last row of the library group, after Downloads, and the last row of the default menu', () => {
  assert.equal(menuItemGroups.transfer, 'library');
  assert.equal(defaultMenuLayout.main.at(-1), 'transfer');
  assert.equal(defaultMenuLayout.main.indexOf('transfer'), defaultMenuLayout.main.indexOf('downloads') + 1);
  assert.equal(menuItemLabel('transfer'), 'Move or copy this profile to another computer…', 'the customizer lists it by the menu\'s own words');
  const library = menuSections(defaultMenuLayout.main).find(section => section.includes('transfer'))!;
  assert.deepEqual(library, ['bookmarks', 'history', 'recentlyClosed', 'rewind', 'downloads', 'transfer'], 'one group, so no hairline of its own');
  assert.equal(menuSections(defaultMenuLayout.main).length, 4, 'the four sections the main menu always had: tabs, windows, page, library');
  assert.equal(defaultMenuLayout.more.includes('transfer' as never), false, 'it sits in the main menu by default, not in More tools');
});

test('a layout saved before the transfer row existed gets it after Downloads, or after the nearest row it does have', () => {
  const old = defaultMenuLayout.main.filter(id => id !== 'transfer');
  const upgraded = normalizeMenuLayout({ main: old, more: defaultMenuLayout.more, hidden: [] });
  assert.deepEqual(upgraded, defaultMenuLayout, 'the stock layout comes back exactly');
  const reordered = normalizeMenuLayout({ main: ['downloads', 'newTab', 'history'], more: ['allTabs'], hidden: [] });
  assert.equal(reordered.main[reordered.main.indexOf('downloads') + 1], 'transfer', 'beside Downloads, wherever the person put it');
  const away = normalizeMenuLayout({ main: ['newTab', 'history', 'rewind'], more: ['downloads', 'allTabs'], hidden: [] });
  assert.equal(away.main[away.main.indexOf('rewind') + 1], 'transfer', 'Downloads moved to More tools: it follows the nearest default row still in the menu');
  assert.ok(away.more.includes('downloads'));
});

test('the transfer row hides, moves and comes back like any other row of the customizer', () => {
  let layout: MenuLayout = setMenuItemHidden(defaultMenuLayout, 'transfer', true);
  assert.deepEqual(layout.hidden, ['transfer']);
  assert.equal([...layout.main, ...layout.more].includes('transfer'), false);
  assert.equal(menuHeight(layout, 'main'), 588, 'a hidden row is not counted');
  layout = setMenuItemHidden(layout, 'transfer', false);
  assert.deepEqual(layout.hidden, []);
  assert.deepEqual(layout.main.slice(-2), ['downloads', 'transfer'], 'shown again beside its group');
  layout = moveMenuItem(layout, 'transfer', -1);
  assert.deepEqual(layout.main.slice(-2), ['transfer', 'downloads'], 'reordered by one place');
  layout = moveMenuItemToList(layout, 'transfer', 'more');
  assert.equal(layout.main.includes('transfer' as never), false);
  assert.equal(layout.more.at(-1), 'transfer', 'More tools has no library row, so it lands at the foot');
  assert.deepEqual(normalizeMenuLayout(layout), layout, 'and the choice survives normalising');
});

test('a private or Tor window never draws or counts the transfer row, wherever the person put it', () => {
  const blocked = platformMenuLayout(defaultMenuLayout, true);
  assert.equal(blocked.main.includes('transfer' as never), false);
  assert.equal(menuHeight(blocked, 'main'), 588, 'the 30px is not counted either');
  assert.equal(platformMenuLayout(defaultMenuLayout, false), defaultMenuLayout, 'an ordinary window keeps the very same layout');
  assert.equal(platformMenuLayout(defaultMenuLayout), defaultMenuLayout, 'and so does a caller that does not say');
  const moved = moveMenuItemToList(defaultMenuLayout, 'transfer', 'more');
  assert.equal(platformMenuLayout(moved, true).more.includes('transfer' as never), false, 'also from More tools');
  assert.equal(platformMenuLayout(moved, false).more.at(-1), 'transfer');
  const hidden = setMenuItemHidden(defaultMenuLayout, 'transfer', true);
  assert.deepEqual(platformMenuLayout(hidden, true).hidden, [], 'the customizer\'s hidden list is the person\'s own; a blocked window does not list it');
});
