import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { bookmarkTarget, zoneRef } from '../src/ui/bookmarkMenu';
import { hideSection, parseSidebarRequest, restoreHiddenSection, sectionHiddenToast, sectionLayout } from '../src/ui/sidebarSections';
import { readRailPrefs, setRailPrefs } from '../src/ui/railPrefs';
import { readSidebarApps, setSidebarAppsHidden } from '../src/ui/sidebarApps';
const require = createRequire(import.meta.url);

// A sidebar section's right-click menu: Hide this section (at once, with a toast and Undo) and Customize sidebar….
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, String(value)); }, removeItem: (key: string) => { store.delete(key); } },
  window: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
});

test('a section menu is a bookmark-context menu whose ref main accepts as a node id', () => {
  const ref = zoneRef('history');
  assert.equal(ref, 'node:zone-history');
  // The overlay hands the ref over as context.node (the part after "node:"), which desktop/validation.cjs holds to [\w.-]{1,120}.
  assert.match(ref.slice(5), /^(?:new:)?[\w.-]{1,120}$/);
  assert.deepEqual(bookmarkTarget(ref, [], 'p1'), { kind: 'zone', section: 'history' });
  assert.deepEqual(bookmarkTarget('node:root', [], 'p1'), { kind: 'root' }, 'the Bookmarks menu is unchanged');
});

test('hiding a section adds it once and keeps the rest', () => {
  const start = sectionLayout({});
  const hidden = hideSection(start, 'bookmarks');
  assert.deepEqual(hidden.hidden, [...start.hidden, 'bookmarks']);
  assert.equal(hideSection(hidden, 'bookmarks'), hidden, 'already hidden: the same layout');
  assert.deepEqual(hidden.order, start.order);
});

test('a request from a menu is read only when it is fresh and well formed', () => {
  const now = 1_000_000;
  assert.deepEqual(parseSidebarRequest(JSON.stringify({ kind: 'customize', at: now }), now), { kind: 'customize' });
  assert.deepEqual(parseSidebarRequest(JSON.stringify({ kind: 'hide', section: 'history', at: now - 100 }), now), { kind: 'hide', section: 'history' });
  for (const raw of [null, '', 'nope', '{}', JSON.stringify({ kind: 'hide', section: 'nope', at: now }), JSON.stringify({ kind: 'hide', at: now }), JSON.stringify({ kind: 'delete-everything', at: now }), JSON.stringify({ kind: 'customize', at: now - 6000 }), JSON.stringify({ kind: 'customize', at: now + 60_000 }), JSON.stringify({ kind: 'customize' })])
    assert.equal(parseSidebarRequest(raw, now), null, String(raw));
});

test('Hide shows a toast with Undo whose token puts the section back, once', () => {
  setRailPrefs({ sections: { order: ['tabs', 'bookmarks', 'downloads', 'history', 'reading'], hidden: [] } }, 'p1', false);
  setRailPrefs({ sections: { order: ['tabs', 'bookmarks', 'downloads', 'history', 'reading'], hidden: ['history'] } }, 'p1', false);
  const toast = sectionHiddenToast('p1', false, 'history');
  assert.ok(toast.type === 'toast');
  assert.equal(toast.text, 'Section hidden: History');
  const command = toast.action?.command;
  assert.ok(command && command.type === 'sidebar.section.restore');
  assert.match(command.token, /^s[a-z0-9]{4,24}$/, 'the token passes main\'s toast validation');
  assert.equal(toast.action?.label, 'Undo');
  assert.equal(sectionLayout(readRailPrefs('p1', false)).hidden.includes('history'), true);
  assert.equal(restoreHiddenSection(command.token), true);
  assert.equal(sectionLayout(readRailPrefs('p1', false)).hidden.includes('history'), false);
  assert.equal(restoreHiddenSection(command.token), false, 'a spent token does nothing');
});

test('Undo for Favorites uses the Favorites store\'s own switch and leaves other sections alone', () => {
  setRailPrefs({ sections: { order: ['tabs', 'bookmarks', 'downloads', 'history', 'reading'], hidden: ['downloads'] } }, 'p2', false);
  setSidebarAppsHidden('p2', false, true);
  const toast = sectionHiddenToast('p2', false, 'favorites');
  assert.ok(toast.type === 'toast' && toast.action?.command.type === 'sidebar.section.restore');
  assert.equal(readSidebarApps('p2', false).hidden, true);
  assert.equal(restoreHiddenSection((toast.action.command as { token: string }).token), true);
  assert.equal(readSidebarApps('p2', false).hidden, false);
  assert.deepEqual(sectionLayout(readRailPrefs('p2', false)).hidden, ['downloads']);
});

test('a private window gets the toast without Undo (its choices live in memory only)', () => {
  const toast = sectionHiddenToast('p3', true, 'history');
  assert.ok(toast.type === 'toast');
  assert.equal(toast.action, undefined);
  assert.equal(store.has('acira-sidebar-section-undo') && store.get('acira-sidebar-section-undo')!.includes('p3'), false);
});

test('main accepts the new toast command and refuses a malformed token', async () => {
  const { validateAction } = require('../desktop/validation.cjs'), { createInitialState } = await import('../src/runtime/core');
  const state = createInitialState();
  const toast = (token: string) => ({ type: 'toast', text: 'Section hidden: History', action: { label: 'Undo', command: { type: 'sidebar.section.restore', token } } });
  assert.doesNotThrow(() => validateAction(toast('sk3j2h1abc'), state));
  for (const token of ['', 'f123456', 'S123456', 's1', 's' + 'a'.repeat(30), 's12 34']) assert.throws(() => validateAction(toast(token), state), /Undo token|Toast|text|Invalid|invalid/i, token);
});

test('every section\'s header and the New tab menu offer the two rows; single rows keep their own menus', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const sidebar = read('../src/components/sidebar/AciraSidebar.tsx'), bookmarkMenu = read('../src/components/sidebar/BookmarkMenu.tsx'), app = read('../src/App.tsx'), actions = read('../src/components/sidebar/SectionActions.tsx');
  // Zone headers (Bookmarks keeps its own menu, which now ends with the rows) and Favorites' free space open the section menu.
  assert.match(sidebar, /openBookmarkMenu\(zoneRef\(id\)/);
  assert.match(sidebar, /openBookmarkMenu\(zoneRef\('favorites'\)/);
  assert.match(sidebar, /closest\('\.sb-app,\.sb-app-editor'\)/, 'a favorite tile keeps Edit favorite');
  assert.match(bookmarkMenu, /sectionActions\(row,sidebarWindowId\(state\),'bookmarks',close\)/);
  assert.match(app, /state\.settings\.verticalTabs && <><hr\/>\{sectionActions\(row, sidebarWindowId\(state\), 'tabs', close\)\}/, 'the tab bar menu, in the sidebar only');
  // The menu rows are the menu's own, with the catalog's words.
  assert.match(actions, /t\("sidebarmenu\.hideSection"\)/);
  assert.match(actions, /t\("sidebarmenu\.customize"\)/);
  // Rows keep their own menus: a tab, a bookmark, a history entry do not call the section menu.
  for (const own of ['tab-context', 'group-context', 'split-context']) assert.doesNotMatch(app.slice(app.indexOf(`kind === '${own}'`), app.indexOf(`kind === '${own}'`) + 200), /sectionActions/, own);
});
