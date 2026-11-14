'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {patchPreload}=require('../desktop/browser-services/extension-runtime-patch.cjs');
const {installExtensionApis,createOffscreen,createIdentity,createSidePanel,extensionURL,patternCovers,MESSAGES}=require('../desktop/browser-services/extension-apis.cjs');
const {createUserScriptRegistry,matchesPattern,globMatch,normalizeScript,worldNumber}=require('../desktop/browser-services/user-scripts.cjs');
const {validateExtensionRequest}=require('../desktop/browser-services/extension-manager.cjs');
const ID='abcdefghijklmnopabcdefghijklmnop',OTHER='ponmlkjihgfedcbaponmlkjihgfedcba';

/** Runs the patched engine preload the way a service worker of `manifest` sees it, with main-process answers from `answer(name,args)`. */
function extensionWorld(manifest,{answer=()=>undefined,allowed=[],browser,native={}}={}){
 const text=patchPreload(fs.readFileSync(require.resolve('electron-chrome-extensions/preload'),'utf8'),{userScriptsAllowed:allowed,packages:[]/* these tests are about the older shims; the packages in ext-api/ have their own tests */});
 const calls=[],listeners=new Map();
 const electron={
  ipcRenderer:{invoke:async(channel,extensionId,name,...args)=>{calls.push({channel,extensionId,name,args});return answer(name,args);},send:(channel,...args)=>calls.push({channel,args}),
   addListener:(name,fn)=>listeners.set(name,fn),on:(name,fn)=>listeners.set(name,fn),once:()=>{},off:()=>{},removeListener:()=>{}},
  contextBridge:{executeInMainWorld:({func})=>func()},webFrame:{}
 };
 const chrome={runtime:{id:ID,getManifest:()=>manifest},i18n:{getMessage:name=>name},...native};
 const context={require:name=>{if(name==='electron')return electron;throw new Error(name);},process:{type:'service-worker',contextIsolated:false},location:{href:`chrome-extension://${ID}/sw.js`},
  console:{log(){},warn(){},error(){},debug(){}},URL,Promise,queueMicrotask,crypto:{randomUUID:()=>'00000000-0000-4000-8000-000000000000'},chrome};
 if(browser)context.browser=browser;
 context.globalThis=context;vm.createContext(context);vm.runInContext(text,context);
 return {chrome:context.chrome,browser:context.browser,calls,listeners};
}

test('Chromium\'s separate `browser` object gets the namespaces the engine adds to `chrome` (1Password, Proton Pass)',async()=>{
 // Chromium 152 exposes `browser` beside `chrome` with only the native namespaces. webextension-polyfill uses it as-is when
 // browser.runtime.id is set, so before this the workers read browser.windows.WINDOW_ID_NONE / browser.permissions.onAdded and died.
 const nativeStorage={local:{get(){}}};
 const browser={runtime:{id:ID,getManifest:()=>({})},storage:nativeStorage};
 const {chrome,calls,browser:seen}=extensionWorld({manifest_version:3,action:{},permissions:['storage','tabs','offscreen','idle']},{browser,native:{storage:{local:{get:async()=>({}),set(){}},session:{get(){}}}},answer:name=>name==='tabs.query'?[{id:7}]:name==='permissions.contains'?true:undefined});
 assert.equal(seen,browser,'the global stays the same object');
 for(const name of ['windows','permissions','action','tabs','runtime','offscreen','idle','contextMenus','notifications'])assert.equal(browser[name],chrome[name],`browser.${name} is chrome.${name}`);
 assert.equal(browser.windows.WINDOW_ID_NONE,-1);assert.equal(typeof browser.permissions.onAdded.addListener,'function');
 assert.equal(browser.storage,chrome.storage,'storage gains sync/managed on both names');assert.equal(typeof browser.storage.sync.get,'function');
 assert.deepEqual(await browser.tabs.query({active:true,currentWindow:true}),[{id:7}]);assert.equal(await browser.permissions.contains({permissions:['tabs']}),true);
 assert.deepEqual(calls.filter(c=>c.channel==='crx-msg').map(c=>c.name),['tabs.query','permissions.contains']);
 assert.equal(typeof browser.runtime.getContexts,'function','Acira\'s runtime additions are on the shared runtime object');
 // Namespaces neither the engine nor Acira supplies stay as Chromium made them; a manifest without the permission gets no extra namespace.
 assert.equal(browser.offscreen,chrome.offscreen);
 const plain={runtime:{id:ID}};extensionWorld({manifest_version:3,permissions:[]},{browser:plain});assert.equal(plain.offscreen,undefined);assert.equal(typeof plain.windows.getCurrent,'function');
 // When `browser` is `chrome` itself (or absent) nothing changes.
 const same=extensionWorld({manifest_version:3,permissions:[]});assert.equal(same.browser,undefined);
});

test('chrome.tabs and chrome.windows carry Chrome\'s constants and enums, on both names (Todoist\'s worker built tabIds: [TAB_ID_NONE])',()=>{
 const browser={runtime:{id:ID}};
 const {chrome}=extensionWorld({manifest_version:3,permissions:['tabs']},{browser});
 assert.equal(chrome.tabs.TAB_ID_NONE,-1);assert.equal(chrome.tabs.TAB_INDEX_NONE,-1);assert.equal(chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND,2);
 assert.deepEqual({...chrome.tabs.TabStatus},{UNLOADED:'unloaded',LOADING:'loading',COMPLETE:'complete'});
 assert.equal(chrome.tabs.ZoomSettingsScope.PER_ORIGIN,'per-origin');assert.equal(chrome.tabs.MutedInfoReason.EXTENSION,'extension');
 assert.equal(chrome.windows.WINDOW_ID_NONE,-1);assert.equal(chrome.windows.WINDOW_ID_CURRENT,-2);
 assert.equal(chrome.windows.WindowState.LOCKED_FULLSCREEN,'locked-fullscreen');assert.equal(chrome.windows.CreateType.POPUP,'popup');assert.equal(chrome.windows.WindowType.DEVTOOLS,'devtools');
 assert.equal(browser.tabs.TAB_ID_NONE,-1,'the browser name sees the same object');
 // A value the engine (or a later Chromium) already provides is kept.
 const own=extensionWorld({manifest_version:3,permissions:[]},{native:{tabs:{TAB_ID_NONE:-7}}});assert.equal(own.chrome.tabs.TAB_ID_NONE,-7);
});

test('chrome.* events answer hasListener / hasListeners instead of throwing "Method not implemented." (Todoist)',()=>{
 const {chrome,calls}=extensionWorld({manifest_version:3,permissions:['webNavigation','tabs']});
 const event=chrome.webNavigation.onCreatedNavigationTarget,listener=()=>{},other=()=>{};
 assert.equal(event.hasListeners(),false);assert.equal(event.hasListener(listener),false);
 event.addListener(listener);assert.equal(event.hasListener(listener),true);assert.equal(event.hasListener(other),false);assert.equal(event.hasListeners(),true);
 assert.equal(chrome.tabs.onUpdated.hasListeners(),false,'each event keeps its own listeners');
 event.removeListener(listener);assert.equal(event.hasListener(listener),false);assert.equal(event.hasListeners(),false);
 assert.deepEqual(calls.filter(c=>/crx-add-listener|crx-remove-listener/.test(c.channel)).map(c=>c.channel),['crx-add-listener','crx-remove-listener'],'the engine still registers and removes the listener');
 assert.throws(()=>event.addRules([]),undefined,'rules stay unsupported (P5 builds webNavigation from Chromium\'s schema: no addRules, as in Chrome)');
});

test('the engine preload gains offscreen, sidePanel, identity, userScripts and runtime.getContexts, only for declared permissions',async()=>{
 const none=extensionWorld({manifest_version:3,permissions:['storage']});
 for(const name of ['offscreen','sidePanel','identity','userScripts'])assert.equal(none.chrome[name],undefined,`${name} needs its permission, as in Chrome`);
 assert.equal(typeof none.chrome.runtime.getContexts,'function');assert.equal(none.chrome.runtime.ContextType.OFFSCREEN_DOCUMENT,'OFFSCREEN_DOCUMENT');
 const world=extensionWorld({manifest_version:3,permissions:['offscreen','sidePanel','identity','userScripts']},{answer:(name)=>name==='offscreen.createDocument'?{__acira_error:MESSAGES.offscreenOne}:name==='offscreen.hasDocument'?true:undefined});
 const {chrome,calls}=world;
 assert.equal(chrome.offscreen.Reason.CLIPBOARD,'CLIPBOARD');
 await assert.rejects(chrome.offscreen.createDocument({url:'off.html',reasons:['CLIPBOARD'],justification:'x'}),new RegExp(MESSAGES.offscreenOne));
 assert.equal(await chrome.offscreen.hasDocument(),true);
 assert.deepEqual(calls.filter(c=>c.channel==='crx-msg').map(c=>c.name),['offscreen.createDocument','offscreen.hasDocument']);
 // A callback sees chrome.runtime.lastError, as in Chrome, and it is gone afterwards.
 const seen=await new Promise(resolve=>chrome.offscreen.createDocument({url:'off.html',reasons:['CLIPBOARD'],justification:'x'},()=>resolve(chrome.runtime.lastError?.message)));
 assert.equal(seen,MESSAGES.offscreenOne);assert.equal(chrome.runtime.lastError,undefined);
 assert.equal(chrome.identity.getRedirectURL(),`https://${ID}.chromiumapp.org/`);assert.equal(chrome.identity.getRedirectURL('cb'),`https://${ID}.chromiumapp.org/cb`);
 assert.equal(typeof chrome.sidePanel.setPanelBehavior,'function');assert.equal(typeof chrome.sidePanel.onOpened.addListener,'function');
 assert.throws(()=>chrome.userScripts.getScripts(),/Allow User Scripts/,'with the switch off a call throws at once (how Tampermonkey detects it)');
 assert.ok(Object.isExtensible(chrome),'chrome is not frozen');
});

test('with the switch on, userScripts calls reach the main process and user script messages are answered',async()=>{
 const {chrome,calls,listeners}=extensionWorld({manifest_version:3,permissions:['userScripts']},{allowed:[ID],answer:name=>name==='userScripts.getScripts'?[{id:'a'}]:undefined});
 assert.deepEqual(await chrome.userScripts.getScripts(),[{id:'a'}]);
 chrome.runtime.onUserScriptMessage.addListener((message,sender,sendResponse)=>{sendResponse({echo:message,from:sender.url});});
 assert.ok(calls.some(c=>c.channel==='crx-add-listener'&&c.args[1]==='runtime.onUserScriptMessage'));
 listeners.get('crx-runtime.onUserScriptMessage')({}, 'hi',{url:'https://a.test/'},'reply-1');
 const reply=calls.find(c=>c.name==='userScripts.reply');assert.deepEqual(reply.args,['reply-1',{echo:'hi',from:'https://a.test/'}]);
 assert.equal(extensionWorld({manifest_version:3,permissions:['userScripts']},{allowed:[OTHER]}).chrome.userScripts.register.length>=0,true);
 assert.throws(()=>extensionWorld({manifest_version:3,permissions:['userScripts']},{allowed:[OTHER]}).chrome.userScripts.register([]),/Allow User Scripts/,'the switch is per extension');
});

function fakeContents(){const wc=new EventEmitter();wc.url='';wc.destroyed=false;wc.loadURL=async url=>{wc.url=url;};wc.getURL=()=>wc.url;wc.isDestroyed=()=>wc.destroyed;wc.close=()=>{wc.destroyed=true;wc.emit('destroyed');};wc.setWindowOpenHandler=()=>{};return wc;}
const ev=(id=ID,permissions=['offscreen'])=>({extension:{id,name:'Test',manifest:{manifest_version:3,permissions}}});

test('chrome.offscreen keeps one hidden document per extension, inside the extension',async()=>{
 const made=[];const offscreen=createOffscreen({session:{},createContents:()=>{const webContents=fakeContents();made.push(webContents);return {webContents};}});
 assert.equal(offscreen.hasDocument(ev()),false);
 assert.equal(await offscreen.create(ev(),{url:'offscreen.html',reasons:['DOM_PARSER'],justification:'parse'}),undefined);
 assert.equal(made[0].url,`chrome-extension://${ID}/offscreen.html`);assert.equal(offscreen.hasDocument(ev()),true);
 assert.deepEqual(await offscreen.create(ev(),{url:'offscreen.html',reasons:['DOM_PARSER'],justification:'parse'}),{__acira_error:MESSAGES.offscreenOne});
 assert.deepEqual(await offscreen.create(ev(OTHER),{url:`chrome-extension://${ID}/offscreen.html`,reasons:['DOM_PARSER'],justification:'x'}),{__acira_error:MESSAGES.offscreenUrl},'never another extension\'s page');
 assert.deepEqual(await offscreen.create(ev(OTHER),{url:'https://example.com/',reasons:['DOM_PARSER'],justification:'x'}),{__acira_error:MESSAGES.offscreenUrl});
 assert.deepEqual(await offscreen.create(ev(OTHER),{url:'o.html',reasons:['NOPE'],justification:'x'}),{__acira_error:MESSAGES.offscreenReasons});
 assert.deepEqual(await offscreen.create(ev(OTHER),{url:'o.html',reasons:['BLOBS']}),{__acira_error:MESSAGES.offscreenJustification});
 assert.equal(offscreen.closeDocument(ev()),undefined);assert.equal(made[0].destroyed,true);
 assert.deepEqual(offscreen.closeDocument(ev()),{__acira_error:MESSAGES.offscreenNone});
 await offscreen.create(ev(),{url:'/a/b.html',reasons:['CLIPBOARD'],justification:'copy'});made[1].close();assert.equal(offscreen.hasDocument(ev()),false,'a document that closes itself is gone');
 assert.equal(extensionURL(ID,'chrome-extension://'+ID+'/x.html'),`chrome-extension://${ID}/x.html`);assert.equal(extensionURL(ID,'//evil.test/x'),null);
});

function fakeAuthWindow(){const win=new EventEmitter(),wc=fakeContents();wc.stop=()=>{};win.webContents=wc;win.destroyed=false;win.isDestroyed=()=>win.destroyed;win.destroy=()=>{if(win.destroyed)return;win.destroyed=true;win.emit('closed');};win.show=()=>{win.shown=true;};win.setTitle=title=>{win.title=title;};return win;}

test('chrome.identity.launchWebAuthFlow ends at the chromiumapp.org address without loading it; getAuthToken fails clearly',async()=>{
 let win;const identity=createIdentity({session:{},createWindow:({title})=>{win=fakeAuthWindow();win.title=title;return win;},t:(id,p)=>`${p.name} sign-in · ${p.host}`,hidden:()=>false});
 const flow=identity.launchWebAuthFlow(ev(ID,['identity']),{url:'https://auth.example.com/authorize?x=1',interactive:true});
 assert.equal(win.title,'Test sign-in · auth.example.com','the window shows whose sign-in and which site');
 win.emit('ready-to-show');assert.equal(win.shown,true);
 let prevented=false;win.webContents.emit('will-redirect',{preventDefault:()=>{prevented=true;}},`https://${ID}.chromiumapp.org/cb#token=abc`);
 assert.equal(await flow,`https://${ID}.chromiumapp.org/cb#token=abc`);assert.equal(prevented,true,'the redirect address is never requested');
 const closed=identity.launchWebAuthFlow(ev(ID,['identity']),{url:'https://auth.example.com/',interactive:true});win.destroy();
 assert.deepEqual(await closed,{__acira_error:MESSAGES.noApproval});
 const quiet=identity.launchWebAuthFlow(ev(ID,['identity']),{url:'https://auth.example.com/'});win.webContents.emit('did-stop-loading');
 assert.deepEqual(await quiet,{__acira_error:MESSAGES.interaction});assert.equal(win.shown,undefined,'non-interactive flows never show a window');
 assert.deepEqual(identity.launchWebAuthFlow(ev(ID,['identity']),{url:'javascript:alert(1)'}),{__acira_error:MESSAGES.authLoad});
 assert.deepEqual(identity.getAuthToken(),{__acira_error:'The user is not signed in.'});assert.deepEqual(identity.getProfileUserInfo(),{email:'',id:''});
 // A look-alike host is not the redirect.
 const lookalike=identity.launchWebAuthFlow(ev(ID,['identity']),{url:'https://auth.example.com/',interactive:true});win.webContents.emit('will-navigate',{preventDefault(){}},`https://${ID}.chromiumapp.org.evil.test/`);win.destroy();
 assert.deepEqual(await lookalike,{__acira_error:MESSAGES.noApproval});
});

test('chrome.userScripts registry: Chrome match patterns, validation, worlds and which scripts run where',()=>{
 assert.ok(matchesPattern('*://*.example.com/*','https://a.b.example.com/x?y=1'));assert.ok(matchesPattern('*://*.example.com/*','http://example.com/'));
 assert.ok(!matchesPattern('*://*.example.com/*','https://badexample.com/'));assert.ok(!matchesPattern('*://*/*','file:///c:/x'));
 assert.ok(matchesPattern('<all_urls>','file:///c:/x'));assert.ok(matchesPattern('https://a.test/p/*','https://a.test/p/q'));assert.ok(!matchesPattern('https://a.test/p/*','https://a.test/q'));
 assert.ok(matchesPattern('http://localhost:8080/*','http://localhost:8080/a'));assert.ok(!matchesPattern('http://localhost:8080/*','http://localhost:9090/a'));
 assert.ok(globMatch('https://*.test/?','https://a.test/x'));assert.ok(!globMatch('https://*.test/?','https://a.test/xy'));
 const saved=[];const registry=createUserScriptRegistry({save:value=>saved.push(value)});
 registry.register(ID,[{id:'one',matches:['*://*.example.com/*'],js:[{code:'1'}],excludeMatches:['*://skip.example.com/*']},{id:'two',matches:['<all_urls>'],js:[{code:'2'}],world:'MAIN',runAt:'document_start',allFrames:true}]);
 assert.throws(()=>registry.register(ID,[{id:'one',matches:['<all_urls>'],js:[{code:'x'}]}]),/Duplicate script ID 'one'/);
 assert.throws(()=>registry.register(ID,[{id:'_x',matches:['<all_urls>'],js:[{code:'x'}]}]),/must not start with '_'/);
 assert.throws(()=>registry.register(ID,[{id:'bad',matches:['nope'],js:[{code:'x'}]}]),/Invalid match pattern/);
 assert.throws(()=>registry.register(ID,[{id:'empty',matches:['<all_urls>'],js:[]}]),/at least one js source/);
 assert.throws(()=>normalizeScript({id:'f',matches:['<all_urls>'],js:[{file:'a.js',code:'b'}]}),/exactly one of code or file/);
 assert.deepEqual(registry.getScripts(ID).map(s=>[s.id,s.world,s.runAt]),[['one','USER_SCRIPT','document_idle'],['two','MAIN','document_start']]);
 registry.update(ID,[{id:'one',js:[{code:'1b'}]}]);assert.equal(registry.getScripts(ID,{ids:['one']})[0].js[0].code,'1b');
 assert.throws(()=>registry.update(ID,[{id:'ghost',js:[{code:'x'}]}]),/does not exist/);
 const allowed=id=>id===ID;
 assert.deepEqual(registry.scriptsFor('https://www.example.com/',{allowed}).map(s=>s.id),['one','two']);
 assert.deepEqual(registry.scriptsFor('https://skip.example.com/',{allowed}).map(s=>s.id),['two']);
 assert.deepEqual(registry.scriptsFor('https://www.example.com/',{allowed,mainFrame:false}).map(s=>s.id),['two'],'subframes only get allFrames scripts');
 assert.deepEqual(registry.scriptsFor('https://www.example.com/',{allowed:()=>false}),[],'nothing runs for an extension whose switch is off');
 const one=registry.scriptsFor('https://www.example.com/',{allowed})[0];assert.equal(one.messaging,false);assert.equal(one.worldNumber,worldNumber(ID,''));assert.ok(one.worldNumber>=0x40000);
 registry.configureWorld(ID,{messaging:true,csp:"script-src 'self'"});assert.equal(registry.scriptsFor('https://www.example.com/',{allowed})[0].messaging,true);
 assert.deepEqual(registry.getWorldConfigurations(ID),[{csp:"script-src 'self'",messaging:true}]);
 assert.equal(registry.hasMessagingScript(ID,'https://www.example.com/'),true);assert.equal(registry.hasMessagingScript(ID,'https://other.test/'),false);
 registry.unregister(ID,{ids:['one']});assert.deepEqual(registry.getScripts(ID).map(s=>s.id),['two']);
 const restored=createUserScriptRegistry({load:()=>saved.at(-1)});assert.deepEqual(restored.getScripts(ID).map(s=>s.id),['two'],'scripts survive a restart');
 registry.forget(ID);assert.deepEqual(registry.getScripts(ID),[]);
});

test('chrome.sidePanel: manifest path, per-tab options, behaviour and the toolbar click',async()=>{
 const opened=[],closed=[],events=[];let current=null;
 const host={open:async details=>{opened.push(details);current={url:details.url,tabId:details.tabId};return {windowId:7};},close:async details=>{closed.push(details);current=null;},current:()=>current,navigate:({url})=>{current.url=url;}};
 const panel=createSidePanel({getExtension:()=>({name:'Test',manifest:{side_panel:{default_path:'panel.html'}}}),host,emit:(...args)=>events.push(args)});
 const e=ev(ID,['sidePanel']);
 assert.deepEqual(panel.getOptions(e,{}),{path:'panel.html',enabled:true});
 panel.setOptions(e,{tabId:3,path:'tab.html'});assert.deepEqual(panel.getOptions(e,{tabId:3}),{path:'tab.html',enabled:true,tabId:3});assert.equal(panel.getOptions(e,{}).path,'panel.html');
 assert.deepEqual(panel.setOptions(e,{path:'//evil.test/x'}),{__acira_error:'Invalid side panel path.'});
 assert.deepEqual(panel.open(e,{}),{__acira_error:'Either windowId or tabId must be specified.'});
 assert.equal(await panel.open(e,{windowId:7}),undefined);assert.equal(opened[0].url,`chrome-extension://${ID}/panel.html`);assert.equal(opened[0].name,'Test');
 assert.equal(events[0][1],'sidePanel.onOpened');assert.equal(events[0][2].windowId,7);
 panel.setOptions(e,{path:'other.html'});assert.equal(current.url,`chrome-extension://${ID}/other.html`,'a new path shows at once');
 panel.setOptions(e,{enabled:false});assert.equal(closed.length,1,'turning the panel off closes it');
 assert.equal(panel.actionClick(ID,{tabId:1}),false,'without openPanelOnActionClick the toolbar button keeps its popup');
 panel.setOptions(e,{enabled:true});panel.setPanelBehavior(e,{openPanelOnActionClick:true});assert.deepEqual(panel.getPanelBehavior(e),{openPanelOnActionClick:true});
 assert.equal(panel.actionClick(ID,{tabId:1}),true);await new Promise(r=>setImmediate(r));assert.equal(opened.length,2);
 assert.equal(panel.actionClick(ID,{tabId:1}),true);await new Promise(r=>setImmediate(r));assert.equal(closed.length,2,'a second click closes it');
 assert.deepEqual(await createSidePanel({getExtension:()=>({manifest:{}}),host:null,emit(){}}).open(e,{windowId:1}),{__acira_error:MESSAGES.panelHost});
});

test('chrome.sidePanel: per-tab options belong to the tab\'s page, however the caller names the tab (restored tab: its own id 2000000002, page 5)',async()=>{
 const opened=[];let current=null;
 const host={open:async details=>{opened.push(details);current={url:details.url,tabId:details.tabId};return {windowId:7};},close:async()=>{current=null;},current:()=>current,navigate:()=>{}};
 const panel=createSidePanel({getExtension:()=>({name:'Test',manifest:{side_panel:{default_path:'panel.html'}}}),host,emit(){},pageOf:id=>(id===2000000002?5:id)});
 const e=ev(ID,['sidePanel']);
 panel.setOptions(e,{tabId:2000000002,path:'tab.html'});
 assert.equal(panel.getOptions(e,{tabId:2000000002}).path,'tab.html','the extension reads back what it set, under its own id in the answer');
 assert.equal(panel.getOptions(e,{tabId:2000000002}).tabId,2000000002);
 assert.equal(panel.getOptions(e,{tabId:5}).path,'tab.html','the toolbar button of that tab (page 5) finds the same options');
 panel.setPanelBehavior(e,{openPanelOnActionClick:true});
 assert.equal(panel.actionClick(ID,{tabId:5}),true);await new Promise(r=>setImmediate(r));
 assert.equal(opened[0].url,`chrome-extension://${ID}/tab.html`,'a click on the page 5 button shows the options set for tab 2000000002');
 assert.equal(panel.getOptions(e,{tabId:6}).path,'panel.html','another tab keeps the extension-wide options');
});

test('installExtensionApis adds handlers on the engine router, checks permissions and wraps the toolbar click',async()=>{
 const handlers=new Map();let popupOpened=0;
 handlers.set('browserAction.activate',{callback:()=>{popupOpened++;},extensionContext:true});
 const router={handlers,listeners:new Map(),handle(name,callback){handlers.set(name,{callback});},sendEvent(){}};
 const sessionExtensions=new EventEmitter();sessionExtensions.getExtension=id=>id===ID?{id,name:'T',manifest:{manifest_version:3,permissions:['sidePanel','offscreen'],side_panel:{default_path:'p.html'}}}:null;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-ext-apis-'));
 try{
  const host={open:async()=>({windowId:1}),close:async()=>{},current:()=>null};
  const api=installExtensionApis({ctx:{router}},{session:{extensions:sessionExtensions,serviceWorkers:{getAllRunning:()=>({})}},userData:dir,sidePanelHost:host,createOffscreenContents:()=>({webContents:fakeContents()})});
  for(const name of ['offscreen.createDocument','offscreen.closeDocument','offscreen.hasDocument','runtime.getContexts','identity.launchWebAuthFlow','identity.getAuthToken','sidePanel.setOptions','sidePanel.open','userScripts.register','userScripts.getScripts','userScripts.reply','idle.queryState'])assert.ok(handlers.has(name),name);
  const call=(name,event,...args)=>handlers.get(name).callback(event,...args);
  const event={extension:sessionExtensions.getExtension(ID)};
  assert.deepEqual(await call('identity.getAuthToken',event),{__acira_error:'Access to extension API denied.'},'ext-api/identity.cjs answers with Chromium\'s dispatcher error');
  assert.deepEqual(await call('userScripts.getScripts',{extension:{...event.extension,manifest:{...event.extension.manifest,permissions:['userScripts']}}}),{__acira_error:"The 'userScripts' API is only available for users when the 'Allow User Scripts' toggle is enabled."});
  await call('offscreen.createDocument',event,{url:'o.html',reasons:['WORKERS'],justification:'w'});
  const contexts=await call('runtime.getContexts',event,{contextTypes:['OFFSCREEN_DOCUMENT']});
  assert.equal(contexts.length,1);assert.equal(contexts[0].documentUrl,`chrome-extension://${ID}/o.html`);assert.equal(contexts[0].documentOrigin,`chrome-extension://${ID}`);
  sessionExtensions.emit('extension-unloaded',{},{id:ID});assert.equal(api.offscreen.documents.size,0,'unloading the extension closes its document');
  call('browserAction.activate',{sender:{}},{eventType:'click',extensionId:ID,tabId:2});assert.equal(popupOpened,1,'no panel behaviour: the popup opens');
  await call('sidePanel.setPanelBehavior',event,{openPanelOnActionClick:true});call('browserAction.activate',{sender:{}},{eventType:'click',extensionId:ID,tabId:2});assert.equal(popupOpened,1,'the click opens the panel instead');
  call('browserAction.activate',{sender:{}},{eventType:'contextmenu',extensionId:ID,tabId:2});assert.equal(popupOpened,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('windows.getCurrent / getLastFocused never answer null while Acira has a window (Grammarly, LastPass workers at startup)',()=>{
 const handlers=new Map(),session={serviceWorkers:{getAllRunning:()=>({})},extensions:{getExtension:()=>null,on(){}}};
 const store={windows:new Set(),lastFocusedWindowId:undefined,getWindowById(id){return [...this.windows].find(w=>w.id===id);},addWindow(w){this.windows.add(w);if(typeof this.lastFocusedWindowId!=='number')this.lastFocusedWindowId=w.id;}};
 const engine=()=>{const w=store.getWindowById(store.lastFocusedWindowId);return w?{id:w.id,focused:false}:null;};
 handlers.set('windows.getCurrent',{callback:engine,extensionContext:true});handlers.set('windows.getLastFocused',{callback:engine});
 const router={handlers,listeners:new Map(),handle(name,callback){handlers.set(name,{callback});},sendEvent(){}};
 let main={id:3,isDestroyed:()=>false};
 /* the older patch alone: the windows package (ext-api/windows.cjs) answers these two itself, tested in ext-api-windows.test.cjs */
 installExtensionApis({ctx:{router,store}},{session,getWindow:()=>main,extApiDir:path.join(__dirname,'fixtures','ext-api','none')});
 assert.deepEqual(handlers.get('windows.getLastFocused').callback({}),{id:3,focused:false},'no page handed over yet: Acira\'s window');
 assert.equal(handlers.get('windows.getCurrent').extensionContext,true,'the engine\'s handler options are kept');
 assert.deepEqual(handlers.get('windows.getCurrent').callback({}),{id:3,focused:false});assert.equal(store.windows.size,1,'registered once');
 // A window whose id went stale is replaced; with no window at all the engine's null stands.
 store.lastFocusedWindowId=99;assert.deepEqual(handlers.get('windows.getCurrent').callback({}),{id:3,focused:false});
 store.windows.clear();store.lastFocusedWindowId=undefined;main=null;assert.equal(handlers.get('windows.getCurrent').callback({}),null);
});

test('permissions.contains: granted host patterns cover the asked ones, as in Chrome (Tampermonkey "has no access to this page")',()=>{
 assert.equal(patternCovers('<all_urls>','http://localhost/*'),true);assert.equal(patternCovers('*://*/*','https://a.example.com/x/*'),true);
 assert.equal(patternCovers('https://*.example.com/*','https://example.com/*'),true);assert.equal(patternCovers('https://*.example.com/*','https://*.a.example.com/*'),true);
 assert.equal(patternCovers('https://*.example.com/*','https://example.org/*'),false);assert.equal(patternCovers('http://*/*','https://a.com/*'),false);
 assert.equal(patternCovers('https://a.com/docs/*','https://a.com/docs/x'),true);assert.equal(patternCovers('https://a.com/docs/*','https://a.com/*'),false);
 assert.equal(patternCovers('*://*/*','<all_urls>'),false);assert.equal(patternCovers('*://*/*','file:///*'),false);
 const handlers=new Map(),session={serviceWorkers:{getAllRunning:()=>({})},extensions:{getExtension:()=>null,on(){}}};
 // The engine's own answer compared exact strings; Acira's permission table answers instead (extension-permission-table.cjs).
 handlers.set('permissions.contains',{callback:()=>false,extensionContext:true});
 const router={handlers,listeners:new Map(),handle(name,callback){handlers.set(name,{callback,extensionContext:true});},sendEvent(){}};
 installExtensionApis({ctx:{router,store:{}}},{session});
 const extension={id:ID,manifest:{manifest_version:3,permissions:['tabs'],host_permissions:['<all_urls>']}};
 const contains=request=>handlers.get('permissions.contains').callback({extension},request);
 assert.equal(contains({origins:['http://localhost/*']}),true);assert.equal(contains({origins:['<all_urls>']}),true);
 assert.equal(contains({permissions:['tabs'],origins:['https://x.org/*']}),true);
 assert.equal(contains({permissions:['history'],origins:['https://x.org/*']}),false,'a missing API permission still answers false');
 extension.manifest.host_permissions=['https://*.example.com/*'];assert.equal(contains({origins:['https://www.example.com/*']}),true);assert.equal(contains({origins:['https://www.example.com/*','https://x.org/*']}),false);
 assert.equal(handlers.get('permissions.contains').extensionContext,true);
});

test('chrome.tabs.captureVisibleTab captures the active web page with host access or a clicked activeTab, at most twice a second (ColorZilla)',async()=>{
 const handlers=new Map(),session={serviceWorkers:{getAllRunning:()=>({})}};
 handlers.set('browserAction.activate',{callback:()=>{}});
 const router={handlers,listeners:new Map(),handle(name,callback){handlers.set(name,{callback});},sendEvent(){}};
 let url='https://example.com/a',captures=0;
 const tab={id:5,session,isDestroyed:()=>false,getURL:()=>url,capturePage:async()=>{captures++;return {toDataURL:()=>'data:image/png;base64,AAA',toJPEG:q=>Buffer.from('jpeg'+q)};}};
 const win={id:1},store={getWindowById:id=>id===1?win:null,getCurrentWindow:()=>win,getActiveTabFromWindow:w=>w===win?tab:undefined,getTabById:id=>id===5?tab:undefined};
 const extensions={getExtension:()=>null,on(){}};session.extensions=extensions;
 const apis=installExtensionApis({ctx:{router,store}},{session});
 const capture=(manifest,...args)=>handlers.get('tabs.captureVisibleTab').callback({extension:{id:ID,manifest}},...args);
 const later=async()=>new Promise(resolve=>setTimeout(resolve,1010));
 const all={manifest_version:3,host_permissions:['<all_urls>']};
 assert.equal(await capture(all),'data:image/png;base64,AAA','no arguments: the current window, PNG');
 assert.equal(await capture(all,{format:'jpeg',quality:40}),'data:image/jpeg;base64,'+Buffer.from('jpeg40').toString('base64'),'options alone, as the first argument');
 assert.deepEqual(await capture(all,1),{__acira_error:MESSAGES.captureQuota},'a third call within a second is refused');
 await later();
 assert.deepEqual(await capture({manifest_version:3,host_permissions:['https://other.org/*']},null,{}),{__acira_error:MESSAGES.captureAccess},'no access to this page');
 assert.deepEqual(await capture({manifest_version:3,permissions:['activeTab']},1,{}),{__acira_error:MESSAGES.captureAccess},'activeTab before any toolbar click');
 handlers.get('browserAction.activate').callback({sender:{}},{eventType:'click',extensionId:ID,tabId:5});await later();
 assert.equal(await capture({manifest_version:3,permissions:['activeTab']},1,{}),'data:image/png;base64,AAA','activeTab after a click on this tab');
 // The grant is for the origin the tab had at the click: the tab goes on to another site and the same click no longer reads it.
 await later();url='https://bank.example/account';
 assert.deepEqual(await capture({manifest_version:3,permissions:['activeTab']},1,{}),{__acira_error:MESSAGES.captureAccess},'activeTab: the tab left the origin it was clicked on');
 await later();url='https://example.com/b';
 assert.equal(await capture({manifest_version:3,permissions:['activeTab']},1,{}),'data:image/png;base64,AAA','back on the same origin, the click still holds');
 await later();
 // uninstalling forgets the click (a reinstall under the same id starts with no grant)
 apis.forget(ID);
 assert.deepEqual(await capture({manifest_version:3,permissions:['activeTab']},1,{}),{__acira_error:MESSAGES.captureAccess},'after the extension was removed the old click is gone');
 await later();
 url='acira://settings';assert.deepEqual(await capture(all,7),{__acira_error:MESSAGES.captureNoTab},'unknown window');
 await later();assert.deepEqual(await capture(all),{__acira_error:MESSAGES.captureAccess},'never a browser page');
 assert.equal(captures,4);
 // The renderer side: chrome.tabs.captureVisibleTab exists and passes its arguments through, with lastError for callbacks.
 const {chrome,calls}=extensionWorld({manifest_version:3,permissions:['tabs']},{answer:name=>name==='tabs.captureVisibleTab'?{__acira_error:MESSAGES.captureAccess}:undefined});
 await assert.rejects(chrome.tabs.captureVisibleTab({format:'png'}),/activeTab/);
 assert.deepEqual(calls.filter(c=>c.channel==='crx-msg').map(c=>[c.name,c.args]),[['tabs.captureVisibleTab',[{format:'png'}]]]);
});

test('the "Allow user scripts" request is validated',()=>{
 const profiles=[{id:'p'}];
 assert.deepEqual(validateExtensionRequest({type:'userScripts',profileId:'p',extensionId:ID,allowed:true},profiles),{type:'userScripts',profileId:'p',extensionId:ID,allowed:true});
 assert.throws(()=>validateExtensionRequest({type:'userScripts',profileId:'p',extensionId:ID},profiles),/user scripts choice/);
 assert.throws(()=>validateExtensionRequest({type:'pin',profileId:'p',extensionId:ID,pinned:true,allowed:true},profiles),/Unexpected/);
});

test('chrome.bookmarks, history and sessions read the profile\'s own records; history and sessions refuse changes',async()=>{
 const {bookmarksApi,historyApi,sessionsApi,bookmarkTree}=require('../desktop/browser-services/extension-store-apis.cjs');
 const nodes=[{id:'f',parentId:null,title:'Work',position:1,createdAt:5},{id:'a',parentId:'f',title:'Acira docs',url:'https://acira.test/docs',position:0,createdAt:10},{id:'b',parentId:null,title:'News',url:'https://news.test/',position:0,createdAt:20}];
 const tree=bookmarkTree(nodes);assert.equal(tree.id,'0');assert.equal(tree.children[0].id,'1');
 assert.deepEqual(tree.children[0].children.map(n=>n.title),['News'],'top-level pages are on the bar');assert.deepEqual(tree.children[1].children.map(n=>n.title),['Work'],'top-level folders are in Other bookmarks');assert.equal(tree.children[1].children[0].children[0].url,'https://acira.test/docs');
 const b=bookmarksApi(()=>nodes);
 assert.deepEqual(b.search({},'acira').map(n=>n.id),['a']);assert.deepEqual(b.search({},{url:'https://news.test/'}).map(n=>n.id),['b']);
 assert.deepEqual(b.getRecent({},1).map(n=>n.id),['b']);assert.deepEqual(b.getChildren({},'f').map(n=>n.id),['a']);
 assert.equal(b.get({},['a'])[0].children,undefined);assert.deepEqual(b.get({},['nope']),{__acira_error:"Can't find bookmark for id."});
 assert.deepEqual(b.create({},{title:'x'}),{__acira_error:'Acira cannot change bookmarks right now.'},'no store to write into: refused in plain words');
 const now=Date.now(),visits=[{id:'1',url:'https://a.test/',title:'A',time:new Date(now-1000).toISOString()},{id:'2',url:'https://a.test/',title:'A2',time:new Date(now-500).toISOString()},{id:'3',url:'https://old.test/',title:'Old',time:new Date(now-3*86400000).toISOString()}];
 const h=historyApi(()=>visits);
 assert.deepEqual(h.search({},{text:''}).map(i=>[i.url,i.visitCount,i.title]),[['https://a.test/',2,'A2']],'last 24 hours by default, one item per address');
 assert.equal(h.search({},{text:'old',startTime:0}).length,1);assert.equal(h.getVisits({},{url:'https://a.test/'}).length,2);
 const s=sessionsApi(()=>[{id:'t1',url:'https://x.test/',title:'X'},{id:'t2',url:'acira://new',title:'New'}]);
 assert.deepEqual(s.getRecentlyClosed({},{}).map(x=>x.tab.url),['https://x.test/'],'only website tabs');assert.ok(s.restore().__acira_error);
 // Wired through the router, behind each namespace's permission.
 const handlers=new Map(),router={handlers,listeners:new Map(),handle(name,callback){handlers.set(name,{callback});},sendEvent(){}},searched=[];
 installExtensionApis({ctx:{router}},{session:{extensions:new EventEmitter()},stores:{bookmarks:()=>nodes,history:()=>visits,closedTabs:()=>[],search:async query=>{searched.push(query);}}});
 const withPerm=permissions=>({extension:{id:ID,manifest:{manifest_version:3,permissions}}});
 assert.equal((await handlers.get('bookmarks.getTree').callback(withPerm(['bookmarks'])))[0].id,'0');
 assert.deepEqual(await handlers.get('bookmarks.getTree').callback(withPerm([])),{__acira_error:"'bookmarks' permission is required."});
 assert.ok((await handlers.get('bookmarks.create').callback(withPerm(['bookmarks']),{title:'x'})).__acira_error,'no write store given: refused');
 assert.deepEqual(await handlers.get('bookmarks.create').callback(withPerm([]),{title:'x'}),{__acira_error:"'bookmarks' permission is required."});
 assert.equal(await handlers.get('search.query').callback(withPerm(['search']),{text:'acira browser'}),undefined);assert.deepEqual(searched,[{text:'acira browser',disposition:undefined,tabId:undefined}]);
 const world=extensionWorld({manifest_version:3,permissions:['bookmarks','history','sessions','search']});
 for(const name of ['bookmarks','history','sessions','search'])assert.equal(typeof world.chrome[name],'object',name);assert.equal(extensionWorld({manifest_version:3,permissions:['idle']}).chrome.idle.IdleState.LOCKED,'locked');assert.equal(typeof extensionWorld({manifest_version:3,permissions:['idle']}).chrome.idle.onStateChanged.addListener,'function');
 assert.equal(typeof world.chrome.bookmarks.onCreated.addListener,'function');assert.equal(world.chrome.search.Disposition.NEW_TAB,'NEW_TAB');
});

test('a chosen New Tab page shows only on ordinary New Tabs; private, Tor, split and setup keep Acira\'s page',()=>{
 const {overrideFor}=require('../desktop/browser-services/extension-new-tab.cjs');
 const tab={id:'t',url:'acira://new',contentKind:'internal',browserProfileId:'p'},choice={extensionId:ID,url:`chrome-extension://${ID}/dashboard.html`};
 assert.deepEqual(overrideFor({tab,choice}),{tabId:'t',profileId:'p',extensionId:ID,url:choice.url});
 for(const blocked of [{privateMode:true},{torMode:true},{split:true},{setup:true},{choice:null},{baseline:new Set(['t'])}])assert.equal(overrideFor({tab,choice,...blocked}),null,JSON.stringify(blocked));
 assert.equal(overrideFor({tab:{...tab,url:'acira://settings'},choice}),null);assert.equal(overrideFor({tab:{...tab,url:'https://a.test/',contentKind:'web'},choice}),null);
 assert.equal(overrideFor({tab,choice:{extensionId:ID,url:'https://evil.test/'}}),null,'only an extension page');
 const profiles=[{id:'p'}];
 assert.deepEqual(validateExtensionRequest({type:'newTab',profileId:'p',extensionId:ID,allowed:false},profiles),{type:'newTab',profileId:'p',extensionId:ID,allowed:false});
 assert.throws(()=>validateExtensionRequest({type:'newTab',profileId:'p',extensionId:ID},profiles),/New Tab choice/);
});

test('the page preload runs user scripts at their time and world, and gives messaging worlds a sendMessage bridge',()=>{
 const run=[],exposed=[],info=[],listeners={};let readyState='loading';
 const scripts=[{extensionId:ID,id:'s',runAt:'document_start',world:'MAIN',code:'start'},{extensionId:ID,id:'e',runAt:'document_end',world:'USER_SCRIPT',worldId:'',worldNumber:0x40001,messaging:true,code:'end'},{extensionId:ID,id:'i',runAt:'document_idle',world:'USER_SCRIPT',worldId:'',worldNumber:0x40001,messaging:true,code:'idle'}];
 const electron={ipcRenderer:{sendSync:(channel,href,main)=>{assert.equal(channel,'acira:user-scripts');assert.equal(href,'https://a.test/');assert.equal(main,true);return scripts;},invoke:async()=>({__acira_value:1})},
  webFrame:{executeJavaScript:code=>{run.push(['MAIN',code]);},executeJavaScriptInIsolatedWorld:(world,sources)=>{run.push([world,sources[0].code.length>40?'prelude':sources[0].code]);},setIsolatedWorldInfo:(world,value)=>info.push([world,value.name])},
  contextBridge:{exposeInIsolatedWorld:(world,key)=>exposed.push([world,key])}};
 const context={require:name=>{if(name==='electron')return electron;throw new Error(name);},process:{isMainFrame:true},location:{href:'https://a.test/'},
  document:{get readyState(){return readyState;},addEventListener:(name,fn)=>{listeners[name]=fn;}},window:{addEventListener:(name,fn)=>{listeners['w:'+name]=fn;}},setTimeout:()=>0,JSON};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../desktop/browser-services/user-scripts-preload.cjs'),'utf8'),context);
 assert.deepEqual(run,[['MAIN','start']],'document_start runs before the page');
 readyState='interactive';listeners.DOMContentLoaded();
 assert.deepEqual(run.slice(1),[[0x40001,'prelude'],[0x40001,'end']],'document_end runs at DOMContentLoaded, after the world gets its chrome.runtime bridge');
 assert.deepEqual(exposed,[[0x40001,'__aciraUserScriptPort']]);assert.deepEqual(info,[[0x40001,'User scripts']]);
 readyState='complete';listeners['w:load']();assert.deepEqual(run.at(-1),[0x40001,'idle']);assert.equal(run.length,4,'the world is prepared once');
});

test('the side panel docks right of the page area and the page gives it its width',()=>{
 const {panelGeometry,trimBounds,GAP,HEADER}=require('../desktop/browser-services/extension-side-panel.cjs');
 const page={x:10,y:80,width:1200,height:700},g=panelGeometry(page);
 assert.equal(g.panel.width,360);assert.equal(g.panel.x+g.panel.width,page.x+page.width,'flush with the page area\'s right edge');
 assert.equal(g.content.y,g.panel.y+HEADER);assert.equal(g.reserve,360+GAP);
 assert.deepEqual(trimBounds({x:10,y:80,width:1200,height:700},page,g),{x:10,y:80,width:1200-360-GAP,height:700},'a full-width page narrows');
 assert.deepEqual(trimBounds({x:10,y:80,width:597,height:700},page,g),{x:10,y:80,width:597,height:700},'the left pane of a split keeps its size');
 assert.equal(panelGeometry({x:0,y:0,width:600,height:500}),null,'too narrow to share');
 assert.equal(panelGeometry({x:0,y:0,width:3000,height:900}).panel.width,420);
});
