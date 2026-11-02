import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createInitialState,persistedSnapshot,reduceBrowser,restoreSnapshot} from '../src/runtime/core';
import {cleanTabName,renameOutcome,renamedTip,shownTab,tabDisplayTitle,TAB_NAME_MAX} from '../src/runtime/tabTitle';
import {tabSignature} from '../src/ui/tabSignature';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';
const require=createRequire(import.meta.url);

const apply=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const loaded=()=>{let s=apply(createInitialState(),{type:'tab.navigate',url:'https://example.com/'});const id=s.activeTabId;s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,url:'https://example.com/',title:'Example Domain',loading:false}});return {s,id};};
const find=(s:BrowserSnapshot,id:string)=>s.tabs.find(tab=>tab.id===id)!;

test('Rename tab: the name is kept on the tab, the page title stays the page title',()=>{
  let {s,id}=loaded();
  s=apply(s,{type:'tab.rename',id,title:'  Tax   documents  '});
  assert.equal(find(s,id).customTitle,'Tax documents','trimmed, single spaces');
  assert.equal(find(s,id).title,'Example Domain','the page title is untouched');
  assert.equal(tabDisplayTitle(find(s,id)),'Tax documents');
  // The page reloads and retitles itself: the name stays.
  s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,title:'Example Domain — more'}});
  assert.equal(find(s,id).customTitle,'Tax documents');assert.equal(find(s,id).title,'Example Domain — more');
});

test('an empty name, or the page title typed back, restores the page title',()=>{
  let {s,id}=loaded();
  s=apply(s,{type:'tab.rename',id,title:'Mine'});assert.equal(find(s,id).customTitle,'Mine');
  s=apply(s,{type:'tab.rename',id,title:'   '});assert.equal('customTitle' in find(s,id),false);assert.equal(tabDisplayTitle(find(s,id)),'Example Domain');
  s=apply(s,{type:'tab.rename',id,title:'Mine'},{type:'tab.rename',id,title:'Example Domain'});assert.equal(find(s,id).customTitle,undefined);
});

test('renaming to the same name changes nothing (no revision churn)',()=>{
  let {s,id}=loaded();
  s=apply(s,{type:'tab.rename',id,title:'Mine'});const before=s;
  assert.equal(reduceBrowser(before,{type:'tab.rename',id,title:'Mine'}),before);
  assert.equal(reduceBrowser(before,{type:'tab.rename',id:'nope',title:'x'}),before);
  const fresh=loaded();assert.equal(reduceBrowser(fresh.s,{type:'tab.rename',id:fresh.id,title:''}),fresh.s,'nothing to restore');
});

test('a name is one line of at most 120 characters',()=>{
  assert.equal(cleanTabName('a\nb\tc\u0000d'),'a b c d');
  assert.equal(cleanTabName('x'.repeat(500)).length,TAB_NAME_MAX);
  assert.equal(cleanTabName(undefined),'');assert.equal(cleanTabName(42),'');
  const {s,id}=loaded();
  assert.equal(find(apply(s,{type:'tab.rename',id,title:'y'.repeat(300)}),id).customTitle!.length,TAB_NAME_MAX);
});

test('the name survives a restart, a closed-tab restore and a duplicate; it never touches history',()=>{
  let {s,id}=loaded();
  s=apply(s,{type:'tab.rename',id,title:'Project board'});
  const restored=restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s))));
  assert.equal(find(restored,id).customTitle,'Project board','session restore keeps the custom name');
  s=apply(s,{type:'tab.new'});const other=s.activeTabId;
  s=apply(s,{type:'tab.close',id});
  s=apply(s,{type:'tab.restore'});assert.equal(find(s,id).customTitle,'Project board','Ctrl+Shift+T brings the name back');
  s=apply(s,{type:'tab.duplicate',id});assert.equal(find(s,s.activeTabId).customTitle,'Project board');
  assert.ok(other);
  assert.ok(s.browsingHistory.every(visit=>visit.title!=='Project board'),'history keeps the page title');
});

test('every strip, sidebar and viewer row redraws when the name changes',()=>{
  const {s,id}=loaded(),before=find(s,id),after={...before,customTitle:'Mine'};
  assert.notEqual(tabSignature(before,undefined),tabSignature(after,undefined));
});

test('shownTab: the name takes the title\'s place and the page title rides along; the tooltip says "renamed"',()=>{
  const plain={title:'Example',customTitle:undefined},named={title:'Example',customTitle:'Mine'};
  assert.equal(shownTab(plain),plain);
  assert.deepEqual(shownTab(named),{title:'Mine',customTitle:'Mine',pageTitle:'Example'});
  assert.equal(renamedTip(shownTab(named),'Mine','Renamed'),'Mine · Renamed');
  assert.equal(renamedTip(shownTab(plain),'Example','Renamed'),'Example','no marker on a tab that was not renamed');
  assert.equal(renamedTip({},undefined,'Renamed'),undefined);
});

test('what the field saves: nothing for the same name, "" to restore',()=>{
  const tab={title:'Example',customTitle:undefined as string|undefined};
  assert.equal(renameOutcome(tab,'Example'),null,'typed the page title on an unnamed tab: nothing to do');
  assert.equal(renameOutcome(tab,'  '),null);
  assert.equal(renameOutcome(tab,' Mine '),'Mine');
  const named={title:'Example',customTitle:'Mine'};
  assert.equal(renameOutcome(named,'Mine'),null);assert.equal(renameOutcome(named,''),'');assert.equal(renameOutcome(named,'Example'),'');assert.equal(renameOutcome(named,'Other'),'Other');
});

test('the rename action and the Rename tab menu command cross the desktop bridge',async()=>{
  const {validateAction,validateCommand}=require('../desktop/validation.cjs'),{s,id}=loaded();
  assert.doesNotThrow(()=>validateAction({type:'tab.rename',id,title:'Mine'},s));
  assert.doesNotThrow(()=>validateAction({type:'tab.rename',id,title:''},s),'empty restores');
  assert.throws(()=>validateAction({type:'tab.rename',id:'nope',title:'x'},s));
  assert.throws(()=>validateAction({type:'tab.rename',id,title:'x'.repeat(401)},s));
  assert.throws(()=>validateAction({type:'tab.rename',id,title:'x',extra:1},s));
  assert.doesNotThrow(()=>validateCommand({type:'ui',tabId:id,action:'rename-tab',targetTabId:id},s));
  const main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  assert.match(main,/'tab\.rename'/);assert.match(main,/c\.action==='rename-tab'/);
});

test('the inline field is wired in the strip, the sidebar and the tab menu, and F2 starts it',()=>{
  const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
  const strip=read('../src/components/BrowserTabsHorizontal.tsx'),app=read('../src/App.tsx'),sidebar=read('../src/components/sidebar/AciraSidebar.tsx');
  assert.match(strip,/event\.key==='F2'[^}]*requestTabRename/);assert.match(sidebar,/event\.key==='F2'[^}]*setRenaming\('inline'\)/);
  assert.match(app,/<TabTitle className="tab-title"/);assert.match(app,/action: 'rename-tab', targetTabId: context\.id/);assert.match(sidebar,/onDoubleClick=\{event=>\{event\.preventDefault\(\);setRenaming\('inline'\)/);
  const editor=read('../src/components/TabTitleEditor.tsx');
  assert.match(editor,/event\.key==='Enter'[^}]*finish\(true\)/);assert.match(editor,/event\.key==='Escape'[^}]*finish\(false\)/);assert.match(editor,/onBlur=\{\(\)=>finish\(true\)\}/);assert.match(editor,/isComposing/);
});
