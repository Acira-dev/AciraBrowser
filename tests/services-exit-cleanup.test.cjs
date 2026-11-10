'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{BrowserDatabase}=require('../desktop/database.cjs'),{createExitCleanup,cleanupChoice,clearExitRecords,clearStoredExitRecords}=require('../desktop/browser-services/exit-cleanup.cjs');
for(const privacy of ['private','tor'])test(`exit cleanup stores only public split state while retaining live ${privacy} tabs`,()=>{
 const {DatabaseSync}=require('node:sqlite'),runtime=require('../desktop/runtime.cjs'),{commitExitRecords}=require('../desktop/browser-services/exit-cleanup.cjs');
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE windows(id TEXT PRIMARY KEY,payload TEXT,updated_at INTEGER);CREATE TABLE history(id TEXT PRIMARY KEY,profile_id TEXT,visited_at TEXT,payload TEXT)');
 const database={db:sql,transaction:fn=>{sql.exec('BEGIN');try{const result=fn();sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 try{
  let s=runtime.createInitialState();const profile=s.activeBrowserProfileId,first=s.activeTabId;
  s=runtime.reduceBrowser(s,{type:'tab.new',url:'https://public.example/'});const second=s.activeTabId;
  s=runtime.reduceBrowser(s,{type:'split.open',tabIds:[first,second]});const publicGroup=s.windowUi.split.groupId;
  s=runtime.reduceBrowser(s,{type:'tab.new',url:'https://public-three.example/'});const third=s.activeTabId;
  s=runtime.reduceBrowser(s,{type:'tab.new',privacy,url:`https://${privacy}-secret.invalid/`});const secret=s.activeTabId;
  s=runtime.reduceBrowser(s,{type:'split.open',tabIds:[third,secret]});const secretGroup=s.windowUi.split.groupId;s.windowUi.zoomTargetTabId=secret;
  const result=commitExitRecords(database,[{id:'main',snapshot:s}],profile,[]);
  assert(result.windows[0].snapshot.tabs.some(tab=>tab.id===secret));assert.equal(result.windows[0].snapshot.windowUi.split.groupId,secretGroup);
  const verify=()=>{const raw=sql.prepare('SELECT payload FROM windows WHERE id=?').get('main').payload,stored=JSON.parse(raw);for(const value of [secret,secretGroup,`${privacy}-secret.invalid`])assert(!raw.includes(value),`SQL leaked ${value}`);assert(stored.windowUi.splitGroups.some(group=>group.id===publicGroup));};verify();
  sql.prepare('UPDATE windows SET payload=? WHERE id=?').run(JSON.stringify(s),'main');clearStoredExitRecords(database,profile,[]);verify();
 }finally{sql.close();}
});
const state=()=>({revision:0,browserProfiles:[{id:'A',partition:'persist:A'},{id:'B',partition:'persist:B'}],browsingHistory:[{id:'remove-A',browserProfileId:'A',url:'https://remove.example/a',time:'2026-10-24T00:00:00Z'},{id:'keep-A',browserProfileId:'A',url:'https://keep.example/a',time:'2026-10-24T00:00:00Z'},{id:'keep-B',browserProfileId:'B',url:'https://remove.example/a',time:'2026-10-24T00:00:00Z'}],closedTabs:[{id:'remove-closed',browserProfileId:'A',url:'https://remove.example/a',history:['https://remove.example/a'],historyIndex:0},{id:'keep-closed',browserProfileId:'A',url:'https://keep.example/a',history:['https://remove.example/a','https://keep.example/a'],historyIndex:1}],tabs:[{id:'current',browserProfileId:'A',url:'https://remove.example/current',history:['https://remove.example/previous','https://keep.example/a','https://remove.example/current'],historyIndex:2}],bookmarkNodes:[{id:'bookmark',browserProfileId:'A',parentId:null,position:0,url:'https://remove.example/a'}],bookmarks:['https://remove.example/a'],downloads:[{id:'download',browserProfileId:'A',path:'retained-file'}]});
function fixture(){
 const {EventEmitter}=require('node:events'),root=path.resolve('.qa-profiles/services-unit');fs.mkdirSync(root,{recursive:true});const directory=fs.mkdtempSync(path.join(root,'exit-')),database=new BrowserDatabase(path.join(directory,'browser.sqlite')),profiles=state().browserProfiles,calls=[],handlers=new Set(),headerHandlers=new Set();let fail=false,live=false,worker=false,network=false,inventory={complete:true,origins:['chrome-extension://'+'a'.repeat(32)]};
 const cookies=Object.assign(new EventEmitter(),{get:async()=>[{domain:'remove.example',secure:true},{domain:'.keep.example',secure:true}]}),serviceWorkers=Object.assign(new EventEmitter(),{getAllRunning:()=>worker?{1:{scope:'https://remove.example/'}}:{}}),session={cookies,serviceWorkers,closeAllConnections:async()=>calls.push({connectionsClosed:true}),clearData:async options=>{calls.push(options);if(fail)throw new Error('native storage failure');}},pipeline={useBefore:handler=>{handlers.add(handler);return()=>handlers.delete(handler);},useHeaders:handler=>{headerHandlers.add(handler);return()=>headerHandlers.delete(handler);},hasActiveRequests:()=>network},service=createExitCleanup({database,getProfiles:()=>profiles,getSession:()=>session,getPipeline:()=>pipeline,hasLivePages:()=>live,cookieRestore:{flush:async()=>calls.push({preflight:true}),clear:(_session,scope)=>calls.push({revoke:scope||'all'}),completeClear:async()=>calls.push({complete:true})},permissions:{list:()=>[{requester:'https://keep.example',embedder:'https://keep.example',permission:'notifications'},{requester:'https://remove.example',embedder:'https://keep.example',permission:'notifications'}],reset:(...args)=>calls.push({reset:args})},commitRecords:()=>({counts:{history:1}}),dialog:{showMessageBox:async()=>{globalThis.__exitCleanupDialogs=(globalThis.__exitCleanupDialogs||0)+1;return {response:1};}},getWindow(){},getProtectedOrigins:()=>inventory});
 return {database,profiles,calls,session,service,handlers,headerHandlers,setFail:value=>fail=value,setLive:value=>live=value,setWorker:value=>worker=value,setNetwork:value=>network=value,setInventory:value=>inventory=value};
}
test('exit cleanup validates explicit choices/keep origins and retains current URLs while removing selected history/restoration only in one profile',()=>{
 assert.deepEqual(cleanupChoice({enabled:true,categories:['history','history'],keepOrigins:['https://keep.example/']}),{enabled:true,categories:['history'],keepOrigins:['https://keep.example']});for(const value of [{enabled:true,categories:[],keepOrigins:[]},{enabled:true,categories:['downloads'],keepOrigins:[]},{enabled:true,categories:['cookies'],keepOrigins:['https://keep.example/path']},{enabled:true,categories:['cookies'],keepOrigins:['https://user:password@keep.example/']}])assert.throws(()=>cleanupChoice(value));
 const original=state(),changed=clearExitRecords(original,'A',['https://keep.example']);assert.deepEqual(changed.snapshot.browsingHistory.map(row=>row.id),['keep-A','keep-B']);assert.deepEqual(changed.snapshot.closedTabs.map(row=>row.id),['keep-closed']);assert.deepEqual(changed.snapshot.tabs[0].history,['https://keep.example/a','https://remove.example/current']);assert.deepEqual(changed.snapshot.closedTabs[0].history,['https://keep.example/a']);assert.deepEqual(changed.snapshot.downloads,original.downloads);assert.deepEqual(changed.snapshot.bookmarkNodes,original.bookmarkNodes);assert.equal(original.browsingHistory.length,3);
});
test('native cleanup plan and preference are one durable transaction; journal write failure rolls the setting back',async()=>{
 const f=fixture();try{f.database.db.exec("CREATE TRIGGER fail_plan BEFORE INSERT ON metadata BEGIN SELECT RAISE(ABORT,'fixture journal failure'); END;");await assert.rejects(f.service.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]}),/fixture journal failure/);assert.equal(f.service.status('A').choice.enabled,false);assert.equal(f.service.status('A').pending,false);f.database.db.exec('DROP TRIGGER fail_plan');await f.service.set('A',{enabled:true,categories:['cookies'],keepOrigins:['https://keep.example']});assert.equal(f.service.status('A').pending,true);assert.equal(f.database.policy('B','*'),null);}finally{f.database.close();}
});
test('live pages block cleanup, partial native failures retain jobs and tombstones, retry respects keep domains and protected extensions',async()=>{
 const f=fixture();try{await f.service.set('A',{enabled:true,categories:['cookies','storage','permissions'],keepOrigins:['https://keep.example']});f.setLive(true);assert.equal((await f.service.runPending()).completed,false);assert.equal(f.calls.length,0);f.setLive(false);f.setFail(true);assert.equal((await f.service.runPending()).completed,false);assert.equal(f.service.status('A').pending,true);assert.equal(f.calls.some(call=>call.complete),false);f.setFail(false);const retried=await f.service.runPending();assert.equal(retried.completed,true);assert.equal(f.service.status('A').pending,false);assert.ok(f.calls.some(call=>call.revoke?.registrableDomain==='remove.example'));assert.equal(f.calls.some(call=>call.revoke?.registrableDomain==='keep.example'),false);assert.ok(f.calls.some(call=>call.excludeOrigins?.includes('chrome-extension://'+'a'.repeat(32))));assert.equal(f.calls.filter(call=>call.reset).length,2);assert.ok(f.calls.some(call=>call.complete));}finally{f.database.close();}
});
test('stored exit history cleanup reaches dormant windows and keeps bookmarks/download rows transactionally',()=>{
 const f=fixture();try{const original=state();f.database.saveWindow('one',original);f.database.saveWindow('dormant',original);clearStoredExitRecords(f.database,'A',['https://keep.example']);const restored=f.database.readWindow('dormant');assert.deepEqual(restored.browsingHistory.map(row=>row.id),['keep-A','keep-B']);assert.deepEqual(restored.tabs[0].history,['https://keep.example/a','https://remove.example/current']);assert.equal(f.database.db.prepare('SELECT count(*) AS count FROM bookmarks').get().count,1);assert.equal(f.database.db.prepare('SELECT count(*) AS count FROM downloads').get().count,1);}finally{f.database.close();}
});
test('exit barrier blocks background network before any deletion, refuses active workers, survives errors and releases only after successful startup recovery',async()=>{
 const f=fixture();try{
  await f.service.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]});f.setWorker(true);const active=await f.service.runPending({phase:'exit'});assert.equal(active.completed,false);assert.match(active.profiles[0].error,/workers are still active/);assert.equal(f.service.status('A').pending,true);assert.equal(f.service.status('A').networkBlocked,true);assert.deepEqual(f.calls,[{connectionsClosed:true}]);
  const fence=[...f.handlers][0];for(const url of ['http://late.example/','https://late.example/','ws://late.example/','wss://late.example/'])assert.deepEqual(fence({url,webContentsId:0}),{cancel:true});assert.deepEqual(fence({url:'chrome-extension://'+'a'.repeat(32)+'/page.html'}),{});assert.deepEqual(fence({url:'acira-browser-ui://ui/index.html'}),{});
  f.setWorker(false);for(const busy of [true,null]){f.setNetwork(busy);const draining=await f.service.runPending({phase:'startup'});assert.equal(draining.completed,false);assert.match(draining.profiles[0].error,/requests are still active or their lifetime is unknown/);assert.equal(f.calls.some(call=>call.preflight),false);}f.setNetwork(false);assert.deepEqual([...f.headerHandlers][0]({url:'https://late.example/'}),{cancel:true});f.setFail(true);assert.equal((await f.service.runPending({phase:'startup'})).completed,false);assert.equal(f.handlers.size,1);f.setFail(false);assert.equal((await f.service.runPending({phase:'exit'})).completed,true);assert.equal(f.service.status('A').pending,false);assert.equal(f.handlers.size,1);assert.ok(f.calls.findIndex(call=>call.connectionsClosed)<f.calls.findIndex(call=>call.preflight));
  f.session.cookies.emit('changed',{}, {domain:'remove.example',secure:true},'explicit',false);assert.equal(f.service.status('A').pending,true,'a native cookie written after completion re-arms the durable job');assert.equal((await f.service.runPending({phase:'startup'})).completed,true);assert.equal(f.service.status('A').networkBlocked,false);assert.equal(f.handlers.size,0);assert.equal(f.headerHandlers.size,0);assert.equal(f.session.cookies.listenerCount('changed'),0);assert.equal(f.session.serviceWorkers.listenerCount('running-status-changed'),0);await assert.rejects(f.service.runPending({phase:'other'}),/startup recovery/);
 }finally{f.database.close();}
});
test('new native worker activity after exit completion durably re-arms cleanup without unregistering or deleting unselected data',async()=>{
 const f=fixture();try{await f.service.set('A',{enabled:true,categories:['history'],keepOrigins:[]});assert.equal((await f.service.runPending()).completed,true);f.session.serviceWorkers.emit('running-status-changed',{versionId:1,runningStatus:'starting'});assert.equal(f.service.status('A').pending,true);assert.equal(f.calls.some(call=>Array.isArray(call.dataTypes)),false);assert.equal((await f.service.runPending({phase:'startup'})).completed,true);assert.equal(f.service.status('A').networkBlocked,false);}finally{f.database.close();}
});
test('a durable re-arm failure keeps the barrier and reports recovery failure, and held shutdown state rejects new preferences',async()=>{
 const f=fixture();try{await f.service.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]});assert.equal((await f.service.runPending()).completed,true);await assert.rejects(f.service.set('A',{enabled:false,categories:[],keepOrigins:[]}),/startup cleanup recovery/);assert.throws(()=>f.service.armAll(),/startup cleanup recovery/);f.database.db.exec("CREATE TRIGGER fail_rearm BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT,'fixture re-arm write failure'); END;");f.session.cookies.emit('changed',{}, {domain:'remove.example',secure:true},'explicit',false);assert.match(f.service.status('A').recoveryError,/fixture re-arm write failure/);assert.equal((await f.service.runPending({phase:'startup'})).completed,false);assert.equal(f.service.status('A').networkBlocked,true);}finally{f.database.close();}
});
test('unknown or wrong-profile installation inventory preserves all data and pending recovery behind the barrier',async()=>{
 const f=fixture();try{await f.service.set('A',{enabled:true,categories:['storage'],keepOrigins:[]});for(const inventory of [[],{complete:false,origins:[]},{complete:true,profileId:'B',origins:[]}]){f.setInventory(inventory);const result=await f.service.runPending({phase:'startup'});assert.equal(result.completed,false);assert.match(result.profiles[0].error,/installed-origin inventory is unknown/);assert.equal(f.calls.some(call=>call.dataTypes),false);assert.equal(f.service.status('A').networkBlocked,true);assert.equal(f.service.status('A').pending,true);}f.setInventory({complete:true,profileId:'A',origins:['chrome-extension://'+'b'.repeat(32)]});assert.equal((await f.service.runPending({phase:'startup'})).completed,true);assert.ok(f.calls.some(call=>call.excludeOrigins?.includes('chrome-extension://'+'b'.repeat(32))));assert.ok(f.calls.some(call=>call.excludeOrigins?.includes('acira-browser-ui://ui')));}finally{f.database.close();}
});
test('exit cleanup waits for delayed native terminal events after deletion before committing its journal',async()=>{
 const f=fixture();try{
  const clear=f.session.clearData;f.session.clearData=async options=>{await clear(options);f.setNetwork(true);setImmediate(()=>f.setNetwork(false));};
  await f.service.set('A',{enabled:true,categories:['storage'],keepOrigins:['https://keep.example']});
  assert.equal((await f.service.runPending()).completed,true);assert.equal(f.service.status('A').pending,false);
  assert.equal(f.service.status('A').networkBlocked,true,'the exit barrier remains until startup recovery');
 }finally{f.database.close();}
});

test('exit cleanup waits for native request cancellation between cookies and storage',async()=>{
 const f=fixture();try{
  const clear=f.session.clearData;
  f.session.clearData=async options=>{
   await clear(options);
   if(options.dataTypes.includes('cookies')){
    f.setNetwork(true);
    setTimeout(()=>f.setNetwork(false),30);
   }
  };
  await f.service.set('A',{enabled:true,categories:['cookies','storage'],keepOrigins:[]});
  const result=await f.service.runPending();
  assert.equal(result.completed,true);
  assert.deepEqual(result.profiles[0].results.map(row=>row.status),['cleared','cleared']);
  assert.ok(f.calls.some(call=>call.complete),'cookie recovery was resumed');
  assert.equal(f.service.status('A').pending,false);
 }finally{f.database.close();}
});

for(const activity of [true,null])test(`exit cleanup retains its journal when post-deletion network activity stays ${activity===true?'active':'unknown'}`,async()=>{
 const f=fixture();try{
  const clear=f.session.clearData;f.session.clearData=async options=>{await clear(options);f.setNetwork(activity);};
  await f.service.set('A',{enabled:true,categories:['storage'],keepOrigins:[]});
  const result=await f.service.runPending();assert.equal(result.completed,false);assert.match(result.profiles[0].error,/requests are still active or their lifetime is unknown/);
  assert.equal(f.service.status('A').pending,true);assert.equal(f.service.status('A').networkBlocked,true);
 }finally{f.database.close();}
});

test('Settings applies its own switch without the native review; every other caller is still asked',async()=>{
 const f=fixture();try{globalThis.__exitCleanupDialogs=0;
  const asked=await f.service.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]});assert.equal(globalThis.__exitCleanupDialogs,1);assert.equal(asked.choice.enabled,true);
  const instant=await f.service.set('A',{enabled:true,categories:['cookies','history'],keepOrigins:['https://keep.example']},{review:false});assert.equal(globalThis.__exitCleanupDialogs,1,'no dialog for an instant change');assert.deepEqual(instant.choice.categories,['cookies','history']);assert.deepEqual(instant.choice.keepOrigins,['https://keep.example']);
  await assert.rejects(f.service.set('A',{enabled:true,categories:[],keepOrigins:[]},{review:false}),/at least one|categor/i,'an invalid choice is still refused');assert.deepEqual(f.service.status('A').choice.categories,['cookies','history']);
 }finally{f.close?.();}
});
