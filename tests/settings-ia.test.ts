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
  assert.deepEqual(all.filter((entry) => entry.section === 'Appearance' && entry.group === 'Layout').map((entry) => entry.id), ['sidebar-only-tabs', 'window-view', 'sidebar-peek', 'seamless-edge-top', 'seamless-edge-side']);
  assert.equal(byId('sidebar-only-tabs')?.title, 'Tabs', 'the name the menu and Make it yours use');
});

test('every common word for the tab layout finds it first or second, with typos too', () => {
  for (const query of ['sidebar', 'vertical tabs', 'tabs on the side', 'tabs on top', 'toolbar view', 'horizontal tabs', 'tab layout', 'layout', 'view', 'sidebar view', 'side tabs', 'tabs']) {
    assert.ok(found(query).slice(0, 2).includes('sidebar-only-tabs'), `${query}: ${found(query).slice(0, 3).join(', ')}`);
  }
  for (const query of ['sidebr', 'vertcal tabs', 'horizonal tabs', 'toolbr view', 'layot', 'sidbar']) assert.equal(found(query)[0], 'sidebar-only-tabs', `${query}: ${found(query).slice(0, 3).join(', ')}`);
  // "view" and "layout" are the Window view's words too: both rows are offered.
  for (const query of ['view', 'layout', 'toolbar view']) assert.ok(found(query).slice(0, 3).includes('window-view'), query);
  // A signpost ranks first only for its own words; a longer query about something else is not taken over.
  assert.equal(found('sidebar width')[0], 'sidebar-width');
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
  assert.equal([...source.matchAll(/setRailPrefs\(/g)].length, 1, 'one place writes the tab layout from Settings');
  const row = fs.readFileSync(path.join(root, 'src/features/settings/TabLayoutRow.tsx'), 'utf8');
  assert.match(row, /id="sidebar-only-tabs"/);
  assert.match(row, /yours\.tabsTop/);
  assert.match(row, /yours\.tabsSide/);
});
