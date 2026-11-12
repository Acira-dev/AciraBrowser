'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createProfileCleanup}=require('../desktop/profile-cleanup.cjs');
function fixture({attach=async()=>({supported:true}),arm=()=>{},run,review}={}){
 const events=[],sessions=new Map(),controllers=[],contents=[],policies=new Map();let serviceOptions;
 const profile=id=>({id,name:id,partition:'persist:'+id}),choice=id=>policies.get(id)||{enabled:false,categories:[],keepOrigins:[]};
 const binding=createProfileCleanup({database:{},cookieRestore:{async attach(context){events.push('attach:'+context.profileId);return attach(context);}},permissions:{},getSession:partition=>{if(!sessions.has(partition))sessions.set(partition,{partition,blocked:false});return sessions.get(partition);},getPipeline:session=>({holdNetwork(){session.blocked=true;events.push('hold:'+session.partition);return()=>{session.blocked=false;events.push('release:'+session.partition);};}}),getControllers:()=>controllers,getAllContents:()=>contents,dialog:{showMessageBox:async(window,options)=>review?review(window,options):{response:1}},getWindow:()=>null,registryPath:'test-only',createInventory:()=>({storageOrigins:id=>({complete:true,profileId:id,origins:['chrome-extension://'+'a'.repeat(32)]})}),createService:options=>{serviceOptions=options;return {status:id=>({profileId:id,choice:choice(id),pending:false,running:false,networkBlocked:false,recoveryError:null}),set:async(id,value)=>{if(review){const answer=await options.dialog.showMessageBox(options.getWindow(id),{});if(answer.response!==1)return {cancelled:true};}policies.set(id,value);return {profileId:id,choice:value};},runPending:async options=>{events.push('run:'+options.phase);return run?run(options,serviceOptions):{completed:true,profiles:[]};},armAll(){events.push('arm');arm();}};}});
 return {binding,events,sessions,controllers,contents,policies,profile,options:()=>serviceOptions};
}
test('actual native network hold precedes async cookie recovery and releases only after durable arm',async()=>{
 let release;const f=fixture({attach:()=>new Promise(resolve=>release=()=>resolve({supported:true}))});const prepared=f.binding.prepare([f.profile('A')]);assert.equal(f.sessions.get('persist:A').blocked,true);assert.equal(f.binding.mayBrowse('A'),false);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,['hold:persist:A','attach:A']);release();await prepared;assert.equal(f.binding.mayBrowse('A'),true);assert.equal(f.sessions.get('persist:A').blocked,false);assert.ok(f.events.indexOf('arm')<f.events.indexOf('release:persist:A'));
});
test('failed durable arm leaves native network held and trusted recovery status honest',async()=>{
 const f=fixture({arm(){throw Error('journal capacity');}});await f.binding.prepare([f.profile('A')]);assert.equal(f.binding.mayBrowse('A'),false);assert.equal(f.sessions.get('persist:A').blocked,true);assert.match(f.binding.gate('A').error,/journal capacity/);assert.equal(f.binding.status('A').networkBlocked,true);await assert.rejects(f.binding.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]}),/journal capacity/);
});
test('native installation inventory and untracked extension/background documents participate in the barrier',async()=>{
 const f=fixture();await f.binding.prepare([f.profile('A')]);const options=f.options(),session=f.sessions.get('persist:A');assert.equal(options.hasLivePages('A'),false);f.contents.push({session,isDestroyed:()=>false,getURL:()=> 'chrome-extension://'+'a'.repeat(32)+'/background.html',getType:()=> 'backgroundPage'});assert.equal(options.hasLivePages('A'),true);assert.deepEqual(options.getProtectedOrigins(session,f.profile('A')),{complete:true,profileId:'A',origins:['chrome-extension://'+'a'.repeat(32)]});assert.throws(()=>f.binding.retry('A'),/Close website tabs/);
});
test('adding another native profile preserves an already browsing profile and its armed job',async()=>{
 let runs=0;const f=fixture({run:async()=>++runs===1?{completed:true,profiles:[]}:{completed:false,profiles:[{profileId:'A',completed:false,error:'live owner'},{profileId:'B',completed:true}]}});await f.binding.prepare([f.profile('A')]);f.policies.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]});await f.binding.prepare([f.profile('A'),f.profile('B')]);assert.equal(f.binding.mayBrowse('A'),true);assert.equal(f.binding.mayBrowse('B'),true);assert.equal(f.sessions.get('persist:A').blocked,false);assert.equal(f.binding.gate('A').error,null);
});

test('native cleanup review belongs to its actual requesting window and closed owners cannot commit',async()=>{
 let finish,reviewed;const f=fixture({review:window=>{reviewed=window;return new Promise(resolve=>finish=resolve);}});await f.binding.prepare([f.profile('A')]);let destroyed=false;const window={isDestroyed:()=>destroyed};const saving=f.binding.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]},window);assert.equal(reviewed,window);await assert.rejects(f.binding.set('A',{enabled:true,categories:['history'],keepOrigins:[]},{isDestroyed:()=>false}),/Another cleanup choice/);destroyed=true;finish({response:1});assert.deepEqual(await saving,{cancelled:true});assert.equal(f.policies.has('A'),false);
});

// Restored windows now call prepare concurrently while services become ready.
test('concurrent restored owners do not recover an already armed browsing profile again',async()=>{
 let unblock;const barrier=new Promise(resolve=>unblock=resolve);let runs=0;
 const f=fixture({run:async()=>{runs++;await barrier;return {completed:true,profiles:[]};}});
 const profiles=[f.profile('A'),f.profile('B')];
 const first=f.binding.prepare(profiles),second=f.binding.prepare(profiles);
 await new Promise(resolve=>setImmediate(resolve));unblock();await Promise.all([first,second]);
 assert.equal(runs,1,'One shared startup recovery, before either owner may browse');
 assert.equal(f.events.filter(e=>e==='arm').length,1);
 assert.equal(f.binding.mayBrowse('A'),true);assert.equal(f.binding.mayBrowse('B'),true);
 assert.equal(f.sessions.get('persist:A').blocked,false);assert.equal(f.sessions.get('persist:B').blocked,false);
});

// Linux without a keyring (Secret Service): Chromium's password store falls back to basic_text, so website-session
// restore is off for the whole run (session-cookie-restore.cjs returns {supported:false}). Acira keeps no saved
// session-cookie copy then, so nothing cleared can come back; the profile must still arm its journal and browse.
test('unsupported website-session restore (Linux with no keyring) still arms the journal, releases the hold and browses',async()=>{
 const f=fixture({attach:async()=>({supported:false})});await f.binding.prepare([f.profile('A')]);
 assert.equal(f.binding.mayBrowse('A'),true);assert.equal(f.sessions.get('persist:A').blocked,false);assert.equal(f.binding.gate('A').error,null);
 assert.deepEqual(f.events,['hold:persist:A','attach:A','run:startup','arm','release:persist:A']);
 assert.equal(f.binding.status('A').networkBlocked,false);
});
test('a website-session attach that fails keeps the profile held with its reason readable, and never arms',async()=>{
 const f=fixture({attach:async()=>{throw Error('Session restore profile assignment changed');}});await f.binding.prepare([f.profile('A')]);
 assert.equal(f.binding.mayBrowse('A'),false);assert.equal(f.sessions.get('persist:A').blocked,true);assert.match(f.binding.gate('A').error,/profile assignment changed/);assert.equal(f.events.includes('arm'),false);assert.equal(f.events.includes('run:startup'),false);
});

// The same no-keyring profile across real restarts, with the real exit-cleanup service and the real website-session
// restore: a cookie cleanup job runs (at exit, or at the next start after a crash) and the cleared cookies stay cleared.
// A keyring that comes back later must not bring back a session cookie saved before it went away.
const noKeyring=(()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
 const {BrowserDatabase}=require('../desktop/database.cjs'),{createSessionCookieRestore}=require('../desktop/browser-services/session-cookie-restore.cjs');
 const key=crypto.randomBytes(32);
 const storage=backend=>({isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>backend,encryptString(text){const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),data]);},decryptString(bytes){const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}});
 const cookie=(name,extra={})=>({name,value:name+'-value',domain:'site.test',path:'/',secure:true,httpOnly:true,sameSite:'Lax',priority:'Medium',session:true,sourceScheme:'Secure',sourcePort:443,...extra});
 const keyOf=c=>JSON.stringify([c.domain,c.path,c.name]);
 /** One profile folder: its database, its session-cookie folder and Chromium's cookie file (only persistent cookies outlive a launch, crash or not). */
 function profileFolder(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'acira-no-keyring-')),disk=new Map();let open=null;
  function launch(backend){
   const database=open=new BrowserDatabase(path.join(directory,'browser.sqlite')),live=new Map(disk),events=[];
   const cookies=Object.assign(new EventEmitter(),{get:async()=>[...live.values()].map(c=>({...c})),flushStore:async()=>{}});
   const session={cookies,serviceWorkers:Object.assign(new EventEmitter(),{getAllRunning:()=>({})}),closeAllConnections:async()=>{},
    clearData:async options=>{if(!options.dataTypes.includes('cookies'))return;events.push('cleared');for(const [k,c]of [...live]){live.delete(k);disk.delete(k);cookies.emit('changed',{},c,'explicit',true);}}};
   let blocked=false;const pipeline={holdNetwork(){blocked=true;events.push('hold');return()=>{blocked=false;events.push('release');};},useBefore:()=>()=>{},useHeaders:()=>()=>{},hasActiveRequests:()=>false};
   const access=()=>({async read(){return [...live.values()].map(c=>({...c}));},async restore(params){for(const p of params){const c=cookie(p.name,{value:p.value});live.set(keyOf(c),c);events.push('restored:'+p.name);}},close(){}});
   const cookieRestore=createSessionCookieRestore({directory:path.join(directory,'session-cookies'),safeStorage:storage(backend),platform:'linux',makeAccess:access,captureDelay:0});
   const cleanup=createProfileCleanup({database,cookieRestore,permissions:{list:()=>[],reset(){}},getSession:()=>session,getPipeline:()=>pipeline,getControllers:()=>[],getAllContents:()=>[],dialog:{showMessageBox:async()=>({response:1})},getWindow:()=>null,registryPath:'test-only',createInventory:()=>({storageOrigins:()=>({complete:true,origins:[]})})});
   const close=()=>{cookieRestore.dispose();database.close();open=null;};
   return {cleanup,cookieRestore,events,session,blocked:()=>blocked,
    setCookie(c){live.set(keyOf(c),c);if(!c.session)disk.set(keyOf(c),c);cookies.emit('changed',{},c,'explicit',false);},
    names:()=>[...live.values()].map(c=>c.name).sort(),
    journal:()=>database.db.prepare('SELECT value FROM metadata WHERE key=?').get('exit-cleanup-plan-v1')?.value??null,
    /* will-quit order in main.cjs: profile cleanup first, then the website-session flush */
    quit:async()=>{const result=await cleanup.finish();await cookieRestore.flush();close();return result;},
    crash:close};
  }
  return {launch,remove:()=>{try{open?.close();}catch{}fs.rmSync(directory,{recursive:true,force:true});}};
 }
 return {profileFolder,cookie};
})();
const profileA={id:'A',name:'A',partition:'persist:A'},cookiesOnly={enabled:true,categories:['cookies'],keepOrigins:[]},reviewWindow={isDestroyed:()=>false};
test('no keyring: websites open, and a cookie cleanup at exit stays cleared after a restart',async()=>{
 const folder=noKeyring.profileFolder();
 try{
  const first=folder.launch('basic_text');assert.equal((await first.cookieRestore.attach({session:first.session,profileId:'A',partition:'persist:A'})).supported,false,'restore is really off');
  await first.cleanup.prepare([profileA]);
  assert.equal(first.cleanup.mayBrowse('A'),true,'websites open');assert.equal(first.blocked(),false);assert.equal(first.cleanup.gate('A').error,null);
  assert.equal(first.journal(),'{"version":1,"jobs":[]}','the journal row is written before the hold lets go');
  first.setCookie(noKeyring.cookie('sid'));first.setCookie(noKeyring.cookie('remember',{session:false,expires:1990000000}));assert.deepEqual(first.names(),['remember','sid']);
  await first.cleanup.set('A',cookiesOnly,reviewWindow,{review:false});assert.match(first.journal(),/"profileId":"A"/);
  const exit=await first.quit();assert.equal(exit.completed,true,JSON.stringify(exit));
  const second=folder.launch('basic_text');await second.cleanup.prepare([profileA]);
  assert.equal(second.cleanup.mayBrowse('A'),true);assert.equal(second.blocked(),false);assert.deepEqual(second.names(),[],'cleared cookies stay cleared');assert.equal(second.events.some(e=>e.startsWith('restored:')),false);
  assert.match(second.journal(),/"profileId":"A"/,'the next exit or crash is still covered');second.crash();
 }finally{folder.remove();}
});
test('no keyring: after a crash the pending cookie cleanup runs before websites open, then the profile browses',async()=>{
 const folder=noKeyring.profileFolder();
 try{
  const first=folder.launch('basic_text');await first.cleanup.prepare([profileA]);assert.equal(first.cleanup.mayBrowse('A'),true);
  await first.cleanup.set('A',cookiesOnly,reviewWindow,{review:false});first.setCookie(noKeyring.cookie('sid'));first.setCookie(noKeyring.cookie('remember',{session:false,expires:1990000000}));first.crash();
  const second=folder.launch('basic_text');assert.deepEqual(second.names(),['remember'],'the persistent cookie outlived the crash');
  const recovered=await second.cleanup.prepare([profileA]);assert.equal(recovered.completed,true,JSON.stringify(recovered));
  assert.deepEqual(second.names(),[]);assert.equal(second.cleanup.mayBrowse('A'),true);assert.equal(second.blocked(),false);
  assert.ok(second.events.indexOf('cleared')>second.events.indexOf('hold')&&second.events.indexOf('cleared')<second.events.lastIndexOf('release'),second.events.join());
  assert.match(second.journal(),/"profileId":"A"/);second.crash();
 }finally{folder.remove();}
});
test('a session cookie saved while a keyring worked does not come back after a no-keyring run cleared cookies',async()=>{
 const folder=noKeyring.profileFolder();
 try{
  const saved=folder.launch('gnome_libsecret');await saved.cleanup.prepare([profileA]);saved.setCookie(noKeyring.cookie('sid'));await saved.quit();
  const control=folder.launch('gnome_libsecret');await control.cleanup.prepare([profileA]);assert.deepEqual(control.names(),['sid'],'control: with the keyring, the session cookie is restored');await control.quit();
  const bare=folder.launch('basic_text');await bare.cleanup.prepare([profileA]);assert.equal(bare.cleanup.mayBrowse('A'),true);assert.deepEqual(bare.names(),[]);
  await bare.cleanup.set('A',cookiesOnly,reviewWindow,{review:false});bare.setCookie(noKeyring.cookie('other'));assert.equal((await bare.quit()).completed,true);
  const back=folder.launch('gnome_libsecret');await back.cleanup.prepare([profileA]);assert.equal(back.cleanup.mayBrowse('A'),true);
  assert.deepEqual(back.names(),[],'nothing cleared comes back');assert.equal(back.events.some(e=>e.startsWith('restored:')),false);back.crash();
 }finally{folder.remove();}
});

test('the no-keyring test switch is honoured only on a throwaway profile, and main passes its safe storage through it',async()=>{
 const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events'),{storageForRun,createSessionCookieRestore}=require('../desktop/browser-services/session-cookie-restore.cjs');
 const real={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from('enc:'+text),decryptString:bytes=>String(bytes).slice(4)};
 for(const env of [{ACIRA_TEST_PASSWORD_STORE:'basic_text'},{ACIRA_BROWSER_TEST_DATA:'/tmp/acira-agents/x',ACIRA_TEST_PASSWORD_STORE:'gnome_libsecret'},{ACIRA_BROWSER_TEST_DATA:'/tmp/acira-agents/x'}])assert.deepEqual(storageForRun({safeStorage:real,platform:'darwin',env}),{safeStorage:real,platform:'darwin'},JSON.stringify(env));
 for(const backend of ['basic_text','unknown']){
  const forced=storageForRun({safeStorage:real,platform:'darwin',env:{ACIRA_BROWSER_TEST_DATA:'/tmp/acira-agents/x',ACIRA_TEST_PASSWORD_STORE:backend}});
  assert.equal(forced.platform,'linux');assert.equal(forced.safeStorage.getSelectedStorageBackend(),backend);assert.equal(forced.safeStorage.decryptString(forced.safeStorage.encryptString('x')),'x');
  const restore=createSessionCookieRestore({directory:path.resolve('/tmp/acira-no-keyring-switch-unused'),...forced,makeAccess:()=>{throw Error('restore is off: no reader page');}});
  assert.equal((await restore.attach({session:{cookies:new EventEmitter()},profileId:'A',partition:'persist:A'})).supported,false);restore.dispose();
 }
 assert.match(fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),/createSessionCookieRestore\(\{[^}]*\.\.\.require\('\.\/browser-services\/session-cookie-restore\.cjs'\)\.storageForRun\(\{safeStorage:require\('electron'\)\.safeStorage\}\)/);
});
