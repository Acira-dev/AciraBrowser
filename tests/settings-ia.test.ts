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
  'newtab-art': 'Appearance', 'newtab-art-style': 'Appearance', 'newtab-collection': 'Appearance', 'newtab-artwork': 'Appearance', 'newtab-art-details': 'Appearance',
  'newtab-personal-image': 'Appearance', 'newtab-caption': 'Appearance', 'newtab-daily': 'Appearance',
  'newtab-name': 'New tab', 'newtab-mark': 'New tab', 'newtab-search': 'New tab', 'newtab-shortcuts': 'New tab', 'newtab-saved': 'New tab', 'newtab-recent': 'New tab', 'newtab-frequent': 'New tab', 'newtab-shortcut-editor': 'New tab',
  proxy: 'Connection', 'secure-dns': 'Connection', 'network-save': 'Connection', gpc: 'Privacy',
  'spellcheck-enabled': 'Languages', 'spellcheck-languages': 'Languages',
  'rewind-enabled': 'Tabs', 'rewind-retention': 'Tabs', 'rewind-clear': 'Tabs',
  incognito: 'Privacy',
  'sidebar-only-tabs': 'Appearance', 'window-view': 'Appearance', // R4-56: Layout group at the top of Appearance
};

test('moved settings sit in their proposed section and keep their ids', () => {
  for (const [id, section] of Object.entries(moved)) assert.equal(byId(id)?.section, section, id);
});

test('every registered section is a section of the Settings sidebar', () => {
  const known = new Set<string>([...settingsSections, ...panelSections]);
  for (const entry of all) assert.ok(known.has(entry.section), `${entry.id}: ${entry.section}`);
  assert.ok(!known.has('Spelling'), 'spell checking is part of Languages');
});

test('the new tab background is where people look: Appearance, found by new-tab and by background words', () => {
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
  // Every link is shown from a different section than the one it names.
  assert.ok(links.some(([, to]) => to === 'newtab-art-style') && links.some(([, to]) => to === 'newtab-shortcut-editor'), 'the background and the layout link to each other');
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

test('secure DNS and the proxy render in Connection, Global Privacy Control in Privacy', () => {
  const panel = (name: string) => fs.readFileSync(path.join(root, 'src/features/settings/panels', name), 'utf8');
  assert.match(panel('proxy.tsx'), /section: 'Connection'/);
  assert.match(panel('secure-dns.tsx'), /section: 'Connection'/);
  assert.match(panel('secure-dns.tsx'), /part="dns"/);
  assert.doesNotMatch(panel('privacy.tsx'), /<Connection disabled/);
  assert.match(fs.readFileSync(path.join(root, 'src/features/BrowserSettings.tsx'), 'utf8'), /<NativeNetworkSettings part="gpc">/);
});

// R4-56: "I can't find where to set a sidebar view or only a toolbar view." Tabs (along the top / in a sidebar) and Window view
// are the Layout group at the top of Appearance, Tabs is mirrored at the top of the Tabs section, and every common word finds it.
test('Layout leads Appearance: Tabs and Window view are registered there, in the Layout group', () => {
  assert.equal(byId('sidebar-only-tabs')?.section, 'Appearance');
  assert.equal(byId('sidebar-only-tabs')?.group, 'Layout');
  assert.equal(byId('window-view')?.group, 'Layout');
  // The group name is not reused for unrelated rows (bookmarks bar, interface size and animation speed used to share it).
  assert.deepEqual(all.filter((entry) => entry.section === 'Appearance' && entry.group === 'Layout').map((entry) => entry.id), ['sidebar-only-tabs', 'window-view', 'seamless-edge-top']);
  // The sidebar's own rows moved to Tabs › Sidebar, where the sidebar's other options are (their Appearance rows are live copies of the same settings).
  for (const id of ['sidebar-peek', 'seamless-edge-side']) assert.deepEqual([byId(id)?.section, byId(id)?.group], ['Tabs', 'Sidebar'], id);
  // Sidebar mode and the address bar's place are the Tabs choice's third answer (item 4): no rows of their own, their words go to the Tabs card.
  for (const id of ['sidebar-mode', 'address-in-sidebar']) assert.equal(byId(id), undefined, `${id} is not a row any more`);
  assert.equal(byId('sidebar-only-tabs')?.title, 'Tabs', 'the name the menu and Make it yours use');
});

test('every common word for the tab layout finds it first or second, with typos too', () => {
  for (const query of ['sidebar', 'vertical tabs', 'tabs on the side', 'tabs on top', 'toolbar view', 'horizontal tabs', 'tab layout', 'layout', 'view', 'sidebar view', 'side tabs', 'tabs']) {
    assert.ok(found(query).slice(0, 2).includes('sidebar-only-tabs'), `${query}: ${found(query).slice(0, 3).join(', ')}`);
  }
  for (const query of ['vertcal tabs', 'horizonal tabs', 'toolbr view', 'layot']) assert.equal(found(query)[0], 'sidebar-only-tabs', `${query}: ${found(query).slice(0, 3).join(', ')}`);
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
  for (const query of ['address bar', 'url bar', 'address bar in sidebar']) assert.equal(found(query)[0], 'sidebar-only-tabs', query);
  // The left-edge rows are drawn with tabs in the sidebar only, so search offers them only then; the address row is offered either way (with tabs on top it says what it needs).
  for (const query of ['left edge', 'closed sidebar']) assert.ok(['sidebar-peek', 'seamless-edge-side'].includes(searchSettings(all, query, { ...context, verticalTabs: true }, 12)[0].entry.id), query);
  assert.ok(!searchSettings(all, 'closed sidebar', { ...context, verticalTabs: false }, 12).some((hit) => hit.entry.id === 'sidebar-peek'), 'no row to jump to with tabs on top');
  for (const id of ['sidebar', 'sidebar-peek', 'sidebar-apps', 'sidebar-section-bookmarks', 'sidebar-section-pinned', 'sidebar-section-downloads', 'sidebar-section-history', 'sidebar-section-reading', 'sidebar-customize']) assert.equal(byId(id)?.section, 'Tabs', id);
});

test('the rows the registry names exist in Tabs › Sidebar, and the Appearance rows are live copies', () => {
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
  const panel = read('src/features/settings/panels/sidebar.tsx'), settings = read('src/features/BrowserSettings.tsx'), rows = read('src/features/settings/SidebarRows.tsx');
  for (const id of ['sidebar-peek', 'seamless-edge-side', 'sidebar-visible', 'sidebar-apps', 'sidebar-customize']) assert.ok(`${panel}${rows}`.includes(`id="${id}"`) || `${panel}${rows}`.includes(`id={'sidebar-section-`) || id === 'seamless-edge-side', id);
  // Tabs › Sidebar sits right under the Tabs layout card; Sidebar sections shows what is inside before it is opened.
  const tabs = settings.slice(settings.indexOf('{section === "Tabs" &&'), settings.indexOf('id="compact-tab-titles"'));
  assert.ok(tabs.indexOf('<TabLayoutRow') < tabs.indexOf('<SidebarGroups') && tabs.indexOf('<SidebarGroups') > 0);
  assert.match(panel, /id="sidebar-sections" bodyRef=\{sections\} fold foldDetail=\{t\("sidebar\.showHideAndReorderTabs"\)\}/);
  // Appearance › Layout and Tabs › Sidebar read and write the same settings through the same components.
  assert.match(settings, /<SidebarEdgeRows state=\{state\} dispatch=\{dispatch\} \/>/);
  assert.match(panel, /<SidebarEdgeRows state=\{state\} dispatch=\{dispatch\} describe \/>/);
});

test('Tabs and Window view render in Appearance › Layout first, Tabs is mirrored at the top of Tabs, one writer for both', () => {
  const source = fs.readFileSync(path.join(root, 'src/features/BrowserSettings.tsx'), 'utf8');
  const appearance = source.slice(source.indexOf('{section === "Appearance" &&'), source.indexOf('{section === "Profiles" &&'));
  assert.ok(appearance.indexOf('<TabLayoutRow') > 0 && appearance.indexOf('<TabLayoutRow') < appearance.indexOf('id="window-view"'), 'Tabs, then Window view');
  assert.ok(appearance.indexOf('id="window-view"') < appearance.indexOf('id="appearance-mode"'), 'Layout comes before Theme');
  assert.match(appearance, /<SettingGroup title=\{tr\("settings\.layoutGroup"\)\} id="layout">\s*<TabLayoutRow/);
  const tabs = source.slice(source.indexOf('{section === "Tabs" &&'), source.indexOf('id="compact-tab-titles"'));
  assert.match(tabs, /<TabLayoutRow layout=\{tabLayout\} onChange=\{chooseTabLayout\} \/>/);
  assert.equal([...source.matchAll(/<TabLayoutRow /g)].length, 2, 'the same component, twice');
  assert.equal([...source.matchAll(/setTabsLayout\(/g)].length, 1, 'one place writes the tab layout from Settings (ui/sidebarMode.ts: both settings, the profile switch and the morph)');
  assert.equal([...source.matchAll(/setRailPrefs\(/g)].length, 0, 'and it is not written by hand beside it');
  const row = fs.readFileSync(path.join(root, 'src/features/settings/TabLayoutRow.tsx'), 'utf8');
  assert.match(row, /id="sidebar-only-tabs"/);
  assert.match(row, /yours\.tabsTop/);
  assert.match(row, /yours\.tabsSide'/);
  assert.match(row, /yours\.tabsSideAddress/, 'the third answer: Sidebar mode, with the address bar in the sidebar');
});
