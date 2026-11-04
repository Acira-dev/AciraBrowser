'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{createForgetSite,forgetOriginRecords}=require('../desktop/browser-services/forget-site.cjs');
for(const privacy of ['private','tor'])test(`Forget site stores only public split state while retaining live ${privacy} tabs`,()=>{
 const {DatabaseSync}=require('node:sqlite'),runtime=require('../desktop/runtime.cjs'),{commitForgetRecords,forgetStoredOrigin}=require('../desktop/browser-services/forget-site.cjs');
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE windows(id TEXT PRIMARY KEY,payload TEXT,updated_at INTEGER);CREATE TABLE history(id TEXT PRIMARY KEY,profile_id TEXT,visited_at TEXT,payload TEXT);CREATE TABLE policies(profile_id TEXT NOT NULL,site TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(profile_id,site))');
 const database={db:sql,transaction:fn=>{sql.exec('BEGIN');try{const result=fn();sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 try{
  let s=runtime.createInitialState();const profile=s.activeBrowserProfileId,first=s.activeTabId;
  s=runtime.reduceBrowser(s,{type:'tab.new',url:'https://public.example/'});const second=s.activeTabId;
  s=runtime.reduceBrowser(s,{type:'split.open',tabIds:[first,second]});const publicGroup=s.windowUi.split.groupId;
  s=runtime.reduceBrowser(s,{type:'tab.new',url:'https://public-three.example/'});const third=s.activeTabId;
  s=runtime.reduceBrowser(s,{type:'tab.new',privacy,url:`https://${privacy}-secret.invalid/`});const secret=s.activeTabId;
  s=runtime.reduceBrowser(s,{type:'split.open',tabIds:[third,secret]});const secretGroup=s.windowUi.split.groupId;
  s.windowUi.zoomTargetTabId=secret;s.browsingHistory.push({id:'remove',browserProfileId:profile,url:'https://erase.example/a',time:'2026-10-26'});
  const result=commitForgetRecords(database,[{id:'main',snapshot:s}],profile,'https://erase.example');
  assert(result.windows[0].snapshot.tabs.some(tab=>tab.id===secret));assert.equal(result.windows[0].snapshot.windowUi.split.groupId,secretGroup);
  const verify=()=>{const raw=sql.prepare('SELECT payload FROM windows WHERE id=?').get('main').payload,stored=JSON.parse(raw);for(const value of [secret,secretGroup,`${privacy}-secret.invalid`])assert(!raw.includes(value),`SQL leaked ${value}`);assert(stored.windowUi.splitGroups.some(group=>group.id===publicGroup));};verify();
  // A legacy stored row can also be rewritten by the stored-only cleanup entry point.
  sql.prepare('UPDATE windows SET payload=? WHERE id=?').run(JSON.stringify(s),'main');forgetStoredOrigin(database,profile,'https://erase.example');verify();
 }finally{sql.close();}
});
function snapshot(){return {revision:1,browserProfiles:[{id:'A'},{id:'B'}],browsingHistory:[{id:'a',browserProfileId:'A',url:'https://one.example.org/a'},{id:'sibling',browserProfileId:'A',url:'https://two.example.org/a'},{id:'b',browserProfileId:'B',url:'https://one.example.org/a'}],closedTabs:[{id:'closed-a',browserProfileId:'A',url:'https://one.example.org/a',history:['https://one.example.org/a'],historyIndex:0},{id:'mixed',browserProfileId:'A',url:'https://other.example.net/',history:['https://one.example.org/a','https://other.example.net/'],historyIndex:1},{id:'closed-b',browserProfileId:'B',url:'https://one.example.org/a'}],tabs:[{id:'open-a',browserProfileId:'A',url:'https://one.example.org/a',history:['https://one.example.org/a']}],bookmarkNodes:[{id:'kept',browserProfileId:'A',url:'https://one.example.org/a'}],downloads:[{browserProfileId:'A',url:'https://one.example.org/file',path:'kept-file'}]};}
test('forget records removes exact-origin/profile history and closed restoration while preserving bookmarks, files, other origins/profiles and live tabs',()=>{
 const source=snapshot(),result=forgetOriginRecords(source,'A','https://one.example.org');assert.deepEqual(result.counts,{history:1,closedTabs:1,closedHistoryEntries:1});assert.deepEqual(result.snapshot.browsingHistory.map(row=>row.id),['sibling','b']);assert.deepEqual(result.snapshot.closedTabs.map(row=>row.id),['mixed','closed-b']);assert.deepEqual(result.snapshot.closedTabs[0].history,['https://other.example.net/']);assert.equal(result.snapshot.closedTabs[0].historyIndex,0);assert.equal(result.snapshot.closedTabs[0].canGoBack,false);for(const key of ['tabs','bookmarkNodes','downloads'])assert.deepEqual(result.snapshot[key],source[key]);assert.equal(source.browsingHistory.length,3);assert.equal(result.filesDeleted,false);assert.throws(()=>forgetOriginRecords(source,'X','https://one.example.org'));assert.throws(()=>forgetOriginRecords(source,'A','https://one.example.org/path'));
});
function fixture(){const wc=Object.assign(new EventEmitter(),{session:{},isDestroyed:()=>false,getURL:()=>'https://one.example.org/a'}),owner={profileId:'A',tabId:'a'},calls=[];let state=snapshot(),response=1;const service=createForgetSite({getContext:()=>owner,previewRecords:scope=>forgetOriginRecords(state,scope.profileId,scope.origin).counts,siteData:{status:async()=>({cookieCount:4,permissions:[{}]}),clear:async(_wc,options)=>{calls.push(['engine',options]);return {results:[{category:'cookies',status:'cleared'}],recoveryPaused:false};}},dialog:{showMessageBox:async()=>({response})},getWindow(){},commitRecords:scope=>{calls.push(['records',scope]);const result=forgetOriginRecords(state,scope.profileId,scope.origin);state=result.snapshot;return result;}});return {wc,owner,calls,service,state:()=>state,setState:value=>state=value,setResponse:value=>response=value};}
test('forget cancellation and same-URL reload/profile changes during native review clear nothing',async()=>{
 const f=fixture();f.setResponse(0);assert.deepEqual(await f.service.forget(f.wc),{cancelled:true});assert.equal(f.calls.length,0);
 for(const mode of ['same-url-reload','profile-change']){const g=fixture(); // Deferred chooser covers the asynchronous review gap.
  let release;const selected=new Promise(resolve=>release=resolve);const service=createForgetSite({getContext:()=>g.owner,previewRecords:scope=>forgetOriginRecords(g.state(),scope.profileId,scope.origin).counts,siteData:{status:async()=>({cookieCount:0,permissions:[]}),clear:async()=>g.calls.push('unexpected')},dialog:{showMessageBox:()=>selected},getWindow(){},commitRecords:()=>g.calls.push('unexpected')});
  const pending=service.forget(g.wc);await new Promise(resolve=>setImmediate(resolve));await assert.rejects(service.forget(g.wc),/already open/);if(mode==='same-url-reload')g.wc.emit('did-start-navigation',{},g.wc.getURL(),false,true);else g.owner.profileId='B';release({response:1});await assert.rejects(pending,/changed during review/);assert.equal(g.calls.length,0);
 }
});
test('forget stored records clears dormant-window restoration and history transactionally; a failed update rolls deletion back',()=>{
 const fs=require('node:fs'),path=require('node:path'),{BrowserDatabase}=require('../desktop/database.cjs'),{forgetStoredOrigin}=require('../desktop/browser-services/forget-site.cjs');const root=path.resolve('.qa-profiles/services-unit');fs.mkdirSync(root,{recursive:true});const directory=fs.mkdtempSync(path.join(root,'forget-')),db=new BrowserDatabase(path.join(directory,'browser.sqlite'));
 try{
  const state=snapshot();state.bookmarks=[];for(const row of state.browsingHistory)row.time='2026-10-24T00:00:00Z';for(const row of state.bookmarkNodes){row.parentId=null;row.position=0;}state.downloads[0].id='download-kept';db.saveWindow('one',state);db.saveWindow('two',state);
  db.db.exec("CREATE TRIGGER fail_forget BEFORE UPDATE ON windows BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;");assert.throws(()=>forgetStoredOrigin(db,'A','https://one.example.org'),/fixture write failure/);assert.equal(db.db.prepare('SELECT count(*) AS count FROM history WHERE profile_id=?').get('A').count,2);assert.equal(db.readWindow('two').closedTabs.length,3);
  db.db.exec('DROP TRIGGER fail_forget');const result=forgetStoredOrigin(db,'A','https://one.example.org');assert.equal(result.history,1);assert.deepEqual(result.windowIds,['one','two']);assert.equal(db.readWindow('two').browsingHistory.some(row=>row.id==='a'),false);assert.equal(db.readWindow('two').closedTabs.some(row=>row.id==='closed-a'),false);assert.equal(db.db.prepare('SELECT count(*) AS count FROM bookmarks').get().count,1);assert.equal(db.db.prepare('SELECT count(*) AS count FROM downloads').get().count,1);
 }finally{db.close();}
});
test('forget commits a fresh canonical state and returns partial failures without claiming success',async()=>{
 const f=fixture();await f.service.preview(f.wc);const now=f.state();now.browsingHistory.push({id:'new-b',browserProfileId:'B',url:'https://one.example.org/new'});f.setState(now);const result=await f.service.forget(f.wc);assert.equal(result.cleared,true);assert.ok(f.state().browsingHistory.some(row=>row.id==='new-b'));assert.deepEqual(f.calls[0][1],{categories:['cookies','storage','cache','permissions'],confirmed:true});
 const g=fixture(),service=createForgetSite({getContext:()=>g.owner,previewRecords:scope=>forgetOriginRecords(g.state(),scope.profileId,scope.origin).counts,siteData:{status:async()=>({cookieCount:0,permissions:[]}),clear:async()=>({results:[{category:'cookies',status:'failed',recoveryPaused:true}],recoveryPaused:true})},dialog:{showMessageBox:async()=>({response:1})},getWindow(){},commitRecords:()=>{throw new Error('durable commit failed');}});const partial=await service.forget(g.wc);assert.equal(partial.cleared,false);assert.equal(partial.recoveryPaused,true);assert.deepEqual(partial.results.map(row=>row.status),['failed','failed']);
});
test('profile-wide preview counts distinct live/dormant records once and commits the same plan without losing unrelated dormant history',()=>{
 const fs=require('node:fs'),path=require('node:path'),{BrowserDatabase}=require('../desktop/database.cjs'),{prepareForgetRecords,commitForgetRecords}=require('../desktop/browser-services/forget-site.cjs'),root=path.resolve('.qa-profiles/services-unit');fs.mkdirSync(root,{recursive:true});const directory=fs.mkdtempSync(path.join(root,'forget-preview-')),db=new BrowserDatabase(path.join(directory,'browser.sqlite'));
 try{
  const current=snapshot();current.bookmarks=[];for(const row of current.browsingHistory)row.time='2026-10-24T00:00:00Z';Object.assign(current.bookmarkNodes[0],{parentId:null,position:0});current.downloads[0].id='download';db.saveWindow('current',current);const dormant=structuredClone(current);dormant.browsingHistory.push({id:'dormant-target',browserProfileId:'A',url:'https://one.example.org/dormant',time:'2026-10-24T00:00:00Z'},{id:'dormant-kept',browserProfileId:'A',url:'https://retained.example/',time:'2026-10-24T00:00:00Z'});dormant.closedTabs.push({id:'dormant-closed',browserProfileId:'A',url:'https://one.example.org/dormant',history:['https://one.example.org/dormant'],historyIndex:0});db.saveWindow('dormant',dormant);
  const live=structuredClone(current);live.browsingHistory.find(row=>row.id==='a').url='https://retained.example/live';live.closedTabs.find(tab=>tab.id==='closed-a').url='https://retained.example/live';live.closedTabs.find(tab=>tab.id==='closed-a').history=['https://retained.example/live'];const liveWindows=[{id:'current',snapshot:live}],before=db.readWindow('dormant'),preview=prepareForgetRecords(db,liveWindows,'A','https://one.example.org');assert.deepEqual(preview.counts,{history:1,closedTabs:1,closedHistoryEntries:1});assert.deepEqual(db.readWindow('dormant'),before);
  const committed=commitForgetRecords(db,liveWindows,'A','https://one.example.org');assert.deepEqual(committed.counts,preview.counts);const result=committed.windows.find(window=>window.id==='current').snapshot;assert.ok(result.browsingHistory.some(row=>row.id==='dormant-kept'));assert.ok(result.browsingHistory.some(row=>row.id==='a'&&row.url==='https://retained.example/live'));assert.ok(result.browsingHistory.some(row=>row.id==='b'));assert.equal(db.readWindow('dormant').closedTabs.some(tab=>tab.id==='dormant-closed'),false);assert.equal(db.db.prepare('SELECT count(*) AS count FROM bookmarks').get().count,1);assert.equal(db.db.prepare('SELECT count(*) AS count FROM downloads').get().count,1);
 }finally{db.close();}
});
test('Forget site forgets the site\'s remembered http choice and keeps its filtering choices, as its dialog says',()=>{
 // The "Continue over http" choice (https-first.cjs) is kept in the site's policies row next to its filtering choices (protection, AI-free mode,
 // cookie banners). Forget site used to leave it, so a forgotten site still opened over http by itself. It is kept under the host that was typed, so
 // Forget site drops every such choice on the registrable domain (as it does cookies): example.com typed, then sent on to www.example.com.
 const fs=require('node:fs'),path=require('node:path'),{BrowserDatabase}=require('../desktop/database.cjs'),{commitForgetRecords}=require('../desktop/browser-services/forget-site.cjs'),httpsFirst=require('../desktop/browser-services/https-first.cjs'),root=path.resolve('.qa-profiles/services-unit');fs.mkdirSync(root,{recursive:true});const directory=fs.mkdtempSync(path.join(root,'forget-http-')),db=new BrowserDatabase(path.join(directory,'browser.sqlite'));
 try{
  const live=[{id:'live',snapshot:{revision:1,browserProfiles:[{id:'A'},{id:'B'}],browsingHistory:[],closedTabs:[]}}];
  db.setPolicy('A','http://example.com',{httpFallback:true,aiContent:true,blocking:false});db.setPolicy('A','https://www.example.com',{aiContent:true,annoyances:true});
  db.setPolicy('A','http://shop.example.com:8080',{httpFallback:true});db.setPolicy('A','http://example.org',{httpFallback:true});db.setPolicy('A','http://example.com.evil.test',{httpFallback:true});
  db.setPolicy('B','http://example.com',{httpFallback:true});db.setPolicy('A','*',{httpsOnly:true,aiContent:true});
  assert.equal(httpsFirst.allowed(db,'A','example.com'),true);
  commitForgetRecords(db,live,'A','http://www.example.com');
  assert.equal(httpsFirst.allowed(db,'A','example.com'),false,'the typed address asks again, though the page forgotten was www');
  assert.deepEqual(db.policy('A','http://example.com'),{aiContent:true,blocking:false},'its filtering choices stay');
  assert.deepEqual(db.policy('A','https://www.example.com'),{aiContent:true,annoyances:true});
  assert.equal(db.policy('A','http://shop.example.com:8080'),null,'a row that held only the http choice is gone, on any host and port of the site');
  assert.equal(httpsFirst.allowed(db,'A','example.org'),true,'another registrable domain keeps its choice');
  assert.equal(httpsFirst.allowed(db,'A','example.com.evil.test'),true,'a name that only starts the same is another site');
  assert.equal(httpsFirst.allowed(db,'B','example.com'),true,'other profiles keep their choice');
  assert.deepEqual(db.policy('A','*'),{httpsOnly:true,aiContent:true},'profile-wide choices stay');
  const before=db.policies('A').length;commitForgetRecords(db,live,'A','https://three.example.net');assert.equal(db.policies('A').length,before,'a site with no choices changes nothing');
 }finally{db.close();}
});
