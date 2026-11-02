import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appClickPlan,appTabFor,listedInSidebar} from '../src/ui/sidebarApps';

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

test('an ordinary tab on the same site is not the favorite\'s tab, nor is another profile\'s',()=>{
  const tabs=[tab('a','https://www.youtube.com/'),tab('z','https://www.youtube.com/','yt','p2')];
  assert.deepEqual(appClickPlan(left,youtube,tabs,'a','p1'),{kind:'open'});
  assert.equal(appTabFor(youtube,tabs,'p1'),undefined);
  assert.equal(appTabFor(youtube,tabs,'p2')?.id,'z');
});

test('Ctrl or Cmd click and middle-click open an ordinary background tab; Shift+click a new window; other buttons nothing',()=>{
  const tabs=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/','yt')];
  for(const click of [{button:0,ctrlKey:true},{button:0,metaKey:true},{button:1},{button:1,shiftKey:true},{button:0,ctrlKey:true,shiftKey:true}])
    for(const active of ['a','b'])assert.deepEqual(appClickPlan(click,youtube,tabs,active,'p1'),{kind:'new-tab'},JSON.stringify(click)+' from '+active);
  assert.deepEqual(appClickPlan({button:0,shiftKey:true},youtube,tabs,'b','p1'),{kind:'new-window'});
  assert.deepEqual(appClickPlan({button:2},youtube,tabs,'b','p1'),{kind:'none'},'right-click is the edit menu, not an open');
});

test('the tab list leaves out a favorite\'s own tab, unless Favorites are hidden or the favorite is gone',()=>{
  const favorites={apps:[youtube],hidden:false};
  assert.equal(listedInSidebar(tab('b','https://www.youtube.com/','yt'),favorites),false);
  assert.equal(listedInSidebar(tab('a','https://www.youtube.com/'),favorites),true,'an ordinary YouTube tab is listed');
  assert.equal(listedInSidebar(tab('b','https://www.youtube.com/','yt'),{...favorites,hidden:true}),true,'Favorites off: listed like any tab');
  assert.equal(listedInSidebar(tab('b','https://www.youtube.com/','gone'),favorites),true,'its favorite was removed: listed');
});

test('the sidebar runs the plan, hides favorites\' tabs from the list, adopts dropped tabs and says what a click on the away tile does',()=>{
  const source=readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx',import.meta.url),'utf8');
  assert.match(source,/const plan=appClickPlan\(event,app,favoriteScope\(state\),state\.activeTabId,profileId\)/,'it looks in every workspace of the window');
  assert.match(source,/plan\.kind==='open'\)\{dispatch\(\{type:'tab\.new',url:app\.url,browserProfileId:profileId,favoriteId:app\.id\}\)/);
  assert.match(source,/plan\.kind==='select'\)\{dispatch\(\{type:'tab\.select',id:plan\.tabId,here:true\}\)/);
  assert.match(source,/plan\.kind==='home'\)\{dispatch\(\{type:'tab\.navigate',url:app\.url,tabId:plan\.tabId\}\)/);
  assert.match(source,/const profileTabs=state\.tabs\.filter\(tab=>tab\.browserProfileId===profileId&&listed\(tab\)\)/);
  assert.match(source,/members:state\.tabs\.filter\(tab=>listed\(tab\)&&groupForTab/);
  assert.match(source,/dispatch\(\{type:'tab\.favorite',id:tab\.id,favoriteId:added\.id\}\)/,'a tab dropped on Favorites or pinned with Ctrl+Shift+D becomes the favorite\'s tab');
  assert.match(source,/dispatch\(\{type:'tab\.favorite',id:tab\.id,favoriteId:null\}\)/,'a removed favorite hands its tab back');
  assert.match(source,/const tab=appTabFor\(app,favoriteScope\(state\),profileId\),active=tab\?\.id===state\.activeTabId;/);
  assert.match(source,/<WorkspaceTitle state=\{state\} count=\{state\.tabs\.filter\(listed\)\.length\}\/>/,'the workspace title counts the tabs the list shows');
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

test('Ctrl+Tab\'s Next tab walks the list on screen too: a favorite\'s own tab is skipped in the sidebar',()=>{
  const sidebar=readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx',import.meta.url),'utf8');
  assert.match(sidebar,/cycle=vertical\?state\.tabs\.filter\(tab=>!tab\.favoriteId&&tab\.browserProfileId===profile\):state\.tabs;const target=nextInCycle\(tabCycleOrder\(cycle,state\.tabGroups,state\.activeTabId,vertical\)/);
});
