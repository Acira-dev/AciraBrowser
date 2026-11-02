'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createMacPasskeys,nativeBridge}=require('../desktop/browser-services/mac-passkeys.cjs');
const {input,request,result}=require('./fixtures/passkey/records.cjs');
function fixture({available=true,platform='darwin',answer,owner={}}={}){
 const handlers=new Map(),events=new Map(),calls=[],cancelled=[];
 const ipcMain={on:(name,fn)=>events.set(name,fn),handle:(name,fn)=>handlers.set(name,fn)};
 const frame={url:'https://accounts.google.com/path',isDestroyed:()=>false};
 const wc=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:frame});
 const window={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>true,getNativeWindowHandle:()=>Buffer.alloc(8)};
 const current={window,active:true,...owner};
 const native={support:()=>({available}),start:async(handle,value)=>{calls.push(value);return answer?answer(value):result(value);},cancel:id=>cancelled.push(id)};
 const service=createMacPasskeys({ipcMain,native,platform});service.attach(wc,()=>current);
 const event={sender:wc,senderFrame:frame};
 const ready=()=>{events.get('acira:mac-passkey-ready')(event);return event.returnValue;};
 return {service,event,frame,wc,window,current,calls,cancelled,ready,start:(value=input())=>handlers.get('acira:mac-passkey-start')(event,value),cancel:id=>handlers.get('acira:mac-passkey-cancel')(event,id)};
}
test('unsigned/unapproved builds, other platforms and unowned frames never open a native request',async()=>{
 for(const setup of [{available:false},{platform:'win32'},{platform:'linux'},{owner:{tor:true}},{owner:{certificateException:true}}]){const f=fixture(setup);assert.equal(f.ready(),false);assert.equal((await f.start()).ok,false);assert.equal(f.calls.length,0);}
 const f=fixture();f.event.senderFrame={...f.frame};assert.equal(f.ready(),false);assert.equal((await f.start()).ok,false);
});
test('a background tab can prepare its API, but only a visible focused owned page can start a request',async()=>{
 const f=fixture({owner:{active:false}});assert.equal(f.ready(),true);assert.equal((await f.start()).ok,false);assert.equal(f.calls.length,0);
 f.current.active=true;f.window.isFocused=()=>false;assert.equal((await f.start()).ok,false);
 f.window.isFocused=()=>true;assert.equal((await f.start()).ok,true);assert.equal(f.calls[0].origin,'https://accounts.google.com');
});
test('navigation, renderer destruction and abort cancel only the matching request; late native replies cannot escape',async()=>{
 for(const reason of ['will-navigate','destroyed','abort']){
  let complete;const f=fixture({answer:()=>new Promise(resolve=>{complete=resolve;})});
  const pending=f.start();await Promise.resolve();
  assert.equal(f.calls.length,1);assert.equal((await f.start()).ok,false,'one system request at a time');
  if(reason==='abort')await f.cancel(input().id);else f.wc.emit(reason);
  assert.equal((await pending).name,'AbortError');assert.deepEqual(f.cancelled,[input().id]);
  complete(result(request()));await Promise.resolve();
 }
});
test('an immediate abort never starts the native provider and stale origins never receive an assertion',async()=>{
 const f=fixture();const pending=f.start();await f.cancel(input().id);assert.equal((await pending).name,'AbortError');assert.equal(f.calls.length,0);
 let complete;const g=fixture({answer:()=>new Promise(resolve=>{complete=resolve;})});const old=g.start();await Promise.resolve();g.frame.url='https://other.example';complete(result(request()));assert.equal((await old).name,'AbortError');
});
test('compiled Mac passkey bridge probes its signing gate without requesting credentials',t=>{
 if(process.platform!=='darwin')return t.skip('Mac native bridge');
 const bridge=nativeBridge();assert.ok(bridge);const state=bridge.support();assert.equal(typeof state.supported,'boolean');assert.equal(typeof state.entitled,'boolean');assert.equal(state.available,state.supported&&state.entitled);
 const raw=require('../desktop/native/build/mac-material.node');
 assert.throws(()=>raw.passkeyStart('not a handle','{}'),/Invalid native/);
 if(!state.available)return bridge.start(Buffer.alloc(8),input()).then(value=>assert.equal(value.ok,false));
});
test('real sandboxed Electron preload and IPC preserve the disabled path and round-trip synthetic assertions and registrations',t=>{
 if(process.platform!=='darwin')return t.skip('Mac sandbox fixture');
 const path=require('node:path'),{spawnSync}=require('node:child_process'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(require('electron'),[path.join(__dirname,'fixtures/passkey/mac-run.cjs')],{env,encoding:'utf8',timeout:60000});
 const line=run.stdout?.split(/\r?\n/).find(value=>value.startsWith('RESULT '));
 assert.equal(run.status,0,(run.stderr||run.stdout||'').slice(-2000));assert.ok(line,(run.stdout||'').slice(-2000));
 const value=JSON.parse(line.slice(7));assert.equal(value.simulatedAuthenticator,true);
 assert.equal(value.realSupport.available,false,'fixture runs under the ordinary unapproved Electron binary');
 assert.equal(value.disabled.secure,true);assert.equal(value.disabled.unchanged,true);assert.equal(value.disabled.nodeExposed,false);
 assert.equal(value.enabled.secure,true);assert.equal(value.enabled.assertion,true);assert.equal(value.enabled.registration,true);assert.equal(value.enabled.algorithm,-7);
 assert.equal(value.enabled.client.origin,'https://passkey.test');assert.equal(value.enabled.client.type,'webauthn.get');
 assert.equal(value.enabled.conditional,false);assert.equal(value.enabled.nodeExposed,false);assert.equal(value.enabled.bridgeExposed,false);assert.deepEqual(value.calls,['get','create']);
});
