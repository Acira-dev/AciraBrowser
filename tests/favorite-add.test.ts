import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addFavorite, favoriteToast, favoriteTabTitle, iconsToBackfill, openTabIcon, planFavorite, type FavoriteTab } from '../src/ui/favoriteAdd';
import { addSidebarApp, readSidebarApps } from '../src/ui/sidebarApps';

// One way to make a favorite (reported 6 Nov): dragging a tab up gave the good tile, the other ways gave something else. Every way now comes
// through ui/favoriteAdd.ts, so the same tab gives the same stored favorite and the same tab hand-over whichever way it is added.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, String(value)); }, removeItem: (key: string) => { store.delete(key); } },
  window: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
});
const ICON = 'data:image/png;base64,AAAA', OTHER_ICON = 'data:image/x-icon;base64,BBBB';
const tab = (id: string, url: string, extra: Partial<FavoriteTab> = {}, profile = 'p1'): FavoriteTab => ({ id, url, title: 'Wikipedia, the free encyclopedia', favicon: ICON, browserProfileId: profile, contentKind: 'web', ...extra });
const wiki = tab('t1', 'https://en.wikipedia.org/wiki/Main_Page');
const stored = (profile: string, privateMode = false) => readSidebarApps(profile, privateMode).apps.map(({ url, title, icon }) => ({ url, title, icon }));

test('the same tab gives the same stored favorite whichever way it is added: drag, shortcut, command, tab menu and the + form', () => {
  const ways: Record<string, Parameters<typeof addFavorite>[0]> = {
    drag: { profileId: 'drag', privateMode: false, url: wiki.url, tab: wiki, tabs: [wiki], index: 0, reveal: true },
    shortcut: { profileId: 'shortcut', privateMode: false, url: wiki.url, tab: wiki, tabs: [wiki], reveal: true },
    menu: { profileId: 'menu', privateMode: false, url: wiki.url, tab: wiki, tabs: [wiki], reveal: true },
    // the "+" form hands over what the person sees: the page's name and address, and the tab when the address is still the page's
    form: { profileId: 'form', privateMode: false, url: wiki.url, title: wiki.title, tab: wiki, tabs: [wiki], reveal: true },
  };
  const out = Object.fromEntries(Object.entries(ways).map(([name, input]) => [name, addFavorite({ ...input, profileId: name })]));
  // the tab's profile is the favorite's profile in the app; here each way gets its own store, so give the tab that profile
  for (const name of Object.keys(ways)) assert.equal(out[name].plan.kind === 'add' || out[name].plan.kind === 'exists', true);
  const first = stored('drag')[0];
  assert.deepEqual(first, { url: wiki.url, title: wiki.title, icon: ICON }, 'address, the page\'s own name and the tab\'s local icon');
  for (const name of ['shortcut', 'menu', 'form']) assert.deepEqual(stored(name)[0], first, name + ' stores what a drag stores');
  for (const name of Object.keys(ways)) { assert.equal(out[name].adopt, 't1', name + ': the favorite is linked to the tab'); assert.equal(out[name].added, true); }
});

test('the name is the one the list shows: a renamed tab keeps its own name; long names are cut to 80', () => {
  assert.equal(favoriteTabTitle({ title: 'Page', customTitle: ' Mine ' }), 'Mine');
  assert.equal(favoriteTabTitle({ title: 'Page' }), 'Page');
  const long = tab('t9', 'https://long.example/', { title: 'x'.repeat(200) });
  const made = addFavorite({ profileId: 'long', privateMode: false, url: long.url, tab: long, tabs: [long] });
  assert.equal(made.app?.title.length, 80);
});

test('a dropped link, an import and a typed address take an open tab\'s icon at add time, and have none when nothing is open', () => {
  const mine = (id: string, url: string, extra: Partial<FavoriteTab>, profile: string) => tab(id, url, extra, profile);
  const link = addFavorite({ profileId: 'link', privateMode: false, url: 'https://en.wikipedia.org/wiki/Main_Page', title: 'Wikipedia', tabs: [mine('t1', wiki.url, {}, 'link'), mine('t2', 'https://www.wikipedia.org/', { favicon: OTHER_ICON }, 'link')], reveal: true });
  assert.equal(link.app?.icon, ICON, 'the same page\'s tab first');
  assert.equal(link.adopt, undefined, 'no tab in hand: the first click opens a tab and links it');
  const site = addFavorite({ profileId: 'link2', privateMode: false, url: 'https://en.wikipedia.org/wiki/Other', tabs: [mine('t2', 'https://en.wikipedia.org/wiki/Main_Page', { favicon: OTHER_ICON }, 'link2')] });
  assert.equal(site.app?.icon, OTHER_ICON, 'else a tab of the same site');
  const nothing = addFavorite({ profileId: 'link3', privateMode: false, url: 'https://nowhere.example/', title: 'Nowhere', tabs: [mine('t1', wiki.url, {}, 'link3')] });
  assert.equal(nothing.app?.icon, undefined);
  assert.equal(nothing.app?.title, 'Nowhere');
});

test('an open tab\'s icon is local, from this profile, never a private or Tor tab\'s, and never a remote address', () => {
  const url = 'https://en.wikipedia.org/wiki/Main_Page';
  assert.equal(openTabIcon(url, [tab('a', url, { privacy: 'private' })], 'p1'), undefined);
  assert.equal(openTabIcon(url, [tab('a', url, { privacy: 'tor' })], 'p1'), undefined);
  assert.equal(openTabIcon(url, [tab('a', url, {}, 'p2')], 'p1'), undefined);
  assert.equal(openTabIcon(url, [tab('a', url, { favicon: 'https://en.wikipedia.org/favicon.ico' })], 'p1'), undefined);
  assert.equal(openTabIcon(url, [tab('a', url)], 'p1'), ICON);
});

test('an address that is already a favorite never makes a second tile: it moves to the drop, and takes the tab in hand only if it has none', () => {
  store.clear();
  const a = addSidebarApp('dup', false, { url: 'https://a.example/', title: 'A' }), b = addSidebarApp('dup', false, { url: 'https://b.example/', title: 'B' });
  assert.ok(typeof a !== 'string' && typeof b !== 'string');
  const page = tab('t3', 'https://b.example/', { favicon: ICON }, 'dup');
  const again = addFavorite({ profileId: 'dup', privateMode: false, url: page.url, tab: page, tabs: [page], index: 0 });
  assert.equal(again.plan.kind, 'exists');
  assert.equal(again.added, false);
  assert.deepEqual(readSidebarApps('dup', false).apps.map(app => app.title), ['B', 'A'], 'moved to the front, not copied');
  assert.equal(again.adopt, 't3', 'it had no tab of its own, so the open page becomes it');
  assert.equal(readSidebarApps('dup', false).apps[0].icon, ICON, 'and it takes the page\'s icon when it had none');
  const own = tab('t4', 'https://b.example/', { favoriteId: (b as { id: string }).id }, 'dup'), another = tab('t5', 'https://b.example/', {}, 'dup');
  const owned = planFavorite({ profileId: 'dup', privateMode: false, url: another.url, tab: another, tabs: [own, another] });
  assert.equal(owned.kind, 'exists');
  assert.equal(owned.kind === 'exists' ? owned.adopt : 'x', undefined, 'a favorite that is already linked to a tab keeps that link');
  assert.match(String(favoriteToast({ plan: owned, app: (b as never), added: false })?.type === 'toast' && (favoriteToast({ plan: owned, app: (b as never), added: false }) as { text: string }).text), /already in Favorites/);
  assert.equal(favoriteToast({ plan: owned, app: (b as never), added: false }, false), null, 'a drag says nothing when it only moved a tile');
});

test('bad addresses and a full grid are refused with a message, and nothing is written', () => {
  store.clear();
  const bad = addFavorite({ profileId: 'bad', privateMode: false, url: 'javascript:alert(1)' });
  assert.equal(bad.plan.kind, 'refuse');
  assert.equal(readSidebarApps('bad', false).apps.length, 0);
  for (let i = 0; i < 24; i++) addSidebarApp('full', false, { url: `https://s${i}.example/` });
  const over = addFavorite({ profileId: 'full', privateMode: false, url: 'https://one-more.example/' });
  assert.equal(over.plan.kind, 'refuse');
  assert.equal(readSidebarApps('full', false).apps.length, 24);
  assert.equal(favoriteToast(over)?.type, 'toast');
});

test('a gesture brings switched-off Favorites back; an import leaves that switch alone; private windows keep their own memory', () => {
  store.clear();
  store.set('acira-sidebar-apps:hid', JSON.stringify({ apps: [], hidden: true, seeded: true }));
  addFavorite({ profileId: 'hid', privateMode: false, url: 'https://quiet.example/' });
  assert.equal(readSidebarApps('hid', false).hidden, true, 'no reveal asked: left as it was');
  addFavorite({ profileId: 'hid', privateMode: false, url: 'https://loud.example/', reveal: true });
  assert.equal(readSidebarApps('hid', false).hidden, false);
  addFavorite({ profileId: 'hid', privateMode: true, url: 'https://secret.example/', reveal: true });
  assert.equal(readSidebarApps('hid', true).apps.length, 1);
  assert.equal(readSidebarApps('hid', false).apps.some(app => app.url.includes('secret')), false, 'a private window\'s favorite never reaches the saved ones');
});

test('a favorite without an icon takes the first local one the browser knows: its own tab\'s, an open tab of the site, the icon store; never a remote address', () => {
  const apps = [
    { id: 'own', url: 'https://own.example/', title: 'Own' }, { id: 'site', url: 'https://site.example/a', title: 'Site' }, { id: 'kept', url: 'https://kept.example/', title: 'Kept' },
    { id: 'none', url: 'https://none.example/', title: 'None' }, { id: 'has', url: 'https://has.example/', title: 'Has', icon: ICON }, { id: 'page', url: 'acira://settings', title: 'Settings' },
  ];
  const tabs = [tab('o', 'https://own.example/deep', { favoriteId: 'own', favicon: OTHER_ICON }), tab('s', 'https://site.example/b', { favicon: ICON })];
  const store2 = (url: string) => url.startsWith('https://kept.example') ? ICON : url.startsWith('https://none.example') ? 'https://none.example/favicon.ico' : undefined;
  const found = iconsToBackfill(apps, tabs, 'p1', store2);
  assert.deepEqual(found, [{ id: 'own', icon: OTHER_ICON }, { id: 'site', icon: ICON }, { id: 'kept', icon: ICON }]);
});

test('the sidebar, the tab menu and the desktop bridge all go through the one function', () => {
  const sidebar = readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.equal(/addSidebarApp\(/.test(sidebar), false, 'the sidebar no longer builds favorites by hand');
  assert.equal((sidebar.match(/addFavorite\(/g) ?? []).length, 4, 'drag, Cmd+Shift+D / command / menu, the + form and a dropped link');
  assert.match(sidebar, /const asked=event\.type==='sidebar-pin-app'\?event\.tabId:event\.type==='ui'&&\(event as \{action\?:string\}\)\.action==='favorite-tab'/, 'the keyboard and the menu take one path');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /state\.settings\.verticalTabs && context\.contentKind === 'web' && !context\.privacy && row\(tr\("acirasidebar\.addToFavorites"\), LayoutGrid, \(\) => \{ void runtime\.browserCommand\(\{ type: 'ui', tabId: tab\.id, action: 'favorite-tab', targetTabId: context\.id \}\)/, 'the tab menu row: sidebar layout, websites, not private or Tor tabs');
  assert.match(readFileSync(new URL('../desktop/validation.cjs', import.meta.url), 'utf8'), /'rename-tab','favorite-tab','preview-hold'/);
  assert.match(readFileSync(new URL('../src/runtime/types.ts', import.meta.url), 'utf8'), /'rename-tab' \| 'favorite-tab'/);
  const en = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>;
  assert.equal(en['acirasidebar.addToFavorites'], 'Add to Favorites', 'the menu row reuses the form\'s own, already translated, label');
});

test('the motion: the bookmark\'s split, with the tile as its end; the tab stays, the tiles make room, the new tile is held until the copy lands', () => {
  const drag = readFileSync(new URL('../src/ui/sidebarTabDrag.ts', import.meta.url), 'utf8');
  assert.match(drag, /const split=\(destination:\(\)=>HTMLElement\|null,onSettled:\(\)=>void,tile\?:\{slot\?:\(\)=>DOMRect\|null;stay\?:boolean\}\)=>\{/, 'one split for the saved page and for the favorite');
  assert.match(drag, /bookmark\(destination:\(\)=>HTMLElement\|null,onSettled:\(\)=>void\)\{split\(destination,onSettled\);\}/, 'the bookmark runs it unchanged');
  assert.match(drag, /favorite\(destination:\(\)=>HTMLElement\|null,onSettled:\(\)=>void,options:/);
  assert.match(drag, /endB=tile\?\{icon:\(to\.width-16\)\/2,title:0,width:0\}:inner\(saved,to\)/, 'the tile is icon only: its icon centred, no title');
  assert.match(drag, /const projectFavorite=\(\)=>\{/, 'over Favorites the tab\'s place stays open and the list does not close up');
  assert.match(drag, /if\(!stay\)row\.dataset\.sidebarDragSource='';/, 'a copy that goes while the row stays never hides the row');
  assert.match(drag, /if\(tile&&settledAt&&!stay\)delete row\.dataset\.sidebarDragSource;/, 'the row is there under the fading glass: no dip');
  assert.match(drag, /saved\.style\.opacity=settledAt\?'1':'0'/, 'the tile is held until the copy has landed');
  assert.equal(/lend\(\)|export function rowCard/.test(drag), false, 'the first version\'s hand-over of the carried card is gone');
  const morph = readFileSync(new URL('../src/ui/favoriteMorph.ts', import.meta.url), 'utf8');
  assert.match(morph, /if \(typeof document === 'undefined' \|\| !motionScale\(\)\) return false;/, 'animation off: no copy, the tile is simply there');
  assert.match(morph, /carrySidebarRow\(row, scroll, \{ x: box\.left \+ box\.width \/ 2, y: box\.top \+ box\.height \/ 2 \}, '', \{ stay: true \}\)/, 'the tab menu, Cmd\+Shift\+D and the \+ form split a copy off the row that stays');
  const sidebar = readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /data-morph=\{favoriteMorphing\(app\.id\)\?'':undefined\} data-motion-skip=\{favoriteMorphing\(app\.id\)\?'':undefined\}/, 'the new tile is held back and left out of the list\'s enter animation');
  assert.match(sidebar, /const adding=favoritePlan\?\.kind==='add';/);
  assert.match(sidebar, /else if\(!adding\)current\.rowPreview\?\.end\(/, 'a drop that makes a favorite splits instead of going home');
  assert.match(sidebar, /tiles\.splice\(Math\.min\(pin!\.index,apps\.length\),0,<span key="gap" className="sb-app sb-app-slot sb-app-gap"/, 'the tiles make room under a tab that would make a favorite');
  assert.match(sidebar, /if\(tile\.classList\.contains\('sb-app-gap'\)\)return items\.indexOf\(tile\);/, 'over the slot the drop stays: the slot never chases the pointer');
  assert.match(sidebar, /animateSpring\(wrap,\[\{translate:`0 \$\{shift\}px`\},\{translate:'0 0'\}\],'reorder\.move'/, 'the list below glides when the first favorite opens the region');
  assert.match(readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8'), /\.sb-app\[data-morph\]\{opacity:0\}/);
});

test('no info icon in the favorites area: the (i) and its tip are gone, with its text in every language', () => {
  const sidebar = readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8'), css = readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8');
  assert.equal(/sb-apps-info|FAVORITES_TIP|aboutFavorites/.test(sidebar + css), false);
  for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN'])
    assert.equal('acirasidebar.aboutFavorites' in JSON.parse(readFileSync(new URL(`../src/i18n/${locale}.json`, import.meta.url), 'utf8')), false, locale);
});

test('adding a favorite takes no tab out of the list: nothing filters a linked tab, and tab.favorite keeps its group and place', () => {
  const core = readFileSync(new URL('../src/runtime/core.ts', import.meta.url), 'utf8');
  assert.equal(/tab\.group=''/.test(core.slice(core.indexOf("case 'tab.favorite'"), core.indexOf("case 'tab.favorite'") + 600)), false, 'the group stays');
});
