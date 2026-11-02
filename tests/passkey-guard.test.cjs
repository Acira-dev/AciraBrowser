'use strict';
// Passkey guard (R3-37, P0 28 Oct; off by default): with "Passkeys and security keys" off no passkey request reaches Windows at all; with it on,
// Windows' passkey dialog only opens after a fresh press on the page that asks for it, and background and conditional (autofill) requests are
// answered quietly the way Chrome answers them with no passkey to offer. Passwords are untouched. The switch is read at every call (live).
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const PRELOAD=path.join(__dirname,'..','desktop','browser-services','passkey-guard-preload.cjs');
const source=fs.readFileSync(PRELOAD,'utf8'),GUARD=/const guard = (function \(allowed\) \{[\s\S]*?\n\});\r?\n/.exec(source)[1];

// A stand-in window: Chromium's credential calls are recorded instead of reaching Windows; press() is a real click (a trusted event plus
// transient activation, as Chromium gives); lapse() is the 5-second activation window running out.
const WINDOW=`
var calls = [], listeners = {};
function CredentialsContainer() {}
CredentialsContainer.prototype.get = function get(options) { calls.push('get' + (options && options.mediation ? ':' + options.mediation : '')); return Promise.resolve('GOT'); };
CredentialsContainer.prototype.create = function create(options) { calls.push('create' + (options && options.mediation ? ':' + options.mediation : '')); return Promise.resolve('CREATED'); };
function PublicKeyCredential() {}
PublicKeyCredential.isConditionalMediationAvailable = function isConditionalMediationAvailable() { return Promise.resolve(true); };
PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = function isUserVerifyingPlatformAuthenticatorAvailable() { return Promise.resolve(true); };
PublicKeyCredential.getClientCapabilities = function getClientCapabilities() { return Promise.resolve({ conditionalGet: true, conditionalCreate: true, passkeyPlatformAuthenticator: true, hybridTransport: true }); };
var DOMException = class DOMException extends Error { constructor(message, name) { super(message); this.name = name; } };
var navigator = { userActivation: { isActive: false }, credentials: new CredentialsContainer() };
var location = { href: HREF };
function addEventListener(type, listener) { (listeners[type] = listeners[type] || []).push(listener); }
function dispatch(type, isTrusted) { for (const listener of listeners[type] || []) listener({ type, isTrusted }); }
function press() { dispatch('pointerdown', true); dispatch('click', true); navigator.userActivation.isActive = true; }
function lapse() { navigator.userActivation.isActive = false; }
var window = globalThis;
function HTMLIFrameElement(child) { this.child = child; }
Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { get() { if (this.child === 'other-origin') return { get location() { throw new Error('SecurityError'); } }; return this.child; }, configurable: true, enumerable: true });
Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', { get() { return this.child && this.child.document; }, configurable: true, enumerable: true });
`;
// `allowed` is what the preload bridges from the main process: true only while the person has passkeys turned on (these tests: on unless said).
function page(href='https://accounts.example/',allowedAtStart=true){
 const state={allowed:allowedAtStart,asked:0};
 const context=vm.createContext({AbortController,HREF:href});vm.runInContext(WINDOW,context);vm.runInContext('('+GUARD+')',context)(()=>{state.asked++;return state.allowed;});
 const run=code=>vm.runInContext(code,context);
 return {context,run,state,allow:value=>{state.allowed=value;},calls:()=>JSON.parse(run('JSON.stringify(calls)')),press:()=>run('press()'),lapse:()=>run('lapse()'),get:o=>run('navigator.credentials').get(o),create:o=>run('navigator.credentials').create(o)};
}
const outcome=promise=>promise.then(value=>String(value),error=>error.name+': '+error.message);
const settledWithin=(promise,ms)=>Promise.race([promise.then(()=>'settled',()=>'settled'),new Promise(resolve=>setTimeout(()=>resolve('pending'),ms))]);
const publicKey={challenge:new Uint8Array(1)};

// Exercise the preload entry point too, including its platform check. The tests
// below that run GUARD directly model Windows, even on a macOS test machine.
function preloadedPage(platform,href='https://accounts.example/',allowed=false){
 const context=vm.createContext({AbortController,HREF:href,process:{platform}}),injected=[];
 vm.runInContext(WINDOW,context);
 const originals=vm.runInContext('[CredentialsContainer.prototype.get,CredentialsContainer.prototype.create,PublicKeyCredential.isConditionalMediationAvailable,PublicKeyCredential.getClientCapabilities]',context);
 context.require=name=>{assert.equal(name,'electron');return {ipcRenderer:{sendSync(channel){assert.equal(channel,'acira:passkeys-allowed');return allowed;}},contextBridge:{executeInMainWorld({func,args}){injected.push(func);return func(...args);}}};};
 vm.runInContext(source,context);
 return {run:code=>vm.runInContext(code,context),originals,injected};
}

for(const platform of ['darwin','linux'])test(`${platform}: the actual preload preserves native passkey APIs, requests and capabilities`,async()=>{
 const p=preloadedPage(platform);
 assert.deepEqual(p.injected,[]);
 const current=p.run('[CredentialsContainer.prototype.get,CredentialsContainer.prototype.create,PublicKeyCredential.isConditionalMediationAvailable,PublicKeyCredential.getClientCapabilities]');
 current.forEach((value,i)=>assert.equal(value,p.originals[i],'native API reference is unchanged'));
 assert.equal(await p.run('PublicKeyCredential.isConditionalMediationAvailable()'),true);
 const caps=await p.run('PublicKeyCredential.getClientCapabilities()');
 assert.equal(caps.conditionalGet,true);assert.equal(caps.conditionalCreate,true);
 // A request after navigation has no transient activation in this document.
 assert.equal(p.run('navigator.userActivation.isActive'),false);
 assert.equal(await p.run('navigator.credentials.get({publicKey:{challenge:new Uint8Array(1)}})'), 'GOT');
 assert.equal(await p.run('navigator.credentials.get({mediation:"conditional",publicKey:{challenge:new Uint8Array(1)}})'), 'GOT');
 assert.equal(await p.run('navigator.credentials.create({publicKey:{challenge:new Uint8Array(1)}})'), 'CREATED');
});

test('Windows: the actual preload still guards requests in HTTPS and srcdoc frames',async()=>{
 for(const href of ['https://accounts.example/','about:srcdoc']){
  const p=preloadedPage('win32',href);
  assert.equal(p.injected.length,1);
  assert.equal(await p.run('PublicKeyCredential.isConditionalMediationAvailable()'),false);
  assert.match(await outcome(p.run('navigator.credentials.get({publicKey:{challenge:new Uint8Array(1)}})')),/^NotAllowedError/);
 }
 assert.equal(preloadedPage('win32','file:///browser-ui.html').injected.length,0);
});

test('passkey autofill is reported unavailable, and the capabilities say no conditional get or create',async()=>{
 const p=page();
 assert.equal(await p.run('PublicKeyCredential.isConditionalMediationAvailable()'),false);
 const caps=await p.run('PublicKeyCredential.getClientCapabilities()');
 assert.equal(caps.conditionalGet,false);assert.equal(caps.conditionalCreate,false);
 assert.equal(caps.passkeyPlatformAuthenticator,true,'everything else the browser reports is kept');assert.equal(caps.hybridTransport,true);
 assert.equal(p.run('PublicKeyCredential.isConditionalMediationAvailable.name'),'isConditionalMediationAvailable','looks like the original');
});

test('a conditional (autofill) sign-in never reaches Windows: it waits until the page aborts it and then rejects with the page\'s reason',async()=>{
 const p=page(),controller=new AbortController();
 const pending=outcome(p.get({mediation:'conditional',publicKey,signal:controller.signal}));
 assert.equal(await settledWithin(pending,50),'pending','no answer while the page waits, like Chrome with no passkey to offer');
 controller.abort(new DOMException('page moved on','AbortError'));
 assert.equal(await pending,'AbortError: page moved on');
 const early=new AbortController();early.abort();
 assert.match(await outcome(p.get({mediation:'conditional',publicKey,signal:early.signal})),/^AbortError/,'an already-aborted signal rejects at once');
 p.press();
 const afterPress=outcome(p.get({mediation:'conditional',publicKey}));
 assert.equal(await settledWithin(afterPress,50),'pending','a press does not let a conditional request through either');
 assert.deepEqual(p.calls(),[]);
});

test('a passkey sign-in or creation with no fresh press is refused like a cancelled dialog',async()=>{
 const p=page();
 assert.match(await outcome(p.get({publicKey})),/^NotAllowedError: Signing in with a passkey needs a click or tap/);
 assert.match(await outcome(p.get({mediation:'optional',publicKey})),/^NotAllowedError/);
 assert.match(await outcome(p.create({publicKey})),/^NotAllowedError: Creating a passkey needs a click or tap/);
 p.run('dispatch("click", false); dispatch("keydown", false)');
 assert.match(await outcome(p.get({publicKey})),/^NotAllowedError/,'events the page makes itself are not presses');
 assert.deepEqual(p.calls(),[]);
});

test('a press opens one passkey dialog: the request goes through once, a second one needs another press',async()=>{
 const p=page();
 p.press();
 assert.equal(await outcome(p.get({publicKey})),'GOT','Sign in with a passkey, pressed by the person, reaches Windows');
 assert.match(await outcome(p.get({publicKey})),/^NotAllowedError/,'the page cannot reopen the dialog from the same press');
 p.press();
 assert.equal(await outcome(p.create({publicKey})),'CREATED','Create a passkey after a new press');
 p.press();p.lapse();
 assert.match(await outcome(p.get({publicKey})),/^NotAllowedError/,'a press older than the activation window does not count');
 assert.deepEqual(p.calls(),['get','create']);
});

test('automatic passkey creation (conditional create) is refused even right after a press',async()=>{
 const p=page();p.press();
 assert.match(await outcome(p.create({mediation:'conditional',publicKey})),/^NotAllowedError/);
 assert.deepEqual(p.calls(),[]);
});

test('passwords, federated sign-in and calls without options are untouched',async()=>{
 const p=page();
 assert.equal(await outcome(p.get({password:true})),'GOT');
 assert.equal(await outcome(p.get({mediation:'conditional',password:true})),'GOT');
 assert.equal(await outcome(p.get(undefined)),'GOT');
 assert.equal(await outcome(p.create({password:{id:'a',password:'b'}})),'CREATED');
 assert.equal(await outcome(p.create(undefined)),'CREATED');
 assert.deepEqual(p.calls(),['get','get:conditional','get','create','create']);
});

test('passkeys off (the default): every passkey request is refused at once, nothing reaches Windows and every check answers no',async()=>{
 const p=page('https://accounts.example/',false);
 for(const options of [{publicKey},{mediation:'optional',publicKey},{mediation:'required',publicKey,signal:new AbortController().signal}]){
  assert.equal(await settledWithin(outcome(p.get(options)),50),'settled','refused at once, not after the dialog times out');
  assert.match(await outcome(p.get(options)),/^NotAllowedError: The operation either timed out or was not allowed/,'the error Chrome gives a cancelled dialog');
 }
 assert.match(await outcome(p.create({publicKey})),/^NotAllowedError: The operation either timed out or was not allowed/);
 p.press();
 assert.match(await outcome(p.get({publicKey})),/^NotAllowedError/,'a real click does not open it either while the switch is off');
 assert.match(await outcome(p.create({publicKey})),/^NotAllowedError/);
 assert.match(await outcome(p.create({mediation:'conditional',publicKey})),/^NotAllowedError/);
 assert.equal(await p.run('PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()'),false);
 assert.equal(await p.run('PublicKeyCredential.isConditionalMediationAvailable()'),false);
 const caps=await p.run('PublicKeyCredential.getClientCapabilities()');
 for(const name of ['conditionalGet','conditionalCreate','passkeyPlatformAuthenticator','hybridTransport','userVerifyingPlatformAuthenticator'])assert.equal(caps[name],false,name+' reads false, not undefined');
 assert.ok(Object.values(caps).every(value=>value===false),'no passkey capability is reported');
 // An autofill request waits for the page to give up (Chrome with no passkey to offer) and never reaches Windows.
 const controller=new AbortController(),pending=outcome(p.get({mediation:'conditional',publicKey,signal:controller.signal}));
 assert.equal(await settledWithin(pending,50),'pending');
 controller.abort(new DOMException('page moved on','AbortError'));
 assert.equal(await pending,'AbortError: page moved on');
 assert.deepEqual(p.calls(),[],'nothing reached the browser, so nothing reached Windows');
 assert.equal(p.run('PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.name'),'isUserVerifyingPlatformAuthenticatorAvailable','looks like the original');
});

test('security review: with passkeys off a page cannot slip a passkey request past the guard (function options, a getter that hides publicKey, a stolen original)',async()=>{
 // This stand-in reads the options the way Chromium's WebIDL conversion does (any object, functions included; every member read again).
 const sees=WINDOW.replace("calls.push('get' + (options && options.mediation ? ':' + options.mediation : ''));","calls.push((options && options.publicKey) ? 'passkey-get' : 'get');").replace("calls.push('create' + (options && options.mediation ? ':' + options.mediation : ''));","calls.push((options && options.publicKey) ? 'passkey-create' : 'create');");
 assert.notEqual(sees,WINDOW);
 const context=vm.createContext({AbortController,HREF:'https://accounts.example/',publicKey});vm.runInContext(sees,context);vm.runInContext('('+GUARD+')',context)(()=>false);
 const run=code=>vm.runInContext(code,context);
 // 1. A function is an object to WebIDL: its publicKey is read like a dictionary's.
 await outcome(run('navigator.credentials.get(Object.assign(function () {}, { publicKey }))'));
 await outcome(run('navigator.credentials.create(Object.assign(function () {}, { publicKey }))'));
 // 2. A getter that answers undefined to the guard's look and the real options to the engine's.
 await outcome(run('(() => { let reads = 0; return navigator.credentials.get({ get publicKey() { return reads++ ? publicKey : undefined; } }); })()'));
 await outcome(run('(() => { let reads = 0; return navigator.credentials.create({ get publicKey() { return reads++ ? publicKey : undefined; } }); })()'));
 // 3. The page swaps Reflect.apply, makes an ordinary call, and keeps the unguarded method the guard hands to it.
 await outcome(run(`(() => { const realApply = Reflect.apply; Reflect.apply = function (target, self, args) { if (typeof target === 'function' && target.name === 'get' && !globalThis.stolen) globalThis.stolen = target; return realApply(target, self, args); };
  return navigator.credentials.get({ password: true }).then(() => { Reflect.apply = realApply; return globalThis.stolen ? globalThis.stolen.call(navigator.credentials, { publicKey }) : 'nothing stolen'; }); })()`));
 assert.deepEqual(JSON.parse(run('JSON.stringify(calls)')).filter(call=>call.startsWith('passkey-')),[],'no passkey request reached the browser, so none reached Windows');
 assert.deepEqual(JSON.parse(run('JSON.stringify(calls)')),['get'],'the password call went through');
});

test('passkeys off: passwords, federated sign-in and calls without options are untouched',async()=>{
 const p=page('https://accounts.example/',false);
 assert.equal(await outcome(p.get({password:true})),'GOT');
 assert.equal(await outcome(p.get({mediation:'conditional',password:true})),'GOT');
 assert.equal(await outcome(p.get({federated:{providers:['https://idp.example']}})),'GOT');
 assert.equal(await outcome(p.get(undefined)),'GOT');
 assert.equal(await outcome(p.create({password:{id:'a',password:'b'}})),'CREATED');
 assert.equal(await outcome(p.create(undefined)),'CREATED');
 assert.deepEqual(p.calls(),['get','get:conditional','get','get','create','create']);
});

test('the switch is read at every call, so a change applies to a page that is already open',async()=>{
 const p=page('https://accounts.example/',false);
 assert.match(await outcome(p.get({publicKey})),/^NotAllowedError/);
 p.allow(true);p.press();
 assert.equal(await outcome(p.get({publicKey})),'GOT','on: a click reaches Windows');
 assert.equal(await p.run('PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()'),true,'on: the engine\'s own answer');
 assert.equal((await p.run('PublicKeyCredential.getClientCapabilities()')).passkeyPlatformAuthenticator,true);
 assert.equal(await p.run('PublicKeyCredential.isConditionalMediationAvailable()'),false,'autofill stays unavailable either way');
 p.press();p.allow(false);
 assert.match(await outcome(p.get({publicKey})),/^NotAllowedError/,'off again: even a fresh press is not enough');
 assert.equal(await p.run('PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()'),false);
 assert.deepEqual(p.calls(),['get']);
 assert.ok(p.state.asked>=5,'asked the main process each time');
});

test('a main process that cannot answer reads as off',async()=>{
 const context=vm.createContext({AbortController,HREF:'https://x.example/'});vm.runInContext(WINDOW,context);
 vm.runInContext('('+GUARD+')',context)(()=>{throw new Error('channel closed');});
 vm.runInContext('press()',context);
 assert.match(await outcome(vm.runInContext('navigator.credentials',context).get({publicKey})),/^NotAllowedError/);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(calls)',context)),[]);
});

test('a child frame that is still about:blank is guarded the moment the page reaches it; other origins are left alone',async()=>{
 const p=page(),child=page('about:blank');
 // The child's own copy of the guard is what its preload would add; drop it to model a script-made frame no preload reached.
 const bare=vm.createContext({AbortController,HREF:'about:blank'});vm.runInContext(WINDOW,bare);
 p.context.bareChild=vm.runInContext('globalThis',bare);
 const reached=p.run('new HTMLIFrameElement(bareChild).contentWindow');
 assert.equal(await reached.PublicKeyCredential.isConditionalMediationAvailable(),false);
 const wrapped=reached.CredentialsContainer.prototype.get;
 p.run('new HTMLIFrameElement(bareChild).contentWindow; new HTMLIFrameElement(bareChild).contentDocument');
 assert.equal(reached.CredentialsContainer.prototype.get,wrapped,'reaching it again does not wrap it twice');
 assert.match(await outcome(reached.navigator.credentials.get({publicKey})),/^NotAllowedError/);
 assert.doesNotThrow(()=>p.run('new HTMLIFrameElement("other-origin").contentWindow'),'a cross-origin frame is not touched');
 assert.equal(await child.run('PublicKeyCredential.isConditionalMediationAvailable()'),false,'a frame with its own guard answers the same');
});

test('a browser without user activation support is left as it is',async()=>{
 const context=vm.createContext({AbortController,HREF:'https://x.example/'});vm.runInContext(WINDOW,context);
 vm.runInContext('delete navigator.userActivation',context);vm.runInContext('('+GUARD+')',context)(()=>true);
 assert.equal(await vm.runInContext('PublicKeyCredential.isConditionalMediationAvailable()',context),true);
});

test('the Windows guard covers every website frame, never needs another file (sandboxed preload) and is registered for every session',()=>{
 assert.ok(!/require\('\.\//.test(source),'a sandboxed preload cannot require local files');
 assert.match(source,/require\('electron'\)/);
 assert.doesNotMatch(source,/process\.isMainFrame/,'iframes are guarded too (Google sign-in widgets live in iframes)');
 assert.match(source,/about:srcdoc/);
 assert.doesNotMatch(GUARD,/`|\$\{|require\(|ipcRenderer/,'the serialised function has no closure over the preload: only the bridged answer');
 assert.match(source,/executeInMainWorld\(\{func:guard,args:\[allowed\]\}\)/);assert.match(source,/sendSync\('acira:passkeys-allowed'\)===true/,'a failed or missing answer reads as off');
 const blocking=fs.readFileSync(path.join(__dirname,'..','desktop','content-blocking.cjs'),'utf8');
 assert.match(blocking,/registerPreloadScript\(\{type:'frame',filePath:path\.join\(__dirname,'browser-services','passkey-guard-preload\.cjs'\)\}\)/);
 // The QA stub sits below the guard, and only in test profiles with its own switch on.
 assert.match(blocking,/if\(process\.env\.ACIRA_BROWSER_TEST_DATA&&process\.env\.ACIRA_TEST_PASSKEY_STUB==='1'\)session\.registerPreloadScript\(\{type:'frame',filePath:path\.join\(__dirname,'browser-services','passkey-test-stub-preload\.cjs'\)\}\);session\.registerPreloadScript\(\{type:'frame',filePath:path\.join\(__dirname,'browser-services','passkey-guard-preload\.cjs'\)\}\)/);
 assert.equal((blocking.match(/passkey-test-stub-preload/g)||[]).length,1);
});

// The same script in real Chromium (Electron), with the credential calls stubbed so no Windows dialog can open.
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
let result=null,problem=null;
if(electron){
 const env={...process.env,ELECTRON_ENABLE_LOGGING:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','passkey','run.cjs')],{encoding:'utf8',timeout:90000,env});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT ')||text.startsWith('ERROR '));
 if(line&&line.startsWith('RESULT '))result=JSON.parse(line.slice(7));else problem=(line||((run.stdout||'')+(run.stderr||'')).slice(0,500))||'electron produced no result';
}
const skip=!electron?'electron binary not available':false;
test('Chromium: fixture run finished',{skip},()=>assert.ok(result,problem));
test('Chromium: the registered sandboxed preload preserves native macOS/Linux APIs in pages, frames and popups',{skip:skip||process.platform==='win32'},()=>{
 for(const [name,probe] of Object.entries(result.native)){
  assert.equal(probe.platform,process.platform,name);
  assert.equal(probe.sandboxed,true,name);
  for(const method of ['get','create','conditional','capabilities'])assert.equal(probe.unchanged[method],true,`${name}: ${method} remains native`);
  assert.equal(probe.conditionalAvailable,probe.conditionalBefore,name);
 }
 assert.deepEqual(Object.keys(result.native).sort(),['frame','page','popup']);
});
test('Chromium: without a press, autofill is unavailable, conditional sign-in waits for the abort and passkey calls are refused',{skip},()=>{
 const {without}=result;
 assert.equal(without.activeAtStart,false);
 assert.equal(without.conditionalAvailable,false);
 assert.equal(without.conditionalGet,'AbortError');
 assert.match(without.conditionalCreate,/^NotAllowedError/);
 assert.match(without.publicKey,/^NotAllowedError: Signing in with a passkey needs a click or tap/);
 assert.equal(without.password,'CREATED');assert.equal(without.noOptions,'CREATED');assert.equal(without.passwordGet,'GOT');
 assert.deepEqual(without.calls,['create','create','get'],'only the password and empty calls reached the browser');
 assert.equal(without.name,'get');assert.equal(without.createName,'create');assert.match(without.text,/\[native code\]/);
});
test('Chromium: with a press the passkey sign-in reaches the browser; conditional requests still never do',{skip},()=>{
 const {withGesture}=result;
 assert.equal(withGesture.activeAtStart,true);
 assert.equal(withGesture.publicKey,'GOT');
 assert.equal(withGesture.conditionalGet,'AbortError');assert.match(withGesture.conditionalCreate,/^NotAllowedError/);
 assert.deepEqual(withGesture.calls,['create','create','get','get']);
});
test('Chromium reports passkey autofill as available before the guard (the request that opened the Windows dialog)',{skip},()=>{
 assert.equal(typeof result.before.conditionalBefore,'boolean');
 assert.ok(result.before.conditionalBefore,'Electron says autofill passkeys work, so Google starts a conditional request on load');
});
test('Chromium: switched off while the page is open, even a click gets NotAllowedError at once and nothing reaches the browser',{skip},()=>{
 const {off,withGesture}=result;
 assert.equal(off.activeAtStart,true);
 assert.match(off.publicKey,/^NotAllowedError/);assert.match(off.publicKeyCreate,/^NotAllowedError/);assert.match(off.conditionalCreate,/^NotAllowedError/);
 assert.ok(off.publicKeyMs<500,'refused at once ('+off.publicKeyMs+' ms)');
 assert.equal(off.conditionalGet,'AbortError','an autofill request waits for the abort and never reaches the browser');
 assert.equal(off.conditionalAvailable,false);assert.equal(off.uvpaa,false);
 assert.ok(off.capabilities===null||Object.values(off.capabilities).every(value=>value===false),'no passkey capability is reported: '+JSON.stringify(off.capabilities));
 assert.equal(off.password,'CREATED');assert.equal(off.passwordGet,'GOT');
 assert.deepEqual(off.calls,['create','create','get'],'only the password and empty calls reached the browser');
 assert.equal(withGesture.publicKey,'GOT','the same page, switched on, still reaches the browser with a click');
});
