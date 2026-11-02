'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createTorWindows,localTarget,isOnion,hardenHeaders,phaseText,TOR_SENTINEL_PROXY,TOR_DENIED_PERMISSIONS,TOR_SETTINGS}=require('../desktop/browser-services/tor-window.cjs');

function fakeEngine(){const listeners=new Set();let status={state:'idle',progress:0,socksPort:0,error:null,version:'0.4.9.14'},leases=0,newnym=0;
 return {status:()=>({...status}),onStatus(fn){listeners.add(fn);return()=>listeners.delete(fn);},set(patch){status={...status,...patch};for(const fn of listeners)fn(status);},
  acquire(){leases++;return async()=>{leases--;};},leases:()=>leases,retry(){},async newIdentity(){newnym++;return {ok:true,delayed:false};},newnyms:()=>newnym};}
function fakeSession({resolveTo}={}){const calls=[];let proxy=null;const s={calls,get proxy(){return proxy;},
 getUserAgent:()=>'Mozilla/5.0',setUserAgent(){},async setProxy(config){proxy=config;calls.push(['setProxy',config.proxyRules]);},async closeAllConnections(){calls.push(['close']);},
 async resolveProxy(){return resolveTo||(proxy?.proxyRules.startsWith('socks5://')?'SOCKS5 '+proxy.proxyRules.slice(9):'DIRECT');},
 setPermissionRequestHandler(handler){s.requestHandler=handler;},setPermissionCheckHandler(handler){s.checkHandler=handler;},
 async clearStorageData(){calls.push(['clearStorage']);},async clearCache(){calls.push(['clearCache']);},async clearAuthCache(){},async clearHostResolverCache(){}};return s;}
function fakeBlocking(){const before=[],headers=[];return {before,headers,https:{setPrivate(session,value){session.httpsOnly=value;}},attach(session){session.attached=(session.attached||0)+1;return {useBefore:h=>before.push(h),useHeaders:h=>headers.push(h)};}};}
const tick=()=>new Promise(r=>setImmediate(r));

test('Tor windows never ask for loopback, private-network or LAN names',()=>{
 for(const host of ['localhost','127.0.0.1','[::1]','10.0.0.8','192.168.1.1','172.20.0.1','169.254.1.1','100.64.0.1','fd00::1','fe80::1','printer','nas.local','router.lan','x.home.arpa','0.0.0.0','224.0.0.251'])assert.equal(localTarget(host),true,host);
 for(const host of ['example.com','check.torproject.org','duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion','1.1.1.1','2606:4700::1111'])assert.equal(localTarget(host),false,host);
 assert.equal(isOnion('abc.onion'),true);assert.equal(isOnion('onion.example'),false);
});

test('document responses turn DNS prefetch off and Link-header hints that would resolve outside Tor are dropped',()=>{
 const out=hardenHeaders({'content-type':['text/html'],link:['<https://cdn.example>; rel=preconnect, <https://a.example/s.css>; rel=preload; as=style, <//dns.example>; rel="dns-prefetch"'],'x-dns-prefetch-control':['on']},true);
 assert.deepEqual(out['X-DNS-Prefetch-Control'],['off']);assert.equal(out['x-dns-prefetch-control'],undefined);
 assert.deepEqual(out.link,['<https://a.example/s.css>; rel=preload; as=style']);
 assert.equal(hardenHeaders({'content-type':['image/png']},false),null);
});

test('plain phase words replace tor’s jargon',()=>{
 assert.equal(phaseText({state:'connecting',progress:10}),'Connecting to the Tor network');
 assert.equal(phaseText({state:'connecting',progress:50}),'Loading the network directory');
 assert.equal(phaseText({state:'connecting',progress:90}),'Building a private circuit');
 assert.equal(phaseText({state:'ready',progress:100}),'Connected');
});

test('a Tor window looks like Tor and searches with DuckDuckGo',()=>{
 assert.equal(TOR_SETTINGS.searchEngine,'duckduckgo');assert.match(TOR_SETTINGS.browserTint,/^#[0-9a-f]{6}$/i);assert.notEqual(TOR_SETTINGS.colorPreset,'');
});

test('nothing loads before Tor is ready, then only through the verified SOCKS port',async()=>{
 const engine=fakeEngine(),blocking=fakeBlocking(),session=fakeSession(),events=[];
 const tor=createTorWindows({engine,contentBlocking:blocking,log:()=>{},contentsOf:()=>[]});
 await tor.prepare({windowId:'w1',session,profileId:'private-1',emit:e=>events.push(e)});
 assert.equal(session.__aciraTor,true);assert.equal(tor.isTorSession(session),true);
 assert.deepEqual(session.proxy,TOR_SENTINEL_PROXY);assert.equal(session.proxy.proxyBypassRules,'<-loopback>');
 assert.equal(session.httpsOnly,true);assert.equal(engine.leases(),1);
 const gate=blocking.before.at(-1);
 assert.deepEqual(gate({url:'http://127.0.0.1:8080/'}),{cancel:true});
 assert.deepEqual(gate({url:'data:text/plain,hi'}),{});
 const waiting=gate({url:'https://check.torproject.org/'});assert.equal(typeof waiting.then,'function');
 let settled=null;waiting.then(v=>{settled=v;});await tick();assert.equal(settled,null);
 engine.set({state:'connecting',progress:50});await tick();assert.equal(settled,null);
 engine.set({state:'ready',progress:100,socksPort:54321});await tick();await tick();await tick();
 assert.deepEqual(settled,{});assert.match(session.proxy.proxyRules,/^socks5:\/\/127\.0\.0\.1:\d+$/,'the per-site relay (tor-isolation.cjs) in front of tor');assert.notEqual(session.proxy.proxyRules,'socks5://127.0.0.1:9','off the sentinel, onto the per-site relay in front of tor 54321');
 assert.deepEqual(gate({url:'https://example.com/'}),{});
 assert.ok(events.some(e=>e.type==='tor-status'&&e.status.state==='ready'));
 // Tor stops: the gate closes and the session goes back to the dead sentinel.
 engine.set({state:'error',socksPort:0,error:{code:'crashed',title:'Tor stopped unexpectedly',detail:'x'}});await tick();await tick();
 assert.deepEqual(session.proxy,TOR_SENTINEL_PROXY);assert.deepEqual(gate({url:'https://example.com/'}),{cancel:true});
 await tor.release('w1');assert.equal(engine.leases(),0);assert.deepEqual(gate({url:'https://example.com/'}),{cancel:true});
});

test('a proxy that does not verify as Tor keeps the gate shut',async()=>{
 const engine=fakeEngine(),blocking=fakeBlocking(),session=fakeSession({resolveTo:'DIRECT'});
 const tor=createTorWindows({engine,contentBlocking:blocking,log:()=>{},contentsOf:()=>[]});
 await tor.prepare({windowId:'w1',session,profileId:'private-1'});const gate=blocking.before.at(-1);
 const waiting=gate({url:'https://example.com/'});engine.set({state:'ready',progress:100,socksPort:1111});
 assert.deepEqual(await waiting,{cancel:true});assert.deepEqual(session.proxy,TOR_SENTINEL_PROXY);
});

test('identifying permissions stay denied whatever handler the permission service installs',async()=>{
 const engine=fakeEngine(),session=fakeSession();const tor=createTorWindows({engine,contentBlocking:fakeBlocking(),log:()=>{},contentsOf:()=>[]});
 await tor.prepare({windowId:'w1',session,profileId:'private-1'});
 session.setPermissionRequestHandler((wc,permission,callback)=>callback(true));session.setPermissionCheckHandler(()=>true);
 for(const permission of TOR_DENIED_PERMISSIONS){let answer;session.requestHandler(null,permission,v=>{answer=v;});assert.equal(answer,false,permission);assert.equal(session.checkHandler(null,permission),false,permission);}
 let media;session.requestHandler(null,'media',v=>{media=v;});assert.equal(media,true);
});

test('WebRTC is locked to proxied UDP for every webContents in a Tor session',async()=>{
 const app=new EventEmitter(),engine=fakeEngine(),session=fakeSession();const tor=createTorWindows({app,engine,contentBlocking:fakeBlocking(),log:()=>{},contentsOf:()=>[]});
 await tor.prepare({windowId:'w1',session,profileId:'private-1'});
 const policies=[];const wc={session,setWebRTCIPHandlingPolicy(p){policies.push(p);}};app.emit('web-contents-created',{},wc);
 wc.setWebRTCIPHandlingPolicy('default_public_interface_only');
 assert.deepEqual(policies,['disable_non_proxied_udp','disable_non_proxied_udp']);
 const other={session:fakeSession(),setWebRTCIPHandlingPolicy(p){policies.push('other:'+p);}};app.emit('web-contents-created',{},other);other.setWebRTCIPHandlingPolicy('default_public_interface_only');
 assert.equal(policies.at(-1),'other:default_public_interface_only');
});

test('New Tor identity sends NEWNYM, clears the window’s session and resets its tabs',async()=>{
 const engine=fakeEngine(),session=fakeSession();const tor=createTorWindows({engine,contentBlocking:fakeBlocking(),log:()=>{},contentsOf:()=>[]});
 await tor.prepare({windowId:'w1',session,profileId:'private-1'});engine.set({state:'ready',progress:100,socksPort:2222});
 let reset=0;const reply=await tor.handle({type:'tor.new-identity'},{windowId:'w1',resetTabs:()=>reset++});
 assert.equal(reply.identity.ok,true);assert.equal(engine.newnyms(),1);assert.equal(reset,1);assert.ok(session.calls.some(c=>c[0]==='clearStorage'));
 assert.throws(()=>tor.handle({type:'tor.new-identity'},{windowId:'not-tor'}),/Tor window or tab/);assert.equal(tor.handle({type:'tor.status'},{windowId:'not-tor'}).tor.state,'ready');
});

test('favicons for the UI only come through a Tor session',async()=>{
 const tor=createTorWindows({engine:fakeEngine(),contentBlocking:fakeBlocking(),log:()=>{},contentsOf:()=>[]});
 assert.equal(await tor.favicon(fakeSession(),'https://example.com/favicon.ico'),'');
});

test('proxy settings leave a Tor session alone and still reset ordinary ones to the system proxy',async()=>{
 const {createProxySettings}=require('../desktop/browser-services/proxy-settings.cjs');
 const make=extra=>{const calls=[];return {calls,...extra,getUserAgent:()=>'Mozilla/5.0',setUserAgent(){},async setProxy(config){calls.push(config);},async closeAllConnections(){}};};
 const service=createProxySettings({database:{policy:()=>null,setPolicy(){}},getContext(){},getWindow(){},dialog:{showMessageBox:async()=>({response:1})}});
 const tor=make({__aciraTor:true}),ordinary=make({});
 await service.attach(tor,'private-t',true);await service.attach(ordinary,'private-o',true);
 assert.equal(tor.calls.length,0);assert.ok(ordinary.calls.length>0);
});

test('a Tor tab’s page that already exists is locked to proxied UDP when its session is prepared',async()=>{
 const engine=fakeEngine(),session=fakeSession(),policies=[];const wc={session,setWebRTCIPHandlingPolicy(p){policies.push(p);}};
 const tor=createTorWindows({engine,contentBlocking:fakeBlocking(),log:()=>{},contentsOf:s=>s===session?[wc]:[]});
 const prepared=tor.prepareTab({key:'private-tab:1',session,profileId:'private-tab-1',tabId:'tab-1',emit:()=>{}});
 await tick();wc.setWebRTCIPHandlingPolicy('default_public_interface_only');
 assert.deepEqual(policies,['disable_non_proxied_udp','disable_non_proxied_udp']);
 let done=false;prepared.then(()=>{done=true;});await tick();assert.equal(done,false,'the page waits for Tor');
 engine.set({state:'ready',progress:100,socksPort:3333});await prepared;assert.match(session.proxy.proxyRules,/^socks5:\/\/127\.0\.0\.1:\d+$/);
 await tor.releaseTab({key:'private-tab:1'});assert.equal(engine.leases(),0);
});

test('a Tor tab whose Tor fails never loads (prepare rejects)',async()=>{
 const engine=fakeEngine(),session=fakeSession();const tor=createTorWindows({engine,contentBlocking:fakeBlocking(),log:()=>{},contentsOf:()=>[]});
 const prepared=tor.prepareTab({key:'private-tab:2',session,profileId:'private-tab-2',tabId:'tab-2',emit:()=>{}});
 await tick();engine.set({state:'error',socksPort:0,error:{code:'unreachable',title:'x',detail:'y'}});
 await assert.rejects(prepared,/Tor is not connected/);assert.deepEqual(session.proxy,TOR_SENTINEL_PROXY);
});

test('New Tor identity preserves the old tabs and rejects when native storage cleanup fails, then can retry',async()=>{
 const engine=fakeEngine(),session=fakeSession();const tor=createTorWindows({engine,contentBlocking:fakeBlocking(),log:()=>{},contentsOf:()=>[]});
 await tor.prepare({windowId:'w1',session,profileId:'private-1'});engine.set({state:'ready',progress:100,socksPort:2222});await tick();await tick();
 let reset=0,failClear=true,privateData='old-session-cookie',authFinished=false;
 session.clearStorageData=async()=>{if(failClear)throw new Error('native storage cleanup failed');privateData=null;};
 session.clearAuthCache=async()=>{await tick();authFinished=true;};
 const request=()=>tor.handle({type:'tor.new-identity'},{windowId:'w1',resetTabs:()=>reset++});
 await assert.rejects(request(),/Site data couldn’t be cleared, so your Tor tabs are still open/);
 assert.equal(privateData,'old-session-cookie');assert.equal(reset,0,'old tabs must remain when site data could not be cleared');
 assert.equal(authFinished,true,'all requested cleanup has settled before failure is returned');
 failClear=false;const reply=await request();
 assert.equal(reply.identity.ok,true);assert.equal(privateData,null);assert.equal(reset,1);assert.equal(engine.newnyms(),2);
 await tor.release('w1');
});
test('one Tor connection serves every Tor tab and window: watch() reports live status, warm() starts at once, a second Tor session never starts a second Tor',async()=>{
 const engine=fakeEngine();let warms=0;engine.warm=()=>{warms++;return Promise.resolve();};
 const tor=createTorWindows({engine,contentBlocking:fakeBlocking(),log:()=>{},contentsOf:()=>[]});
 const seen=[],off=tor.watch(status=>seen.push(status.state+':'+status.progress));
 assert.deepEqual(seen,['idle:0'],'the listener gets the current status at once');
 tor.warm();assert.equal(warms,1,'a new Tor tab starts Tor before its page exists');
 engine.set({state:'connecting',progress:40,socksPort:0});engine.set({state:'ready',progress:100,socksPort:3333});
 assert.deepEqual(seen,['idle:0','connecting:40','ready:100']);
 const one=fakeSession(),two=fakeSession();
 await tor.prepareTab({key:'private-tab:a',session:one,profileId:'private-tab-a',tabId:'a',emit:()=>{}});
 await tor.prepareTab({key:'private-tab:b',session:two,profileId:'private-tab-b',tabId:'b',emit:()=>{}});
 assert.equal(engine.leases(),2,'two Tor tabs, two leases, one engine');assert.equal(warms,1,'the second tab did not start Tor again');
 assert.match(one.proxy.proxyRules,/^socks5:\/\/127\.0\.0\.1:\d+$/);assert.match(two.proxy.proxyRules,/^socks5:\/\/127\.0\.0\.1:\d+$/);assert.notEqual(one.proxy.proxyRules,two.proxy.proxyRules,'each Tor session has its own relay in front of the one tor');
 off();engine.set({state:'ready',progress:100,socksPort:3333});assert.equal(seen.length,3,'unsubscribed');
 await tor.releaseTab({key:'private-tab:a'});await tor.releaseTab({key:'private-tab:b'});
});

test('New Tor identity renews every Tor session in the app, and works from a Tor tab that has not loaded a page yet',async()=>{
 const engine=fakeEngine(),a=fakeSession(),b=fakeSession();const tor=createTorWindows({engine,contentBlocking:fakeBlocking(),log:()=>{},contentsOf:()=>[]});
 await tor.prepare({windowId:'w1',session:a,profileId:'private-1'});await tor.prepare({windowId:'w2',session:b,profileId:'private-2'});engine.set({state:'ready',progress:100,socksPort:4444});await tick();await tick();
 let reset=0;
 await assert.rejects(()=>Promise.resolve().then(()=>tor.handle({type:'tor.new-identity'},{windowId:'ordinary',resetTabs:()=>reset++})),/isn’t a Tor window or tab/,'an ordinary window without Tor tabs is refused');
 const reply=await tor.handle({type:'tor.new-identity'},{windowId:'w3',inTor:true,resetTabs:()=>reset++});
 assert.equal(reply.identity.ok,true);assert.equal(reset,1,'tabs are replaced once, by the caller, for every window');assert.equal(engine.newnyms(),1,'one NEWNYM serves the one connection');
 for(const session of [a,b])assert.ok(session.calls.some(call=>call[0]==='clearStorage'),'every Tor session was cleared, not only the asking window');
 await tor.release('w1');await tor.release('w2');
});
