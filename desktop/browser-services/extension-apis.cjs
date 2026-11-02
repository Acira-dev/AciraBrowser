'use strict';
// Main-process side of the Chrome namespaces electron-chrome-extensions 4.9 lacks (renderer side: extension-apis-renderer.cjs, written into the
// engine's preload by extension-runtime-patch.cjs). Handlers are added to the engine's own router, so its checks apply (the call must come from a
// loaded extension of this session; permission names are checked here and the namespace only exists when the manifest declares it).
//  - chrome.offscreen: one hidden document per extension, a WebContentsView of the extension's session that is never shown.
//  - chrome.runtime.getContexts: background worker, offscreen document, side panel and extension tabs.
//  - chrome.identity: launchWebAuthFlow in a small Acira window that shows the sign-in site's address and ends at https://<id>.chromiumapp.org/
//    (that address is never requested); getAuthToken needs a Google account in the browser, which Acira does not have, so it fails clearly.
//  - chrome.sidePanel: options, behaviour and open/close, shown by the window's side panel host (extension-side-panel.cjs).
//  - chrome.userScripts: register/update/unregister/getScripts/execute and worlds (user-scripts.cjs), only for extensions whose
//    "Allow user scripts" switch is on.
//  - chrome.tabCapture and chrome.desktopCapture: stream ids after Chrome's checks, Acira's share picker (media-capture.cjs, share-ui.cjs).
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {createUserScriptRegistry,matchesPattern}=require('./user-scripts.cjs');
const capture=require('./media-capture.cjs');
const {globMatch}=require('./glob-match.cjs');

const REASONS=['TESTING','AUDIO_PLAYBACK','IFRAME_SCRIPTING','DOM_SCRAPING','BLOBS','DOM_PARSER','USER_MEDIA','DISPLAY_MEDIA','WEB_RTC','CLIPBOARD','LOCAL_STORAGE','WORKERS','BATTERY_STATUS','MATCH_MEDIA','GEOLOCATION'];
const CONTEXT_TYPES=['TAB','POPUP','BACKGROUND','OFFSCREEN_DOCUMENT','SIDE_PANEL','DEVELOPER_TOOLS'];
const MESSAGES={
 offscreenOne:'Only a single offscreen document may be created.',offscreenNone:'No current offscreen document.',
 offscreenReasons:'A reason must be provided.',offscreenJustification:'A justification must be provided.',offscreenUrl:'Invalid URL.',offscreenLoad:'Page failed to load.',
 notSignedIn:'The user is not signed in.',noApproval:'The user did not approve access.',interaction:'User interaction required.',authLoad:'Authorization page could not be loaded.',
 noPanel:'No active side panel for the specified window or tab.',panelHost:'The side panel is not available in this window.',panelPath:'Side panel path is not set.',
 noReceiver:'Could not establish connection. Receiving end does not exist.',tabAccess:'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
 noTab:'No tab with id: ',
 captureQuota:'This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.',captureNoTab:'No active web contents to capture',
 captureAccess:"Either the '<all_urls>' or 'activeTab' permission is required."
};
const failure=message=>({__acira_error:String(message)});
/** Does the granted match pattern cover every address the asked one does? (scheme, host with *. subdomains, path glob) */
function patternCovers(granted,asked){
 if(granted===asked||granted==='<all_urls>')return true;
 if(asked==='<all_urls>')return false;
 const parse=p=>/^(\*|https?|wss?|file|ftp|urn):\/\/([^/]*)(\/.*)$/.exec(String(p));
 const g=parse(granted),a=parse(asked);if(!g||!a)return false;
 const schemeOk=g[1]===a[1]||(g[1]==='*'&&['http','https','ws','wss'].includes(a[1]));
 const host=a[2],wild=g[2];
 const hostOk=wild==='*'||wild===host||(wild.startsWith('*.')&&(host===wild.slice(2)||host.endsWith(wild.slice(1))));
 const pathOk=globMatch(g[3],a[3]);
 return schemeOk&&hostOk&&pathOk;
}
const permitted=(extension,name)=>Array.isArray(extension?.manifest?.permissions)&&extension.manifest.permissions.includes(name);
const originOf=id=>`chrome-extension://${id}`;

/** A badge colour as Chrome takes it: [r, g, b, a] (0-255) or a CSS colour string (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()). null if invalid. */
function parseBadgeColor(value){
 const byte=n=>Number.isInteger(n)&&n>=0&&n<=255;
 if(Array.isArray(value))return value.length===4&&value.every(byte)?[...value]:null;
 if(typeof value!=='string')return null;
 const s=value.trim().toLowerCase();
 let m=s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
 if(m){let h=m[1];if(h.length<=4)h=[...h].map(c=>c+c).join('');const n=[0,2,4,6].map(i=>i<h.length?parseInt(h.slice(i,i+2),16):255);return n;}
 m=s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/);
 if(m){const rgb=[m[1],m[2],m[3]].map(Number);const a=m[4]===undefined?255:Math.round(Math.min(1,Math.max(0,Number(m[4])))*255);return rgb.every(byte)?[...rgb,a]:null;}
 return null;
}

/** chrome.system.storage answered by Acira: every mounted drive (Windows: C: … Z:, elsewhere /) as a fixed unit, sizes from fs.statfs.
 *  Ids are stable per root and opaque, as in Chrome. A drive that does not answer within `timeout` ms is left out. */
function createSystemStorage({platform=process.platform,statfs=root=>require('node:fs').promises.statfs(root),timeout=1500}={}){
 const roots=()=>platform==='win32'?'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter=>letter+':\\'):['/'];
 const idFor=root=>require('node:crypto').createHash('sha256').update('acira-system-storage:'+root).digest('hex').slice(0,32);
 const stat=root=>new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),timeout);timer.unref?.();Promise.resolve().then(()=>statfs(root)).then(value=>{clearTimeout(timer);resolve(value);},()=>{clearTimeout(timer);resolve(null);});});
 async function units(){const list=roots(),stats=await Promise.all(list.map(stat));return list.map((root,i)=>stats[i]&&Number(stats[i].blocks)>0?{root,stat:stats[i]}:null).filter(Boolean);}
 return {
  async getInfo(){return (await units()).map(({root,stat})=>({id:idFor(root),name:root,type:'fixed',capacity:Number(stat.blocks)*Number(stat.bsize)}));},
  async getAvailableCapacity(id){
   const unit=(await units()).find(u=>idFor(u.root)===id);
   return unit?{id,availableCapacity:Number(unit.stat.bavail)*Number(unit.stat.bsize)}:failure('Error occurred when querying available capacity.');
  },
  // Every unit Acira reports is a fixed drive; Chrome answers no_such_device for an id it cannot eject.
  async ejectDevice(){return 'no_such_device';}
 };
}

/** Resolves a path an extension gives (relative to its root, or a full URL of itself) to an address inside the extension, or null. */
function extensionURL(id,value){
 if(typeof value!=='string'||!value||value.length>4096)return null;
 let url;try{url=new URL(value,originOf(id)+'/');}catch{return null;}
 return url.protocol==='chrome-extension:'&&url.hostname===id&&!url.username&&!url.password?url.href:null;
}

function defaultOffscreenContents(session){
 const {WebContentsView}=require('electron');
 const view=new WebContentsView({webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,spellcheck:false}});
 return {view,webContents:view.webContents};
}

function createOffscreen({session,createContents=defaultOffscreenContents,onChange=()=>{}}){
 const documents=new Map();
 function close(id){const doc=documents.get(id);if(!doc)return false;documents.delete(id);try{if(!doc.webContents.isDestroyed())(doc.webContents.close||doc.webContents.destroy).call(doc.webContents);}catch{}onChange(id);return true;}
 return {
  documents,
  async create(event,params){
   const extension=event.extension,id=extension.id;
   if(!params||typeof params!=='object')return failure(MESSAGES.offscreenUrl);
   const url=extensionURL(id,params.url);if(!url)return failure(MESSAGES.offscreenUrl);
   const reasons=Array.isArray(params.reasons)?params.reasons:[];if(!reasons.length||reasons.some(r=>!REASONS.includes(r)))return failure(MESSAGES.offscreenReasons);
   if(typeof params.justification!=='string'||!params.justification.trim())return failure(MESSAGES.offscreenJustification);
   if(documents.has(id))return failure(MESSAGES.offscreenOne);
   const created=createContents(session),wc=created.webContents,doc={...created,url,reasons:[...reasons],justification:params.justification.slice(0,1024),documentId:crypto.randomUUID().replace(/-/g,'').toUpperCase(),contextId:crypto.randomUUID()};
   documents.set(id,doc);
   try{
    wc.setWindowOpenHandler?.(()=>({action:'deny'}));
    wc.on?.('will-navigate',(navigation,target)=>{if(!String(target||navigation?.url||'').startsWith(originOf(id)+'/'))navigation.preventDefault?.();});
    wc.once?.('destroyed',()=>{if(documents.get(id)===doc){documents.delete(id);onChange(id);}});
    await wc.loadURL(url);
   }catch{close(id);return failure(MESSAGES.offscreenLoad);}
   onChange(id);return undefined;
  },
  closeDocument(event){return close(event.extension.id)?undefined:failure(MESSAGES.offscreenNone);},
  hasDocument(event){return documents.has(event.extension.id);},
  close,
  closeAll(){for(const id of [...documents.keys()])close(id);}
 };
}

function defaultAuthWindow({session,parent,title}){
 const {BrowserWindow}=require('electron');
 return new BrowserWindow({width:520,height:680,minWidth:380,minHeight:420,show:false,parent:parent&&!parent.isDestroyed?.()?parent:undefined,autoHideMenuBar:true,
  minimizable:false,maximizable:false,fullscreenable:false,title,icon:path.join(__dirname,'..','..','dist','app-icon.png'),
  webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false}});
}

function createIdentity({session,getWindow=()=>null,createWindow=defaultAuthWindow,t=(id,p)=>`${p?.name||''} — ${p?.host||''}`,hidden=()=>process.env.ACIRA_BROWSER_TEST_HIDDEN==='1'}){
 const flows=new Map();
 function launchWebAuthFlow(event,details){
  const extension=event.extension,id=extension.id,redirectHost=`${id}.chromiumapp.org`;
  let start;try{start=new URL(String(details?.url||''));}catch{return failure(MESSAGES.authLoad);}
  if(!['https:','http:'].includes(start.protocol)||start.username||start.password)return failure(MESSAGES.authLoad);
  const interactive=details?.interactive===true,abortOnLoad=details?.abortOnLoadForNonInteractive!==false,waitAfterLoad=Math.max(0,Math.min(Number(details?.timeoutMsForNonInteractive)||0,60000));
  flows.get(id)?.finish(failure(MESSAGES.noApproval));
  const name=String(extension.name||extension.manifest?.name||'Extension').slice(0,80);
  const titleFor=value=>{let host='';try{host=new URL(value).host;}catch{}return t('ext.signInWindowTitle',{name,host});};
  const win=createWindow({session,parent:getWindow(),title:titleFor(start.href)}),wc=win.webContents;
  return new Promise(resolve=>{
   let done=false,timer=null,cap=null;
   const finish=value=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(cap);flows.delete(id);setImmediate(()=>{try{if(!win.isDestroyed())win.destroy();}catch{}});resolve(value);};
   flows.set(id,{finish});
   const reached=target=>{let url;try{url=new URL(target);}catch{return false;}if(url.hostname!==redirectHost||url.protocol!=='https:')return false;finish(target);return true;};
   wc.on('will-redirect',(navigation,target)=>{if(reached(typeof target==='string'?target:navigation?.url))navigation.preventDefault?.();});
   wc.on('will-navigate',(navigation,target)=>{if(reached(typeof target==='string'?target:navigation?.url))navigation.preventDefault?.();});
   wc.on('did-start-navigation',(navigation,target,inPlace,isMainFrame)=>{const url=typeof target==='string'?target:navigation?.url,main=typeof isMainFrame==='boolean'?isMainFrame:navigation?.isMainFrame!==false;if(main)reached(url);/* never wc.stop() here: stopping a navigation inside did-start-navigation ends Electron 44's main process natively (the whole browser closed on every successful sign-in); finish() destroys the window on the next tick */});
   wc.on('did-navigate',(_event,url)=>{try{if(!win.isDestroyed())win.setTitle(titleFor(url));}catch{}});
   win.on('page-title-updated',event=>event.preventDefault?.());   // the window keeps "<extension> sign-in · <host>": a provider page cannot retitle it (the event is the window's, not the contents')
   wc.setWindowOpenHandler?.(()=>({action:'deny'}));
   wc.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3&&!interactive)finish(failure(MESSAGES.authLoad));});
   wc.on('did-stop-loading',()=>{if(done||interactive||!abortOnLoad)return;clearTimeout(timer);timer=setTimeout(()=>finish(failure(MESSAGES.interaction)),waitAfterLoad);});
   win.on('closed',()=>finish(failure(MESSAGES.noApproval)));
   if(interactive)win.once('ready-to-show',()=>{if(!done&&!hidden())win.show();});
   cap=setTimeout(()=>finish(failure(interactive?MESSAGES.noApproval:MESSAGES.interaction)),interactive?15*60*1000:60*1000);
   wc.loadURL(start.href).catch(()=>{});
  });
 }
 return {
  launchWebAuthFlow,
  getAuthToken:()=>failure(MESSAGES.notSignedIn),
  getProfileUserInfo:()=>({email:'',id:''}),
  removeCachedAuthToken:()=>undefined,clearAllCachedAuthTokens:()=>undefined,getAccounts:()=>[],
  closeAll(){for(const flow of [...flows.values()])flow.finish(failure(MESSAGES.noApproval));}
 };
}

function createSidePanel({getExtension,host,emit}){
 const state=new Map();
 const of=id=>{let entry=state.get(id);if(!entry){entry={behavior:{openPanelOnActionClick:false},global:{},tabs:new Map()};state.set(id,entry);}return entry;};
 const manifestPath=id=>getExtension(id)?.manifest?.side_panel?.default_path;
 /** The page and switch for one tab: tab-specific options override the extension-wide ones, which start from the manifest. */
 function options(id,tabId){const entry=of(id),global={path:entry.global.path??manifestPath(id),enabled:entry.global.enabled??true},tab=tabId!==undefined?entry.tabs.get(tabId):undefined;return {path:tab?.path??global.path,enabled:tab?.enabled??global.enabled};}
 function urlFor(id,tabId){const found=options(id,tabId);if(!found.enabled||!found.path)return null;return extensionURL(id,found.path);}
 async function open(id,{windowId,tabId,sender}={}){
  if(!host)return failure(MESSAGES.panelHost);const url=urlFor(id,tabId);if(!url)return failure(MESSAGES.panelPath);
  const extension=getExtension(id);let opened;const onClosed=details=>emit(id,'sidePanel.onClosed',{windowId:opened?.windowId??windowId??-1,path:details?.url||url});try{opened=await host.open({extensionId:id,name:String(extension?.name||extension?.manifest?.name||'Extension'),url,windowId,tabId,sender,onClosed});}catch(error){return failure(error?.message||MESSAGES.panelHost);}
  if(opened?.error)return failure(opened.error);
  emit(id,'sidePanel.onOpened',{windowId:opened?.windowId??windowId??-1,path:extensionURL(id,options(id,tabId).path),...(tabId!==undefined?{tabId}:{})});
  return undefined;
 }
 return {
  setOptions(event,input){
   const id=event.extension.id;if(!input||typeof input!=='object')return failure('Invalid options.');
   if(input.path!==undefined&&(typeof input.path!=='string'||!extensionURL(id,input.path)))return failure('Invalid side panel path.');
   if(input.enabled!==undefined&&typeof input.enabled!=='boolean')return failure('Invalid enabled value.');
   const entry=of(id),target=input.tabId!==undefined?(entry.tabs.get(input.tabId)||{}):entry.global;
   if(input.path!==undefined)target.path=input.path;if(input.enabled!==undefined)target.enabled=input.enabled;
   if(input.tabId!==undefined){if(entry.tabs.size>=1000&&!entry.tabs.has(input.tabId))entry.tabs.delete(entry.tabs.keys().next().value);entry.tabs.set(input.tabId,target);}
   const now=host?.current?.(id);if(now&&!urlFor(id,now.tabId))void host.close({extensionId:id});else if(now&&input.path!==undefined){const url=urlFor(id,now.tabId);if(url&&url!==now.url)host.navigate?.({extensionId:id,url});}
   return undefined;
  },
  getOptions(event,input){const id=event.extension.id,tabId=input?.tabId,found=options(id,tabId);return {...(found.path!==undefined?{path:found.path}:{}),enabled:found.enabled,...(tabId!==undefined?{tabId}:{})};},
  setPanelBehavior(event,input){if(input?.openPanelOnActionClick!==undefined&&typeof input.openPanelOnActionClick!=='boolean')return failure('Invalid behavior.');if(input?.openPanelOnActionClick!==undefined)of(event.extension.id).behavior.openPanelOnActionClick=input.openPanelOnActionClick;return undefined;},
  getPanelBehavior(event){return {...of(event.extension.id).behavior};},
  getLayout(){return {side:'right'};},
  open(event,input){if(!input||typeof input!=='object'||(input.windowId===undefined&&input.tabId===undefined))return failure('Either windowId or tabId must be specified.');return open(event.extension.id,{windowId:input.windowId,tabId:input.tabId});},
  async close(event,input){const id=event.extension.id;if(!host?.current?.(id))return failure(MESSAGES.noPanel);await host.close({extensionId:id,windowId:input?.windowId});return undefined;},
  /** The toolbar button: with openPanelOnActionClick the click toggles the panel instead of the popup. Returns true when it handled the click. */
  actionClick(id,{tabId,sender}){
   if(!of(id).behavior.openPanelOnActionClick||!urlFor(id,tabId)||!host)return false;
   if(host.current?.(id)){void host.close({extensionId:id});return true;}
   void open(id,{tabId,sender});return true;
  },
  forget(id){state.delete(id);}
 };
}

/** Installs the handlers on one runtime (one ordinary profile session). Returns the pieces other code needs, or null when the router is missing. */
function installExtensionApis(runtime,{session,userData,storeKey='default',getWindow=()=>null,sidePanelHost=null,stores=null,userScriptsAllowed=()=>false,t,createOffscreenContents,createAuthWindow,captureBroker=null,pickShare=null,dialog=null,refreshPreload=()=>false,promptPermissions=null,extApiDir}={}){
 const router=runtime?.ctx?.router;if(!router||typeof router.handle!=='function'||!(router.handlers instanceof Map))return null;
 const extensions=session?.extensions||session;
 const getExtension=id=>{try{return extensions?.getExtension?.(id)||null;}catch{return null;}};
 const emit=(id,name,...args)=>{try{router.sendEvent(id,name,...args);}catch{}};
 // Acira's permission table (extension-permission-table.cjs): the manifest's permissions, including the 39 Electron calls "unknown", plus
 // granted optional ones (persisted). Every check below uses it, so a permission granted by permissions.request counts like a declared one.
 const permissions=require('./extension-permission-table.cjs').createPermissionTable({userData,storeKey,getExtension,log:(...args)=>console.warn('[ext-permissions]',...args)});
 const permitted=(extension,name)=>!!extension&&permissions.has(extension,name);
 // permissions.request: ask the user (Acira's prompt when one is supplied; until then the engine's), then record the grant.
 // target: the extension's id or its Extension object. Resolves true when everything asked is held afterwards.
 permissions.request=async(target,request={},{event}={})=>{
  const extension=target&&typeof target==='object'?target:getExtension(target);if(!extension)return false;
  const ask={permissions:Array.isArray(request.permissions)?request.permissions:[],origins:Array.isArray(request.origins)?request.origins:[]};
  if(permissions.contains(extension,ask))return true;
  let yes=false;
  if(typeof promptPermissions==='function')yes=await promptPermissions({extension,request:ask,event,getWindow});
  else{const store=runtime?.ctx?.store;yes=typeof store?.requestPermissions==='function'?!!(await store.requestPermissions(extension,ask)):false;}
  if(!yes)return false;
  permissions.grant(extension,ask);
  return permissions.contains(extension,ask);
 };
 // Running pages and workers of the extension follow a change at once; pages and workers started later get it from the preload text.
 permissions.onChange((id,{active})=>{emit(id,'acira.permissions.changed',active);try{refreshPreload();}catch{}});
 // The engine's chrome.permissions answered from Electron's view (no "unknown" permissions, grants lost on restart, remove did nothing).
 // These answer from the table; the permissions work package (ext-api/permissions.cjs) replaces them with Chromium's full behaviour.
 router.handle('permissions.getAll',event=>permissions.active(event.extension));
 router.handle('permissions.contains',(event,request)=>permissions.contains(event.extension,request||{}));
 router.handle('permissions.request',(event,request)=>permissions.request(event.extension,request||{},{event}).catch(error=>failure(error?.message||String(error))));
 router.handle('permissions.remove',(event,request)=>{permissions.revoke(event.extension,request||{});return true;});
 const guard=(permission,callback)=>(event,...args)=>permitted(event.extension,permission)?callback(event,...args):failure(`'${permission}' permission is required.`);
 const handle=(name,callback)=>router.handle(name,callback);

 const offscreen=createOffscreen({session,...(createOffscreenContents?{createContents:createOffscreenContents}:{})});
 handle('offscreen.createDocument',guard('offscreen',(event,params)=>offscreen.create(event,params)));
 handle('offscreen.closeDocument',guard('offscreen',event=>offscreen.closeDocument(event)));
 handle('offscreen.hasDocument',guard('offscreen',event=>offscreen.hasDocument(event)));

 const identity=createIdentity({session,getWindow,...(createAuthWindow?{createWindow:createAuthWindow}:{}),...(t?{t}:{})});
 for(const name of ['launchWebAuthFlow','getAuthToken','getProfileUserInfo','removeCachedAuthToken','clearAllCachedAuthTokens','getAccounts'])handle('identity.'+name,guard('identity',(event,...args)=>identity[name](event,...args)));

 const sidePanel=createSidePanel({getExtension,host:sidePanelHost,emit});
 for(const name of ['setOptions','getOptions','setPanelBehavior','getPanelBehavior','getLayout','open','close'])handle('sidePanel.'+name,guard('sidePanel',(event,...args)=>sidePanel[name](event,...args)));
 // openPanelOnActionClick: the toolbar click opens the panel. Wraps the engine's own handler; everything else goes through unchanged.
 // The toolbar click is also the user gesture that grants activeTab for that tab (used by tabs.captureVisibleTab below).
 const activeTabGrants=new Map(),invocations=new Map();
 const activate=router.handlers.get('browserAction.activate');
 if(typeof activate?.callback==='function')router.handlers.set('browserAction.activate',{...activate,callback:(event,details)=>{try{if(details?.eventType==='click'&&typeof details.extensionId==='string'&&Number.isInteger(details.tabId)){activeTabGrants.set(details.extensionId,details.tabId);let url='';try{url=runtime.ctx.store?.getTabById?.(details.tabId)?.getURL?.()||'';}catch{}invocations.set(details.extensionId,{tabId:details.tabId,origin:capture.originOf(url)});}if(details?.eventType==='click'&&typeof details.extensionId==='string'&&permitted(getExtension(details.extensionId),'sidePanel')&&sidePanel.actionClick(details.extensionId,{tabId:details.tabId,sender:event?.sender}))return undefined;}catch{}return activate.callback(event,details);}});

 // windows.getCurrent / getLastFocused answered null until a web page of the window had been handed to the engine: workers start with the
 // app, before the first web page, and the start page has no web contents. Grammarly's worker read `.focused` of that null and its start
 // failed; LastPass read `.id`. Chrome always answers with a window, so Acira's own window is registered with the engine then.
 for(const name of ['windows.getCurrent','windows.getLastFocused']){
  const original=router.handlers.get(name);if(typeof original?.callback!=='function')continue;
  router.handlers.set(name,{...original,callback:(event,...args)=>{
   const result=original.callback(event,...args);if(result)return result;
   const store=runtime.ctx.store,win=getWindow();
   if(!store||typeof store.addWindow!=='function'||!win||win.isDestroyed?.())return result;
   if(!store.windows?.has?.(win))store.addWindow(win);
   if(!store.getWindowById?.(store.lastFocusedWindowId))store.lastFocusedWindowId=win.id;
   return original.callback(event,...args);
  }});
 }

 // action.setBadgeTextColor / getBadgeTextColor / isEnabled (Chrome 110+), which the engine lacks. Colours per extension, globally or per
 // tab, as Chrome's [r, g, b, a]; the engine's enable/disable do nothing yet, so every action is enabled.
 const badgeTextColors=new Map();
 const textColorsOf=id=>{if(!badgeTextColors.has(id))badgeTextColors.set(id,{global:null,tabs:new Map()});return badgeTextColors.get(id);};
 handle('action.setBadgeTextColor',(event,details)=>{
  const color=parseBadgeColor(details?.color);if(!color)return failure('The color specification could not be parsed.');
  const colors=textColorsOf(event.extension.id);
  if(Number.isInteger(details?.tabId))colors.tabs.set(details.tabId,color);else colors.global=color;
  return undefined;
 });
 handle('action.getBadgeTextColor',(event,details)=>{const colors=textColorsOf(event.extension.id);return (Number.isInteger(details?.tabId)&&colors.tabs.get(details.tabId))||colors.global||[255,255,255,255];});
 handle('action.isEnabled',()=>true);

 // tabs.query ignored currentWindow, lastFocusedWindow and windowType: query({active:true,currentWindow:true}), the most common call in
 // popups and workers, came back with the active tab of every window. As in Chrome, the current window of a popup or worker is the last
 // focused browser window; every Acira window is a 'normal' one.
 const tabsQuery=router.handlers.get('tabs.query');
 if(typeof tabsQuery?.callback==='function')router.handlers.set('tabs.query',{...tabsQuery,callback:(event,info,...rest)=>{
  const asked=info&&typeof info==='object'?info:{};
  const {currentWindow,lastFocusedWindow,windowType,...engineInfo}=asked;
  const focusedId=()=>{
   const store=runtime.ctx.store;if(!store)return undefined;
   if(!store.getWindowById?.(store.lastFocusedWindowId)){const win=getWindow();if(win&&!win.isDestroyed?.()&&typeof store.addWindow==='function'){if(!store.windows?.has?.(win))store.addWindow(win);store.lastFocusedWindowId=win.id;}}
   return store.lastFocusedWindowId;
  };
  const narrow=tabs=>{
   if(!Array.isArray(tabs))return tabs;
   let out=tabs;
   if(typeof currentWindow==='boolean'||typeof lastFocusedWindow==='boolean'){
    const id=focusedId();
    if(typeof currentWindow==='boolean')out=out.filter(tab=>(tab?.windowId===id)===currentWindow);
    if(typeof lastFocusedWindow==='boolean')out=out.filter(tab=>(tab?.windowId===id)===lastFocusedWindow);
   }
   if(typeof windowType==='string')out=windowType==='normal'?out:[];
   return out;
  };
  const result=tabsQuery.callback(event,engineInfo,...rest);
  return result&&typeof result.then==='function'?result.then(narrow):narrow(result);
 }});

 // permissions.contains compares host patterns by containment (the table's contains, above): an extension holding <all_urls> has access to
 // http://example.com/* (Tampermonkey's popup said "has no access to this page" when patterns were compared as strings).

 // chrome.tabs.captureVisibleTab (ColorZilla's eyedropper reads page pixels from it): the visible part of the active tab of the given or the
 // current window, as a data URL. As in Chrome: only web pages, only with host access to the page (or activeTab granted by a toolbar click on
 // that tab), at most MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2) calls a second per extension.
 const captureTimes=new Map();
 handle('tabs.captureVisibleTab',async(event,windowId,options)=>{
  if(windowId&&typeof windowId==='object'){options=windowId;windowId=undefined;}
  const id=event.extension.id,now=Date.now(),recent=(captureTimes.get(id)||[]).filter(time=>now-time<1000);
  if(recent.length>=2)return failure(MESSAGES.captureQuota);
  recent.push(now);captureTimes.set(id,recent);
  const store=runtime.ctx.store;
  const win=Number.isInteger(windowId)&&windowId>=0?store?.getWindowById?.(windowId):store?.getCurrentWindow?.();
  const tab=win?store.getActiveTabFromWindow?.(win):undefined;
  if(!tab||tab.isDestroyed()||tab.session!==session)return failure(MESSAGES.captureNoTab);
  const url=tab.getURL(),hosts=permissions.active(event.extension).origins;
  if(!/^https?:/i.test(url))return failure(MESSAGES.captureAccess);
  // activeTab: the toolbar click was on THIS tab and the tab is still on the origin it had then (invocations: {tabId, origin}). The grant used
  // to be the tab id alone, so a click on one page let the extension capture whatever the tab went on to show, a bank included.
  const invoked=invocations.get(id),granted=!!invoked&&invoked.tabId===tab.id&&!!invoked.origin&&invoked.origin===capture.originOf(url);
  if(!hosts.some(pattern=>matchesPattern(pattern,url))&&!(permitted(event.extension,'activeTab')&&granted))return failure(MESSAGES.captureAccess);
  const image=await tab.capturePage();
  if(options?.format==='jpeg'){const quality=Number.isInteger(options.quality)?Math.min(100,Math.max(0,options.quality)):92;return 'data:image/jpeg;base64,'+image.toJPEG(quality).toString('base64');}
  return image.toDataURL();
 });

 // chrome.tabCapture and chrome.desktopCapture (media-capture.cjs explains the stream ids). An id is issued only after Chrome's checks: for
 // a tab, the extension was invoked there (its toolbar button clicked on that tab, on the same site); for desktopCapture, the person picked
 // a screen, window or tab in Acira's share picker. The extension's own pages then use it through getUserMedia (extension-apis-renderer.cjs).
 const media=captureBroker||capture.broker(),store=()=>runtime.ctx.store;
 const tabOf=id=>{try{const tab=Number.isInteger(id)?store()?.getTabById?.(id):null;return tab&&!tab.isDestroyed()&&tab.session===session?tab:null;}catch{return null;}};
 const activeTab=()=>{try{const s=store(),win=s?.getCurrentWindow?.()||s?.getLastFocusedWindow?.(),tab=win?s.getActiveTabFromWindow?.(win):undefined;return tab&&!tab.isDestroyed()&&tab.session===session?tab:null;}catch{return null;}};
 const tabStreamId=(event,tab)=>{
  if(!tab)return failure(capture.MESSAGES.tabFinding);
  const id=event.extension.id,error=capture.tabCaptureError({tab:{id:tab.id,url:tab.getURL()},invoked:invocations.get(id),busy:media.tabBusy(tab.id)});
  if(error)return failure(error);
  return media.issue({extensionId:id,owner:router,source:{type:'tab',tabId:tab.id},audio:true,label:event.extension.name||event.extension.manifest?.name});
 };
 handle('tabCapture.getMediaStreamId',guard('tabCapture',(event,options)=>{
  const o=options&&typeof options==='object'?options:{};
  if(o.consumerTabId!=null&&!tabOf(o.consumerTabId))return failure(capture.MESSAGES.consumerInvalid);
  if(o.targetTabId!=null&&!tabOf(o.targetTabId))return failure(capture.MESSAGES.tabInvalid);
  return tabStreamId(event,o.targetTabId!=null?tabOf(o.targetTabId):activeTab());
 }));
 // tabCapture.capture(): the active tab of the current window, from a page of the extension (Chrome has no capture() in workers).
 handle('tabCapture.captureStreamId',guard('tabCapture',(event,want)=>{
  if(event.type!=='frame')return failure(capture.MESSAGES.frameOnly);
  if(!want?.audio&&!want?.video)return failure(capture.MESSAGES.noAudioOrVideo);
  return tabStreamId(event,activeTab());
 }));
 handle('tabCapture.getCapturedTabs',guard('tabCapture',event=>media.capturedTabs(event.extension.id)));
 media.subscribe((status,item)=>{if(item.owner===router&&item.source.type==='tab')emit(item.extensionId,'tabCapture.onStatusChanged',{tabId:item.source.tabId,status,fullscreen:false});});

 const choosing=new Map();
 handle('desktopCapture.chooseDesktopMedia',guard('desktopCapture',async(event,requestId,sources,targetTab)=>{
  const error=capture.desktopSourcesError(sources,{fromWorker:event.type!=='frame',targetTab});if(error)return failure(error);
  if(targetTab&&!tabOf(targetTab.id))return failure(capture.MESSAGES.targetInvalid);
  const pick=pickShare||capture.service('pick'),key=`${event.extension.id}|${event.type}|${event.sender?.id??''}|${requestId}`;
  if(typeof pick!=='function')return {streamId:''};
  if(choosing.has(key))return failure(capture.MESSAGES.pickerBusy);
  const request={cancelled:false,cancel:null};choosing.set(key,request);
  try{
   const result=await pick({session,requester:event.extension.name||event.extension.manifest?.name||'',types:sources.filter(source=>source!=='audio'),audio:sources.includes('audio'),parent:getWindow(),request});
   if(!result?.source||request.cancelled)return {streamId:''};
   const streamId=media.issue({extensionId:event.extension.id,owner:router,source:result.source,audio:!!result.audio,label:event.extension.name||event.extension.manifest?.name});
   return {streamId,canRequestAudioTrack:!!result.audio};
  }finally{choosing.delete(key);}
 }));
 handle('desktopCapture.cancelChooseDesktopMedia',guard('desktopCapture',(event,requestId)=>{const request=choosing.get(`${event.extension.id}|${event.type}|${event.sender?.id??''}|${requestId}`);if(request){request.cancelled=true;try{request.cancel?.();}catch{}}return undefined;}));

 // The preload's getUserMedia, just before it asks for the display stream: checks the id, uses it up and arms this page for that one request.
 const canCapture=extension=>permitted(extension,'tabCapture')||permitted(extension,'desktopCapture'),watched=new WeakSet();
 const watch=wc=>{if(watched.has(wc))return;watched.add(wc);const end=()=>media.endFor(wc.id);wc.once?.('destroyed',end);wc.on?.('did-start-navigation',(details)=>{if(details?.isMainFrame&&!details.isSameDocument)end();});};
 handle('mediaCapture.arm',async(event,id)=>{
  if(!canCapture(event.extension))return failure("'tabCapture' or 'desktopCapture' permission is required.");
  if(event.type!=='frame'||!event.sender||event.sender.isDestroyed?.())return failure(capture.MESSAGES.frameOnly);
  const result=media.arm(id,{extensionId:event.extension.id,contentsId:event.sender.id});if(result.error)return failure(result.error);
  watch(event.sender);
  // getDisplayMedia needs a user gesture in the page. The stream id stands for the gesture already given (toolbar click or picker answer).
  try{await event.sender.executeJavaScript('0',true);}catch{}
  return result;
 });
 handle('mediaCapture.started',(event,captureId)=>media.started(captureId,event.extension.id));
 handle('mediaCapture.ended',(event,captureId)=>media.ended(captureId,event.extension.id));

 // chrome.userScripts. The registry is kept in the profile folder so scripts survive a restart, as in Chrome.
 const storeFile=userData?path.join(userData,'extension-runtime',`user-scripts-${crypto.createHash('sha256').update(String(storeKey)).digest('hex').slice(0,12)}.json`):null;
 const userScripts=createUserScriptRegistry({
  load:()=>{if(!storeFile)return {};try{if(fs.statSync(storeFile).size>64*1024*1024)return {};return JSON.parse(fs.readFileSync(storeFile,'utf8'));}catch{return {};}},
  save:value=>{if(!storeFile)return;fs.mkdirSync(path.dirname(storeFile),{recursive:true});fs.writeFileSync(storeFile+'.tmp',JSON.stringify(value));fs.renameSync(storeFile+'.tmp',storeFile);}
 });
 const readerFor=extension=>relative=>{const root=path.resolve(extension.path||''),file=path.resolve(root,String(relative).replace(/^\/+/,''));if(!extension.path||!file.startsWith(root+path.sep))throw new Error('outside');if(fs.statSync(file).size>8*1024*1024)throw new Error('large');return fs.readFileSync(file,'utf8');};
 const allowedNow=event=>permitted(event.extension,'userScripts')&&userScriptsAllowed(event.extension.id);
 const scripted=callback=>(event,...args)=>{if(!allowedNow(event))return failure("The 'userScripts' API is only available for users when the 'Allow User Scripts' toggle is enabled.");try{return callback(event,...args);}catch(error){return failure(error?.userScripts?error.message:'Invalid user scripts.');}};
 handle('userScripts.register',scripted((event,scripts)=>{userScripts.register(event.extension.id,scripts,{readFile:readerFor(event.extension)});}));
 handle('userScripts.update',scripted((event,scripts)=>{userScripts.update(event.extension.id,scripts,{readFile:readerFor(event.extension)});}));
 handle('userScripts.unregister',scripted((event,filter)=>{userScripts.unregister(event.extension.id,filter);}));
 handle('userScripts.getScripts',scripted((event,filter)=>userScripts.getScripts(event.extension.id,filter)));
 handle('userScripts.configureWorld',scripted((event,config)=>{userScripts.configureWorld(event.extension.id,config);}));
 handle('userScripts.getWorldConfigurations',scripted(event=>userScripts.getWorldConfigurations(event.extension.id)));
 handle('userScripts.resetWorldConfiguration',scripted((event,worldId)=>{userScripts.resetWorldConfiguration(event.extension.id,worldId);}));
 handle('userScripts.execute',scripted(async(event,injection)=>{
  const id=event.extension.id,tabId=injection?.target?.tabId;
  const wc=(()=>{try{return require('electron').webContents.fromId(tabId);}catch{return null;}})();
  if(!wc||wc.isDestroyed()||wc.session!==session)return failure(MESSAGES.noTab+tabId);
  const url=wc.getURL(),hosts=[...(event.extension.manifest.host_permissions||[]),...(event.extension.manifest.permissions||[]).filter(p=>p==='<all_urls>'||/:\/\//.test(p))];
  if(!hosts.some(pattern=>matchesPattern(pattern,url)))return failure(MESSAGES.tabAccess);
  const sources=Array.isArray(injection?.js)?injection.js:[];if(!sources.length)return failure('At least one js source is required.');
  let code;try{code=sources.map(source=>typeof source?.code==='string'?source.code:readerFor(event.extension)(source?.file)).join('\n;\n');}catch{return failure('Could not load file.');}
  const world=injection.world==='MAIN'?'MAIN':'USER_SCRIPT',worldNumber=require('./user-scripts.cjs').worldNumber(id,typeof injection.worldId==='string'?injection.worldId:'');
  let result;try{result=world==='MAIN'?await wc.mainFrame.executeJavaScript(code):await wc.executeJavaScriptInIsolatedWorld(worldNumber,[{code}]);}catch(error){return failure(String(error?.message||error).slice(0,512));}
  return [{frameId:0,documentId:undefined,result}];
 }));

 // Messages from a user script's world: delivered to runtime.onUserScriptMessage in the extension; its sendResponse comes back through userScripts.reply.
 const pending=new Map();
 handle('userScripts.reply',(event,replyId,response)=>{const waiting=pending.get(replyId);if(waiting&&waiting.extensionId===event.extension.id){pending.delete(replyId);clearTimeout(waiting.timer);waiting.resolve({__acira_value:response});}return undefined;});
 function userScriptMessage(sender,frame,{extensionId,worldId,message}){
  if(typeof extensionId!=='string'||!getExtension(extensionId)||!permitted(getExtension(extensionId),'userScripts')||!userScriptsAllowed(extensionId))return Promise.resolve(failure(MESSAGES.noReceiver));
  const url=frame?.url||sender.getURL();
  if(!userScripts.worldConfig(extensionId,typeof worldId==='string'?worldId:'').messaging||!userScripts.hasMessagingScript(extensionId,url))return Promise.resolve(failure(MESSAGES.noReceiver));
  const listeners=router.listeners?.get?.('runtime.onUserScriptMessage')||[];if(!listeners.some(listener=>listener.extensionId===extensionId))return Promise.resolve(failure(MESSAGES.noReceiver));
  const replyId=crypto.randomUUID();
  let origin='';try{origin=new URL(url).origin;}catch{}
  const tab=runtime.ctx?.store?.tabDetailsCache?.get?.(sender.id)||{id:sender.id};
  return new Promise(resolve=>{
   const timer=setTimeout(()=>{pending.delete(replyId);resolve({__acira_value:undefined});},5*60*1000);timer.unref?.();
   pending.set(replyId,{extensionId,resolve,timer});
   if(pending.size>500){const [oldest,entry]=pending.entries().next().value;pending.delete(oldest);clearTimeout(entry.timer);entry.resolve({__acira_value:undefined});}
   emit(extensionId,'runtime.onUserScriptMessage',message,{id:extensionId,url,origin,tab,frameId:frame&&frame!==sender.mainFrame?frame.routingId:0,...(worldId?{userScriptWorldId:worldId}:{})},replyId);
  });
 }

 // bookmarks, history, sessions (read-only) and search, from this profile's own stores (extension-store-apis.cjs).
 if(stores){
  const {bookmarksApi,historyApi,sessionsApi}=require('./extension-store-apis.cjs'),safe=read=>()=>{try{const value=read();return Array.isArray(value)?value:[];}catch{return [];}};
  const bookmarks=bookmarksApi(safe(stores.bookmarks)),history=historyApi(safe(stores.history)),sessions=sessionsApi(safe(stores.closedTabs));
  for(const name of ['get','getChildren','getRecent','getTree','getSubTree','search'])handle('bookmarks.'+name,guard('bookmarks',(event,...args)=>bookmarks[name](event,...args)));
  for(const name of ['create','update','move','remove','removeTree'])handle('bookmarks.'+name,guard('bookmarks',()=>bookmarks.write()));
  for(const name of ['search','getVisits'])handle('history.'+name,guard('history',(event,...args)=>history[name](event,...args)));
  for(const name of ['addUrl','deleteUrl','deleteRange','deleteAll'])handle('history.'+name,guard('history',()=>history.write()));
  for(const name of ['getRecentlyClosed','getDevices','restore'])handle('sessions.'+name,guard('sessions',(event,...args)=>sessions[name](event,...args)));
  handle('search.query',guard('search',async(event,query)=>{const text=typeof query?.text==='string'?query.text.trim().slice(0,2048):'';if(!text)return failure('Search text is required.');try{await stores.search({text,disposition:query.disposition,tabId:query.tabId});}catch(error){return failure(String(error?.message||error).slice(0,300));}return undefined;}));
 }

 // chrome.idle (password managers lock on idle): the system idle state from Electron's powerMonitor; onStateChanged is polled only while some
 // extension of this session listens for it.
 const idleIntervals=new Map(),idleLast=new Map();
 const idleState=seconds=>{try{const state=require('electron').powerMonitor.getSystemIdleState(Math.max(15,Math.round(Number(seconds)||60)));return ['active','idle','locked'].includes(state)?state:'active';}catch{return 'active';}};
 const legacyIdleQuery=guard('idle',(_event,seconds)=>idleState(seconds));handle('idle.queryState',legacyIdleQuery);   // ext-api/idle.cjs replaces these and the timer below stands down
 handle('idle.setDetectionInterval',guard('idle',(event,seconds)=>{idleIntervals.set(event.extension.id,Math.max(15,Math.round(Number(seconds)||60)));return undefined;}));
 handle('idle.getAutoLockDelay',guard('idle',()=>0));
 const idleTimer=setInterval(()=>{
  if(router.handlers.get('idle.queryState')?.callback!==legacyIdleQuery)return;
  const listeners=router.listeners?.get?.('idle.onStateChanged')||[];if(!listeners.length)return;
  for(const id of new Set(listeners.map(l=>l.extensionId))){const state=idleState(idleIntervals.get(id)||60),last=idleLast.get(id)||'active';if(state!==last){idleLast.set(id,state);emit(id,'idle.onStateChanged',state);}}
 },5000);idleTimer.unref?.();

 // chrome.system.storage. Chromium's own functions need a StorageMonitor, which Electron never creates: calling getInfo (or listening to
 // onAttached/onDetached) ended the whole browser. The renderer side (extension-apis-renderer.cjs) replaces the namespace, and these answer.
 const systemStorage=createSystemStorage();
 handle('system.storage.getInfo',guard('system.storage',()=>systemStorage.getInfo()));
 handle('system.storage.getAvailableCapacity',guard('system.storage',(_event,id)=>systemStorage.getAvailableCapacity(id)));
 handle('system.storage.ejectDevice',guard('system.storage',(_event,id)=>systemStorage.ejectDevice(id)));

 // runtime.getContexts
 handle('runtime.getContexts',(event,filter)=>{
  const id=event.extension.id,origin=originOf(id),manifest=event.extension.manifest||{},out=[];
  const worker=manifest.background?.service_worker;
  try{const running=Object.values(session.serviceWorkers?.getAllRunning?.()||{}).some(info=>String(info.scope||'').startsWith(origin+'/'));if(worker&&running)out.push({contextType:'BACKGROUND',contextId:crypto.createHash('sha256').update(id+'|bg').digest('hex').slice(0,32),tabId:-1,windowId:-1,frameId:-1,documentUrl:extensionURL(id,worker),documentOrigin:origin,incognito:false});}catch{}
  const doc=offscreen.documents.get(id);
  if(doc&&!doc.webContents.isDestroyed?.())out.push({contextType:'OFFSCREEN_DOCUMENT',contextId:doc.contextId,tabId:-1,windowId:-1,frameId:0,documentId:doc.documentId,documentUrl:doc.webContents.getURL?.()||doc.url,documentOrigin:origin,incognito:false});
  const panel=sidePanelHost?.current?.(id);
  if(panel?.webContents&&!panel.webContents.isDestroyed())out.push({contextType:'SIDE_PANEL',contextId:crypto.createHash('sha256').update(id+'|panel|'+panel.webContents.id).digest('hex').slice(0,32),tabId:-1,windowId:panel.windowId??-1,frameId:0,documentUrl:panel.webContents.getURL(),documentOrigin:origin,incognito:false});
  try{
   const skip=new Set([doc?.webContents,panel?.webContents].filter(Boolean));
   for(const wc of require('electron').webContents.getAllWebContents()){
    if(wc.isDestroyed()||wc.session!==session||skip.has(wc)||!wc.getURL().startsWith(origin+'/'))continue;
    const type=typeof wc.getType==='function'?wc.getType():'window';
    out.push({contextType:type==='backgroundPage'?'BACKGROUND':'TAB',contextId:crypto.createHash('sha256').update(id+'|wc|'+wc.id).digest('hex').slice(0,32),tabId:wc.id,windowId:-1,frameId:0,documentUrl:wc.getURL(),documentOrigin:origin,incognito:false});
   }
  }catch{}
  const pick=(key,value)=>!Array.isArray(filter?.[key])||filter[key].includes(value);
  return out.filter(c=>pick('contextTypes',c.contextType)&&pick('contextIds',c.contextId)&&pick('tabIds',c.tabId)&&pick('windowIds',c.windowId)&&pick('documentIds',c.documentId)&&pick('frameIds',c.frameId)&&pick('documentUrls',c.documentUrl)&&pick('documentOrigins',c.documentOrigin)&&(filter?.incognito===undefined||filter.incognito===false));
 });

 try{extensions?.on?.('extension-unloaded',(_event,extension)=>{offscreen.close(extension?.id);if(sidePanelHost?.current?.(extension?.id))void sidePanelHost.close({extensionId:extension.id});});}catch{}
 // declarativeNetRequest enforcement for this profile (dnr-host.cjs); the request pipeline in content-blocking.cjs asks it per request.
 let dnr=null;try{dnr=require('./dnr-host.cjs').attachDnrHost({session,router,userData,storeKey,emit,getExtension,log:(...args)=>console.warn('[dnr]',...args)});}catch(error){console.warn('[dnr] not attached',error?.message);}
 // Work packages (ext-api/*.cjs, docs/launch/EXTENSION_WORK_PACKAGES.md): installed last, so a package's handler replaces any above.
 let packages={packages:[],forget(){},dispose(){}};
 try{const extApi=require('./ext-api/index.cjs');packages=extApi.installPackages({session,runtime,router,userData,storeKey,getWindow,getExtension,emit,dialog,t,permissions,log:(...args)=>console.warn(...args)},extApiDir?{packages:extApi.loadPackages({dir:extApiDir})}:{});}
 catch(error){console.warn('[ext-api] packages not installed',error?.message);}
 // The page preload is only registered while some extension of this profile may run user scripts, so other profiles pay nothing per page.
 let preloadId=null;
 const api={
  offscreen,identity,sidePanel,userScripts,userScriptMessage,dnr,packages,permissions,
  scriptsFor:(url,{mainFrame=true}={})=>userScripts.scriptsFor(url,{mainFrame,allowed:id=>!!getExtension(id)&&permitted(getExtension(id),'userScripts')&&userScriptsAllowed(id)}),
  syncUserScriptPreload(on){
   try{
    if(on&&!preloadId&&typeof session?.registerPreloadScript==='function')preloadId=session.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'user-scripts-preload.cjs')});
    else if(!on&&preloadId){session.unregisterPreloadScript(preloadId);preloadId=null;}
   }catch{}
   return !!preloadId;
  },
  forget(id){offscreen.close(id);sidePanel.forget(id);userScripts.forget(id);dnr?.forget(id);packages.forget(id);permissions.forget(id);activeTabGrants.delete(id);invocations.delete(id);captureTimes.delete(id);}
 };
 if(session)bySession.set(session,api);registerPageChannels();
 return api;
}

const bySession=new WeakMap();let channelsRegistered=false;
/** The two page channels of user-scripts-preload.cjs; each answers only for its own session's extensions. */
function registerPageChannels(){
 if(channelsRegistered)return;let ipcMain;try{ipcMain=require('electron').ipcMain;}catch{return;}if(!ipcMain?.on)return;channelsRegistered=true;
 ipcMain.on('acira:user-scripts',(event,_href,mainFrame)=>{
  let scripts=[];
  try{const wc=event.sender,frame=event.senderFrame,url=frame?.url,api=wc&&!wc.isDestroyed()?bySession.get(wc.session):null;if(api&&/^(https?|file):/.test(url||''))scripts=api.scriptsFor(url,{mainFrame:frame?frame===wc.mainFrame:!!mainFrame});
   if(scripts.reduce((sum,s)=>sum+s.code.length,0)>16*1024*1024)scripts=[];}catch{scripts=[];}
  event.returnValue=scripts;
 });
 ipcMain.handle('acira:user-script-message',async(event,request)=>{
  const wc=event.sender,api=wc&&!wc.isDestroyed()?bySession.get(wc.session):null;
  if(!api||!request||typeof request!=='object')return failure(MESSAGES.noReceiver);
  return api.userScriptMessage(wc,event.senderFrame,request);
 });
}

module.exports={installExtensionApis,createOffscreen,createIdentity,createSidePanel,createSystemStorage,parseBadgeColor,extensionURL,patternCovers,REASONS,CONTEXT_TYPES,MESSAGES};
