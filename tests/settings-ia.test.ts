// R3-74: Settings information architecture (docs/launch/SETTINGS_IA.md). Every setting lives where people look for it,
// keeps its id, is found by its old and its new words, and the two-place settings have a working "Also in" link.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { settingsSections, type SettingsContext, type SettingsEntry } from '../src/features/settings/model';
import { searchSettings } from '../src/features/settings/search';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryDir = path.join(root, 'src/features/settings/entries');
const all: SettingsEntry[] = [];
for (const file of fs.readdirSync(entryDir).filter((name) => name.endsWith('.ts')).sort()) {
  all.push(...((await import(pathToFileURL(path.join(entryDir, file)).href)).default as SettingsEntry[]));
}
const panelSections = new Set<string>();
for (const file of fs.readdirSync(path.join(root, 'src/features/settings/panels')).filter((name) => name.endsWith('.tsx'))) {
  const match = /section: '([^']+)'/.exec(fs.readFileSync(path.join(root, 'src/features/settings/panels', file), 'utf8'));
  if (match) panelSections.add(match[1]);
}
const byId = (id: string) => all.find((entry) => entry.id === id);
const context: SettingsContext = { customGlassColors: true, privateProfile: false, desktop: true, websiteOpen: true, appearanceChanged: true, toolbarChanged: true, newTabChanged: true, stockSearch: true };
const found = (query: string) => searchSettings(all, query, context, 12).map((hit) => hit.entry.id);

/** setting → its section after R3-74 (the "proposed" column of SETTINGS_IA.md). */
const moved: Record<string, string> = {
  // Beta 14.4: the New Tab's background lives on the New tab page, with the rest of the New Tab.
  'newtab-art': 'New tab', 'newtab-art-style': 'New tab', 'newtab-collection': 'New tab', 'newtab-artwork': 'New tab', 'newtab-art-details': 'New tab',
  'newtab-personal-image': 'New tab', 'newtab-caption': 'New tab', 'newtab-daily': 'New tab',
  'newtab-name': 'New tab', 'newtab-mark': 'New tab', 'newtab-search': 'New tab', 'newtab-shortcuts': 'New tab', 'newtab-saved': 'New tab', 'newtab-recent': 'New tab', 'newtab-frequent': 'New tab', 'newtab-shortcut-editor': 'New tab',
  proxy: 'Connection', 'secure-dns': 'Connection', 'network-save': 'Connection', gpc: 'Protection', // Beta 14.4: Global Privacy Control sits with Anti-tracking on Protection
  'spellcheck-enabled': 'Languages', 'spellcheck-languages': 'Languages',
  'rewind-enabled': 'Tabs', 'rewind-retention': 'Tabs', 'rewind-clear': 'Tabs',
  incognito: 'Privacy',
  // Beta 14.4: three homes on the Acira menu's words. Layout = where things are (the Tabs choice, Window view, the toolbar), Sidebar = its own page,
  // Appearance = how it looks (Window opacity and Reduce transparency side by side), Tabs = how tabs behave.
  'sidebar-only-tabs': 'Layout', 'tab-size': 'Layout', 'window-view': 'Layout', 'hide-toolbar': 'Layout', 'seamless-edge-top': 'Layout', 'seamless-edge-side': 'Layout', 'toolbar-customize': 'Layout', 'bookmarks-bar': 'Layout', 'menu-customize': 'Layout',
  sidebar: 'Sidebar', 'sidebar-visible': 'Sidebar', 'sidebar-peek': 'Sidebar', 'sidebar-apps': 'Sidebar', 'sidebar-section-bookmarks': 'Sidebar',
  'glass-opacity': 'Appearance', 'reduce-transparency': 'Appearance', 'interface-size': 'Appearance', 'page-zoom': 'Appearance',
  'on-startup': 'Tabs', 'side-panel-sites': 'Tabs', 'reduce-motion': 'Accessibility',
};

test('moved settings sit in their proposed section and keep their ids', () => {
  for (const [id, section] of Object.entries(moved)) assert.equal(byId(id)?.section, section, id);
});

test('every registered section is a section of the Settings sidebar', () => {
  const known = new Set<string>([...settingsSections, ...panelSections]);
  for (const entry of all) assert.ok(known.has(entry.section), `${entry.id}: ${entry.section}`);
  assert.ok(!known.has('Spelling'), 'spell checking is part of Languages');
});

test('the new tab background is found by new-tab and by background words (its home is New tab › Background)', () => {
  for (const query of ['new tab background', 'background image', 'wallpaper', 'new tab image']) assert.ok(found(query).includes('newtab-art-style'), query);
  assert.ok(found('new tab collection').includes('newtab-collection'));
  assert.ok(found('cover').includes('newtab-art'));
  // the layout words still find the layout rows
  assert.ok(found('new tab shortcuts').includes('newtab-shortcuts'));
  assert.ok(found('speed dial').includes('newtab-shortcut-editor'));
});

test('moved settings are found by their old words and their new words', () => {
  for (const [query, id] of [
    ['proxy', 'proxy'], ['privacy proxy', 'proxy'], ['connection proxy', 'proxy'], ['socks', 'proxy'],
    ['secure dns', 'secure-dns'], ['privacy dns', 'secure-dns'], ['connection dns', 'secure-dns'],
    ['spelling', 'spellcheck-enabled'], ['languages spelling', 'spellcheck-enabled'], ['dictionary', 'spellcheck-languages'],
    ['rewind', 'rewind-enabled'], ['privacy rewind', 'rewind-enabled'], ['restore closed tabs', 'rewind-enabled'],
    ['private window', 'incognito'], ['incognito', 'incognito'], ['privacy private', 'incognito'],
  ] as const) assert.ok(found(query).includes(id), `${query} → ${id}`);
});

test('Also-in links point at real settings in the section they name', () => {
  const source = fs.readFileSync(path.join(root, 'src/features/BrowserSettings.tsx'), 'utf8');
  const links = [...source.matchAll(/<SettingCrossLink to="([^"]+)" section="([^"]+)"/g)];
  assert.ok(links.length >= 7, 'the two-place settings are linked');
  for (const [, to, section] of links) {
    assert.ok(byId(to), `link target ${to} is registered`);
    assert.equal(byId(to)!.section, section, `${to} lives in ${section}`);
  }
  // Beta 14.4: where people look first for something whose home is elsewhere: the wallpaper from Appearance, tab size from Tabs and Appearance, transparency from Accessibility.
  for (const to of ['newtab-art', 'tab-size', 'sidebar-only-tabs', 'reduce-transparency', 'animation-speed']) assert.ok(links.some(([, target]) => target === to), `a link to ${to}`);
  // A link is a pointer, never a second control: its line names the setting's home from the registry (controls.tsx SettingsHomeContext).
  assert.match(fs.readFileSync(path.join(root, 'src/features/settings/controls.tsx'), 'utf8'), /useContext\(SettingsHomeContext\)\(to\) \?\? section/);
});

test('the new tab settings split by part, and every part keeps its anchors', () => {
  const source = fs.readFileSync(path.join(root, 'src/features/NewTabSettings.tsx'), 'utf8');
  assert.match(source, /part: 'layout' \| 'background'/);
  for (const id of ['newtab-art-style', 'newtab-collection', 'newtab-artwork', 'newtab-daily', 'newtab-caption', 'newtab-personal-image', 'newtab-frequent', 'newtab-reset', 'newtab-shortcut-editor']) {
    assert.ok(source.includes(id), id);
  }
  const settings = fs.readFileSync(path.join(root, 'src/features/BrowserSettings.tsx'), 'utf8');
  assert.match(settings, /<NewTabSettings profile=\{profile\} part="background" \/>/);
  assert.match(settings, /<NewTabSettings profile=\{profile\} part="layout" \/>/);
});

test('secure DNS and the proxy render in Connection, Global Privacy Control in Protection (with Anti-tracking)', () => {
  const panel = (name: string) => fs.readFileSync(path.join(root, 'src/features/settings/panels', name), 'utf8');
  assert.match(panel('proxy.tsx'), /section: 'Connection'/);
  assert.match(panel('secure-dns.tsx'), /section: 'Connection'/);
  assert.match(panel('secure-dns.tsx'), /part="dns"/);
  assert.doesNotMatch(panel('privacy.tsx'), /<Connection disabled/);
  assert.match(fs.readFileSync(path.join(root, 'src/features/BrowserSettings.tsx'), 'utf8'), /<NativeNetworkSettings part="gpc" bare>/);
});

// R4-56: "I can't find where to set a sidebar view or only a toolbar view." Beta 14.4: they have a page of their own, Layout, named like the Acira menu's Layout rows:
// the Tabs choice and Tab size first, then Window view with Hide the toolbar and the two Seamless edge rows, then the toolbar.
test('Layout holds the Tabs choice, Window view and the toolbar; the sidebar has its own page', () => {
  assert.deepEqual([byId('sidebar-only-tabs')?.section, byId('sidebar-only-tabs')?.group], ['Layout', 'Tab layout']);
  assert.deepEqual(all.filter((entry) => entry.section === 'Layout' && entry.group === 'Window view').map((entry) => entry.id), ['window-view', 'hide-toolbar', 'seamless-edge-top', 'seamless-edge-side']);
  for (const id of ['sidebar-peek', 'sidebar-reveal', 'sidebar-closed', 'sidebar-size', 'sidebar-side']) assert.deepEqual([byId(id)?.section, byId(id)?.group], ['Sidebar', 'Sidebar'], id);
  for (const id of ['sidebar-apps', 'sidebar-apps-limit', 'sidebar-apps-tabs']) assert.deepEqual([byId(id)?.section, byId(id)?.group], ['Sidebar', 'Favorites'], id);
  // Sidebar mode and the address bar's place are the Tabs choice's third answer (item 4): no rows of their own, their words go to the Tabs card.
  for (const id of ['sidebar-mode', 'address-in-sidebar']) assert.equal(byId(id), undefined, `${id} is not a row any more`);
  assert.equal(byId('sidebar-only-tabs')?.title, 'Tabs', 'the name the menu and Make it yours use');
  const order = [...settingsSections];
  assert.ok(order.indexOf('Appearance') < order.indexOf('Layout') && order.indexOf('Layout') < order.indexOf('Sidebar'), 'Layout and Sidebar follow Appearance');
});

test('every common word for the tab layout finds it first or second, with typos too', () => {
  for (const query of ['sidebar', 'vertical tabs', 'tabs on the side', 'tabs on top', 'toolbar view', 'horizontal tabs', 'tab layout', 'layout', 'view', 'sidebar view', 'side tabs', 'tabs']) {
    assert.ok(found(query).slice(0, 2).includes('sidebar-only-tabs'), `${query}: ${found(query).slice(0, 3).join(', ')}`);
  }
  for (const query of ['vertcal tabs', 'horizonal tabs', 'toolbr view']) assert.equal(found(query)[0], 'sidebar-only-tabs', `${query}: ${found(query).slice(0, 3).join(', ')}`);
  // "layout" is the Window view's word as well (both are in a Layout group, one in Appearance and one in Tabs): a typo of it offers the two, either first.
  assert.ok(found('layot').slice(0, 2).includes('sidebar-only-tabs'), `layot: ${found('layot').slice(0, 3).join(', ')}`);
  // "sidebar" leads with the Sidebar group (Tabs › Sidebar), the Tabs layout choice follows, typos included.
  for (const query of ['sidebar', 'sidebr', 'sidbar']) assert.deepEqual(found(query).slice(0, 2), ['sidebar', 'sidebar-only-tabs'], query);
  // "view" and "layout" are the Window view's words too: both rows are offered.
  for (const query of ['view', 'layout', 'toolbar view']) assert.ok(found(query).slice(0, 3).includes('window-view'), query);
  // A signpost ranks first only for its own words; a longer query about something else is not taken over.
  assert.equal(found("sidebar width")[0], "sidebar-size");
});

// Sidebar findability: every sidebar option has one obvious home, Tabs › Sidebar, and the words people use land on it.
test('sidebar words land on the Sidebar group: sidebar, sidebar mode, bookmarks in sidebar, address bar, url bar', () => {
  assert.equal(found('sidebar')[0], 'sidebar');
  for (const query of ['sidebar mode', 'everything in sidebar', 'sidebar only']) assert.equal(found(query)[0], 'sidebar-only-tabs', query);
  for (const query of ['bookmarks in sidebar', 'bookmarks in the sidebar', 'hide bookmarks', 'bookmarks under tabs', 'bookmarks below tabs']) assert.equal(found(query)[0], 'sidebar-section-bookmarks', query);
  // Beta 14.4 (the team): "address bar" leads with Hide the toolbar and the address-bar search engine; the Tabs card keeps "address bar in sidebar".
  assert.deepEqual(found('address bar').slice(0, 2), ['hide-toolbar', 'search-engine']);
  assert.equal(found('address bar in sidebar')[0], 'sidebar-only-tabs');
  // The left-edge rows are drawn with tabs in the sidebar only, so search offers them only then; the address row is offered either way (with tabs on top it says what it needs).
  // Beta 14.4: the edge rows are always listed (greyed with the reason where they cannot apply), so search offers them in every layout and lands on the row.
  assert.ok(['sidebar-peek', 'seamless-edge-side'].includes(searchSettings(all, 'left edge', { ...context, verticalTabs: true }, 12)[0].entry.id), 'left edge');
  // "closed sidebar" offers both rows that say it: When the sidebar is closed (Mini or Hidden) and When the sidebar is closed, show it at the left edge.
  assert.deepEqual(searchSettings(all, 'closed sidebar', { ...context, verticalTabs: true }, 12).slice(0, 2).map((hit) => hit.entry.id), ['sidebar-closed', 'sidebar-peek']);
  assert.ok(searchSettings(all, 'closed sidebar', { ...context, verticalTabs: false }, 12).some((hit) => hit.entry.id === 'sidebar-peek'), 'with tabs on top the row is there, off, and says why');
  for (const id of ['sidebar', 'sidebar-peek', 'sidebar-apps', 'sidebar-section-bookmarks', 'sidebar-section-pinned', 'sidebar-section-downloads', 'sidebar-section-history', 'sidebar-section-reading', 'sidebar-customize']) assert.equal(byId(id)?.section, 'Sidebar', id);
});

test('the rows the registry names exist on the Sidebar page, and no other page repeats them', () => {
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
  const panel = read('src/features/settings/panels/sidebar.tsx'), settings = read('src/features/BrowserSettings.tsx'), rows = read('src/features/settings/SidebarRows.tsx');
  for (const id of ['sidebar-peek', 'seamless-edge-side', 'sidebar-visible', 'sidebar-apps', 'sidebar-customize']) assert.ok(`${panel}${rows}`.includes(`id="${id}"`), id);
  assert.match(settings, /\{section === "Sidebar" && <SidebarGroups state=\{state\} dispatch=\{dispatch\} \/>\}/);
  assert.match(panel, /id="sidebar-sections" bodyRef=\{sections\} fold foldDetail=\{t\("sidebar\.showHideAndReorderTabs"\)\}/);
  assert.match(panel, /<SettingGroup title=\{t\("acirasidebar\.favorites"\)\} id="favorites">/);
  // The peek row is on Sidebar, the Seamless edge row is under Window view on Layout: each control in one place.
  assert.match(panel, /<SidebarPeekRow state=\{state\} dispatch=\{dispatch\} \/>/);
  assert.equal([...settings.matchAll(/<SeamlessSideRow /g)].length, 1);
  assert.doesNotMatch(settings, /<SidebarPeekRow|<SidebarSideRow/);
});

test('Layout: the Tabs card, then Window view with its edge rows; the Tabs page only points at the card, one writer', () => {
  const source = fs.readFileSync(path.join(root, 'src/features/BrowserSettings.tsx'), 'utf8');
  const layout = source.slice(source.indexOf('{section === "Layout" &&'), source.indexOf('{section === "Sidebar" &&'));
  assert.ok(layout.indexOf('<TabLayoutRow') > 0 && layout.indexOf('<TabLayoutRow') < layout.indexOf('id="tab-size"') && layout.indexOf('id="tab-size"') < layout.indexOf('id="window-view"'), 'the Tabs card and Tab size, then Window view');
  assert.ok(layout.indexOf('id="window-view"') < layout.indexOf('id="hide-toolbar"') && layout.indexOf('id="hide-toolbar"') < layout.indexOf('id="seamless-edge-top"') && layout.indexOf('id="seamless-edge-top"') < layout.indexOf('<SeamlessSideRow'), 'Hide the toolbar and the Seamless rows directly under Window view');
  const appearance = source.slice(source.indexOf('{section === "Appearance" &&'), source.indexOf('{section === "Layout" &&'));
  assert.ok(!appearance.includes('<TabLayoutRow') && !appearance.includes('id="window-view"'), 'Appearance is how it looks');
  const tabs = source.slice(source.indexOf('{section === "Tabs" &&'), source.indexOf('{section === "Search" &&'));
  assert.ok(!tabs.includes('<TabLayoutRow') && tabs.includes('<SettingCrossLink to="sidebar-only-tabs" section="Layout"') && tabs.includes('<SettingCrossLink to="tab-size" section="Layout"'), 'Tabs points at Layout');
  assert.equal([...source.matchAll(/<TabLayoutRow /g)].length, 1, 'the card is in one place');
  assert.equal([...source.matchAll(/setTabsLayout\(/g)].length, 1, 'one place writes the tab layout from Settings (ui/sidebarMode.ts: both settings, the profile switch and the morph)');
  assert.equal([...source.matchAll(/setRailPrefs\(/g)].length, 0, 'and it is not written by hand beside it');
  const row = fs.readFileSync(path.join(root, 'src/features/settings/TabLayoutRow.tsx'), 'utf8');
  assert.match(row, /id="sidebar-only-tabs"/);
  assert.match(row, /yours\.tabsTop/);
  assert.match(row, /yours\.tabsSide'/);
  assert.match(row, /yours\.tabsSideAddress/, 'the third answer: Sidebar mode, with the address bar in the sidebar');
});

test('Settings › Extensions and the extensions menu lead to the Extensions group in Shortcuts', () => {
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
  const link = read('src/features/settings/panels/extensions.tsx').match(/<SettingCrossLink to="([^"]+)" section="([^"]+)"/);
  assert.ok(link, 'Settings › Extensions has the Keyboard shortcuts row');
  assert.ok(byId(link![1]), `link target ${link![1]} is registered`);
  assert.equal(byId(link![1])!.section, link![2]);
  assert.equal(link![2], 'Shortcuts');
  assert.match(read('src/features/settings/panels/shortcuts.tsx'), new RegExp(`id=\\{category === 'Extensions' \\? '${link![1]}'`), 'the Extensions group carries the target id');
  assert.match(read('src/App.tsx'), new RegExp(`onKeyboardShortcuts=\\{\\(\\) => \\{ openSettings\\(state, dispatch, \\{ setting: '${link![1]}' \\}\\)`), 'the extensions menu opens the same target');
  assert.match(read('src/components/ExtensionManager.tsx'), /onKeyboardShortcuts&&<ActionRow label=\{t\("nativeCore\.keyboardShortcuts"\)\}/);
  for (const word of ['extension shortcuts', 'extension keys', 'bitwarden shortcut']) assert.ok(found(word).includes(link![1]), `${word} finds it`);
  assert.match(read('src/features/settings/panels/shortcuts.tsx'), /category === 'Extensions' && list\.some\(asksForMediaKey\) && .*shortcuts\.mediaKeysNote/, 'the note about media keys is in the Extensions group, only when an extension asked for one');
});
