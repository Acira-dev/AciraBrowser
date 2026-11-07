'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTorUpdater,newer}=require('../desktop/browser-services/tor-update.cjs');
const {verifyDetached}=require('../desktop/browser-services/tor-openpgp.cjs');

const scratch=path.join(__dirname,'..','.scratch-src'),archivePath=path.join(scratch,'tor-expert-bundle-windows-x86_64-15.0.26.tar.gz'),sigPath=archivePath+'.asc';
const haveRelease=fs.existsSync(archivePath)&&fs.existsSync(sigPath);
const response=(body,ok=true)=>({ok,status:ok?200:404,headers:{get:()=>String(body.length)},arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.length)});
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-update-'));

test('versions compare numerically',()=>{assert.equal(newer('15.0.27','15.0.26'),true);assert.equal(newer('15.0.26','15.0.26'),false);assert.equal(newer('15.0.9','15.0.26'),false);assert.equal(newer('16.0','15.9.9'),true);});

test('the OpenPGP check refuses unsigned or altered data',()=>{
 assert.equal(verifyDetached(Buffer.from('hello'),'-----BEGIN PGP SIGNATURE-----\n\nAAAA\n-----END PGP SIGNATURE-----'),false);
 assert.equal(verifyDetached(Buffer.from('hello'),Buffer.alloc(0)),false);
});

test('release signed by a pinned Tor key verifies; one altered byte does not',{skip:!haveRelease&&'release files not in .scratch-src'},()=>{
 const data=fs.readFileSync(archivePath),signature=fs.readFileSync(sigPath);
 assert.equal(verifyDetached(data,signature),true);const bad=Buffer.from(data);bad[1000]^=1;assert.equal(verifyDetached(bad,signature),false);
});

test('automatic updates off: nothing is contacted until a check is forced; the choice is remembered',async()=>{
 const userData=folder();let calls=0;
 try{
  const updater=createTorUpdater({platform:'win32',userData,fetcher:async()=>{calls++;return response(Buffer.from('{"version":"99.0"}'));}});
  updater.setAuto(false);await updater.check();assert.equal(calls,0);
  assert.equal(createTorUpdater({platform:'win32',userData}).status().auto,false);
  await updater.check({force:true});assert.ok(calls>0);assert.equal(updater.status().latest,'99.0');
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('a newer release whose signature is not a Tor key is never installed',async()=>{
 const userData=folder();
 try{
  const fetcher=async url=>url.endsWith('.json')||url.includes('download-windows')?response(Buffer.from('{"version":"99.0.1"}')):url.endsWith('.asc')?response(Buffer.from('-----BEGIN PGP SIGNATURE-----\n\nAAAA\n-----END PGP SIGNATURE-----')):response(Buffer.alloc(2048,1));
  const updater=createTorUpdater({platform:'win32',userData,fetcher,feedUrl:'https://feed.example/download.json'});
  const status=await updater.check({force:true});
  assert.match(status.error,/not signed by a Tor Browser Developers key/);assert.equal(updater.updated(),null);assert.equal(status.updatePending,false);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('a correctly signed newer release is installed beside the bundled one and recorded with its hash',{skip:!haveRelease&&'release files not in .scratch-src'},async()=>{
 const userData=folder();
 try{
  const archive=fs.readFileSync(archivePath),signature=fs.readFileSync(sigPath);
  const fetcher=async url=>url.includes('feed')?response(Buffer.from('{"version":"15.0.26"}')):url.endsWith('.asc')?response(signature):response(archive);
  const updater=createTorUpdater({platform:'win32',userData,fetcher,feedUrl:'https://feed.example/feed.json',bundled:'15.0.25',run:async()=>'0.4.9.14'});
  const status=await updater.check({force:true});
  assert.equal(status.error,null);assert.equal(status.updatePending,true);assert.equal(status.current,'15.0.26');
  const up=updater.updated();assert.ok(up&&fs.statSync(up.file).size>1e6);assert.match(up.sha256,/^[0-9a-f]{64}$/);
  assert.equal(createTorUpdater({platform:'win32',userData,bundled:'15.0.25'}).updated().file,up.file,'remembered across runs');
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

// P8 (beta.11): the weekly check used to start its 20 seconds when the Tor tab opened, so on a first start (Tor needs 20 to 60 s) it timed out and was
// written down as done for the week. It now waits for Tor, asks the feed, and counts the week only once the feed was read.
const abortError=()=>Object.assign(new Error('This operation was aborted'),{name:'AbortError'});
test('the check waits for Tor to be connected before it asks the feed',async()=>{
 const userData=folder();const order=[];let connect;
 try{
  const ready=()=>new Promise(resolve=>{order.push('ready asked');connect=()=>{order.push('tor connected');resolve();};});
  const fetcher=async()=>{order.push('feed asked');return response(Buffer.from('{"version":"15.0.0"}'));};
  const updater=createTorUpdater({platform:'win32',userData,fetcher,ready,feedUrl:'https://feed.example/feed.json',bundled:'15.0.25'});
  const pending=updater.check();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(order,['ready asked'],'no request to the feed while Tor is still starting');assert.equal(updater.status().state,'checking');
  connect();const status=await pending;
  assert.deepEqual(order,['ready asked','tor connected','feed asked']);assert.equal(status.error,null);assert.equal(status.latest,'15.0.0');assert.ok(status.lastChecked>0);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('a feed that could not be read is not recorded as a check: it is tried again at the next Tor start, and not before 30 minutes within one run',async()=>{
 const userData=folder();let t=1_790_000_000_000,calls=0,answer='timeout';
 try{
  const fetcher=async()=>{calls++;if(answer==='timeout')throw abortError();return response(Buffer.from('{"version":"15.0.0"}'));};
  const make=()=>createTorUpdater({platform:'win32',userData,fetcher,now:()=>t,feedUrl:'https://feed.example/feed.json',bundled:'15.0.25'});
  const updater=make();
  let status=await updater.check();
  assert.equal(calls,1);assert.equal(status.lastChecked,0,'the failed check is not written down as done');
  assert.equal(status.error,'The Tor update feed did not answer in time.','a sentence, not "This operation was aborted"');
  await updater.check();await updater.check();assert.equal(calls,1,'a second and third Tor tab in the same minute do not ask again');
  t+=29*60*1000;await updater.check();assert.equal(calls,1,'still inside the 30 minutes');
  t+=2*60*1000;await updater.check();assert.equal(calls,2,'after 30 minutes it asks again');
  // the next start of Acira asks at once, whatever the last run did
  const next=make();await next.check();assert.equal(calls,3,'a new run tries again at its first Tor start');
  answer='ok';t+=31*60*1000;status=await next.check();
  assert.equal(calls,4);assert.equal(status.error,null);assert.equal(status.lastChecked,t,'a read feed is recorded');
  await next.check();assert.equal(calls,4,'and then it is a week before the next look');
  t+=6*24*3600*1000;await next.check();assert.equal(calls,4);t+=2*24*3600*1000;await next.check();assert.equal(calls,5,'a week on, it asks again');
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('Tor that never connects is a failed check, not a done one',async()=>{
 const userData=folder();let t=1_790_000_000_000,asked=0;
 try{
  let readyCalls=0;const updater=createTorUpdater({platform:'win32',userData,now:()=>t,ready:async()=>{readyCalls++;throw new Error('Tor did not connect in time.');},fetcher:async()=>{asked++;return response(Buffer.from('{"version":"99.0"}'));}});
  const status=await updater.check();
  assert.equal(asked,0,'the feed is not asked without Tor');assert.equal(status.error,'Tor did not connect in time.');assert.equal(status.lastChecked,0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData,'tor','update.json'),'utf8')).lastChecked,0,'and the file on disk says the same');
  // a forced check ("Check now") is never held back by the 30 minutes
  await updater.check();assert.equal(readyCalls,1,'a second Tor tab within 30 minutes does not start another wait');
  const forced=await updater.check({force:true});assert.equal(readyCalls,2);assert.equal(forced.lastChecked,0);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('automatic updates off still asks Tor for nothing, with or without a ready function',async()=>{
 const userData=folder();let readyCalls=0;
 try{
  const updater=createTorUpdater({platform:'win32',userData,ready:async()=>{readyCalls++;},fetcher:async()=>response(Buffer.from('{"version":"99.0"}'))});
  updater.setAuto(false);await updater.check();assert.equal(readyCalls,0,'Tor is not even started for a check that is off');
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('a release that was found but could not be installed still counts for the week (no large download at every start)',async()=>{
 const userData=folder();let t=1_790_000_000_000;
 try{
  const fetcher=async url=>url.endsWith('.json')?response(Buffer.from('{"version":"99.0.1"}')):url.endsWith('.asc')?response(Buffer.from('-----BEGIN PGP SIGNATURE-----\n\nAAAA\n-----END PGP SIGNATURE-----')):response(Buffer.alloc(2048,1));
  const updater=createTorUpdater({platform:'win32',userData,fetcher,now:()=>t,feedUrl:'https://feed.example/download.json'});
  const status=await updater.check({force:true});
  assert.match(status.error,/not signed by a Tor Browser Developers key/);assert.equal(status.lastChecked,t);assert.equal(status.latest,'99.0.1');
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});
