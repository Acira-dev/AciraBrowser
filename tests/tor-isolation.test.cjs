'use strict';
// Per-site Tor circuits (desktop/browser-services/tor-isolation.cjs): Chromium's no-auth SOCKS5 CONNECT is replayed to tor with
// username = first-party site and password = that site's nonce (Tor Browser's TorDomainIsolator). A fake tor SOCKS port records
// what tor would see; nothing here touches the network.
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {createTorIsolation,firstPartyOf,parseConnect,TOR_CATCHALL_SITE}=require('../desktop/browser-services/tor-isolation.cjs');
const {levelPolicy,hardenHeaders,requestSite,TOR_LEVEL_PREFERENCES,TOR_LEVELS}=require('../desktop/browser-services/tor-window.cjs');

/** A fake tor SOCKS port: requires username/password auth (method 2), records each stream, answers success, echoes bytes. */
function fakeTor(){
 const streams=[];const server=net.createServer(socket=>{let buf=Buffer.alloc(0),stage='greet',auth=null;
  socket.on('data',chunk=>{buf=Buffer.concat([buf,chunk]);
   if(stage==='greet'&&buf.length>=2&&buf.length>=2+buf[1]){const methods=[...buf.subarray(2,2+buf[1])];buf=buf.subarray(2+buf[1]);if(!methods.includes(2)){socket.end(Buffer.from([5,0xff]));return;}socket.write(Buffer.from([5,2]));stage='auth';}
   if(stage==='auth'&&buf.length>=2){const ul=buf[1];if(buf.length<3+ul)return;const pl=buf[2+ul];if(buf.length<3+ul+pl)return;auth={username:buf.subarray(2,2+ul).toString(),password:buf.subarray(3+ul,3+ul+pl).toString()};buf=buf.subarray(3+ul+pl);socket.write(Buffer.from([1,0]));stage='req';}
   if(stage==='req'){const r=parseConnect(buf);if(!r)return;streams.push({...auth,host:r.host,port:r.port});buf=r.rest;socket.write(Buffer.from([5,0,0,1,0,0,0,0,0,0]));stage='pipe';if(buf.length)socket.write(buf);return;}
   if(stage==='pipe'){socket.write(buf);buf=Buffer.alloc(0);}
  });});
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,port:server.address().port,streams})));
}
/** Chromium's side: no-auth greeting, CONNECT by host name (ATYP 3, remote DNS), then one round trip of data. */
function chromiumConnect(port,host,target=443){
 return new Promise((resolve,reject)=>{const socket=net.connect(port,'127.0.0.1');let buf=Buffer.alloc(0),stage='greet',done=false;
  const finish=error=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve();};
  const timer=setTimeout(()=>finish(new Error('timed out at '+stage)),5000);socket.on('close',()=>{clearTimeout(timer);finish(new Error('closed at '+stage));});
  socket.on('error',finish);socket.on('connect',()=>socket.write(Buffer.from([5,1,0])));
  socket.on('data',chunk=>{buf=Buffer.concat([buf,chunk]);
   if(stage==='greet'&&buf.length>=2){if(buf[0]!==5||buf[1]!==0)return finish(new Error('the relay must accept no-auth from Chromium'));buf=buf.subarray(2);const h=Buffer.from(host);const req=Buffer.concat([Buffer.from([5,1,0,3,h.length]),h,Buffer.from([target>>8,target&255])]);socket.write(req);stage='reply';}
   if(stage==='reply'&&buf.length>=10){if(buf[1]!==0)return finish(new Error('refused, code '+buf[1]));buf=buf.subarray(10);stage='data';socket.write('ping');}
   if(stage==='data'&&buf.toString().includes('ping')){clearTimeout(timer);finish();}
  });});
}

test('first party is the registrable domain; .onion keeps its address; IP literals stay as they are',()=>{
 assert.equal(firstPartyOf('https://www.bbc.co.uk/news'),'bbc.co.uk');
 assert.equal(firstPartyOf('https://cdn.static.example.com/x.js'),'example.com');
 assert.equal(firstPartyOf('http://abc.duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/'),'duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion');
 assert.equal(firstPartyOf('https://93.184.215.14/'),'93.184.215.14');
 assert.equal(firstPartyOf('not a url'),'');
});

test('each site rides its own circuit: tor sees username = first party, a per-site password, and host names unresolved',async()=>{
 const tor=await fakeTor();const iso=createTorIsolation({upstreamPort:()=>tor.port});
 try{
  const relay=await iso.open('tab-1');
  // Site A's page and its third-party script; then site B's page loading the same third-party host.
  iso.note('tab-1','https://news.example/','news.example');await chromiumConnect(relay,'news.example');
  iso.note('tab-1','https://cdn.tracker.test/t.js','news.example');await chromiumConnect(relay,'cdn.tracker.test');
  iso.note('tab-1','https://shop.other/','shop.other');await chromiumConnect(relay,'shop.other');
  iso.note('tab-1','https://cdn.tracker.test/t.js','shop.other');await chromiumConnect(relay,'cdn.tracker.test');
  const [a,aThird,b,bThird]=tor.streams;
  assert.deepEqual([a.username,aThird.username,b.username,bThird.username],['news.example','news.example','shop.other','shop.other']);
  assert.equal(a.password,aThird.password,'a site and the third parties it loads share its circuit');
  assert.notEqual(a.password,b.password,'two sites never share a circuit');
  assert.equal(aThird.host,'cdn.tracker.test','the name reaches tor unresolved (socks5h): nothing is resolved locally');
  assert.equal(aThird.port,443);
 }finally{iso.close('tab-1');tor.server.close();}
});

test('New Tor circuit for this site changes only that site; New Tor identity changes every site',async()=>{
 const tor=await fakeTor();const iso=createTorIsolation({upstreamPort:()=>tor.port});
 try{
  const relay=await iso.open('w');
  const visit=async site=>{iso.note('w','https://'+site+'/',site);await chromiumConnect(relay,site);return tor.streams.at(-1).password;};
  const a1=await visit('a.example'),b1=await visit('b.example');
  assert.ok(iso.newCircuit('a.example'));
  const a2=await visit('a.example'),b2=await visit('b.example');
  assert.notEqual(a1,a2,'the site got a new circuit');assert.equal(b1,b2,'other sites keep theirs');
  iso.reset();
  const a3=await visit('a.example'),b3=await visit('b.example');
  assert.notEqual(a3,a2);assert.notEqual(b3,b2);
  assert.ok(iso.streams().every(s=>!('password' in s)),'QA output never carries a nonce');
 }finally{iso.close('w');tor.server.close();}
});

test('a stream nobody claimed uses the tab site, else the catch-all; nothing connects while tor is not ready',async()=>{
 const tor=await fakeTor();let port=tor.port;const iso=createTorIsolation({upstreamPort:()=>port});
 try{
  const relay=await iso.open('t');
  await chromiumConnect(relay,'sw.example');assert.equal(tor.streams.at(-1).username,TOR_CATCHALL_SITE,'a service worker fetch with no page');
  iso.setSite('t','page.example');await chromiumConnect(relay,'beacon.example');assert.equal(tor.streams.at(-1).username,'page.example');
  port=0;const before=tor.streams.length;
  await assert.rejects(chromiumConnect(relay,'x.example'),'no tor, no stream (the relay never connects anywhere else)');
  assert.equal(tor.streams.length,before);
 }finally{iso.close('t');tor.server.close();}
});

test('security levels: Safer blocks scripts on non-HTTPS pages (onion is secure), Safest everywhere; page settings follow',()=>{
 assert.deepEqual(TOR_LEVELS,['standard','safer','safest']);
 assert.equal(levelPolicy('standard','http://example.com/'),'');
 assert.equal(levelPolicy('safer','https://example.com/'),'');
 assert.match(levelPolicy('safer','http://example.com/'),/script-src 'none'/);
 assert.equal(levelPolicy('safer','http://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvw.onion/'),'','an .onion page counts as secure (Tor Browser)');
 assert.match(levelPolicy('safest','https://example.com/'),/script-src 'none'.*font-src 'none'.*media-src 'none'/);
 assert.ok(!TOR_LEVEL_PREFERENCES.standard.additionalArguments.some(a=>/jitless/.test(a)));
 for(const level of ['safer','safest']){const p=TOR_LEVEL_PREFERENCES[level];assert.ok(p.additionalArguments.includes('--js-flags=--jitless --no-expose-wasm'),'no JIT and no WebAssembly');assert.equal(p.webgl,false);assert.equal(p.disableBlinkFeatures,undefined,'MathML has no runtime switch in Chromium 152: nothing claims it');assert.ok(p.additionalArguments.includes('--blink-settings=dnsPrefetchingEnabled=false'),'DNS prefetch stays off at every level');assert.equal(p.webgl,false);assert.equal(p.autoplayPolicy,'document-user-activation-required');}
 assert.equal(TOR_LEVEL_PREFERENCES.safest.javascript,false);assert.notEqual(TOR_LEVEL_PREFERENCES.safer.javascript,false);
});

test('the level policy is added beside the site’s own policy, never instead of it',()=>{
 const out=hardenHeaders({'content-security-policy':["default-src 'self'"]},true,"script-src 'none'");
 assert.deepEqual(out['content-security-policy'],["default-src 'self'","script-src 'none'"]);
 assert.equal(Object.keys(out).filter(k=>k.toLowerCase()==='content-security-policy').length,1);
 const fresh=hardenHeaders({'content-type':['text/html']},true,"script-src 'none'");assert.deepEqual(fresh['Content-Security-Policy'],["script-src 'none'"]);
 assert.equal(hardenHeaders({'content-type':['image/png']},false,"script-src 'none'"),null,'subresources are left alone');
});

test('a request belongs to its page’s site: navigations to their own, subresources to the top frame, else the tab',()=>{
 assert.equal(requestSite({resourceType:'mainFrame',url:'https://www.a.example/x'}),'a.example');
 assert.equal(requestSite({resourceType:'script',url:'https://cdn.c.test/x.js',frame:{top:{url:'https://b.example/'}}}),'b.example');
 const wc={isDestroyed:()=>false,getURL:()=>'https://d.example/page'};
 assert.equal(requestSite({resourceType:'xhr',url:'https://api.e.test/',webContentsId:7},id=>id===7?wc:null),'d.example');
 assert.equal(requestSite({resourceType:'other',url:'https://x.test/'}),'');
});

test('one Tor window, two sites, one third party: each CONNECT rides the circuit of the one site that claims it; ambiguity or no claim gets a circuit of its own',async()=>{
 const tor=await fakeTor();const iso=createTorIsolation({upstreamPort:()=>tor.port});
 try{
  const port=await iso.open('window-1',{shared:true});
  iso.setSite('window-1','a.example');iso.setSite('window-1','b.example'); // two tabs: the latest main frame is b.example
  // Site A's page asks for the tracker; its CONNECT arrives while only A claims tracker.test:443.
  iso.note('window-1','https://tracker.test/p.gif','a.example',101);await chromiumConnect(port,'tracker.test');iso.settle('window-1',101);
  // Site B's page asks for the same tracker (Chromium opens B its own socket: connections are partitioned by top-level site).
  iso.note('window-1','https://tracker.test/p.gif','b.example',202);await chromiumConnect(port,'tracker.test');iso.settle('window-1',202);
  const [a,b]=tor.streams;
  assert.equal(a.username,'a.example');assert.equal(b.username,'b.example');assert.notEqual(a.password,b.password,'tor (IsolateSOCKSAuth) builds them different circuits');
  // A again: same circuit as before (its own nonce), not B's.
  iso.note('window-1','https://tracker.test/2','a.example',103);await chromiumConnect(port,'tracker.test');iso.settle('window-1',103);
  assert.deepEqual([tor.streams[2].username,tor.streams[2].password],[a.username,a.password]);
  // Both claim at once: tor must not put the stream on either site's circuit.
  iso.note('window-1','https://tracker.test/x','a.example',104);iso.note('window-1','https://tracker.test/x','b.example',204);await chromiumConnect(port,'tracker.test');
  const both=tor.streams[3];assert.equal(both.username,'--isolated--');assert.ok(![a.password,b.password].includes(both.password));
  iso.settle('window-1',104);iso.settle('window-1',204);
  // Nobody claims (a preconnect, a worker): never the window's latest site, a one-off circuit instead, different each time.
  await chromiumConnect(port,'cdn.test');await chromiumConnect(port,'cdn.test');
  const [p1,p2]=tor.streams.slice(4);assert.equal(p1.username,'--isolated--');assert.notEqual(p1.password,p2.password);
  // A settled claim no longer explains a later CONNECT; an old one expires.
  iso.note('window-1','https://late.test/','a.example',105);iso.settle('window-1',105);await chromiumConnect(port,'late.test');
  assert.equal(tor.streams[6].username,'--isolated--');
 }finally{iso.close('window-1');tor.server.close();}
});

test('security review: a CONNECT that another site happens to claim never rides that site’s circuit when it came from a preconnect or a page-less request',async()=>{
 const tor=await fakeTor();const iso=createTorIsolation({upstreamPort:()=>tor.port});
 try{
  const port=await iso.open('window-1',{shared:true});
  // Site A holds a claim on tracker.test:443 (a request still waiting for its headers: a long poll the tracker never answers).
  iso.note('window-1','https://tracker.test/poll','a.example',301);
  // Site B's <link rel=preconnect> opens a socket in B's partition: no webRequest event, only the session's 'preconnect' event.
  iso.preconnect('window-1','https://tracker.test/','b.example');await chromiumConnect(port,'tracker.test');
  assert.notEqual(tor.streams[0].username,'a.example','B’s preconnected socket (reused by B’s later requests) must not ride A’s circuit');
  // The same preconnect without a known frame is anybody's: a circuit of its own.
  iso.preconnect('window-1','https://tracker.test/','');await chromiumConnect(port,'tracker.test');
  assert.equal(tor.streams[1].username,'--isolated--');
  // A page-less request (a service worker's fetch: no site) is a claim too, so A's lone claim cannot explain its CONNECT.
  iso.note('window-1','https://tracker.test/sw','',302);await chromiumConnect(port,'tracker.test');iso.settle('window-1',302);
  assert.equal(tor.streams[2].username,'--isolated--','a request with no known site gets a circuit of its own, never A’s');
 }finally{iso.close('window-1');tor.server.close();}
 // A Tor tab that went from a.example to b.example: B's preconnect must not take A's circuit from A's leftover claim or hint.
 const tor2=await fakeTor();let clock=1000;const tab=createTorIsolation({upstreamPort:()=>tor2.port,now:()=>clock});
 try{
  const port=await tab.open('tab-1');tab.setSite('tab-1','a.example');
  tab.note('tab-1','https://tracker.test/x','a.example',1);clock+=5000; // cancelled by the navigation: never settled
  tab.setSite('tab-1','b.example');tab.preconnect('tab-1','https://tracker.test/','b.example');await chromiumConnect(port,'tracker.test');
  assert.notEqual(tor2.streams[0].username,'a.example');
 }finally{tab.close('tab-1');tor2.server.close();}
});

test('a Tor tab (one site at a time) keeps its site circuit for streams nobody claimed; claims expire after a minute',async()=>{
 const tor=await fakeTor();let clock=1000;const iso=createTorIsolation({upstreamPort:()=>tor.port,now:()=>clock});
 try{
  const port=await iso.open('tab-9');iso.setSite('tab-9','a.example');
  await chromiumConnect(port,'cdn.test');assert.equal(tor.streams[0].username,'a.example','a preconnect in a tab rides the tab’s site circuit');
  iso.note('tab-9','https://other.test/','b.example',7);await chromiumConnect(port,'other.test');
  assert.equal(tor.streams[1].username,'b.example','a live claim wins over the tab’s site (a navigation from a to b)');
  iso.note('tab-9','https://gone.test/','b.example',8);clock+=121000;await chromiumConnect(port,'gone.test');
  assert.equal(tor.streams[2].username,'a.example','an expired claim (and hint) is ignored: the tab’s site');
 }finally{iso.close('tab-9');tor.server.close();}
});

test('Chromium partitions sockets by top-level site, which per-site circuits in a Tor window rely on',()=>{
 const {NETWORK_PARTITION_FEATURES}=require('../desktop/browser-services/engine-features.cjs');
 assert.ok(NETWORK_PARTITION_FEATURES.includes('PartitionConnectionsByNetworkIsolationKey'));
 const enabled=[];const app={isReady:()=>false,commandLine:{getSwitchValue:()=>'',appendSwitch:(key,value)=>{if(key==='enable-features')enabled.push(...value.split(','));},removeSwitch(){}}};
 require('../desktop/browser-services/engine-features.cjs').configureEngineFeatures({app,thirdPartyCookies:'allow'});
 for(const feature of NETWORK_PARTITION_FEATURES)assert.ok(enabled.includes(feature),feature+' is on whatever the cookie choice');
});
