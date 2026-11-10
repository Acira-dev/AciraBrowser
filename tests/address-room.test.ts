import test from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

// 13.6 "room in the address field" (a Windows report): the zoom level and the bookmark star sat in the field for good and left no room to click, and the
// suggestion list printed "From your history" beside every title, so in a narrow sidebar a title was cut to "List...".
//   1. The zoom level shows as a figure for two seconds after a zoom change, then rests as a small magnifier that still opens the zoom controls.
//   2. The magnifier and the star can be hidden: right-click > Hide, Customize toolbar, Settings (the same two switches everywhere).
//   3. A history suggestion has no "From your history" text; its title has the whole row, and its remove (x) shows on hover.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
Object.assign(globalThis, {
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  window: { acira: { platform: 'darwin', subscribeBrowser: () => () => undefined, service: async () => ({}) }, addEventListener: () => undefined, removeEventListener: () => undefined, matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) },
});
const { ZOOM_TEXT_MS, zoomChanged, zoomState, nextZoomText } = await import('../src/ui/zoomBadge');
const { toolbarVisibilityItems } = await import('../src/ui/toolbarMenu');
const { createInitialState, restoreSnapshot } = await import('../src/runtime/core');
const { AddressSuggestions } = await import('../src/components/AddressSuggestions');
const validation = createRequire(import.meta.url)('../desktop/validation.cjs');
import type { AddressSuggestion } from '../src/ui/addressSuggestions';

test('the figure shows for two seconds', () => { assert.equal(ZOOM_TEXT_MS, 2000); });

test('only a zoom change on the same tab and address is a change the figure shows for', () => {
  const tab = { id: 'a', url: 'https://x.test/', zoom: 100 };
  assert.equal(zoomChanged(tab, { ...tab, zoom: 110 }), true);
  assert.equal(zoomChanged(tab, tab), false, 'no change');
  assert.equal(zoomChanged(tab, { ...tab, id: 'b', zoom: 110 }), false, 'another tab (a switch)');
  assert.equal(zoomChanged(tab, { ...tab, url: 'https://y.test/', zoom: 110 }), false, 'another address (a navigation to a zoomed site)');
});

test('the figure state follows the tab: a change shows it, a switch or a navigation ends it, a repeat render keeps it', () => {
  const start = { id: 'a', url: 'https://x.test/', zoom: 100, text: false };
  const changed = nextZoomText(start, { id: 'a', url: 'https://x.test/', zoom: 110 });
  assert.equal(changed.text, true, 'zoomed: figure');
  assert.equal(nextZoomText(changed, { id: 'a', url: 'https://x.test/', zoom: 110 }), changed, 'same render again: same state (no loop)');
  const again = nextZoomText(changed, { id: 'a', url: 'https://x.test/', zoom: 125 });
  assert.equal(again.text, true, 'a second change keeps the figure (the two seconds start again)');
  assert.equal(nextZoomText(again, { id: 'b', url: 'https://x.test/', zoom: 125 }).text, false, 'switching tabs ends it');
  assert.equal(nextZoomText(again, { id: 'a', url: 'https://y.test/', zoom: 125 }).text, false, 'navigating ends it');
  // A zoomed page seen for the first time (a new window, a restart, switching back to it) is the magnifier at once, not the figure.
  assert.equal(nextZoomText({ id: 'a', url: 'u', zoom: 100, text: false }, { id: 'b', url: 'u', zoom: 150 }).text, false);
});

test('the three looks of the zoom control', () => {
  const base = { zoom: 110, recent: false, iconShown: true, bubbleOpen: false };
  assert.equal(zoomState({ ...base, recent: true }), 'text', 'after a change: the figure');
  assert.equal(zoomState(base), 'glyph', 'at rest, zoomed: the magnifier');
  assert.equal(zoomState({ ...base, iconShown: false }), 'away', 'hidden: nothing at rest');
  assert.equal(zoomState({ ...base, iconShown: false, recent: true }), 'text', 'hidden: the figure still shows for the two seconds after a change');
  assert.equal(zoomState({ ...base, zoom: 100 }), 'away', 'at 100% nothing rests in the field');
  assert.equal(zoomState({ ...base, zoom: 100, iconShown: false, recent: true }), 'away', 'at 100% a hidden icon shows nothing');
  assert.equal(zoomState({ ...base, zoom: 100, bubbleOpen: true }), 'text', 'at 100% the zoom bubble has the figure to hang from');
});

test('Customize toolbar, Settings and the right-click toolbar menu share two switches; both start on and turn off with one patch', () => {
  const s = createInitialState().settings;
  assert.equal(s.showZoomIcon, true);
  assert.equal(s.showBookmarkStar, true);
  const items = toolbarVisibilityItems(s);
  const zoom = items.find(item => item.id === 'showZoomIcon'), star = items.find(item => item.id === 'showBookmarkStar');
  assert.ok(zoom && star, 'both are listed');
  assert.equal(zoom.checked, true);
  assert.equal(star.checked, true);
  assert.deepEqual(zoom.action, { type: 'settings.update', patch: { showZoomIcon: false } });
  assert.deepEqual(star.action, { type: 'settings.update', patch: { showBookmarkStar: false } });
  const off = { ...s, showZoomIcon: false, showBookmarkStar: false };
  const back = toolbarVisibilityItems(off);
  assert.equal(back.find(item => item.id === 'showZoomIcon')!.checked, false);
  assert.deepEqual(back.find(item => item.id === 'showZoomIcon')!.action.patch, { showZoomIcon: true });
  assert.deepEqual(back.find(item => item.id === 'showBookmarkStar')!.action.patch, { showBookmarkStar: true });
  // A saved profile from before 13.6 has neither key: both read as on.
  const old = { ...s } as unknown as Record<string, unknown>; delete old.showZoomIcon; delete old.showBookmarkStar;
  assert.equal(toolbarVisibilityItems(old as unknown as typeof s).find(item => item.id === 'showZoomIcon')!.checked, true);
  assert.equal(toolbarVisibilityItems(old as unknown as typeof s).find(item => item.id === 'showBookmarkStar')!.checked, true);
});

test('the choice is saved with the profile and survives a restart', () => {
  const state = createInitialState();
  const saved = JSON.parse(JSON.stringify({ ...state, settings: { ...state.settings, showZoomIcon: false, showBookmarkStar: false } }));
  const restored = restoreSnapshot(saved);
  assert.equal(restored.settings.showZoomIcon, false);
  assert.equal(restored.settings.showBookmarkStar, false);
  const fromOld = restoreSnapshot(JSON.parse(JSON.stringify({ ...state, settings: Object.fromEntries(Object.entries(state.settings).filter(([key]) => key !== 'showZoomIcon' && key !== 'showBookmarkStar')) })));
  assert.notEqual(fromOld.settings.showZoomIcon, false, 'an old save shows the icon');
  assert.notEqual(fromOld.settings.showBookmarkStar, false, 'an old save shows the star');
});

test('the main process accepts the two switches as booleans only', () => {
  const snapshot = createInitialState();
  const ok = (patch: unknown) => { validation.validateAction({ type: 'settings.update', patch }, snapshot); };
  assert.doesNotThrow(() => ok({ showZoomIcon: false }));
  assert.doesNotThrow(() => ok({ showBookmarkStar: true }));
  assert.throws(() => ok({ showZoomIcon: 'no' }));
  assert.throws(() => ok({ showBookmarkStar: 0 }));
});

const history = (id: string, title: string): AddressSuggestion => ({ id: `local:${id}`, kind: 'history', title, url: `https://${id}.test/`, detail: 'From your history', historyId: id });
const render = (items: AddressSuggestion[]) => renderToStaticMarkup(createElement(AddressSuggestions, { items, activeIndex: -1, query: 'list', onActiveIndexChange: () => undefined, onChoose: () => undefined, onRemove: () => undefined, reducedMotion: true, speed: 1 }));

test('a history suggestion prints no "From your history" beside its title (a screen reader still hears it)', () => {
  const html = render([history('a', 'List of the best things to watch tonight')]);
  assert.ok(!/class="address-suggestion-source"/.test(html), 'no visible source label');
  assert.ok(/<span class="address-suggestions-a11y">From your history<\/span>/.test(html), 'the source stays in the reading order for assistive technology');
  assert.ok(/class="address-suggestion-remove"/.test(html), 'the remove (x) is still there');
  assert.ok(/data-removable/.test(html), 'the row says it has one (the title fades under it on hover)');
});

test('titles and addresses pick their own direction, so a right-to-left title is cut at its end (and a Latin one as before)', () => {
  const html = render([history('a', 'قائمة الأفلام المقترحة لهذا المساء')]);
  assert.match(html, /<span dir="auto">/);
  assert.match(html, /<small dir="auto">/);
});

test('other rows keep their labels', () => {
  const bookmark: AddressSuggestion = { id: 'b', kind: 'bookmark', title: 'Saved page', url: 'https://b.test/', detail: 'Bookmark' };
  const tab: AddressSuggestion = { id: 't', kind: 'tab', title: 'Open page', url: 'https://t.test/', detail: 'Already open', tabId: 'tab-1' };
  const html = render([bookmark, tab]);
  assert.ok(/class="address-suggestion-source">Bookmark</.test(html));
  assert.ok(/class="address-suggestion-action"/.test(html), 'Switch to tab is still a button');
});

test('the remove (x) is out of the row\'s flow and shows on hover or selection', () => {
  const css = read('../src/components/AddressSuggestions.css');
  assert.match(css, /\.address-suggestion-remove\{position:absolute;[^}]*opacity:0;pointer-events:none\}/, 'at rest it takes no room and cannot be hit');
  assert.match(css, /\.address-suggestion:is\(:hover,\[aria-selected=true\]\) \.address-suggestion-remove,\.address-suggestion-remove:focus-visible\{opacity:1;pointer-events:auto\}/);
  assert.match(css, /\.address-suggestion\[data-removable\]:has\(\.address-suggestion-copy>span:dir\(rtl\)\) \.address-suggestion-copy\{padding-right:36px\}/, 'a right-to-left title keeps the x\'s room (it starts where the x is)');
  assert.ok(!/:dir\(rtl\) \.address-suggestion-copy\{[^}]*mask-image/.test(css));
});

test('App: the star and the zoom icon follow the two switches, offer Hide on right-click, and popups hang from the field when they are gone', () => {
  const app = read('../src/App.tsx');
  assert.match(app, /bookmark\.reason !== 'private' && s\.showBookmarkStar !== false && <button/, 'the star is not drawn when hidden');
  assert.match(app, /iconShown: s\.showZoomIcon !== false/, 'the magnifier follows its switch');
  assert.match(app, /data-state=\{zoomLook\}/);
  assert.match(app, /onContextMenu=\{event => addressItemMenu\(event, 'address-star'\)\}/);
  assert.match(app, /onContextMenu=\{event => addressItemMenu\(event, 'address-zoom'\)\}/);
  assert.match(app, /open\('toolbar-context', id, \{ x: event\.clientX, y: event\.clientY, width: 2, height: 2 \}\)/, 'the menu opens at the pointer');
  assert.match(app, /overlay === 'toolbar-context' && contextId \? \{ node: contextId \}/, 'the target travels as a node id: a tab id that is not a tab makes main drop the popup');
  assert.match(app, /fallbackFor: Record<string, string> = \{ zoom: '\.address-bar', 'bookmark-edit': '\.address-bar' \}/, 'the editor and the zoom bubble hang from the field when the star or the icon is hidden');
  assert.match(app, /kind === 'toolbar-context' && addressItem && row\(tr\("addressitem\.hide"\), Eye/);
  assert.match(app, /showZoomIcon: false \} : \{ showBookmarkStar: false \}/, 'Hide turns off exactly that one switch');
});

test('the right-click toolbar menu gives the two switches their glyphs (a missing glyph would break the menu)', () => {
  assert.match(read('../src/App.tsx'), /toolbarItemIcons: Record<string, BrowserMenuIcon> = \{[^}]*showZoomIcon: Search, showBookmarkStar: Star/);
});

test('the zoom icon, like the star, does not take focus from the field on a press', () => {
  assert.match(read('../src/App.tsx'), /data-state=\{zoomLook\} onPointerDown=\{event => event\.preventDefault\(\)\}/);
});

test('every language has the new words', () => {
  const ids = ['core.showZoomIcon', 'core.zoomIconInTheAddress', 'core.showBookmarkStar', 'core.bookmarkStarInTheAddress', 'addressitem.hide'];
  const en = JSON.parse(read('../src/i18n/en.json'));
  for (const id of ids) assert.ok(en[id], `en ${id}`);
  for (const locale of ['es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']) {
    const catalog = JSON.parse(read(`../src/i18n/${locale}.json`));
    for (const id of ids) assert.ok(catalog[id] && catalog[id] !== en[id] || id === 'addressitem.hide' && catalog[id], `${locale} ${id}`);
  }
});

test('the toolbar Reset restores both switches', () => {
  assert.match(read('../src/features/BrowserSettings.tsx'), /showHome: true,\s*showTabOverview: true,\s*showZoomIcon: true,\s*showBookmarkStar: true,/);
  assert.match(read('../src/components/ToolbarCustomizer.tsx'), /showHome: true, showTabOverview: true, showZoomIcon: true, showBookmarkStar: true/);
  assert.match(read('../src/features/BrowserSettings.tsx'), /s\.showZoomIcon === false \|\|\s*s\.showBookmarkStar === false \|\|/, 'a hidden one counts as a changed toolbar (the Reset row appears)');
});
