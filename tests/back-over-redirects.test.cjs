'use strict';
// The Back trap: page A sends you to B by itself (location.href after a timer, a meta refresh) and Back from B lands on A, which
// sends you to B again. Chromium marks A skippable and navigationHistory.goBack() steps over it (checked in the real app: a timer
// redirect, a meta refresh and a two-step chain go back to the page before; a redirect after a click goes back to the clicked page).
// The trap was Acira's own fallback: when the page has nothing it may go back to, the tab's history went to A. Now it goes to the app
// page before the skipped ones (the New Tab page), or nowhere, and the Back button is off then, as in Chrome.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {stepsBackOverSkipped}=require('../desktop/history-skip.cjs');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {validateAction}=require('../desktop/validation.cjs');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),app=fs.readFileSync(path.join(__dirname,'../src/App.tsx'),'utf8');

test('the page\'s own Back applies whenever it has somewhere to go (Chromium already skips A, never a page the person clicked on)',()=>{
 assert.equal(stepsBackOverSkipped(['https://start/','https://a/','https://b/'],2,true,2),null,'timer or meta redirect after a typed page: goBack lands on the typed page');
 assert.equal(stepsBackOverSkipped(['https://start/','https://clicked/','https://b/'],2,true,2),null,'a redirect after a click: goBack lands on the clicked page');
 assert.equal(stepsBackOverSkipped(['https://b/'],0,false,0),null,'a page with nothing behind it');
});

test('when every earlier page entry was skipped, Back goes to the app page before them, over a whole chain',()=>{
 assert.equal(stepsBackOverSkipped(['acira://new','https://a/','https://b/'],2,false,1),2,'New Tab, A (timer), B: Back from B is the New Tab page, not A');
 assert.equal(stepsBackOverSkipped(['acira://new','https://a/','https://a2/','https://c/'],3,false,2),3,'a chain A to A2 to C: Back lands before A');
 assert.equal(stepsBackOverSkipped(['https://x/','acira://settings','https://a/','https://b/'],3,false,1),2,'the nearest app page');
 assert.equal(stepsBackOverSkipped(['https://a/','https://b/'],1,false,1),0,'only the redirecting page is behind: nowhere to go');
});

test('the tab\'s history can step back over several entries at once, onto an app page',()=>{
 let s=createInitialState();const id=s.activeTabId;
 s=reduceBrowser(s,{type:'tab.navigate',tabId:id,url:'https://a.test/'});
 s.tabs=s.tabs.map(t=>t.id===id?{...t,history:['acira://new','https://a.test/','https://b.test/'],historyIndex:2,url:'https://b.test/',contentKind:'web'}:t);
 const back=reduceBrowser(s,{type:'tab.history',direction:-1,steps:2}),tab=back.tabs.find(t=>t.id===id);
 assert.deepEqual([tab.url,tab.historyIndex,tab.contentKind],['acira://new',0,'internal']);
 assert.equal(reduceBrowser(s,{type:'tab.history',direction:-1}).tabs.find(t=>t.id===id).url,'https://b.test/','one step onto a web entry is still the page\'s own business');
 assert.doesNotThrow(()=>validateAction({type:'tab.history',direction:-1,steps:2},s));assert.doesNotThrow(()=>validateAction({type:'tab.history',direction:1},s));
 for(const steps of [0,101,1.5,'2'])assert.throws(()=>validateAction({type:'tab.history',direction:-1,steps},s),/History steps/,String(steps));
});

test('Back from the button, the keys and the app command uses it; Forward is unchanged; the button is off when nothing is behind',()=>{
 const at=main.indexOf("if(c.type==='back'||c.type==='forward'){"),block=main.slice(at,main.indexOf("else if(c.type==='reload')",at));
 assert.ok(block.includes("const skip=c.type==='back'?stepsBackOverSkipped(tab.history,tab.historyIndex,wc.navigationHistory.canGoBack(),wc.navigationHistory.getActiveIndex()):null;"));
 assert.ok(block.includes("dispatch({type:'tab.history',direction:-1,steps:skip})"));
 assert.ok(block.includes("wc.navigationHistory[c.type==='back'?'goBack':'goForward']()"),'otherwise the page\'s own Back and Forward, as before');
 assert.ok(main.includes("case 'back':case 'forward':if(active.contentKind==='web')browserCommand({type:command.action,tabId:active.id})"),'Cmd+[, Cmd+Left, the mouse back button and the menu come through browserCommand');
 assert.ok(app.includes("disabled={tab.contentKind === 'web' ? !tab.canGoBack && !tab.history.slice(0, tab.historyIndex).some(url => url.startsWith('acira://')) :"));
});
