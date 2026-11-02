'use strict';
// New Tor identity (R3 tor-identity pass): the engine's NEWNYM handling against a fake tor that speaks the control protocol, including tor's own
// 10 s rate limit (here shortened), plus source tripwires for the main-process wiring (desktop/main.cjs is one closure the unit tests cannot enter).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createTorEngine}=require('../desktop/browser-services/tor-engine.cjs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');

/** A tor that answers the control commands the engine sends. NEWNYM follows control-spec: applied at once, or (inside `rate` ms of the last applied one) acknowledged now and applied later. */
function fakeTor({rate=300}={}){
 const log=[],sockets=new Set();let lastApplied=0,pending=null,server=null,applied=0;
 const apply=()=>{pending=null;lastApplied=Date.now();applied++;for(const s of sockets)s.write('650 SIGNAL NEWNYM\r\n');};
 function spawnTor(_file,args){
  const argument=name=>args[args.indexOf(name)+1];
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;
  child.kill=()=>{if(child.exitCode===null){child.exitCode=0;child.emit('exit',0);}server?.close();for(const s of sockets)s.destroy();};
  server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';
   socket.on('data',chunk=>{buffer+=chunk.toString('latin1');let index;while((index=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+2);log.push(line.split(' ').slice(0,2).join(' '));
    if(line==='GETINFO net/listeners/socks')socket.write('250-net/listeners/socks="127.0.0.1:9055"\r\n250 OK\r\n');
    else if(line==='GETINFO status/bootstrap-phase')socket.write('250-status/bootstrap-phase=NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"\r\n250 OK\r\n');
    else if(line==='SIGNAL NEWNYM'){const now=Date.now();if(!lastApplied||now-lastApplied>=rate){apply();socket.write('250 OK\r\n');}else{socket.write('250 OK\r\n');if(!pending)pending=setTimeout(apply,rate-(now-lastApplied));}}
    else socket.write('250 OK\r\n');}});});
  server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(argument('--ControlPortWriteToFile'),`PORT=127.0.0.1:${server.address().port}\n`);fs.writeFileSync(argument('--CookieAuthFile'),crypto.randomBytes(32));});
  return child;
 }
 return {spawnTor,log,newnyms:()=>log.filter(line=>line==='SIGNAL NEWNYM').length,applied:()=>applied,stop:()=>{clearTimeout(pending);for(const s of sockets)s.destroy();server?.close();}};
}
async function readyEngine({rate=300,margin=800,engineRate=rate}={}){
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-identity-')),exe=path.join(userData,'tor-fake.exe');fs.writeFileSync(exe,'fake');
 const sha=crypto.createHash('sha256').update('fake').digest('hex'),tor=fakeTor({rate});
 const engine=createTorEngine({userData,spawnTor:tor.spawnTor,executable:()=>exe,updated:()=>({file:exe,sha256:sha}),timeouts:{newnymRate:engineRate,newnymMargin:margin}});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('fake tor never became ready: '+JSON.stringify(engine.status()))),8000);const off=engine.onStatus(status=>{if(status.state==='ready'){clearTimeout(timer);off();resolve();}if(status.state==='error'){clearTimeout(timer);off();reject(new Error('engine error '+status.error.code));}});void engine.warm();});
 return {engine,tor,done:()=>{engine.stop();tor.stop();fs.rmSync(userData,{recursive:true,force:true});}};
}

test('New Tor identity returns only after tor has applied it; a second one inside tor’s rate limit waits for the real application',async()=>{
 const {engine,tor,done}=await readyEngine({rate:350});
 try{
  const first=await engine.newIdentity();
  assert.equal(first.ok,true);assert.equal(first.applied,true);assert.equal(first.delayed,false,'nothing held it back');assert.equal(tor.applied(),1);
  const started=Date.now(),second=await engine.newIdentity(),waited=Date.now()-started;
  assert.equal(second.delayed,true,'the second request fell inside the rate limit');assert.equal(second.applied,true,'and still waited for tor’s confirmation');
  assert.ok(waited>=250,`it must not come back before tor applied it (came back after ${waited} ms)`);assert.equal(tor.applied(),2);
 }finally{done();}
});

test('two New Tor identity requests at once share one NEWNYM application and both wait for it',async()=>{
 const {engine,tor,done}=await readyEngine({rate:300});
 try{
  await engine.newIdentity();const before=tor.applied();
  const results=await Promise.all([engine.newIdentity(),engine.newIdentity()]);
  assert.ok(results.every(r=>r.applied&&r.delayed));assert.equal(tor.applied()-before,1,'tor collapses requests inside its limit into one application');
 }finally{done();}
});

test('an identity that tor never confirms still ends (applied:false) instead of hanging the confirmation',async()=>{
 const {engine,tor,done}=await readyEngine({rate:20000,engineRate:200,margin:150});
 try{
  await engine.newIdentity();const started=Date.now(),second=await engine.newIdentity();
  assert.equal(second.applied,false);assert.ok(Date.now()-started<2000,'it gave up after the limit plus the margin, not after tor’s real 20 s');
 }finally{done();}
});

test('closing the Tor tabs a New Tor identity just replaced does not send a second NEWNYM, but closing tabs that browsed does',async()=>{
 const {engine,tor,done}=await readyEngine({rate:300});
 try{
  const release=engine.acquire('tab-a');await engine.newIdentity();const afterIdentity=tor.newnyms();
  await release();await new Promise(r=>setTimeout(r,120));
  assert.equal(tor.newnyms(),afterIdentity,'the old tab’s lease ending after the identity must not renew circuits again (tor would hold it back 10 s and swap circuits under the new tab)');
  const next=engine.acquire('tab-b');await next();await new Promise(r=>setTimeout(r,120));
  assert.equal(tor.newnyms(),afterIdentity+1,'a Tor tab that used the circuits and closed still renews them for the next one');
 }finally{done();}
});

test('a Tor that dies while an identity is waiting fails the request',async()=>{
 const {engine,tor,done}=await readyEngine({rate:20000,engineRate:5000,margin:3000});
 try{
  await engine.newIdentity();const pending=engine.newIdentity();setTimeout(()=>tor.stop(),50);
  await assert.rejects(pending,/connected/);
 }finally{done();}
});

// ---- the service (tor-window.cjs): ordering, gates, one at a time, honest failures ----
const {createTorWindows,TOR_SENTINEL_PROXY}=require('../desktop/browser-services/tor-window.cjs');
const tick=()=>new Promise(r=>setImmediate(r));
function fakeEngine(){const listeners=new Set();let status={state:'ready',progress:100,socksPort:2222,error:null,version:'0.4.9.14'},newnym=0;
 const engine={status:()=>({...status}),onStatus(fn){listeners.add(fn);return()=>listeners.delete(fn);},set(patch){status={...status,...patch};for(const fn of listeners)fn(status);},acquire(){return async()=>{};},retry(){},
  hook:null,fail:null,async newIdentity(){newnym++;if(engine.fail)throw engine.fail;await engine.hook?.();return {ok:true,delayed:false,applied:true};},newnyms:()=>newnym};return engine;}
function fakeSession(){const calls=[];let proxy=null;const s={calls,get proxy(){return proxy;},getUserAgent:()=>'Mozilla/5.0',setUserAgent(){},async setProxy(config){proxy=config;calls.push('setProxy');},async closeAllConnections(){calls.push('close');},
 async resolveProxy(){return proxy?.proxyRules.startsWith('socks5://')?'SOCKS5 '+proxy.proxyRules.slice(9):'DIRECT';},setPermissionRequestHandler(){},setPermissionCheckHandler(){},
 async clearStorageData(){calls.push('clearStorage');},async clearCache(){},async clearAuthCache(){},async clearHostResolverCache(){}};return s;}
function fakeBlocking(){const before=[];return {before,https:{setPrivate(){}},attach(){return {useBefore:h=>before.push(h),useHeaders(){}};}};}
async function rig(windows=['w1']){
 const engine=fakeEngine(),blocking=fakeBlocking(),sessions=windows.map(()=>fakeSession());const tor=createTorWindows({engine,contentBlocking:blocking,log:()=>{},contentsOf:()=>[]});
 for(const [index,id] of windows.entries())await tor.prepare({windowId:id,session:sessions[index],profileId:'private-'+id});
 engine.set({state:'ready',progress:100,socksPort:2222});await tick();await tick();await tick();
 return {engine,tor,sessions,gates:blocking.before};
}
const ask=(tor,ctx)=>tor.handle({type:'tor.new-identity'},{windowId:'w1',...ctx});

test('during a New Tor identity nothing reaches the network; the gates open on the new circuits only after the whole reset',async()=>{
 const {engine,tor,sessions,gates}=await rig(),[session]=sessions,gate=gates[0],order=[];
 assert.deepEqual(gate({url:'https://example.com/'}),{},'open before');
 let during=null;engine.hook=()=>{order.push('newnym');during={proxy:session.proxy,request:gate({url:'https://example.com/during'})};};
 const clear=session.clearStorageData;session.clearStorageData=async()=>{order.push('clear');return clear.call(session);};
 const reply=await ask(tor,{resetTabs:async()=>{order.push('reset');return ['token'];},announce:(token,info)=>order.push('announce:'+token+':'+info.cleared)});
 assert.deepEqual(order,['newnym','clear','reset','clear','announce:token:true'],'NEWNYM (waited), empty while the pages exist, close them, empty again, then tell the windows');
 assert.deepEqual(during.proxy,TOR_SENTINEL_PROXY,'while the identity runs the session sits on the dead sentinel proxy');
 assert.equal(typeof during.request.then,'function','a request made meanwhile waits at the gate');
 assert.deepEqual(await during.request,{},'and goes ahead once the gates reopen');
 assert.match(session.proxy.proxyRules,/^socks5:\/\/127\.0\.0\.1:\d+$/);assert.notEqual(session.proxy.proxyRules,'socks5://127.0.0.1:9');assert.deepEqual(gate({url:'https://example.com/after'}),{});assert.equal(reply.identity.cleared,true);
});

test('a page that keeps writing while the tabs close leaves nothing behind: sessions are emptied again after the tabs are gone',async()=>{
 const {tor,sessions}=await rig(),[session]=sessions;let cookie='old';
 session.clearStorageData=async()=>{cookie=null;};
 const reply=await ask(tor,{resetTabs:async()=>{cookie='written by a page that was still alive';return [];}});
 assert.equal(cookie,null);assert.equal(reply.identity.cleared,true);
});

test('two New Tor identity requests at once are one identity: one NEWNYM, one tab reset, both answered',async()=>{
 const {engine,tor}=await rig();let resets=0;engine.hook=()=>tick();
 const ctx={resetTabs:async()=>{resets++;return [];}};
 const [a,b]=await Promise.all([ask(tor,ctx),ask(tor,ctx)]);
 assert.equal(engine.newnyms(),1);assert.equal(resets,1);assert.equal(a.identity.ok,true);assert.equal(b.identity.ok,true);
 await ask(tor,ctx);assert.equal(engine.newnyms(),2,'a request after it finished is a new identity');assert.equal(resets,2);
});

test('while Tor is not connected nothing is shut or closed and the error says so in plain words',async()=>{
 const {engine,tor,sessions}=await rig(),[session]=sessions;engine.set({state:'connecting',progress:40,socksPort:0});await tick();await tick();
 const before=session.calls.length;let reset=0;
 await assert.rejects(()=>ask(tor,{resetTabs:async()=>{reset++;return [];}}),/Tor isn’t connected yet\./);
 assert.equal(reset,0);assert.equal(engine.newnyms(),0);assert.equal(session.calls.slice(before).includes('clearStorage'),false);
});

test('when tor refuses NEWNYM nothing is closed or cleared, the gates reopen, and the error is plain',async()=>{
 const {engine,tor,sessions,gates}=await rig(),[session]=sessions;engine.fail=new Error('552 Unrecognized signal');let reset=0,cleared=0;session.clearStorageData=async()=>{cleared++;};
 await assert.rejects(()=>ask(tor,{resetTabs:async()=>{reset++;return [];}}),/Tor couldn’t switch to new routes\. Nothing was closed\./);
 assert.equal(reset,0);assert.equal(cleared,0);assert.match(session.proxy.proxyRules,/^socks5:\/\/127\.0\.0\.1:\d+$/,'the gate is open again');assert.notEqual(session.proxy.proxyRules,'socks5://127.0.0.1:9');assert.deepEqual(gates[0]({url:'https://example.com/'}),{});
 engine.fail=null;const reply=await ask(tor,{resetTabs:async()=>{reset++;return [];}});assert.equal(reply.identity.ok,true);assert.equal(reset,1);
});

test('every Tor session is tried even when one fails to clear, and the tabs stay until all of them cleared',async()=>{
 const {tor,sessions}=await rig(['w1','w2','w3']);let reset=0;const tried=[];
 sessions[0].clearStorageData=async()=>{tried.push(0);throw new Error('disk');};sessions[1].clearStorageData=async()=>{tried.push(1);};sessions[2].clearStorageData=async()=>{tried.push(2);};
 await assert.rejects(()=>ask(tor,{resetTabs:async()=>{reset++;return [];}}),/Site data couldn’t be cleared, so your Tor tabs are still open/);
 assert.deepEqual(tried,[0,1,2],'the failure of one does not skip the others');assert.equal(reset,0);
});

test('site data that survives after the tabs closed is reported, not hidden: the answer says cleared:false and every window is told',async()=>{
 const {tor,sessions}=await rig();let n=0,told=null;sessions[0].clearStorageData=async()=>{if(++n===2)throw new Error('late failure');};
 const reply=await ask(tor,{resetTabs:async()=>['window'],announce:(token,info)=>{told={token,info};}});
 assert.equal(reply.identity.cleared,false);assert.deepEqual(told,{token:['window'],info:{cleared:false}});
});

// ---- main.cjs / interface wiring (source tripwires: main.cjs is one closure) ----
test('each window resets its Tor tabs without disturbing ordinary ones: the fresh tab takes the old place and is shown only if a Tor tab was',()=>{
 const body=/async resetTor\(\)\{[\s\S]*?return true;\},/.exec(read('desktop/main.cjs'))[0];
 assert.match(body,/wasActive=old\.includes\(state\.activeTabId\)/);
 assert.match(body,/afterId:old\[old\.length-1\],background:!wasActive/,'the fresh Tor tab opens where the old ones were and in the background when the person is on an ordinary tab');
 assert.match(body,/isTorSession\(popup\.webContents\.session\)\)popup\.destroy\(\)/,'pop-ups of Tor pages close first');
 assert.match(body,/if\(torMode\)peek\.close\(\)/,'Peek in a Tor window closes');
 assert.match(body,/await Promise\.all\(gone\)/,'it waits until the old pages are really gone');
 assert.match(body,/downloads\.remove/,'a download the identity cut short does not linger in the list');
 assert.doesNotMatch(body,/type:'toast'/,'the success toast is raised once everything was cleared (announce), not before');
 const main=read('desktop/main.cjs');
 assert.match(main,/announce:\(reset,\{cleared\}\)=>\{for\(const other of reset\|\|\[\]\)try\{other\.toast\(tm\(cleared\?'main\.newTorIdentityEarlierTabs':'tor\.identity\.partial'\),\{tone:cleared\?'info':'error'\}\)/);
});

test('"Private cleanup is still finishing." only appears if cleanup is still unfinished a few seconds later, never right before its own retry succeeds',()=>{
 const main=read('desktop/main.cjs');
 assert.match(main,/privateCleanupTimers=new Map\(\)/);
 assert.match(main,/const timer=setTimeout\(\(\)=>\{privateCleanupTimers\.delete\(status\.profileId\);if\(!privateCleanupNotices\.has\(status\.profileId\)\)return;[^\n]*Private cleanup is still finishing\.'\);\},4000\)/,'the notice waits');
 assert.match(main,/privateCleanupNotices\.delete\(status\.profileId\);clearTimeout\(privateCleanupTimers\.get\(status\.profileId\)\)/,'and a completed cleanup cancels it');
});

test('the shortcut asks again when the Tor panel is already open (after Cancel, or on the status): the open panel is closed and a fresh one asks',()=>{
 const main=read('desktop/main.cjs');
 assert.match(main,/case 'tor-identity':[^\n]*if\(layout\.overlay\?\.kind==='tor'\)\{closeOverlay\(true\);setTimeout\(ask,90\);\}else ask\(\);/);
});

test('the menu row asks for confirmation like the shortcut does: the native popup does not drop its target',()=>{
 const app=read('src/App.tsx');
 assert.match(app,/onOpen=\{\(kind, id\) => kind === 'tor' && id === 'identity' \? void runtime\.native\?\.\(\{ type: 'shortcuts\.run', id: 'tor-identity' \}\)/,'the overlay copy of the menu runs the same command as Ctrl+Shift+U (a bare ui:open would drop the intent and open the status panel)');
});

test('the Tor panel asks only about a connected Tor, shows work in progress, stays on its question when it fails, and says what happens to a download',()=>{
 const panel=read('src/features/tor/TorPopover.tsx'),page=read('src/features/tor/TorNewTab.tsx'),client=read('src/features/tor/torClient.ts');
 assert.match(panel,/if \(status && status\.state !== 'ready'\) setAsking\(false\)/,'opened while connecting: status, not a question that appears later by itself');
 assert.match(panel,/busy \? t\('tor\.identity\.working'\) : t\('tor\.identity\.confirm'\)/);assert.match(panel,/aria-busy=\{busy \|\| undefined\}/);
 assert.match(panel,/\.finally\(\(\) => setBusy\(false\)\)/);assert.doesNotMatch(panel,/setBusy\(false\); setAsking\(false\)/,'a failed identity does not drop back to the status panel');
 assert.match(panel,/torDownloadsActive\(state\) && <> \{t\('tor\.identity\.downloads'\)\}<\/>/);
 assert.match(page,/busy && confirming \? t\("tor\.identity\.working"\)/);assert.match(page,/confirming && downloading && <p className="tor-pop-note">/);
 assert.match(client,/\['Downloading', 'Paused'\]\.includes\(item\.status\)/);
 assert.match(read('src/features/FrostWorkspace.tsx'),/downloading=\{torDownloadsActive\(state\)\}/);
});

test('every string a New Tor identity can show is in all 13 catalogs, the question says what really happens, and failures are plain',()=>{
 const need=['tor.identity.body','tor.identity.notReady','tor.identity.failed','tor.identity.cleanupFailed','tor.identity.partial','tor.identity.working','tor.identity.downloads','main.newTorIdentityEarlierTabs'];
 const locales=fs.readdirSync(path.join(__dirname,'..','src','i18n')).filter(name=>/^[a-z]{2}(?:-[A-Z]{2})?\.json$/.test(name));assert.equal(locales.length,13);
 for(const name of locales){const catalog=JSON.parse(read('src/i18n/'+name));for(const id of need)assert.ok(catalog[id],`${name} lacks ${id}`);}
 const en=JSON.parse(read('src/i18n/en.json'));
 assert.match(en['tor.identity.body'],/every window/,'it closes the Tor tabs of every window, and says so');assert.doesNotMatch(en['tor.identity.body'],/Tor tabs and windows/,'Tor windows are not closed: only their tabs are');
 assert.match(en['tor.identity.body'],/Other tabs aren’t touched/);assert.match(en['tor.identity.cleanupFailed'],/still open/);assert.match(en['tor.identity.failed'],/Nothing was closed/);
});
