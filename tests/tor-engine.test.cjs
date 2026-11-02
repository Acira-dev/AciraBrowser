'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTorEngine,torExecutable,torArguments,parseKeywords,parseBootstrap,parseLogBootstrap,TOR_MANIFEST}=require('../desktop/browser-services/tor-engine.cjs');

test('control-port keywords keep quoted values whole',()=>{
 assert.deepEqual(parseKeywords('PROGRESS=50 TAG=loading_descriptors SUMMARY="Loading relay descriptors"'),{PROGRESS:'50',TAG:'loading_descriptors',SUMMARY:'Loading relay descriptors'});
 assert.equal(parseKeywords('WARNING="say \\"hi\\""').WARNING,'say "hi"');
});

test('bootstrap events and warnings parse from STATUS_CLIENT lines',()=>{
 assert.deepEqual(parseBootstrap('STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"'),{progress:100,tag:'done',summary:'Done',warning:null});
 const warn=parseBootstrap('STATUS_CLIENT WARN BOOTSTRAP PROGRESS=10 TAG=conn_done SUMMARY="Connected to a relay" WARNING="Connection refused" REASON=CONNECTREFUSED COUNT=3 RECOMMENDATION=warn');
 assert.equal(warn.progress,10);assert.deepEqual(warn.warning,{reason:'CONNECTREFUSED',warning:'Connection refused',recommendation:'warn'});
 assert.equal(parseBootstrap('STATUS_CLIENT NOTICE CIRCUIT_ESTABLISHED'),null);
});

test('bootstrap progress also reads from tor stdout',()=>{
 assert.deepEqual(parseLogBootstrap('Oct 24 23:22:54.000 [notice] Bootstrapped 45% (requesting_descriptors): Asking for relay descriptors'),{progress:45,tag:'requesting_descriptors',summary:'Asking for relay descriptors',warning:null});
 assert.equal(parseLogBootstrap('[notice] Opening Socks listener on 127.0.0.1:0'),null);
});

test('tor runs with explicit, private, owner-bound options and reads no torrc',()=>{
 const args=torArguments({dataDirectory:'D',runDirectory:'R',ownerPid:42}),value=name=>args[args.indexOf(name)+1];
 assert.ok(args.includes('--ignore-missing-torrc'));
 assert.equal(value('--SocksPort'),'127.0.0.1:auto ExtendedErrors IPv6Traffic PreferIPv6 KeepAliveIsolateSOCKSAuth','Tor Browser 15 SOCKS flags: per-site circuits by SOCKS auth');assert.equal(value('--ControlPort'),'127.0.0.1:auto');
 assert.equal(value('--__OwningControllerProcess'),'42');assert.equal(value('--ClientOnly'),'1');assert.equal(value('--CookieAuthentication'),'1');
 assert.equal(value('--DataDirectory'),'D');assert.ok(value('-f').startsWith('R'));assert.ok(value('--defaults-torrc').startsWith('R'));
});

test('the pinned engine is a signed Tor Project release with hashes for every shipped file',()=>{
 assert.match(TOR_MANIFEST.archive.url,/^https:\/\/dist\.torproject\.org\/torbrowser\/[\d.]+\/tor-expert-bundle-windows-x86_64-[\d.]+\.tar\.gz$/);
 assert.match(TOR_MANIFEST.archive.sha256,/^[0-9a-f]{64}$/);
 assert.equal(TOR_MANIFEST.signingKey,'EF6E286DDA85EA2A4BA7DE684E2C6E8793298290');
 for(const entry of Object.values(TOR_MANIFEST.files))assert.match(entry.sha256,/^[0-9a-f]{64}$/);
 assert.ok(TOR_MANIFEST.files['tor.exe']);
});

test('packaged builds resolve the current platform engine name in resources/tor',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-res-')),name=process.platform==='win32'?'tor.exe':'tor',other=name==='tor'?'tor.exe':'tor';fs.mkdirSync(path.join(dir,'tor'));
 try{
  const wrong=path.join(dir,'tor',other);fs.writeFileSync(wrong,'wrong platform');
  assert.notEqual(torExecutable({resourcesPath:dir}),wrong,'another platform binary is never selected');
  const correct=path.join(dir,'tor',name);fs.writeFileSync(correct,'x');
  assert.equal(torExecutable({resourcesPath:dir}),correct);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

const waitFor=(engine,states)=>new Promise(resolve=>{const s=engine.status();if(states.includes(s.state))return resolve(s);const off=engine.onStatus(next=>{if(states.includes(next.state)){off();resolve(next);}});});

test('a missing engine fails closed with a plain error; the last release does not stop tor (one connection per session)',async()=>{
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-engine-'));
 try{
  const engine=createTorEngine({userData,executable:()=>null,repair:async()=>false});
  const release=engine.acquire('w1');const failed=await waitFor(engine,['error']);
  assert.equal(failed.error.code,'missing');assert.equal(failed.socksPort,0);assert.match(failed.error.title,/Tor/);
  await release();assert.equal(engine.status().state,'error','releasing the last lease leaves the engine as it is: tor is not stopped');assert.equal(engine.leases(),0);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('warm() starts connecting without any lease, once while it is starting, and Try again works with no Tor page open',async()=>{
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-engine-'));let looked=0;
 try{
  const engine=createTorEngine({userData,executable:()=>{looked++;return null;},repair:async()=>false});
  assert.equal(engine.leases(),0);const first=engine.warm(),second=engine.warm();
  assert.equal(engine.status().state,'starting','a Tor tab opened: connecting has begun at once');
  const failed=await waitFor(engine,['error']);await Promise.all([first,second]);
  assert.equal(failed.error.code,'missing');assert.equal(looked,2,'one start (a lookup before the repair, one after), not two');
  engine.retry();assert.equal(engine.status().state,'starting','Try again restarts with no lease held');
  await waitFor(engine,['error']);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('a tor.exe that does not match the pinned hash is never started',async()=>{
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-engine-')),fake=path.join(userData,'tor.exe');fs.writeFileSync(fake,'not tor');
 let spawned=false;
 try{
  const engine=createTorEngine({userData,executable:()=>fake,spawnTor:()=>{spawned=true;throw new Error('should not spawn');}});
  engine.acquire('w1');const failed=await waitFor(engine,['error']);
  assert.equal(failed.error.code,'integrity');assert.equal(spawned,false);engine.stop();
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('a development build with no tor.exe downloads it once, then starts it',async()=>{
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-engine-'));let present=false,repairs=0,seen=[];
 try{
  const engine=createTorEngine({userData,executable:()=>present?path.join(userData,'tor.exe'):null,repair:async()=>{repairs++;present=true;fs.writeFileSync(path.join(userData,'tor.exe'),'not tor');}});
  engine.onStatus(s=>seen.push(s.summary));engine.acquire('w1');const failed=await waitFor(engine,['error']);
  assert.equal(repairs,1);assert.ok(seen.includes('Downloading Tor, one time'));assert.equal(failed.error.code,'integrity','the repaired file is still verified against the pinned hash');
  engine.stop();
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});
