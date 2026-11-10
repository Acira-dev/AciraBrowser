'use strict';
// Chrome extension namespaces the engine (electron-chrome-extensions 4.9) does not have, as they appear inside an extension's own pages and
// service worker: chrome.offscreen, chrome.sidePanel, chrome.identity, chrome.userScripts, chrome.runtime.getContexts,
// chrome.runtime.onUserScriptMessage, chrome.tabCapture and chrome.desktopCapture (with the getUserMedia shim for their stream ids). The function below is not called here: extension-runtime-patch.cjs writes its source into the
// library's preload (inside mainWorldScript), so it may use nothing outside its own body. Each call goes to the main process through the
// library's own invokeExtension; a failure comes back as {__acira_error} and becomes a rejected promise, or chrome.runtime.lastError during
// the callback, the way Chrome reports it. The main-process side is extension-apis.cjs.
function aciraExtraApis(ctx){
 const {electron,extensionId,manifest,ExtensionEvent,withLastError,userScriptsAllowed,chromiumConstants={}}=ctx;
 // has: Acira's permission table for this extension (manifest permissions plus granted optional ones, kept current), from ext-api/index.cjs.
 // Work packages (ext-api/*-renderer.cjs) run after everything here and replace whole namespaces; what is built here is their `base`.
 const declared=Array.isArray(manifest.permissions)?manifest.permissions:[];
 const has=typeof ctx.has==='function'?ctx.has:name=>declared.includes(name);
 const unwrap=result=>{
  if(result&&typeof result==='object'&&typeof result.__acira_error==='string')throw new Error(result.__acira_error);
  return result&&typeof result==='object'&&Object.prototype.hasOwnProperty.call(result,'__acira_value')?result.__acira_value:result;
 };
 const call=name=>(...args)=>{
  const callback=typeof args[args.length-1]==='function'?args.pop():undefined;
  const run=electron.invokeExtension(extensionId,name,{},...args).then(unwrap);
  if(callback){run.then(value=>withLastError(undefined,()=>callback(value)),error=>withLastError(String(error&&error.message||error),()=>callback()));return undefined;}
  return run;
 };
 const REASONS=['TESTING','AUDIO_PLAYBACK','IFRAME_SCRIPTING','DOM_SCRAPING','BLOBS','DOM_PARSER','USER_MEDIA','DISPLAY_MEDIA','WEB_RTC','CLIPBOARD','LOCAL_STORAGE','WORKERS','BATTERY_STATUS','MATCH_MEDIA','GEOLOCATION'];
 const enumOf=values=>Object.freeze(Object.fromEntries(values.map(value=>[value,value])));
 const USER_SCRIPTS_OFF="The 'userScripts' API is only available for users when the 'Allow User Scripts' toggle is enabled.";
 const definitions={
  offscreen:{
   shouldInject:()=>has('offscreen'),
   factory:base=>base&&typeof base.createDocument==='function'?base:{...base,Reason:enumOf(REASONS),createDocument:call('offscreen.createDocument'),closeDocument:call('offscreen.closeDocument'),hasDocument:call('offscreen.hasDocument')}
  },
  sidePanel:{
   shouldInject:()=>has('sidePanel'),
   factory:base=>base&&typeof base.setOptions==='function'?base:{...base,Side:enumOf(['left','right']),
    setOptions:call('sidePanel.setOptions'),getOptions:call('sidePanel.getOptions'),setPanelBehavior:call('sidePanel.setPanelBehavior'),getPanelBehavior:call('sidePanel.getPanelBehavior'),
    open:call('sidePanel.open'),close:call('sidePanel.close'),getLayout:call('sidePanel.getLayout'),
    onOpened:new ExtensionEvent('sidePanel.onOpened'),onClosed:new ExtensionEvent('sidePanel.onClosed')}
  },
  identity:{
   shouldInject:()=>has('identity'),
   factory:base=>base&&typeof base.launchWebAuthFlow==='function'?base:{...base,
    AccountStatus:enumOf(['SYNC','ANY']),
    getRedirectURL:path=>{const root='https://'+extensionId+'.chromiumapp.org/';try{return new URL(typeof path==='string'?path:'',root).href;}catch(e){return root;}},
    launchWebAuthFlow:call('identity.launchWebAuthFlow'),getAuthToken:call('identity.getAuthToken'),getProfileUserInfo:call('identity.getProfileUserInfo'),
    removeCachedAuthToken:call('identity.removeCachedAuthToken'),clearAllCachedAuthTokens:call('identity.clearAllCachedAuthTokens'),getAccounts:call('identity.getAccounts'),
    onSignInChanged:new ExtensionEvent('identity.onSignInChanged')}
  },
  idle:{
   shouldInject:()=>has('idle'),
   factory:base=>base&&typeof base.queryState==='function'?base:{...base,IdleState:Object.freeze({ACTIVE:'active',IDLE:'idle',LOCKED:'locked'}),queryState:call('idle.queryState'),setDetectionInterval:call('idle.setDetectionInterval'),getAutoLockDelay:call('idle.getAutoLockDelay'),onStateChanged:new ExtensionEvent('idle.onStateChanged')}
  },
  // Read from Acira's own stores of this profile; changes are refused (extension-store-apis.cjs).
  bookmarks:{
   shouldInject:()=>has('bookmarks'),
   factory:base=>base&&typeof base.getTree==='function'?base:{...base,
    get:call('bookmarks.get'),getChildren:call('bookmarks.getChildren'),getRecent:call('bookmarks.getRecent'),getTree:call('bookmarks.getTree'),getSubTree:call('bookmarks.getSubTree'),search:call('bookmarks.search'),
    create:call('bookmarks.create'),update:call('bookmarks.update'),move:call('bookmarks.move'),remove:call('bookmarks.remove'),removeTree:call('bookmarks.removeTree'),
    onCreated:new ExtensionEvent('bookmarks.onCreated'),onRemoved:new ExtensionEvent('bookmarks.onRemoved'),onChanged:new ExtensionEvent('bookmarks.onChanged'),onMoved:new ExtensionEvent('bookmarks.onMoved'),
    onChildrenReordered:new ExtensionEvent('bookmarks.onChildrenReordered'),onImportBegan:new ExtensionEvent('bookmarks.onImportBegan'),onImportEnded:new ExtensionEvent('bookmarks.onImportEnded')}
  },
  history:{
   shouldInject:()=>has('history'),
   factory:base=>base&&typeof base.search==='function'?base:{...base,search:call('history.search'),getVisits:call('history.getVisits'),addUrl:call('history.addUrl'),deleteUrl:call('history.deleteUrl'),deleteRange:call('history.deleteRange'),deleteAll:call('history.deleteAll'),
    onVisited:new ExtensionEvent('history.onVisited'),onVisitRemoved:new ExtensionEvent('history.onVisitRemoved')}
  },
  sessions:{
   shouldInject:()=>has('sessions'),
   factory:base=>base&&typeof base.getRecentlyClosed==='function'?base:{...base,MAX_SESSION_RESULTS:25,getRecentlyClosed:call('sessions.getRecentlyClosed'),getDevices:call('sessions.getDevices'),restore:call('sessions.restore'),onChanged:new ExtensionEvent('sessions.onChanged')}
  },
  // Stream ids from extension-apis.cjs; the extension's pages use them through getUserMedia (captureShim below).
  tabCapture:{
   shouldInject:()=>has('tabCapture'),
   factory:base=>base&&typeof base.getMediaStreamId==='function'?base:{...base,
    TabCaptureState:Object.freeze({PENDING:'pending',ACTIVE:'active',STOPPED:'stopped',ERROR:'error'}),
    getMediaStreamId:call('tabCapture.getMediaStreamId'),getCapturedTabs:call('tabCapture.getCapturedTabs'),
    // capture(options, callback): the active tab, from a page of the extension, as a MediaStream (Chrome: callback only).
    capture:(options,callback)=>{
     const o=options&&typeof options==='object'?options:{};
     const run=(async()=>{
      const id=unwrap(await electron.invokeExtension(extensionId,'tabCapture.captureStreamId',{},{audio:!!o.audio,video:!!o.video}));
      const part=extra=>({mandatory:{...(extra&&extra.mandatory&&typeof extra.mandatory==='object'?extra.mandatory:{}),chromeMediaSource:'tab',chromeMediaSourceId:id}});
      return navigator.mediaDevices.getUserMedia({audio:o.audio?part(o.audioConstraints):false,video:o.video?part(o.videoConstraints):false});
     })();
     run.then(stream=>{if(typeof callback==='function')withLastError(undefined,()=>callback(stream));},error=>{if(typeof callback==='function')withLastError(String(error&&error.message||error),()=>callback(null));});
     return undefined;
    },
    onStatusChanged:new ExtensionEvent('tabCapture.onStatusChanged')}
  },
  desktopCapture:{
   shouldInject:()=>has('desktopCapture'),
   factory:base=>{
    if(base&&typeof base.chooseDesktopMedia==='function')return base;
    let next=0;
    return {...base,DesktopCaptureSourceType:Object.freeze({SCREEN:'screen',WINDOW:'window',TAB:'tab',AUDIO:'audio'}),
     // chooseDesktopMedia(sources, [targetTab], callback) returns the request id at once; the callback gets the stream id ('' when cancelled).
     chooseDesktopMedia(sources,targetTab,callback){
      if(typeof targetTab==='function'){callback=targetTab;targetTab=undefined;}
      const requestId=++next,tab=targetTab&&typeof targetTab==='object'?{id:targetTab.id,url:targetTab.url}:null;
      electron.invokeExtension(extensionId,'desktopCapture.chooseDesktopMedia',{},requestId,sources,tab).then(unwrap).then(
       result=>{if(typeof callback==='function')withLastError(undefined,()=>callback(result&&result.streamId||'',{canRequestAudioTrack:!!(result&&result.canRequestAudioTrack)}));},
       error=>{if(typeof callback==='function')withLastError(String(error&&error.message||error),()=>callback(''));});
      return requestId;
     },
     cancelChooseDesktopMedia(requestId){electron.invokeExtension(extensionId,'desktopCapture.cancelChooseDesktopMedia',{},requestId);}};
   }
  },
  search:{
   shouldInject:()=>has('search'),
   factory:base=>base&&typeof base.query==='function'?base:{...base,Disposition:enumOf(['CURRENT_TAB','NEW_TAB','NEW_WINDOW']),query:call('search.query')}
  },
  // The engine keeps and validates rules but its request path never applies them; Acira's main process does (dnr-host.cjs). Each update
  // call goes to the engine first, exactly as the extension made it (its callback / promise / lastError unchanged), and once the engine
  // accepted it, the same change is sent to Acira. getMatchedRules, setExtensionActionOptions and onRuleMatchedDebug come from Acira's
  // matcher, because the engine never sees a match.
  declarativeNetRequest:{
   shouldInject:()=>has('declarativeNetRequest')||has('declarativeNetRequestWithHostAccess'),
   factory:base=>{
    if(!base||typeof base!=='object')return base;
    const sync=call('declarativeNetRequest.aciraSync');
    const lastError=()=>{try{const runtime=(globalThis.chrome||{}).runtime;return runtime&&runtime.lastError;}catch(e){return undefined;}};
    const forward=(name,kind)=>{
     const native=typeof base[name]==='function'?base[name].bind(base):null;if(!native)return undefined;
     return (...args)=>{
      const callback=typeof args[args.length-1]==='function'?args.pop():undefined,options=args[0];
      const run=new Promise((resolve,reject)=>{try{native(options,value=>{const error=lastError();if(error)reject(new Error(error.message));else resolve(value);});}catch(error){reject(error);}})
       .then(value=>sync(kind,options).catch(error=>console.warn('Acira could not apply this rule change:',String(error&&error.message||error))).then(()=>value));
      if(callback){run.then(value=>withLastError(undefined,()=>callback(value)),error=>withLastError(String(error&&error.message||error),()=>callback()));return undefined;}
      return run;
     };
    };
    const overrides={
     updateDynamicRules:forward('updateDynamicRules','dynamic'),updateSessionRules:forward('updateSessionRules','session'),
     updateEnabledRulesets:forward('updateEnabledRulesets','enabled'),updateStaticRules:forward('updateStaticRules','static'),
     getMatchedRules:call('declarativeNetRequest.getMatchedRules'),
     setExtensionActionOptions:(()=>{const ours=call('declarativeNetRequest.setExtensionActionOptions'),native=typeof base.setExtensionActionOptions==='function'?base.setExtensionActionOptions.bind(base):null;
      return (options,callback)=>{const run=ours(options).then(value=>{if(native)try{native(options,()=>void lastError());}catch(e){}return value;});if(typeof callback==='function'){run.then(()=>withLastError(undefined,()=>callback()),error=>withLastError(String(error&&error.message||error),()=>callback()));return undefined;}return run;};})(),
     onRuleMatchedDebug:has('declarativeNetRequestFeedback')?new ExtensionEvent('declarativeNetRequest.onRuleMatchedDebug'):base.onRuleMatchedDebug
    };
    for(const key of Object.keys(overrides))if(overrides[key]===undefined)delete overrides[key];
    // A Proxy may not report another value for a non-configurable property; then the overrides sit on an object that inherits the rest.
    const fixed=Object.keys(overrides).some(key=>{const d=Object.getOwnPropertyDescriptor(base,key);return !!d&&d.configurable===false;});
    if(fixed){const api=Object.create(base);for(const key of Object.keys(overrides))Object.defineProperty(api,key,{value:overrides[key],enumerable:true,configurable:true,writable:true});return api;}
    const bound=new Map();
    return new Proxy(base,{
     get(target,key){if(Object.prototype.hasOwnProperty.call(overrides,key))return overrides[key];const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(!bound.has(key))bound.set(key,value.bind(target));return bound.get(key);},
     has(target,key){return Object.prototype.hasOwnProperty.call(overrides,key)||Reflect.has(target,key);}
    });
   }
  },
  userScripts:{
   shouldInject:()=>has('userScripts'),
   factory:base=>{
    if(base&&typeof base.register==='function')return base;
    // As in Chrome 138+: with the switch off every call throws at once, which is how extensions detect it (try { chrome.userScripts.getScripts(); }).
    const gated=name=>{const run=call('userScripts.'+name);return (...args)=>{if(!userScriptsAllowed)throw new Error(USER_SCRIPTS_OFF);return run(...args);};};
    return {...base,ExecutionWorld:enumOf(['MAIN','USER_SCRIPT']),
     register:gated('register'),update:gated('update'),unregister:gated('unregister'),getScripts:gated('getScripts'),execute:gated('execute'),
     configureWorld:gated('configureWorld'),getWorldConfigurations:gated('getWorldConfigurations'),resetWorldConfiguration:gated('resetWorldConfiguration')};
   }
  }
 };
 // Chromium 152 also gives extension pages and workers the WebExtensions name `browser`, a separate object from `chrome` that holds only
 // the engine's native namespaces. The library completes `chrome` alone, so code that prefers `browser` (webextension-polyfill does whenever
 // browser.runtime.id is set: 1Password, Proton Pass) found browser.windows / browser.permissions / browser.action undefined and its
 // service worker died at startup. `browser` gets the same namespace objects as `chrome` for every namespace the engine or Acira supplies.
 function mirrorBrowser(chrome,keys){
  const browser=globalThis.browser;if(!chrome||!browser||typeof browser!=='object'||browser===chrome)return;
  for(const key of keys){
   if(!Object.prototype.hasOwnProperty.call(chrome,key))continue;
   try{Object.defineProperty(browser,key,{value:chrome[key],enumerable:true,configurable:true});}catch(e){}
  }
 }
 // Chrome's constants and enums on tabs and windows. The library's tabs object has none (only windows.WINDOW_ID_NONE / _CURRENT), so code
 // like Todoist's worker, which builds a session rule with tabIds: [chrome.tabs.TAB_ID_NONE], threw at startup ("expected integer, found
 // undefined") before it registered its handlers. Values as in Chrome; anything already present is left alone.
 const CONSTANTS={
  tabs:{TAB_ID_NONE:-1,TAB_INDEX_NONE:-1,MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND:2,
   TabStatus:enumOf(['unloaded','loading','complete']),WindowType:enumOf(['normal','popup','panel','app','devtools']),
   MutedInfoReason:enumOf(['user','capture','extension']),ZoomSettingsMode:enumOf(['automatic','manual','disabled']),ZoomSettingsScope:enumOf(['per-origin','per-tab'])},
  windows:{WINDOW_ID_NONE:-1,WINDOW_ID_CURRENT:-2,WindowType:enumOf(['normal','popup','panel','app','devtools']),
   WindowState:enumOf(['normal','minimized','maximized','fullscreen','locked-fullscreen']),CreateType:enumOf(['normal','popup','panel'])}
 };
 function constantAdditions(chrome){
  // chrome.tabs.captureVisibleTab([windowId], [options], [callback]) is not in the engine (ColorZilla's eyedropper); extension-apis.cjs answers it.
  const tabs=chrome&&chrome.tabs;
  if(tabs&&typeof tabs==='object'&&typeof tabs.captureVisibleTab!=='function')try{Object.defineProperty(tabs,'captureVisibleTab',{value:call('tabs.captureVisibleTab'),enumerable:true,configurable:true,writable:true});}catch(e){}
  for(const [namespace,values] of Object.entries(CONSTANTS)){
   const target=chrome&&chrome[namespace];if(!target||typeof target!=='object')continue;
   for(const [key,value] of Object.entries(values)){
    if(target[key]!==undefined)continue;
    // Chrome's enums are keyed by the upper-case name (TabStatus.COMPLETE === 'complete').
    const out=value&&typeof value==='object'?Object.freeze(Object.fromEntries(Object.values(value).map(v=>[v.toUpperCase().replace(/-/g,'_'),v]))):value;
    try{Object.defineProperty(target,key,{value:out,enumerable:true,configurable:true});}catch(e){}
   }
  }
  // Every other constant and enum Chromium 152 defines (tabs.SPLIT_VIEW_ID_NONE, contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT,
  // runtime.OnInstalledReason, ...), on the namespaces this extension has; anything the engine already defines is left alone.
  for(const [path,values] of Object.entries(chromiumConstants||{})){
   let target=chrome;
   try{for(const part of path.split('.'))target=target&&typeof target==='object'?target[part]:undefined;}catch(e){target=undefined;}
   if(!target||typeof target!=='object')continue;
   for(const [key,value] of Object.entries(values)){
    let present;try{present=target[key]!==undefined;}catch(e){present=true;}
    if(present)continue;
    try{Object.defineProperty(target,key,{value:value&&typeof value==='object'?Object.freeze({...value}):value,enumerable:true,configurable:true});}catch(e){}
   }
  }
 }
 // chrome.system.storage: Chromium's native functions need a StorageMonitor that Electron never creates, so calling getInfo /
 // getAvailableCapacity / ejectDevice, or adding an onAttached / onDetached listener, ended the whole browser (main process). The namespace
 // is replaced on `chrome` and on Chromium's separate `browser` object, so the native one is never reachable; extension-apis.cjs answers.
 let systemStorage=null;
 function systemAdditions(root){
  if(!has('system.storage')||!root||typeof root!=='object')return;
  let system;try{system=root.system;}catch(e){return;}
  if(!system||typeof system!=='object')return;
  if(!systemStorage)systemStorage={
   EjectDeviceResultCode:Object.freeze({SUCCESS:'success',IN_USE:'in_use',NO_SUCH_DEVICE:'no_such_device',FAILURE:'failure'}),
   StorageUnitType:Object.freeze({FIXED:'fixed',REMOVABLE:'removable',UNKNOWN:'unknown'}),
   getInfo:call('system.storage.getInfo'),ejectDevice:call('system.storage.ejectDevice'),getAvailableCapacity:call('system.storage.getAvailableCapacity'),
   onAttached:new ExtensionEvent('system.storage.onAttached'),onDetached:new ExtensionEvent('system.storage.onDetached')};
  try{Object.defineProperty(system,'storage',{value:systemStorage,enumerable:true,configurable:true,writable:true});}catch(e){}
  let replaced=false;try{replaced=system.storage===systemStorage;}catch(e){}
  if(!replaced){
   // A namespace object that refuses the new property: give `system` a copy holding the native cpu/display/memory and our storage.
   const copy={storage:systemStorage};
   for(const key of ['cpu','display','memory'])try{if(system[key])copy[key]=system[key];}catch(e){}
   try{Object.defineProperty(root,'system',{value:copy,enumerable:true,configurable:true,writable:true});}catch(e){}
  }
 }
 // Small Chrome behaviours the engine gets wrong (docs/launch/EXTENSION_API_COVERAGE.md, quick wins).
 const answer=(compute,error)=>(...args)=>{
  const callback=typeof args[args.length-1]==='function'?args.pop():undefined;
  const run=error?Promise.reject(new Error(error)):Promise.resolve().then(()=>compute(...args));
  if(callback){run.then(value=>withLastError(undefined,()=>callback(value)),e=>withLastError(String(e&&e.message||e),()=>callback()));return undefined;}
  return run;
 };
 function quickFixes(chrome){
  // storage.managed is policy data: read-only and, with no policy set, empty. The engine made it the same object as storage.local, so an
  // extension reading its "managed" settings got (and could overwrite) its own local data. Chromium's write error: policy_value_store.cc.
  const storage=chrome&&chrome.storage;
  if(storage&&typeof storage==='object'&&has('storage')){
   const READ_ONLY='This is a read-only store.';
   const managed={
    get:answer(keys=>(keys&&typeof keys==='object'&&!Array.isArray(keys)?{...keys}:{})),getKeys:answer(()=>[]),getBytesInUse:answer(()=>0),
    set:answer(null,READ_ONLY),remove:answer(null,READ_ONLY),clear:answer(null,READ_ONLY),setAccessLevel:answer(null,READ_ONLY),
    onChanged:new ExtensionEvent('storage.managed.onChanged')};
   try{Object.defineProperty(storage,'managed',{value:managed,enumerable:true,configurable:true,writable:true});}catch(e){}
  }
  // downloads.search answered undefined (the engine's placeholder); Chrome always answers with an array. Acira has no downloads API for
  // extensions yet (WP4), so the answer is an empty list instead of a value that breaks `.length`.
  const downloads=chrome&&chrome.downloads;
  if(downloads&&typeof downloads==='object'&&has('downloads'))try{Object.defineProperty(downloads,'search',{value:answer(()=>[]),enumerable:true,configurable:true,writable:true});}catch(e){}
  // action: Chrome 152 members the engine lacks. Badge text colours are kept by extension-apis.cjs; isEnabled answers true because the
  // engine's enable/disable do not grey the button yet (so every button is in fact enabled).
  const action=chrome&&chrome.action;
  if(action&&typeof action==='object'){
   // The engine's renderer can carry Chromium's own bindings for these, but nothing answers them in the browser process (isEnabled said
   // false, getBadgeTextColor []), so Acira's always replace them.
   const add=(key,value,always)=>{if(!always&&action[key]!==undefined)return;try{Object.defineProperty(action,key,{value,enumerable:true,configurable:true,writable:true});}catch(e){}};
   add('setBadgeTextColor',call('action.setBadgeTextColor'),true);add('getBadgeTextColor',call('action.getBadgeTextColor'),true);add('isEnabled',call('action.isEnabled'),true);
   add('onUserSettingsChanged',new ExtensionEvent('action.onUserSettingsChanged'));
  }
  // notifications.getAll answers an object keyed by notification id (Chrome), not an array.
  const notifications=chrome&&chrome.notifications;
  if(notifications&&typeof notifications==='object'&&typeof notifications.getAll==='function'){
   const native=notifications.getAll.bind(notifications);
   const toMap=value=>{if(!Array.isArray(value))return value&&typeof value==='object'?value:{};const out={};for(const item of value){const id=typeof item==='string'?item:item&&typeof item.id==='string'?item.id:null;if(id)out[id]=true;}return out;};
   try{Object.defineProperty(notifications,'getAll',{value:answer(async()=>toMap(await native())),enumerable:true,configurable:true,writable:true});}catch(e){}
  }
 }
 // Added to chrome.runtime, tabs and windows after the library built them (they are plain objects there).
 function after(chrome,keys=[]){
  try{systemAdditions(chrome);if(typeof globalThis.browser==='object'&&globalThis.browser!==chrome)systemAdditions(globalThis.browser);}catch(e){}
  try{quickFixes(chrome);}catch(e){}
  try{runtimeAdditions(chrome);constantAdditions(chrome);captureShim();}finally{mirrorBrowser(chrome,keys);}
 }
 // getUserMedia({video|audio: {mandatory: {chromeMediaSource: 'tab' | 'desktop', chromeMediaSourceId}}}) in a page of an extension that
 // may capture. Electron cannot resolve Chrome's stream ids, so the id is checked and used up in the main process ('mediaCapture.arm'),
 // which arms this page; getDisplayMedia is then answered by the session's handler with that tab or screen, without a picker. Every other
 // getUserMedia call (camera, microphone) goes to the browser unchanged.
 function captureShim(){
  if(!has('tabCapture')&&!has('desktopCapture'))return;
  const devices=typeof navigator!=='undefined'&&navigator.mediaDevices;
  if(!devices||typeof devices.getUserMedia!=='function'||typeof devices.getDisplayMedia!=='function')return;
  const userMedia=devices.getUserMedia.bind(devices),displayMedia=devices.getDisplayMedia.bind(devices);
  const read=part=>{
   if(!part||typeof part!=='object')return null;
   const m=part.mandatory&&typeof part.mandatory==='object'?part.mandatory:part,source=m.chromeMediaSource,id=m.chromeMediaSourceId;
   return (source==='tab'||source==='desktop'||source==='system')&&typeof id==='string'&&id?{id,width:+m.maxWidth||0,height:+m.maxHeight||0,frameRate:+m.maxFrameRate||0}:null;
  };
  const tell=(name,captureId)=>electron.invokeExtension(extensionId,name,{},captureId).catch(()=>undefined),running=new Map();
  // The sharing pill's Stop (main process) ends this page's capture: every track stops and fires "ended", as when the person stops a share in Chrome.
  try{Object.defineProperty(devices,Symbol.for('acira.capture.stop'),{configurable:true,value:captureId=>{const tracks=running.get(captureId);if(!tracks)return false;for(const track of [...tracks]){try{track.stop();track.dispatchEvent(new Event('ended'));}catch(e){}}return true;}});}catch(e){}
  async function captured(video,audio){
   const armed=unwrap(await electron.invokeExtension(extensionId,'mediaCapture.arm',{},(video||audio).id));
   let stream;
   try{stream=await displayMedia({video:true,audio:!!audio&&!!armed.audio});}
   catch(error){tell('mediaCapture.ended',armed.captureId);throw error;}
   if(!video)for(const track of stream.getVideoTracks()){track.stop();stream.removeTrack(track);}
   else{const want={};if(video.width>0)want.width={max:video.width};if(video.height>0)want.height={max:video.height};if(video.frameRate>0)want.frameRate={max:video.frameRate};const track=stream.getVideoTracks()[0];if(track&&Object.keys(want).length)track.applyConstraints(want).catch(()=>undefined);}
   // The capture ends when every track has ended or been stopped (stop() fires no "ended" event, so it is watched too).
   const live=new Set(stream.getTracks()),gone=track=>{if(!live.delete(track))return;if(!live.size){running.delete(armed.captureId);tell('mediaCapture.ended',armed.captureId);}};
   running.set(armed.captureId,live);
   for(const track of live){track.addEventListener('ended',()=>gone(track),{once:true});const stop=track.stop;try{Object.defineProperty(track,'stop',{configurable:true,writable:true,value:function(){stop.call(this);gone(track);}});}catch(e){}}
   tell('mediaCapture.started',armed.captureId);
   return stream;
  }
  const getUserMedia=function getUserMedia(constraints){
   const c=constraints&&typeof constraints==='object'?constraints:{},video=read(c.video),audio=read(c.audio);
   return video||audio?captured(video,audio):userMedia(constraints);
  };
  try{Object.defineProperty(devices,'getUserMedia',{value:getUserMedia,configurable:true,writable:true});}catch(e){}
  // Old extensions still use navigator.webkitGetUserMedia(constraints, success, failure).
  if(typeof navigator.webkitGetUserMedia==='function')try{const legacy=navigator.webkitGetUserMedia.bind(navigator);Object.defineProperty(navigator,'webkitGetUserMedia',{configurable:true,writable:true,value:(constraints,success,failure)=>{const c=constraints||{};if(!read(c.video)&&!read(c.audio))return legacy(constraints,success,failure);getUserMedia(c).then(success,failure);}});}catch(e){}
 }
 function runtimeAdditions(chrome){
  const runtime=chrome&&chrome.runtime;if(!runtime||typeof runtime!=='object')return;
  const define=(key,value,always=false)=>{if(!always&&runtime[key]!==undefined)return;try{Object.defineProperty(runtime,key,{value,enumerable:true,configurable:true,writable:true});}catch(e){}};
  if(manifest.manifest_version===3){define('ContextType',enumOf(['TAB','POPUP','BACKGROUND','OFFSCREEN_DOCUMENT','SIDE_PANEL','DEVELOPER_TOOLS']));/* the engine's native getContexts misses Acira's side panel; Acira's own list is merged in (native entries first, one per type and address) */
   {const native=typeof runtime.getContexts==='function'?runtime.getContexts.bind(runtime):null,ours=call('runtime.getContexts');
    define('getContexts',(...args)=>{const callback=typeof args[args.length-1]==='function'?args.pop():undefined,filter=args[0]||{};
     const run=Promise.all([native?Promise.resolve().then(()=>native(filter)).catch(()=>[]):[],ours(filter).catch(()=>[])]).then(([first,second])=>{const seen=new Set(),out=[];for(const context of [...(Array.isArray(first)?first:[]),...(Array.isArray(second)?second:[])]){const key=context&&context.contextType+'|'+context.documentUrl;if(!context||seen.has(key))continue;seen.add(key);out.push(context);}return out;});
     if(callback){run.then(value=>withLastError(undefined,()=>callback(value)));return undefined;}return run;},true);}}
  if(has('userScripts')){
   // Messages from user scripts (USER_SCRIPT world with messaging on) arrive here; sendResponse answers the script's sendMessage.
   const listeners=[];let attached=false;
   const relay=(message,sender,replyId)=>{
    let answered=false,waiting=false;
    const sendResponse=response=>{if(answered)return;answered=true;electron.invokeExtension(extensionId,'userScripts.reply',{},replyId,response);};
    for(const listener of listeners.slice()){
     try{const result=listener(message,sender,sendResponse);if(result===true)waiting=true;else if(result&&typeof result.then==='function'){waiting=true;result.then(sendResponse,()=>sendResponse(undefined));}}catch(error){console.error(error);}
    }
    if(!waiting&&!answered)sendResponse(undefined);
   };
   const event={
    addListener(callback){if(typeof callback!=='function'||listeners.includes(callback))return;listeners.push(callback);if(!attached){attached=true;electron.addExtensionListener(extensionId,'runtime.onUserScriptMessage',relay);}},
    removeListener(callback){const at=listeners.indexOf(callback);if(at>=0)listeners.splice(at,1);},
    hasListener(callback){return listeners.includes(callback);},
    hasListeners(){return listeners.length>0;}
   };
   // Always ours: the engine's renderer may carry Chromium's own (inert here) event object under the same name.
   define('onUserScriptMessage',event,true);
   define('onUserScriptConnect',{addListener(){},removeListener(){},hasListener(){return false;},hasListeners(){return false;}},true);
  }
 }
 return {definitions,after};
}

/** Chromium's constants and enums per namespace, from the generated surface (extension-api-surface.gen.cjs): values only, never behaviour.
 *  Enum keys follow Chromium's GetJSEnumEntryName (camelCase split with '_', '-' as '_', upper case, '_' before a leading digit). */
let constantsCache=null;
function chromiumConstants(){
 if(constantsCache)return constantsCache;
 let surface;try{surface=require('./extension-api-surface.gen.cjs');}catch{return constantsCache={};}
 const enumKey=value=>{let out=/^\d/.test(value)?'_':'';for(let i=0;i<value.length;i++){const c=value[i];if(i>0&&/[a-z]/.test(value[i-1])&&/[A-Z]/.test(c))out+='_'+c;else out+=c==='-'?'_':c.toUpperCase();}return out;};
 const out={};
 for(const [namespace,schema] of Object.entries(surface.namespaces||{})){
  if(schema.status!=='exposed'&&schema.status!=='developer-mode')continue;
  const values={};
  for(const [name,prop] of Object.entries(schema.properties||{}))if(prop&&prop.value!==undefined&&!prop.$ref&&typeof prop.value!=='object')values[name]=prop.value;
  for(const [name,type] of Object.entries(schema.types||{}))if(Array.isArray(type.enum))values[name]=Object.fromEntries(type.enum.map(v=>[enumKey(String(v)),v]));
  if(Object.keys(values).length)out[namespace]=values;
 }
 return constantsCache=out;
}

/** The text that goes into the preload: the function above, called with the library's own helpers. */
function rendererSource(options={}){
 const {userScriptsAllowed=[]}=options;
 const allowed=JSON.stringify([...new Set(userScriptsAllowed.filter(id=>/^[a-p]{32}$/.test(id)))].sort());
 // The ext-api runtime (ext-api/index.cjs: packages, permission table) first, so the shims below see the same permission table.
 return `const acira_ext = ${require('./ext-api/index.cjs').rendererSource(options)};\n`+
  `      const acira_extra = (${aciraExtraApis.toString()})({ electron, extensionId, manifest, ExtensionEvent, withLastError: acira_withLastError, userScriptsAllowed: ${allowed}.includes(extensionId), chromiumConstants: ${JSON.stringify(chromiumConstants())}, has: acira_ext.has });`;
}

module.exports={aciraExtraApis,rendererSource,chromiumConstants};
