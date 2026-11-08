import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appClickPlan,appTabFor} from '../src/ui/sidebarApps';

// A click on a favorite tile (reviewer, 2 Nov: "fav tabs aren't a tab. when you click in the fav tab, it opens a new tab").
// A favorite owns one tab, found by its `favoriteId` (runtime/favoriteTabs.ts): the first click opens it, later clicks return
// to it, and on it a click takes it back to the favorite's address once you browsed away. Ctrl/Cmd or middle-click is still a
// background copy; Shift+click a new window. This replaces R3-72 (a second click opened a fresh tab).
const youtube={id:'yt',url:'https://www.youtube.com/',title:'YouTube'};
const tab=(id:string,url:string,favoriteId?:string,profile='p1')=>({id,url,browserProfileId:profile,...(favoriteId?{favoriteId}:{})});
const left={button:0};

test('no tab of its own yet: the first click opens one',()=>{
  assert.deepEqual(appClickPlan(left,youtube,[tab('a','https://example.com/')],'a','p1'),{kind:'open'});
});

test('its tab is open but not on screen: the click switches to that same tab, wherever it browsed to',()=>{
  const tabs=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/watch?v=1','yt')];
  assert.deepEqual(appClickPlan(left,youtube,tabs,'a','p1'),{kind:'select',tabId:'b'});
});

test('on its own tab: a click takes it back to the favorite\'s address when it browsed away, and does nothing at the address',()=>{
  const away=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/watch?v=42','yt')];
  assert.deepEqual(appClickPlan(left,youtube,away,'b','p1'),{kind:'home',tabId:'b'});
  const home=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/','yt')];
  assert.deepEqual(appClickPlan(left,youtube,home,'b','p1'),{kind:'none'},'never a second copy');
});

test('an ordinary tab on another page of the site is not the favorite\'s tab, nor is another profile\'s',()=>{
  const tabs=[tab('a','https://www.youtube.com/watch?v=1'),tab('z','https://www.youtube.com/','yt','p2')];
  assert.deepEqual(appClickPlan(left,youtube,tabs,'a','p1'),{kind:'open'});
  assert.equal(appTabFor(youtube,tabs,'p1'),undefined);
  assert.equal(appTabFor(youtube,tabs,'p2')?.id,'z');
});

// Item 33 (7 Nov): a favorite made without a tab (a typed address, a dropped link, an import, a web-app install) used to open a second copy of a page
// that was already open. Its click now takes the ordinary tab at exactly its address over: the tab is linked, then selected, and nothing new opens.
test('no tab of its own, but its address is open in an ordinary tab: the click takes that tab over, never a second copy',()=>{
  const tabs=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/')];
  assert.deepEqual(appClickPlan(left,youtube,tabs,'a','p1'),{kind:'adopt',tabId:'b',select:true});
  assert.deepEqual(appClickPlan(left,youtube,tabs,'b','p1'),{kind:'adopt',tabId:'b',select:false},'already on screen: it is only linked');
  const two=[tab('a','https://www.youtube.com/'),tab('b','https://www.youtube.com/')];
  assert.deepEqual(appClickPlan(left,youtube,two,'b','p1'),{kind:'adopt',tabId:'b',select:false},'the tab on screen wins');
  assert.deepEqual(appClickPlan(left,youtube,two,'x','p1'),{kind:'adopt',tabId:'a',select:true},'else the first in the list');
});

test('only exactly the favorite\'s address, in this profile, in an unlinked ordinary tab is taken over',()=>{
  const other={id:'fb',url:'https://www.facebook.com/',title:'Facebook'};
  assert.deepEqual(appClickPlan(left,youtube,[tab('a','https://www.youtube.com/watch?v=1')],'a','p1'),{kind:'open'},'another page of the site');
  assert.deepEqual(appClickPlan(left,youtube,[tab('a','https://www.youtube.com/','fb')],'a','p1'),{kind:'open'},'a tab linked to another favorite stays that favorite\'s');
  assert.deepEqual(appClickPlan(left,youtube,[tab('a','https://www.youtube.com/',undefined,'p2')],'a','p1'),{kind:'open'},'another profile\'s tab');
  for(const privacy of ['private','tor','secured'])assert.deepEqual(appClickPlan(left,youtube,[{...tab('a','https://www.youtube.com/'),privacy}],'a','p1'),{kind:'open'},privacy+' tabs are never taken over');
  assert.deepEqual(appClickPlan(left,other,[tab('a','https://www.youtube.com/')],'a','p1'),{kind:'open'});
  assert.deepEqual(appClickPlan(left,youtube,[tab('a','https://www.youtube.com/'),tab('b','https://www.youtube.com/watch?v=9','yt')],'a','p1'),{kind:'select',tabId:'b'},'a linked tab always comes first');
});

test('Ctrl/Cmd click, middle-click and Shift+click still open a copy even when the address is open',()=>{
  const tabs=[tab('a','https://www.youtube.com/')];
  assert.deepEqual(appClickPlan({button:0,metaKey:true},youtube,tabs,'a','p1'),{kind:'new-tab'});
  assert.deepEqual(appClickPlan({button:1},youtube,tabs,'a','p1'),{kind:'new-tab'});
  assert.deepEqual(appClickPlan({button:0,shiftKey:true},youtube,tabs,'a','p1'),{kind:'new-window'});
});

test('Ctrl or Cmd click and middle-click open an ordinary background tab; Shift+click a new window; other buttons nothing',()=>{
  const tabs=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/','yt')];
  for(const click of [{button:0,ctrlKey:true},{button:0,metaKey:true},{button:1},{button:1,shiftKey:true},{button:0,ctrlKey:true,shiftKey:true}])
    for(const active of ['a','b'])assert.deepEqual(appClickPlan(click,youtube,tabs,active,'p1'),{kind:'new-tab'},JSON.stringify(click)+' from '+active);
  assert.deepEqual(appClickPlan({button:0,shiftKey:true},youtube,tabs,'b','p1'),{kind:'new-window'});
  assert.deepEqual(appClickPlan({button:2},youtube,tabs,'b','p1'),{kind:'none'},'right-click is the edit menu, not an open');
});

test('a favorite\'s tab is an ordinary row of the tab list unless Settings keep it only in its tile: the one filter is listedInSidebar (tests/favorite-tabs-in-list.test.ts)',()=>{
  const source=readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx',import.meta.url),'utf8');
  assert.match(source,/listedInSidebar\(tab,favorites,state\.settings\)/,'the sidebar filters through the one rule');
  assert.match(readFileSync(new URL('../src/ui/sidebarApps.ts',import.meta.url),'utf8'),/export const listedInSidebar=/);
});

test('the sidebar runs the plan, lists favorites\' tabs like any tab, links dropped tabs and says what a click on the away tile does',()=>{
  const source=readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx',import.meta.url),'utf8');
  assert.match(source,/const plan=appClickPlan\(event,app,favoriteScope\(state\),state\.activeTabId,profileId\)/,'it looks in every workspace of the window');
  assert.match(source,/plan\.kind==='open'\)\{dispatch\(\{type:'tab\.new',url:app\.url,browserProfileId:profileId,favoriteId:app\.id\}\)/);
  assert.match(source,/plan\.kind==='select'\)\{dispatch\(\{type:'tab\.select',id:plan\.tabId\}\)/,'it goes to the tab where it is: its own workspace opens, nothing moves');
  assert.match(source,/plan\.kind==='adopt'\)\{dispatch\(\{type:'tab\.favorite',id:plan\.tabId,favoriteId:app\.id\}\);if\(plan\.select\)dispatch\(\{type:'tab\.select',id:plan\.tabId\}\)/,'an open tab at the favorite address is linked and selected');
  assert.match(source,/plan\.kind==='home'\)\{dispatch\(\{type:'tab\.navigate',url:app\.url,tabId:plan\.tabId\}\)/);
  assert.match(source,/const profileTabs=state\.tabs\.filter\(tab=>tab\.browserProfileId===profileId\),listedProfileTabs=profileTabs\.filter\(listed\)/);
  assert.match(source,/members:state\.tabs\.filter\(tab=>listed\(tab\)&&groupForTab\(state,tab\)\?\.id===group\.id\)/);
  assert.match(source,/dispatch\(\{type:'tab\.favorite',id:adopt,favoriteId:app\.id\}\)/,'a tab dropped on Favorites or pinned with Ctrl+Shift+D is linked to the favorite and stays in the list (one function, applyFavorite)');
  assert.match(source,/dispatch\(\{type:'tab\.favorite',id:tab\.id,favoriteId:null\}\)/,'a removed favorite hands its tab back');
  assert.match(source,/const tab=appTabFor\(app,favoriteScope\(state\),profileId\),active=tab\?\.id===state\.activeTabId;/);
  assert.match(source,/<WorkspaceTitle state=\{state\}\/>/,'the workspace title counts every tab of the workspace');
  assert.match(source,/title=\{away\?t\("acirasidebar\.clickToGoBack",\{host:appHost\(app\.url\)\|\|address\(app\.url\)\}\):`\$\{app\.title\} · \$\{address\(app\.url\)\}`\}/);
  const en=JSON.parse(readFileSync(new URL('../src/i18n/en.json',import.meta.url),'utf8')) as Record<string,string>;
  assert.equal(en['acirasidebar.clickToGoBack'],'Click to go back to {host}');
  assert.equal(en['acirasidebar.clickAgainNewTab'],undefined,'the old "new tab" hint is gone');
});

test('Close tab: the favorite\'s right-click editor offers it only while the favorite\'s tab is open, and it closes that tab (Cmd+W\'s twin)',()=>{
  const editor=readFileSync(new URL('../src/components/sidebar/FavoriteEditor.tsx',import.meta.url),'utf8');
  assert.match(editor,/const tab=favoriteTabOf\(\[\.\.\.state\.tabs,\.\.\.\(state\.otherWorkspaceTabs\?\?\[\]\)\],app\.id,target\.profileId\);/,'its tab in any workspace of the window');
  assert.match(editor,/const closeTab=\(\)=>\{if\(tab\)dispatch\(\{type:'tab\.close',id:tab\.id\}\);close\(\);\};/);
  assert.match(editor,/\{tab&&<button type="button" className="acira-button acira-button-quiet fav-edit-close" onClick=\{closeTab\}>\{t\("app\.closeTab"\)\}<\/button>\}/,'shown only while it is open');
  assert.match(readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),/<FavoriteEditor state=\{state\} dispatch=\{dispatch\} close=\{close\}\/>/);
  const sidebar=readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx',import.meta.url),'utf8');
  assert.match(sidebar,/\{app&&tab&&<button type="button" className="sb-button" onClick=\{\(\)=>\{dispatch\(\{type:'tab\.close',id:tab\.id\}\);onDone\(app\.id\);\}\}>\{t\("app\.closeTab"\)\}<\/button>\}/,'a private window\'s inline editor too');
  assert.match(sidebar,/tab=\{editing==='new'\?undefined:favoriteTabOf\(favoriteScope\(state\),editing,profileId\)\}/);
  const en=JSON.parse(readFileSync(new URL('../src/i18n/en.json',import.meta.url),'utf8')) as Record<string,string>;
  assert.equal(en['app.closeTab'],'Close tab');
});

test('Ctrl+Tab\'s Next tab walks the list on screen too: a favorite\'s tab is a tab of it unless it lives only in its tile',()=>{
  const sidebar=readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx',import.meta.url),'utf8');
  assert.match(sidebar,/cycle=vertical\?state\.tabs\.filter\(tab=>tab\.browserProfileId===profile&&listed\(tab\)\):state\.tabs;const target=nextInCycle\(tabCycleOrder\(cycle,state\.tabGroups,state\.activeTabId,vertical\)/);
});
