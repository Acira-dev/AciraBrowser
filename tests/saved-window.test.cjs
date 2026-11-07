'use strict';
// field-safety: a window record in browser.sqlite that cannot be read (damaged text the integrity check does not see, or a shape a newer Acira wrote)
// made that window's start throw. With one window Acira then stayed running with no window and no message (seen in the real app, 3 Nov). Now one
// question per launch: Start fresh (a copy of the database first, one new tab, the shared data salvaged) or Quit (changes nothing).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BrowserDatabase}=require('../desktop/database.cjs'),{readSavedWindow,salvage,createSavedWindowRecovery}=require('../desktop/saved-window.cjs');
const {restoreSnapshot,createInitialState,makeTab,persistedSnapshot,reduceBrowser}=require('../desktop/runtime.cjs');
const {asideName}=require('../desktop/database-backups.cjs'),{createOpenWindows}=require('../desktop/open-windows.cjs');
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-saved-window-'));

/** A profile with two windows: tabs, a bookmark, history and a chosen setting, saved the way main saves them. */
function profileWithWindows(){
 const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);
 let state=createInitialState();
 for(const url of ['https://one.example/','https://two.example/'])state=reduceBrowser(state,{type:'tab.new',url});
 state.settings={...state.settings,searchEngine:'duckduckgo'};
 const profileId=state.activeBrowserProfileId;
 state.bookmarkNodes=[{id:'bm-1',type:'bookmark',title:'Kept bookmark',url:'https://kept.example/',parentId:null,position:0,browserProfileId:profileId}];
 state.browsingHistory=[{id:'visit-1',url:'https://kept.example/',title:'Kept',time:new Date(Date.UTC(2026,10,3)).toISOString(),browserProfileId:profileId}];
 db.saveWindow('main',persistedSnapshot(state));
 db.saveWindow('window-2',persistedSnapshot({...state,tabs:[state.tabs[1]],activeTabId:state.tabs[1].id}));
 return {db,file,profileId};
}
const damage=(db,id,payload='{"tabs":[{"id":"t1","url":"https://exa')=>db.db.prepare('UPDATE windows SET payload=? WHERE id=?').run(payload,id);
const tools={restoreSnapshot,createInitialState,makeTab};

test('a record that cannot be read is told apart from one that is missing and one that reads',async()=>{
 const {db}=profileWithWindows();
 assert.ok((await readSavedWindow({database:db,windowId:'main',restoreSnapshot})).snapshot.tabs.length>=2);
 assert.equal(await readSavedWindow({database:db,windowId:'nope',restoreSnapshot}),null);
 damage(db,'main');assert.match(String((await readSavedWindow({database:db,windowId:'main',restoreSnapshot})).damaged),/JSON|Unterminated/);
 damage(db,'window-2','{"tabs":{"not":"a list"},"browserProfiles":"x"}');
 assert.ok((await readSavedWindow({database:db,windowId:'window-2',restoreSnapshot})).damaged,'a shape this Acira cannot restore counts as unreadable too');
 db.close();
});

test('Start fresh salvages the shared data from another window that reads: settings, bookmarks and history kept, one new tab',()=>{
 const {db,profileId}=profileWithWindows();damage(db,'main');
 const state=salvage({database:db,windowId:'main',...tools});
 assert.equal(state.tabs.length,1);assert.equal(state.tabs[0].url,'acira://new');assert.equal(state.activeTabId,state.tabs[0].id);
 assert.equal(state.tabs[0].browserProfileId,profileId);assert.equal(state.activeBrowserProfileId,profileId);
 assert.equal(state.settings.searchEngine,'duckduckgo','the settings came from the other window');
 assert.deepEqual(state.bookmarkNodes.map(b=>b.title),['Kept bookmark']);assert.deepEqual(state.browsingHistory.map(v=>v.url),['https://kept.example/']);
 assert.equal(state.windowUi.split,null);assert.deepEqual(state.closedTabs,[]);
 db.close();
});

test('with no window record that reads, bookmarks, history and profiles still come back from their own tables',()=>{
 const {db,profileId}=profileWithWindows();damage(db,'main');damage(db,'window-2');
 const state=salvage({database:db,windowId:'main',...tools});
 assert.deepEqual(state.bookmarkNodes.map(b=>b.title),['Kept bookmark']);assert.deepEqual(state.browsingHistory.map(v=>v.url),['https://kept.example/']);
 assert.ok(state.browserProfiles.some(p=>p.id===profileId));assert.equal(state.tabs.length,1);assert.equal(state.tabs[0].browserProfileId,profileId);
 db.close();
});

test('one question per launch: Quit changes nothing (no copy, nothing written); Start fresh keeps a copy of the database first, once',async()=>{
 const quitCase=profileWithWindows();damage(quitCase.db,'main');damage(quitCase.db,'window-2');
 const before=fs.readdirSync(path.dirname(quitCase.file)).sort();let asked=0,quits=0;
 const quitting=createSavedWindowRecovery({database:quitCase.db,...tools,asideName,ask:async()=>{asked++;return 'quit';},quit:()=>{quits++;}});
 const [first,second]=await Promise.all([quitting.recover('main',new Error('bad')),quitting.recover('window-2',new Error('bad'))]);
 assert.equal(asked,1,'one question for both windows');assert.deepEqual([first.choice,second.choice],['quit','quit']);assert.ok(quits>=1);
 assert.deepEqual(fs.readdirSync(path.dirname(quitCase.file)).sort(),before,'no copy is made when the person quits');
 quitCase.db.close();
 const freshCase=profileWithWindows();damage(freshCase.db,'main');let questions=[];
 const fresh=createSavedWindowRecovery({database:freshCase.db,...tools,asideName,now:()=>Date.UTC(2026,10,3,15),ask:async question=>{questions.push(question);return 'fresh';},quit:()=>assert.fail('no quit')});
 const outcome=await fresh.recover('main',new Error('bad'));
 assert.equal(outcome.choice,'fresh');assert.equal(questions.length,1);
 const copy=freshCase.file+'.damaged-2026-11-03T15-00-00-000Z';assert.equal(questions[0].aside,copy,'the question names the copy');assert.equal(outcome.aside,copy);
 const kept=new BrowserDatabase(copy);assert.match(kept.db.prepare("SELECT payload FROM windows WHERE id='main'").get().payload,/^\{"tabs":\[\{"id":"t1"/,'the copy holds the unreadable record as it was');kept.close();
 assert.equal(outcome.state.settings.searchEngine,'duckduckgo');
 freshCase.db.close();
});

test('when no copy can be made (a full disk), nothing is started fresh: Acira explains once and quits',async()=>{
 const {db}=profileWithWindows();damage(db,'main');damage(db,'window-2');
 db.backup=()=>{throw Object.assign(new Error('database or disk is full'),{errcode:13});};
 let explained=0;const recovery=createSavedWindowRecovery({database:db,...tools,asideName,ask:async()=>'fresh',quit:()=>{},explain:()=>{explained++;},warn:()=>{}});
 const results=await Promise.all([recovery.recover('main',new Error('bad')),recovery.recover('window-2',new Error('bad'))]);
 assert.deepEqual(results.map(r=>r.choice),['quit','quit']);assert.equal(explained,1);
 db.close();
});

test('the windows to reopen keep one whose record cannot be read, so it asks instead of disappearing without a word',()=>{
 const {db}=profileWithWindows();db.setMetadata('open-windows',JSON.stringify(['main','window-2','gone']));damage(db,'window-2');
 const open=createOpenWindows({getDatabase:()=>db,getControllers:()=>[]});
 assert.deepEqual(open.restorable(),['main','window-2']);
 db.close();
});

test('main: a window waiting on the question never saves over its record, and the start reads through saved-window.cjs',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/createSaveQueue\(\{write\(\)\{try\{if\(!privateMode&&!webApp&&!recordUnreadable\)database\?\.saveWindow\(windowId,persistedSnapshot\(state\)\);/);
 assert.match(main,/const saved=await require\('\.\/saved-window\.cjs'\)\.readSavedWindow\(\{database,windowId,restoreSnapshot\}\);if\(saved\?\.unavailable\)\{[^\n]*?\}if\(saved\?\.damaged\)\{[^\n]*recordUnreadable=true;const outcome=await savedWindows\(\)\.recover\(windowId,saved\.damaged\);if\(outcome\.choice!=='fresh'\)throw [^\n]*recordUnreadable=false;state=outcome\.state;/);
 assert.match(main,/buttons:\[tm\('main\.dataFreshButton'\),tm\('main\.dataQuitButton'\)\],defaultId:0,cancelId:1/);
 assert.equal((main.match(/database\.readWindow\(windowId\)/g)||[]).length,0,'no other read of this window\'s record can throw out of the start');
});
