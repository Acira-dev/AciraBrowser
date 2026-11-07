import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createInitialState,freshStartSnapshot,makeTab,persistedSnapshot,reduceBrowser,restoreSnapshot} from '../src/runtime/core';

const require=createRequire(import.meta.url);
const {validateAction}=require('../desktop/validation.cjs');

/** beta.12 item 24: Settings > Tabs > "When Acira starts": Continue where you left off (the default) or Open a New Tab. */
function session() {
  let s=createInitialState();
  const profile=s.activeBrowserProfileId;
  const add=(url:string,extra:Record<string,unknown>={})=>{const tab={...makeTab('tab-'+(s.tabs.length+1).toString().padStart(8,'0')+'-0000-0000-0000-000000000000',s.activeProfileId,url,profile),...extra};s.tabs.push(tab as any);return tab;};
  s.tabs=[];
  add('https://example.com/pinned',{pinned:true});
  add('https://example.com/one');
  add('https://example.com/two');
  const grouped=add('https://example.com/grouped');
  s.activeTabId=grouped.id;
  s.bookmarks=['https://example.com/kept-bookmark'];
  s.settings={...s.settings,onStartup:'newtab'};
  return restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s))));
}

test('the setting defaults to continue, and anything else saved is read as continue', () => {
  assert.equal(createInitialState().settings.onStartup,'continue');
  const odd=restoreSnapshot({settings:{onStartup:'something-else'}} as any);
  assert.equal(odd.settings.onStartup,'continue');
  assert.equal(restoreSnapshot({settings:{onStartup:'newtab'}} as any).settings.onStartup,'newtab');
  assert.equal(restoreSnapshot({} as any).settings.onStartup,'continue');
});

test('the setting is validated: two values, nothing else', () => {
  for (const value of ['continue','newtab']) assert.doesNotThrow(() => validateAction({type:'settings.update',patch:{onStartup:value}}));
  for (const value of ['','New Tab','restore',null,1,true]) assert.throws(() => validateAction({type:'settings.update',patch:{onStartup:value}}), /When Acira starts/, String(value));
  const changed=reduceBrowser(createInitialState(),{type:'settings.update',patch:{onStartup:'newtab'}} as any);
  assert.equal(changed.settings.onStartup,'newtab');
});

test('Open a New Tab: the tabs of the last session are replaced by one new tab in front, pinned tabs stay', () => {
  const saved=session();
  assert.equal(saved.tabs.length,4);
  const id='tab-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const fresh=freshStartSnapshot(saved,id);
  assert.deepEqual(fresh.tabs.map(t=>t.url),['https://example.com/pinned','acira://new']);
  assert.equal(fresh.activeTabId,id);
  assert.equal(fresh.tabs.at(-1)!.id,id);
  assert.equal(fresh.tabs.at(-1)!.contentKind,'internal');
  assert.equal(fresh.tabs.at(-1)!.browserProfileId,saved.activeBrowserProfileId,'the new tab opens in the profile that was on screen');
  assert.equal(fresh.activeBrowserProfileId,saved.activeBrowserProfileId);
});

test('Open a New Tab keeps everything that is not a tab: settings, bookmarks, profiles', () => {
  const saved=session();
  const fresh=freshStartSnapshot(saved,'tab-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(fresh.settings.onStartup,'newtab','the choice itself stays');
  assert.deepEqual(fresh.bookmarks,saved.bookmarks);
  assert.deepEqual(fresh.browserProfiles,saved.browserProfiles);
  assert.deepEqual(fresh.settings,saved.settings);
});

test('Open a New Tab with no pinned tabs leaves just the new tab; with nothing saved it still does', () => {
  const saved=session();
  saved.tabs=saved.tabs.map(t=>({...t,pinned:false}));
  const fresh=freshStartSnapshot(saved,'tab-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.deepEqual(fresh.tabs.map(t=>t.url),['acira://new']);
  const empty=freshStartSnapshot(createInitialState(),'tab-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(empty.tabs.length,1);
  assert.equal(empty.activeTabId,'tab-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

test('Open a New Tab leaves no group, split or favorite link pointing at a tab that is gone', () => {
  let saved=session();
  saved=reduceBrowser(saved,{type:'tab.group.create',tabId:saved.tabs[1].id,name:'Research'} as any);
  saved=reduceBrowser(saved,{type:'tab.group.assign',tabId:saved.tabs[2].id,name:'Research'} as any);
  assert.equal(saved.tabs.filter(t=>t.group==='Research').length>=1,true,'the group is in use before the restart');
  const withFavorite=restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot({...saved,tabs:saved.tabs.map((t,i)=>i===3?{...t,favoriteId:'fav-1'}:t)}))));
  const fresh=freshStartSnapshot(withFavorite,'tab-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  const ids=new Set(fresh.tabs.map(t=>t.id));
  assert.ok(fresh.tabs.every(t=>!t.group||fresh.tabGroups.some(g=>g.name===t.group&&g.browserProfileId===t.browserProfileId)),'a tab never names a group that is missing');
  for (const group of fresh.tabGroups||[]) assert.ok(!group.lastActiveTabId||ids.has(group.lastActiveTabId),'a group does not remember a tab that is gone');
  assert.ok(fresh.tabs.every(t=>!t.favoriteId),'the favorite stays a favorite; its old tab is gone with the other tabs');
  assert.ok(!fresh.windowUi.split||fresh.windowUi.split.tabIds.every((id:string)=>ids.has(id)),'no split view over closed tabs');
});

test('Open a New Tab never carries private, Tor or secured tabs forward', () => {
  const saved=session();
  const withPrivate={...saved,tabs:[...saved.tabs,{...saved.tabs[0],id:'tab-11111111-2222-3333-4444-555555555555',privacy:'private' as const,pinned:true}]};
  const fresh=freshStartSnapshot(withPrivate as any,'tab-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.ok(fresh.tabs.every(t=>!t.privacy));
});

// The startup wiring in main.cjs: one place picks the windows, and the new-tab start hands every saved window to Rewind first.
const main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
test('main.cjs: both start paths go through the one choice, and the fresh tab is made in start()', () => {
  assert.equal((main.match(/(?<!function )restoreStartWindows\(\)/g)||[]).length,2,'the first start and the deferred start (after a web app opened first)');
  assert.doesNotMatch(main,/for\(const id of restorableWindowIds\(\)\)createBrowserWindow/);
  assert.match(main,/function restoreStartWindows\(\)\{const choice=require\('\.\/startup-windows\.cjs'\)\.chooseStartWindows\(restorableWindowIds\(\),database\)/);
  assert.match(main,/for\(const id of \[\.\.\.choice\.ids,\.\.\.choice\.dropped\]\)\{try\{const saved=database\.readWindow\(id\);if\(saved\)keep\.capture\(restoreSnapshot\(saved\),\{windowId:id,reason:'window-close'\}\)/,'Rewind gets every saved window before any is left out');
  assert.match(main,/if\(freshStart\)state=require\('\.\/runtime\.cjs'\)\.freshStartSnapshot\(state,'tab-'\+randomUUID\(\)\);/);
  assert.ok(main.indexOf("keep.capture(")<main.indexOf('choice.ids.map(id=>createBrowserWindow'),'kept before the window opens');
});
