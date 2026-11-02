'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events'),crypto=require('node:crypto');
const {createSessionCookieRestore,cookieParam}=require('../desktop/browser-services/session-cookie-restore.cjs');
const key=crypto.randomBytes(32),safe={isEncryptionAvailable:()=>true,encryptString(text){const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),data]);},decryptString(bytes){const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}};
const cookie=(extra={})=>({name:'session',value:'highly-sensitive-fixture',domain:'example.test',path:'/',secure:true,httpOnly:true,sameSite:'Lax',priority:'Medium',session:true,sourceScheme:'Secure',sourcePort:443,...extra});
function fixture(){const session={cookies:new EventEmitter()},state={live:[],restored:[]};const makeAccess=()=>({async read(){return structuredClone(state.live);},async restore(params){state.restored=params;state.live=params.map(p=>cookie({...p,domain:p.domain||new URL(p.url).hostname,session:true}));},close(){}});return {session,state,makeAccess};}
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-session-restore-test-'));
test('cookie reconstruction preserves host-only, HttpOnly, session lifetime and CHIPS partition key',()=>{
 const param=cookieParam(cookie());assert.equal(param.domain,undefined);assert.equal(param.httpOnly,true);assert.equal(param.expires,undefined);assert.equal(param.expirationDate,undefined);
 const chips=cookieParam(cookie({partitionKey:{topLevelSite:'https://top.test',hasCrossSiteAncestor:true}}));assert.deepEqual(chips.partitionKey,{topLevelSite:'https://top.test',hasCrossSiteAncestor:true});
 assert.equal(cookieParam(cookie({partitionKeyOpaque:true})),null);assert.equal(cookieParam(cookie({session:false})),null);assert.equal(cookieParam(cookie({domain:'user:pass@example.test'})),null);
 assert.equal(cookieParam(cookie({domain:'[::1]'})).url,'https://[::1]/');assert.equal(cookieParam(cookie({domain:'::1'})).url,'https://[::1]/');
});
test('encrypted profile-bound restore excludes private and persistent cookie snapshots',async()=>{
 const directory=temp(),a=fixture(),manager=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:a.makeAccess});await manager.attach({session:a.session,profileId:'A',partition:'persist:A'});a.state.live=[cookie(),cookie({name:'persistent',session:false})];a.session.cookies.emit('changed',{},cookie(),'explicit',false);await manager.flush();manager.dispose();
 const file=path.join(directory,fs.readdirSync(directory)[0]);assert.equal(fs.readFileSync(file).includes(Buffer.from('highly-sensitive-fixture')),false);
 const b=fixture(),next=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:b.makeAccess});await next.attach({session:b.session,profileId:'A',partition:'persist:A'});assert.equal(b.state.restored.length,1);assert.equal(b.state.restored[0].name,'session');
 const privateSession=fixture();assert.equal((await next.attach({session:privateSession.session,profileId:'private-A',partition:'private-A',private:true})).supported,false);next.dispose();
 const wrong=fixture(),wrongManager=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:wrong.makeAccess});await wrongManager.attach({session:wrong.session,profileId:'B',partition:'persist:A'});assert.equal(wrong.state.restored.length,0);wrongManager.dispose();
});
test('logout and explicit clearing cannot resurrect captured credentials on next restore',async()=>{
 const directory=temp(),f=fixture(),manager=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:f.makeAccess});await manager.attach({session:f.session,profileId:'A',partition:'persist:A'});f.state.live=[cookie()];f.session.cookies.emit('changed',{},cookie(),'explicit',false);await manager.flush();
 f.state.live=[];f.session.cookies.emit('changed',{},cookie(),'explicit',true);await manager.flush();manager.dispose();
 const after=fixture(),second=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:after.makeAccess});await second.attach({session:after.session,profileId:'A',partition:'persist:A'});assert.equal(after.state.restored.length,0);
 after.state.live=[cookie()];after.session.cookies.emit('changed',{},cookie(),'explicit',false);await second.flush();second.clear(after.session);after.state.live=[];await second.completeClear(after.session);await second.flush();second.dispose();
 const final=fixture(),third=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:final.makeAccess});await third.attach({session:final.session,profileId:'A',partition:'persist:A'});assert.equal(final.state.restored.length,0);third.dispose();
});
test('unprotected Linux fallback and unavailable OS storage never write plaintext',async()=>{
 for(const storage of [{...safe,isEncryptionAvailable:()=>false},{...safe,getSelectedStorageBackend:()=> 'basic_text'}]){const directory=temp(),f=fixture(),manager=createSessionCookieRestore({directory,safeStorage:storage,platform:'linux',makeAccess:f.makeAccess});assert.equal((await manager.attach({session:f.session,profileId:'A',partition:'persist:A'})).supported,false);assert.equal(fs.readdirSync(directory).length,0);manager.dispose();}
});
test('in-flight native reads cannot resurrect a clear that is interrupted before native completion',async()=>{
 const directory=temp(),session={cookies:new EventEmitter()};let live=[],block=false,releaseRead;const makeAccess=()=>({async read(){if(block)return new Promise(resolve=>{releaseRead=()=>resolve(structuredClone(live));});return structuredClone(live);},async restore(params){live=params.map(p=>cookie({...p,domain:p.domain||new URL(p.url).hostname}));},close(){}});
 const manager=createSessionCookieRestore({directory,safeStorage:safe,makeAccess,captureDelay:0});await manager.attach({session,profileId:'A',partition:'persist:A'});live=[cookie()];session.cookies.emit('changed',{},cookie(),'explicit',false);await manager.flush();block=true;session.cookies.emit('changed',{},cookie(),'explicit',false);await new Promise(resolve=>setTimeout(resolve,15));manager.clear(session);releaseRead();await manager.flush();manager.dispose();
 const after=fixture(),next=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:after.makeAccess});await next.attach({session:after.session,profileId:'A',partition:'persist:A'});assert.equal(after.state.restored.length,0);next.dispose();
});
test('registrable-domain tombstones cover siblings/children while preserving other sites, private suffix tenants and profileB',async()=>{
 const directory=temp(),a=fixture(),b=fixture(),managerA=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:a.makeAccess}),managerB=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:b.makeAccess});await managerA.attach({session:a.session,profileId:'A',partition:'persist:A'});await managerB.attach({session:b.session,profileId:'B',partition:'persist:B'});
 a.state.live=['a.example.test','b.example.test','child.b.example.test','elsewhere.test','one.tenant.github.io','other.github.io'].map(domain=>cookie({domain}));b.state.live=[cookie({domain:'b.example.test'})];a.session.cookies.emit('changed',{},a.state.live[0],'explicit',false);b.session.cookies.emit('changed',{},b.state.live[0],'explicit',false);await managerA.flush();await managerB.flush();
 assert.throws(()=>managerA.clear(a.session,{origin:'https://a.example.test',registrableDomain:'elsewhere.test'}),/does not match/);managerA.clear(a.session,{origin:'https://a.example.test:8443/',registrableDomain:'example.test'});await managerA.flush();managerA.dispose();managerB.dispose();
 const after=fixture(),restore=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:after.makeAccess});await restore.attach({session:after.session,profileId:'A',partition:'persist:A'});assert.equal(after.state.restored.some(item=>new URL(item.url).hostname.endsWith('example.test')),false);assert.equal(after.state.restored.some(item=>new URL(item.url).hostname==='elsewhere.test'),true);
 restore.clear(after.session,{origin:'https://one.tenant.github.io',scope:'registrable-domain'});await restore.flush();restore.dispose();const again=fixture(),restoreAgain=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:again.makeAccess});await restoreAgain.attach({session:again.session,profileId:'A',partition:'persist:A'});assert.equal(again.state.restored.some(item=>new URL(item.url).hostname==='one.tenant.github.io'),false);assert.equal(again.state.restored.some(item=>new URL(item.url).hostname==='other.github.io'),true);restoreAgain.dispose();
 const other=fixture(),otherManager=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:other.makeAccess});await otherManager.attach({session:other.session,profileId:'B',partition:'persist:B'});assert.equal(other.state.restored.some(item=>new URL(item.url).hostname==='b.example.test'),true);otherManager.dispose();
});
test('idle cookie churn costs no disk writes: persistent-cookie changes, repeated captures of an unchanged set, and bursts of changes',async()=>{
 const directory=temp(),writes=[];let reads=0,live=[cookie()];
 const session={cookies:new EventEmitter()},makeAccess=()=>({async read(){reads++;return structuredClone(live);},async restore(){},close(){}});
 const counting={...fs,openSync:(file,...rest)=>{writes.push(String(file));return fs.openSync(file,...rest);}};
 const manager=createSessionCookieRestore({directory,safeStorage:safe,makeAccess,fileSystem:counting,captureDelay:5});
 await manager.attach({session,profileId:'A',partition:'persist:A'});await manager.flush();
 const settled=()=>new Promise(resolve=>setTimeout(resolve,40));
 writes.length=0;reads=0;
 for(let i=0;i<20;i++)session.cookies.emit('changed',{},cookie({name:'analytics',session:false,value:String(i)}),'explicit',false);
 await settled();
 assert.equal(writes.length,0,'persistent cookies that no saved session cookie shares a name with are not a deletion, and the unchanged set is not rewritten');
 assert.equal(reads,1,'twenty changes in a burst share one capture');
 live=[cookie(),cookie({name:'second',value:'x'})];session.cookies.emit('changed',{},cookie({name:'second'}),'explicit',false);await settled();
 assert.ok(writes.some(file=>file.endsWith('.tmp')),'a real change is still saved');
 const before=writes.length;session.cookies.emit('changed',{},cookie({name:'second'}),'explicit',false);await settled();assert.equal(writes.length,before,'the same set twice is one write');
 manager.dispose();
});


test('encrypted native upgrade rewrites existing cookies once, preserving expiry and CHIPS attributes',async()=>{
 const directory=temp(),session={cookies:new EventEmitter()},writes=[];let flushes=0;
 session.cookies.flushStore=async()=>{flushes++;};
 const current=[cookie({name:'legacy',session:false,expires:1900000000.25}),cookie({name:'chips',partitionKey:{topLevelSite:'https://top.test',hasCrossSiteAncestor:true}})];
 const makeAccess=()=>({read:async()=>structuredClone(current),restore:async params=>{if(params.length)writes.push(params);},close(){}});
 const options={directory,safeStorage:safe,makeAccess,encryptExistingCookies:true};
 const manager=createSessionCookieRestore(options);await manager.attach({session,profileId:'A',partition:'persist:A'});
 assert.equal(flushes,1);assert.equal(writes.length,1);assert.equal(writes[0][0].expires,current[0].expires);assert.equal(writes[0][0].domain,undefined);assert.equal(writes[0][1].expires,undefined);assert.deepEqual(writes[0][1].partitionKey,current[1].partitionKey);manager.dispose();
 const next=createSessionCookieRestore(options);await next.attach({session,profileId:'A',partition:'persist:A'});assert.equal(flushes,1);assert.equal(writes.length,1);next.dispose();
});

test('failed native encryption upgrade remains retryable and never marks or rewrites unsupported attributes',async()=>{
 for(const mode of ['write','flush','opaque']){
  const directory=temp(),session={cookies:new EventEmitter()};let writes=0;
  session.cookies.flushStore=async()=>{if(mode==='flush')throw Error('owned flush fault');};
  const makeAccess=()=>({read:async()=>[cookie({partitionKeyOpaque:mode==='opaque'})],restore:async params=>{if(params.length){writes++;if(mode==='write')throw Error('owned rewrite fault');}},close(){}});
  const manager=createSessionCookieRestore({directory,safeStorage:safe,makeAccess,encryptExistingCookies:true});
  assert.equal((await manager.attach({session,profileId:'A',partition:'persist:A'})).supported,false);
  assert.equal(fs.readdirSync(directory).some(name=>name.endsWith('.native-encrypted-v1')),false);assert.equal(writes,mode==='opaque'?0:1);manager.dispose();
 }
});
