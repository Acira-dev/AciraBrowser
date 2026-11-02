import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appClickPlan,rememberAppTab} from '../src/ui/sidebarApps';

// R3-72: a click on a favorite tile. On the favorite's own tab a second click opens a fresh tab at its address; from another
// tab it switches back; Ctrl/Cmd or middle-click is a background tab; Shift+click a new window.
const youtube={id:'yt',url:'https://www.youtube.com/',title:'YouTube'};
const tab=(id:string,url:string,profile='p1')=>({id,url,browserProfileId:profile});
const left={button:0};

test('no tab open: a click opens one at the favorite and it becomes the favorite\'s tab',()=>{
  assert.deepEqual(appClickPlan(left,youtube,[tab('a','https://example.com/')],'a','p1'),{kind:'new-tab',background:false,remember:true});
});

test('the favorite\'s tab is open but not the one you are on: the click switches to it',()=>{
  rememberAppTab('yt','b');
  const tabs=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/watch?v=1')];
  assert.deepEqual(appClickPlan(left,youtube,tabs,'a','p1'),{kind:'select',tabId:'b'});
});

test('you are on the favorite\'s tab and click again: a fresh tab at the favorite\'s address (even when you have browsed away on the site)',()=>{
  rememberAppTab('yt','b');
  const home=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/')];
  assert.deepEqual(appClickPlan(left,youtube,home,'b','p1'),{kind:'new-tab',background:false,remember:true},'the new tab becomes the favorite\'s tab');
  const away=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/watch?v=42')];
  assert.deepEqual(appClickPlan(left,youtube,away,'b','p1'),{kind:'new-tab',background:false,remember:true},'no "back home" navigation any more');
});

test('a tab found by address (not opened from the tile) counts too, and another profile\'s tab does not',()=>{
  const tabs=[tab('a','https://www.youtube.com/'),tab('z','https://www.youtube.com/','p2')];
  rememberAppTab('yt','nope');
  assert.deepEqual(appClickPlan(left,youtube,tabs,'a','p1'),{kind:'new-tab',background:false,remember:true},'on it: click again for a new tab');
  assert.deepEqual(appClickPlan(left,youtube,[tab('x','https://example.com/'),tabs[1]],'x','p1'),{kind:'new-tab',background:false,remember:true},'the other profile\'s YouTube is not this favorite\'s tab');
});

test('Ctrl or Cmd click and middle-click always open a new background tab, even from the favorite\'s own tab',()=>{
  rememberAppTab('yt','b');
  const tabs=[tab('a','https://example.com/'),tab('b','https://www.youtube.com/')];
  for(const click of [{button:0,ctrlKey:true},{button:0,metaKey:true},{button:1},{button:1,shiftKey:true},{button:0,ctrlKey:true,shiftKey:true}])
    for(const active of ['a','b'])assert.deepEqual(appClickPlan(click,youtube,tabs,active,'p1'),{kind:'new-tab',background:true,remember:false},JSON.stringify(click)+' from '+active);
});

test('Shift+click opens a new window; other buttons do nothing',()=>{
  const tabs=[tab('b','https://www.youtube.com/')];rememberAppTab('yt','b');
  assert.deepEqual(appClickPlan({button:0,shiftKey:true},youtube,tabs,'b','p1'),{kind:'new-window'});
  assert.deepEqual(appClickPlan({button:2},youtube,tabs,'b','p1'),{kind:'none'},'right-click is the edit menu, not an open');
});

test('the tile runs the plan: select, a window from a tab made here and moved, a new tab; and its tooltip says "Click again for a new tab" only on its own tab',()=>{
  const source=readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx',import.meta.url),'utf8');
  assert.match(source,/const plan=appClickPlan\(event,app,state\.tabs,state\.activeTabId,profileId\)/);
  assert.match(source,/plan\.kind==='select'\)\{rememberAppTab\(app\.id,plan\.tabId\)/);
  assert.match(source,/plan\.kind==='new-window'\)\{const id='tab-'\+crypto\.randomUUID\(\);dispatch\(\{type:'tab\.new',url:app\.url,browserProfileId:profileId,background:true,id\}\);dispatch\(\{type:'tab\.move-window',id\}\)/);
  assert.match(source,/if\(plan\.remember\)pendingApp\.current=app\.id/);
  assert.match(source,/title=\{active\?t\("acirasidebar\.clickAgainNewTab"\):`\$\{app\.title\} · \$\{address\(app\.url\)\}`\}/,'short enough for the house tooltip to fit beside the page (a longer one would fall back to the OS tooltip)');
  const en=JSON.parse(readFileSync(new URL('../src/i18n/en.json',import.meta.url),'utf8')) as Record<string,string>;
  assert.equal(en['acirasidebar.clickAgainNewTab'],'Click again for a new tab');
});
