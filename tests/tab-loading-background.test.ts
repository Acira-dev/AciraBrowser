// Reported bug (27 Oct): the loading dot matrix showed only on the current tab's row. Every tab row — sidebar, horizontal
// strip, compact strip, tab viewer — shows it while that tab's page loads, current or not, and its icon after.
// Native proof: qa/tab-loading-background.mjs (slow local server, three background tabs, capturePage per layout).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import {tabShowsLoading} from '../src/ui/tabLoading';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';

const apply=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const event=(tabId:string,patch:Record<string,unknown>):BrowserAction=>({type:'browser.event',event:{type:'state',tabId,...patch}} as BrowserAction);
const read=(file:string)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('a tab opened in the background with an address is loading at once (a requested address main gives a page to)',()=>{
  let s=apply(createInitialState(),{type:'tab.navigate',url:'https://home.test/'});const home=s.activeTabId;
  s=apply(s,{type:'tab.new',url:'https://slow.test/1',background:true,afterId:home});
  const tab=s.tabs.find(t=>t.url==='https://slow.test/1')!;
  assert.equal(s.activeTabId,home,'the current tab stays current');
  assert.equal(tab.loading,true);assert.equal(tab.requestedUrl,'https://slow.test/1');
  assert.ok(tabShowsLoading(tab),'its row shows the dots');
});

test('lazy background tabs (Rewind restores), blank new tabs and foreground tabs keep their old behaviour',()=>{
  let s=createInitialState();
  s=apply(s,{type:'tab.new',url:'https://restored.test/',background:true,lazy:true});
  const restored=s.tabs.at(-1)!;assert.equal(restored.loading,false,'a lazy tab waits asleep until selected');assert.equal(restored.requestedUrl,undefined);
  s=apply(s,{type:'tab.new',background:true});assert.equal(s.tabs.at(-1)!.loading,false,'a blank new tab is not a page load');
  s=apply(s,{type:'tab.new',url:'https://front.test/'});const front=s.tabs.find(t=>t.url==='https://front.test/')!;
  assert.equal(s.activeTabId,front.id);assert.equal(front.loading,false,'foreground loading still comes from main');
});

test('a background page that loads keeps loading on (main withholds only progress off screen), then shows its icon',()=>{
  let s=apply(createInitialState(),{type:'tab.navigate',url:'https://home.test/'});s=apply(s,event(s.activeTabId,{loading:false}),{type:'tab.new',url:'https://slow.test/2',background:true});
  const id=s.tabs.find(t=>t.url==='https://slow.test/2')!.id;
  // What main sends for a hidden view: did-start-loading, then the one hidden-progress message.
  s=apply(s,event(id,{loading:true,error:null}),event(id,{progress:undefined,loading:true}));
  let tab=s.tabs.find(t=>t.id===id)!;assert.equal(tab.progress,undefined);assert.ok(tabShowsLoading(tab),'no progress needed');
  s=apply(s,event(id,{loading:false,title:'Slow page 2',favicon:'https://slow.test/icon.svg',url:'https://slow.test/2'}));
  tab=s.tabs.find(t=>t.id===id)!;assert.equal(tabShowsLoading(tab),false,'favicon back');assert.equal(tab.requestedUrl,undefined);
  // A reload of that background tab: loading again, dots again, on that row only.
  s=apply(s,event(id,{loading:true,error:null}));assert.ok(tabShowsLoading(s.tabs.find(t=>t.id===id)!));
  assert.equal(s.tabs.filter(tabShowsLoading).length,1);
});

test('the row rule: loading web pages only, never sleeping, failed or Acira pages, and never tied to being the current tab',()=>{
  const base={loading:true,contentKind:'web' as const,sleeping:undefined,error:null};
  assert.equal(tabShowsLoading(base),true);
  assert.equal(tabShowsLoading({...base,loading:false}),false);
  assert.equal(tabShowsLoading({...base,sleeping:true}),false);
  assert.equal(tabShowsLoading({...base,error:'Failed (-105)'}),false);
  assert.equal(tabShowsLoading({...base,contentKind:'newtab' as never}),false);
});

test('every tab row uses the one rule: sidebar, horizontal strip, compact strip, tab viewer',()=>{
  const sidebar=read('src/components/sidebar/AciraSidebar.tsx');
  assert.match(sidebar,/useLoadingSignal\(tabShowsLoading\(tab\)\)/,'sidebar rows');
  assert.doesNotMatch(sidebar,/useLoadingSignal\([^)]*active/,'the sidebar no longer gates the dots on the current tab');
  assert.doesNotMatch(sidebar,/useLoadingSignal\([^)]*progress/,'nor on progress, which main withholds off screen');
  const app=read('src/App.tsx');
  assert.match(app,/renderIcon=\{t => tabShowsLoading\(t\)\?<span className="tab-agent-icon"><DotMatrix preset="loader"/,'compact strip (R5-11: the loader, in the full text colour)');
  assert.doesNotMatch(app,/<span className="tab-agent-icon"[^>]*><DotMatrix preset="pulse"/,'R5-11: no strip shows the sparse pulse as its loading signal');
  assert.match(app,/\{tabShowsLoading\(t\) \? <span className="tab-agent-icon"/,'horizontal strip');
  assert.match(read('src/components/sidebar/TabSwitcher.tsx'),/tabShowsLoading\(tab\)\?<DotMatrix/,'tab viewer');
  // The dots are painted by DotMatrix's one shared loop: a row re-renders on start and stop only, not per frame.
  assert.match(read('src/components/DotMatrix.tsx'),/One animation loop serves every visible matrix/);
});

test('main gives a requested background tab its page, without selecting it through the extensions library',()=>{
  const main=read('desktop/main.cjs');
  assert.match(main,/&&!requestedInBackground\(tab\)\)continue;const entry=ensurePage\(tab\)/,'syncPages makes the page');
  assert.match(main,/function requestedInBackground\(tab\)\{return tab\.loading&&tab\.contentKind==='web'&&!!tab\.requestedUrl&&tab\.requestedUrl===tab\.url/);
  // electron-chrome-extensions' observeTab calls onActivated for every added tab, which reached tab.select.
  assert.match(main,/selectTab\(wc\)\{if\(extensionSelectQuiet\)return;/);
  // Only the shown CURRENT tab attaches on its own (quietly since 13.8: the library's selectTab answer brought the window forward); a visible split pane that is not the current tab is attached quietly too (tests/split-restore-active-pane.test.cjs).
  assert.match(main,/function attachExtensionTab\(id,wc\)\{if\(!extensionManager\)return;(?:\/\*[^*]*\*\/)?if\(pageVisible\(id\)&&id===state\.activeTabId\)\{(?:\/\*[^*]*\*\/)?extensionSelectQuiet=true;try\{extensionManager\.attachTab\(wc,mainWindow\);\}finally\{extensionSelectQuiet=false;\}return;\}extensionSelectQuiet=true;try\{/);
  // (A secured workspace's page is never handed to extensions: R3-38's guard may sit in front of the call.)
  assert.match(main,/const wc=view\.webContents;(?:\/\*[^*]*\*\/)?(?:wc\.setMaxListeners\(32\);)?(?:\/\*[^*]*\*\/)?(?:if\(tab\.privacy!=='secured'\))?attachExtensionTab\(tab\.id,wc\);/);
  assert.match(read('desktop/rewind/rewind.cjs'),/type:'tab\.new',url:tab\.url,background:true,lazy:true/,'Rewind restores stay asleep');
});

test('R5-11: a loading row lights its dots in the full foreground, not the dim ink of a row that is not current', () => {
  const css = read('src/components/sidebar/sidebar.css');
  assert.match(css, /\.acira-sidebar \.sb-tab \.sb-tab-icon\[data-loading\]\{opacity:1;color:var\(--sb-fg\)\}/);
  const sidebar = read('src/components/sidebar/AciraSidebar.tsx');
  assert.equal((sidebar.match(/<span className="sb-tab-icon" data-loading=\{loading\|\|undefined\}>\{loading\?/g) || []).length, 2, 'both row renderings mark the loading icon');
});
