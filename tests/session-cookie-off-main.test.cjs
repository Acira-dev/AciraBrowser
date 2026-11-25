'use strict';
// A smoothness pass: a cookie change event and the capture after it wait for the disk off the main thread (fsync on libuv's pool, not fsyncSync).
// During a cookie-heavy page load every overwrite of a saved session cookie made two synchronous fsyncs on main (34.5 ms seen on one CNN load).
// The guarantees stay: the marker's bytes are written before the event returns, nothing is renamed before its fsync is done, and a save that waited
// while a cookie was deleted (or cleared, or the profile removed) never puts the old set back. Tests 1-3 fail on the code before this change (fsync on main, a marker
// and a save per deletion); test 4 passes there too (the synchronous clear and removal it races were already safe).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events'),crypto=require('node:crypto');
const {createSessionCookieRestore}=require('../desktop/browser-services/session-cookie-restore.cjs');
const key=crypto.randomBytes(32),safe={isEncryptionAvailable:()=>true,encryptString(text){const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),data]);},decryptString(bytes){const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}};
const cookie=(extra={})=>({name:'session',value:'sensitive-off-main-fixture',domain:'example.test',path:'/',secure:true,httpOnly:true,sameSite:'Lax',session:true,sourceScheme:'Secure',sourcePort:443,...extra});
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-session-off-main-'));
// fsync on main is counted; the pool's fsync can be held to open the window in which an event or a clear lands while a save waits for the disk.
function disk(){
 const calls={syncOnMain:0,syncOff:0,opened:[]},held=[];let hold=false;
 const io={...fs,
  openSync(file,...rest){calls.opened.push(path.basename(String(file)));return fs.openSync(file,...rest);},
  fsyncSync(fd){calls.syncOnMain++;return fs.fsyncSync(fd);},
  fsync(fd,done){calls.syncOff++;if(hold)held.push(()=>fs.fsync(fd,done));else fs.fsync(fd,done);}};
 return {io,calls,hold:()=>{hold=true;},release:()=>{hold=false;for(const go of held.splice(0))go();}};
}
function fixture(io){
 const session={cookies:new EventEmitter()},live={cookies:[],restored:[]};
 const makeAccess=()=>({async read(){return structuredClone(live.cookies);},async restore(params){live.restored=params;live.cookies=params.map(p=>cookie({...p,domain:p.domain||new URL(p.url).hostname}));},close(){}});
 return {session,live,makeAccess,io};
}
const restart=async directory=>{const f=fixture(fs),m=createSessionCookieRestore({directory,safeStorage:safe,makeAccess:f.makeAccess});await m.attach({session:f.session,profileId:'A',partition:'persist:A'});m.dispose();return f.live.restored.map(c=>c.name).sort();};
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));

test('a logout during a page load writes its marker at once and leaves every fsync to the pool',async()=>{
 const directory=temp(),d=disk(),f=fixture(d.io),manager=createSessionCookieRestore({directory,safeStorage:safe,fileSystem:d.io,makeAccess:f.makeAccess,captureDelay:5});
 await manager.attach({session:f.session,profileId:'A',partition:'persist:A'});
 f.live.cookies=[cookie(),cookie({name:'other'})];f.session.cookies.emit('changed',{},cookie(),'explicit',false);await manager.flush();
 d.calls.syncOnMain=0;
 f.live.cookies=[cookie({name:'other'})];f.session.cookies.emit('changed',{},cookie(),'explicit',true);
 assert.ok(fs.readdirSync(directory).some(name=>name.endsWith('.revoked')),'the marker is on file before the event returns');
 await tick();await manager.flush();
 assert.equal(d.calls.syncOnMain,0,'no fsync on the main thread for the deletion or the capture after it');
 assert.ok(d.calls.syncOff>=2,'the marker and the new snapshot were flushed to disk on the pool');
 assert.equal(fs.readdirSync(directory).some(name=>name.endsWith('.revoked')||name.endsWith('.tmp')),false,'the save that knows of the deletion removed the marker');
 manager.dispose();
 assert.deepEqual(await restart(directory),['other'],'the logged-out cookie never comes back; the other one does');
});

test('a save still waiting for the disk when a cookie is deleted never puts the deleted cookie back',async()=>{
 const directory=temp(),d=disk(),f=fixture(d.io),manager=createSessionCookieRestore({directory,safeStorage:safe,fileSystem:d.io,makeAccess:f.makeAccess,captureDelay:0});
 await manager.attach({session:f.session,profileId:'A',partition:'persist:A'});
 f.live.cookies=[cookie()];f.session.cookies.emit('changed',{},cookie(),'explicit',false);await manager.flush();
 // a new cookie arrives; its capture's save is held at the fsync
 d.hold();f.live.cookies=[cookie(),cookie({name:'late'})];f.session.cookies.emit('changed',{},cookie({name:'late'}),'explicit',false);await tick();
 // the session cookie is deleted while that save waits
 f.live.cookies=[cookie({name:'late'})];f.session.cookies.emit('changed',{},cookie(),'explicit',true);
 assert.ok(fs.readdirSync(directory).some(name=>name.endsWith('.revoked')),'marked at once');
 d.release();await tick();d.release();await manager.flush();d.release();await manager.flush();
 manager.dispose();
 assert.deepEqual(await restart(directory),['late'],'the held save was dropped; the one after it knows of the deletion');
});

test('a burst of deletions writes one marker and one snapshot',async()=>{
 const directory=temp(),d=disk(),f=fixture(d.io),manager=createSessionCookieRestore({directory,safeStorage:safe,fileSystem:d.io,makeAccess:f.makeAccess,captureDelay:1000});
 await manager.attach({session:f.session,profileId:'A',partition:'persist:A'});
 const names=Array.from({length:10},(_,i)=>'s'+i);f.live.cookies=names.map(name=>cookie({name}));f.session.cookies.emit('changed',{},cookie({name:'s0'}),'explicit',false);await manager.flush();
 d.calls.opened.length=0;f.live.cookies=[];
 for(const name of names)f.session.cookies.emit('changed',{},cookie({name}),'overwrite',true);
 const end=Date.now()+5000;while(d.calls.opened.filter(name=>name.endsWith('.tmp')).length<1&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));
 await tick();
 assert.equal(d.calls.opened.filter(name=>name.endsWith('.revoked')).length,1,'one marker for the burst');
 assert.equal(d.calls.opened.filter(name=>name.endsWith('.tmp')).length,1,'one snapshot for the burst');
 await manager.flush();manager.dispose();
 assert.deepEqual(await restart(directory),[]);
});

test('clearing website data while a save waits for the disk, and removing the profile while one waits, leave nothing to restore',async()=>{
 for(const how of ['clear','remove']){
  const directory=temp(),d=disk(),f=fixture(d.io),manager=createSessionCookieRestore({directory,safeStorage:safe,fileSystem:d.io,makeAccess:f.makeAccess,captureDelay:0});
  await manager.attach({session:f.session,profileId:'A',partition:'persist:A'});
  f.live.cookies=[cookie()];f.session.cookies.emit('changed',{},cookie(),'explicit',false);await manager.flush();
  d.hold();f.live.cookies=[cookie(),cookie({name:'late'})];f.session.cookies.emit('changed',{},cookie({name:'late'}),'explicit',false);await tick();
  if(how==='clear'){f.live.cookies=[];manager.clear(f.session);}else await manager.removeProfile('persist:A');
  d.release();await tick();d.release();
  if(how==='clear'){await manager.completeClear(f.session);await manager.flush();}
  manager.dispose();
  assert.deepEqual(await restart(directory),[],how);
  assert.equal(fs.readdirSync(directory).some(name=>name.endsWith('.tmp')),false,how+': no temporary file left');
 }
});
