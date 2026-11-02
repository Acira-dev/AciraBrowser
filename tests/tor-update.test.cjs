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
