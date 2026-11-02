'use strict';
// chrome.webRequest (P5): Chrome 152's behaviour for extensions, on Acira's one Electron webRequest hook per profile session.
//
// Why: Electron gives a session ONE listener per webRequest event, and once any is set the engine's own chrome.webRequest never fires.
// Acira's request pipeline (desktop/request-pipeline.cjs) owns those listeners (Ghostery engine, DNR, query stripping, HTTPS-only…), so
// this package is an observer of that pipeline (observeRequests): each event is matched against the listeners extensions registered and
// delivered once per extension context that holds matching listeners (Chromium's per-context dispatch, web_request_event.js), with the
// details Chrome builds. While no extension listens for an event, the pipeline does nothing extra for it (see request-pipeline.cjs).
//
// Chrome's rules kept here:
//  - filter: urls (match patterns), types, tabId, windowId; extraInfoSpec decides requestHeaders / responseHeaders / requestBody, and
//    without 'extraHeaders' the renderer erases Cookie, Referer, Origin, Accept-Language, Accept-Encoding and Set-Cookie (as Chromium).
//  - who sees what (web_request_permissions.cc): host permission for the URL and, for non-navigation requests, for the initiator;
//    requests of an extension only to that extension; hidden: other schemes, Chrome Web Store and other sensitive URLs, the browser's own
//    requests (Acira's filter-list updates, update checks), file: URLs (Acira loads extensions without file access). Private, Tor and other
//    non-profile sessions never load extensions, so their requests never reach this code; a Tor-flagged session is refused anyway.
//  - order: onBeforeRequest → onBeforeSendHeaders → onSendHeaders → onHeadersReceived → onAuthRequired → onBeforeRedirect |
//    onResponseStarted → onCompleted | onErrorOccurred. Acira's blocker and DNR act like Chrome's DNR: listeners still hear onBeforeRequest
//    of a request they cancel, then onErrorOccurred (net::ERR_BLOCKED_BY_CLIENT); a redirect gives onBeforeRedirect, then onBeforeRequest.
//  - blocking: webRequestBlocking is granted to MV2 extensions only (Chrome 152 gives it to policy-installed MV3 extensions; Acira has no
//    enterprise policy); onAuthRequired may block with webRequestAuthProvider. A blocking listener without that permission is refused with
//    Chromium's console error. Blocking answers are honoured for onAuthRequired; for the other events (MV2-only here) they are not applied
//    yet — the listeners hear every event (deferred, see docs/launch/EXTENSION_WORK_PACKAGES.md report).
const {observeRequests}=require('../../request-pipeline.cjs');
const {urlParts,compilePattern,compileList}=require('./web-request/patterns.cjs');
const {documentsFor,frameIdOf,read}=require('./web-navigation/frames.cjs');

const HOST=Symbol.for('acira.web-request-host-v1');
const CHANNEL='crx-aciraWebRequest.event';
const PHASE={onBeforeRequest:'before',onBeforeSendHeaders:'sendHeaders',onSendHeaders:'sent',onHeadersReceived:'headers',onResponseStarted:'responseStarted',
 onBeforeRedirect:'redirect',onCompleted:'completed',onErrorOccurred:'error',onAuthRequired:'auth'};
const EVENT_OF=Object.fromEntries(Object.entries(PHASE).map(([event,phase])=>[phase,event]));
const EVENTS=Object.keys(PHASE);
const OPTIONS={onBeforeRequest:['blocking','requestBody','extraHeaders'],onBeforeSendHeaders:['requestHeaders','blocking','extraHeaders'],
 onSendHeaders:['requestHeaders','extraHeaders'],onHeadersReceived:['blocking','responseHeaders','extraHeaders'],
 onAuthRequired:['responseHeaders','blocking','asyncBlocking','extraHeaders'],onResponseStarted:['responseHeaders','extraHeaders'],
 onBeforeRedirect:['responseHeaders','extraHeaders'],onCompleted:['responseHeaders','extraHeaders'],onErrorOccurred:['extraHeaders']};
const TYPES={mainFrame:'main_frame',subFrame:'sub_frame',stylesheet:'stylesheet',script:'script',image:'image',font:'font',object:'object',
 xhr:'xmlhttprequest',ping:'ping',cspReport:'csp_report',media:'media',webSocket:'websocket',other:'other'};
const RESOURCE_TYPES=new Set(['main_frame','sub_frame','stylesheet','script','image','font','object','xmlhttprequest','ping','csp_report','media','websocket','webbundle','other']);
// web_request_api_constants.cc
const MESSAGES={
 blocking:'You do not have permission to use blocking webRequest listeners. Be sure to declare the webRequestBlocking permission in your manifest. Note that webRequestBlocking is only allowed for extensions that are installed using ExtensionInstallForcelist.',
 hosts:'You need to request host permissions in the manifest file in order to be notified about requests from the webRequest API.',
 pattern:value=>`'${value}' is not a valid URL pattern.`,
 extraInfo:'Invalid extraInfo spec.',
 // Chrome 152 accepts securityInfo only behind a developer flag (kSecurityInfoFlagAbsentInExtensions).
 securityInfo:'ExtraInfoSpec.securityInfo is allowed only with WebRequestSecurityInfo developer flag'
};
const MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES=20;
const WEB_SCHEMES=new Set(['http','https','ws','wss','ftp','file','chrome-extension','about','filesystem','urn','uuid-in-package']);
const INTERNAL_PAGE=/^(?:acira|chrome|devtools|chrome-devtools|chrome-untrusted):/i;

/** Requests Chrome never shows to extensions (WebRequestPermissions::HideRequest, IsSensitiveGoogleClientUrl, webstore URLs). */
function sensitive(parts,initiator,fromBrowser,type){
 const host=parts.host,path=parts.pathq;
 if(host==='chromewebstore.google.com'||host.endsWith('.chromewebstore.google.com'))return true;
 if(host==='chrome.google.com'&&path.startsWith('/webstore'))return true;
 if(host==='clients2.google.com'&&path.startsWith('/service/update2'))return true;
 if(host==='clients2.googleusercontent.com'&&path.startsWith('/crx/'))return true;
 if(host==='update.googleapis.com'||host==='safebrowsing.googleapis.com'||host==='sb-ssl.google.com')return true;
 if(fromBrowser&&type!=='main_frame'&&/^(?:.*\.)?clients\d*\.google\.com$/.test(host))return true;
 if(initiator==='https://chromewebstore.google.com')return true;
 return false;
}

const headerList=headers=>{const out=[];if(!headers||typeof headers!=='object')return out;for(const name of Object.keys(headers)){const value=headers[name];if(Array.isArray(value))for(const item of value)out.push({name,value:String(item)});else if(value!==undefined&&value!==null)out.push({name,value:String(value)});}return out;};
/** requestBody from Electron's uploadData: formData for an urlencoded form body, raw bytes otherwise (Chrome also parses multipart). */
function requestBody(details,type){
 const data=details.uploadData;if(!Array.isArray(data)||!data.length)return undefined;
 if((type==='main_frame'||type==='sub_frame')&&data.length===1&&data[0]?.bytes&&details.method==='POST'){
  const text=Buffer.from(data[0].bytes).toString('utf8');
  if(/^(?:[^=&\s]+=[^&\s]*)(?:&[^=&\s]+=[^&\s]*)*$/.test(text)){const formData={};for(const [key,value] of new URLSearchParams(text))(formData[key]||(formData[key]=[])).push(value);return {formData};}
 }
 const raw=[];for(const item of data){if(item?.bytes)raw.push({bytes:new Uint8Array(item.bytes)});else if(typeof item?.file==='string')raw.push({file:item.file});}
 return raw.length?{raw}:undefined;
}

function install(api){
 const session=api.session;if(!session)return {};
 if(session[HOST])return {dispose(){}};
 const docs=documentsFor(session);
 const contexts=new Map();            // key -> {key, extensionId, worker, sender, scope, wc, generation, listeners: Map(id -> record)}
 const byEvent=Object.fromEntries(EVENTS.map(name=>[name,[]]));
 const access=new Map();              // extensionId -> parts => boolean (host permissions now held)
 const behaviorCalls=new Map();       // extensionId -> [time]
 const generations=new WeakMap();     // webContents -> main-frame document count (frame contexts of older documents are dropped)
 const pendingAuth=new Map();         // token -> {waiting: Set(contextKey), responses: [], resolve}
 const recentAuth=new Map();          // url -> {details, at} for the 401/407 that leads to onAuthRequired
 let observer=null,authSeq=1e9,authToken=0;
 const extensionOf=id=>{try{return api.getExtension(id);}catch{return null;}};
 const manifestOf=id=>extensionOf(id)?.manifest||{};
 const hostAccess=id=>{
  if(access.has(id))return access.get(id);
  let origins=null;try{origins=api.permissions?.active?.(id)?.origins||null;}catch{origins=null;}
  if(!origins){const m=manifestOf(id);origins=[...(Array.isArray(m.host_permissions)?m.host_permissions:[]),...(Array.isArray(m.permissions)?m.permissions.filter(p=>typeof p==='string'&&(p==='<all_urls>'||p.includes('://'))):[])];}
  const test=compileList(origins.filter(p=>typeof p==='string'));access.set(id,test);return test;
 };
 try{api.permissions?.onChange?.(id=>access.delete(id));}catch{}
 const allowed=(id,parts)=>{
  if(!parts)return false;
  if(parts.scheme==='about')return true;
  if(parts.scheme==='chrome-extension')return parts.host===id;
  if(parts.scheme==='file')return false; // Acira loads extensions without file access
  return hostAccess(id)(parts);
 };
 const store=()=>{try{return api.store();}catch{return null;}};

 // ----------------------------------------------------------------------------------------------- registrations
 function rebuild(){
  for(const name of EVENTS)byEvent[name]=[];
  for(const context of contexts.values())for(const record of context.listeners.values())byEvent[record.event].push(record);
  const phases=new Set();
  for(const name of EVENTS)if(byEvent[name].length){if(name==='onAuthRequired')phases.add('headers');else phases.add(PHASE[name]);}
  if(!phases.size){observer?.dispose();observer=null;return;}
  if(!observer)observer=observeRequests(session,{phases,notify});else observer.update(phases);
 }
 function contextFor(event,token){
  const extensionId=event.extension.id;
  if(event.type==='service-worker'){
   const key='w:'+extensionId;let context=contexts.get(key);
   if(!context){context={key,extensionId,worker:true,listeners:new Map()};contexts.set(key,context);}
   context.sender=event.sender;context.scope=`chrome-extension://${extensionId}/`;return context;
  }
  const wc=event.sender;const key=`f:${read(()=>wc.id,0)}:${String(token).slice(0,64)}`;let context=contexts.get(key);
  if(!context){
   if(!generations.has(wc)){generations.set(wc,0);try{wc.on('did-start-navigation',details=>{if(details&&details.isMainFrame&&!details.isSameDocument)generations.set(wc,(generations.get(wc)||0)+1);});wc.once('destroyed',()=>{for(const [k,c] of contexts)if(c.wc===wc)contexts.delete(k);rebuild();});}catch{}}
   const generation=generations.get(wc)||0;
   for(const [k,c] of contexts)if(c.wc===wc&&c.generation<generation)contexts.delete(k);
   context={key,extensionId,worker:false,sender:wc,wc,generation,listeners:new Map()};contexts.set(key,context);
  }
  return context;
 }
 api.handle('webRequest.addListener',(event,name,id,filter,extraInfoSpec,token)=>{
  if(!EVENTS.includes(name)||typeof id!=='string'||id.length>80)throw new Error('Failed to add listener.');
  const extension=event.extension,manifest=extension?.manifest||{};
  const f=filter&&typeof filter==='object'?filter:{};
  const urls=Array.isArray(f.urls)?f.urls:[];
  const patterns=[];for(const url of urls){const test=compilePattern(url);if(!test)throw new Error(MESSAGES.pattern(url));patterns.push(test);}
  const types=Array.isArray(f.types)&&f.types.length?new Set(f.types):null;
  if(types)for(const type of types)if(!RESOURCE_TYPES.has(type))throw new Error(MESSAGES.extraInfo);
  const spec=Array.isArray(extraInfoSpec)?extraInfoSpec.map(String):[];
  if(spec.includes('securityInfo')||spec.includes('securityInfoRawDer'))throw new Error(MESSAGES.securityInfo);
  if(spec.some(item=>!OPTIONS[name].includes(item)))throw new Error(MESSAGES.extraInfo);
  const blocking=spec.includes('blocking')||spec.includes('asyncBlocking');
  if(blocking){
   const has=permission=>{try{return api.permissions?api.permissions.has(extension,permission):(manifest.permissions||[]).includes(permission);}catch{return false;}};
   const may=(manifest.manifest_version<=2&&has('webRequestBlocking'))||(name==='onAuthRequired'&&has('webRequestAuthProvider'));
   if(!may)throw new Error(MESSAGES.blocking);
  }
  const origins=(()=>{try{return api.permissions?.active?.(extension)?.origins;}catch{return null;}})();
  const anyHost=Array.isArray(origins)?origins.length>0:(Array.isArray(manifest.host_permissions)&&manifest.host_permissions.length>0)||(manifest.permissions||[]).some(p=>p==='<all_urls>'||String(p).includes('://'));
  if(!anyHost)throw new Error(MESSAGES.hosts);
  const context=contextFor(event,token);
  context.listeners.set(id,{id,event:name,extensionId:extension.id,context,patterns,types,
   tabId:Number.isInteger(f.tabId)?f.tabId:-1,windowId:Number.isInteger(f.windowId)?f.windowId:-1,
   requestHeaders:spec.includes('requestHeaders'),responseHeaders:spec.includes('responseHeaders'),requestBody:spec.includes('requestBody'),
   blocking:spec.includes('blocking'),asyncBlocking:spec.includes('asyncBlocking')});
  rebuild();
  return undefined;
 });
 api.handle('webRequest.removeListener',(event,name,id,token)=>{
  const key=event.type==='service-worker'?'w:'+event.extension.id:`f:${read(()=>event.sender.id,0)}:${String(token).slice(0,64)}`;
  const context=contexts.get(key);if(context&&context.listeners.delete(id)){if(!context.listeners.size&&!context.worker)contexts.delete(key);rebuild();}
  return undefined;
 });
 // handlerBehaviorChanged: Chrome flushes Blink's in-memory cache on the next navigation; past 20 calls in 10 minutes it posts a warning and
 // continues. Acira's dispatch has no cache to flush (memory-cache hits never reach the network in Electron either), so this keeps the quota.
 api.handle('webRequest.handlerBehaviorChanged',event=>{
  const id=event.extension.id,now=Date.now(),calls=(behaviorCalls.get(id)||[]).filter(time=>now-time<10*60*1000);calls.push(now);behaviorCalls.set(id,calls);
  if(calls.length>MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES)api.log(`${id}: webRequest.handlerBehaviorChanged called more than ${MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES} times in 10 minutes`);
  return undefined;
 });
 api.handle('webRequest.authReply',(event,token,contextToken,response)=>{
  const pending=pendingAuth.get(token);if(!pending)return undefined;
  const key=event.type==='service-worker'?'w:'+event.extension.id:`f:${read(()=>event.sender.id,0)}:${String(contextToken).slice(0,64)}`;
  if(!pending.waiting.delete(key))return undefined;
  if(response&&typeof response==='object')pending.responses.push({extensionId:event.extension.id,response});
  if(!pending.waiting.size)pending.finish();
  return undefined;
 });

 // ----------------------------------------------------------------------------------------------- matching
 /** What every listener test needs about one request, or null when Chrome hides it from every extension. */
 function requestOf(details){
  if(session.__aciraTor)return null;
  const parts=urlParts(details.url);if(!parts||!WEB_SCHEMES.has(parts.scheme))return null;
  const type=TYPES[details.resourceType]||'other';
  const initiator=typeof details.initiatorOrigin==='string'?details.initiatorOrigin:undefined;
  let wc=details.webContents||null;if(!wc&&details.webContentsId)try{wc=require('electron').webContents.fromId(details.webContentsId)||null;}catch{wc=null;}
  if(wc&&read(()=>wc.isDestroyed(),true))wc=null;
  let tabId=-1,windowId=-1,fromExtension=null;
  if(wc){
   const engine=store();
   if(engine&&engine.tabs&&engine.tabs.has(wc)){tabId=wc.id;windowId=read(()=>engine.tabToWindow.get(wc)?.id,-1)??-1;}
   else{const page=read(()=>wc.getURL(),'');if(INTERNAL_PAGE.test(page))return null;const m=/^chrome-extension:\/\/([a-p]{32})\//.exec(page);if(m)fromExtension=m[1];}
  }else{
   // No page: a web or extension service worker (it has an initiator), or the browser itself (Acira's own downloads: hidden).
   if(!initiator||!/^(?:https?|chrome-extension):\/\//i.test(initiator))return null;
   const m=/^chrome-extension:\/\/([a-p]{32})$/.exec(initiator);if(m)fromExtension=m[1];
  }
  if(sensitive(parts,initiator,!wc,type))return null;
  return {details,parts,type,initiator,initiatorParts:initiator&&initiator!=='null'?urlParts(initiator+'/'):null,wc,tabId,windowId,fromExtension,frame:null};
 }
 function listenerMatches(record,req){
  if(req.fromExtension&&record.extensionId!==req.fromExtension)return false;
  if(record.patterns.length&&!record.patterns.some(test=>test(req.parts)))return false;
  if(record.tabId!==-1&&record.tabId!==req.tabId)return false;
  if(record.windowId!==-1&&record.windowId!==req.windowId)return false;
  if(record.types&&!record.types.has(req.type))return false;
  if(!allowed(record.extensionId,req.parts))return false;
  if(req.type!=='main_frame'&&req.type!=='sub_frame'&&req.initiatorParts&&!allowed(record.extensionId,req.initiatorParts))return false;
  return true;
 }
 /** Chrome's details for one event (the union of what the target context's listeners asked for; the renderer trims per listener). */
 function detailsFor(event,req,want){
  const d=req.details,frame=read(()=>d.frame,null),type=req.type;
  const out={requestId:String(d.id),url:d.url,method:d.method};
  if(type==='main_frame'){Object.assign(out,{frameId:0,parentFrameId:-1,frameType:'outermost_frame',documentLifecycle:'active'});}
  else if(frame){
   const parent=read(()=>frame.parent,null);
   out.frameId=frameIdOf(frame);out.parentFrameId=parent?frameIdOf(parent):-1;
   if(type!=='sub_frame')out.documentId=docs.idOf(frame);
   if(parent)out.parentDocumentId=docs.idOf(parent);
   out.frameType=parent?'sub_frame':'outermost_frame';out.documentLifecycle='active';
  }else{out.frameId=-1;out.parentFrameId=-1;}
  out.tabId=req.tabId;out.type=type;
  if(req.initiator!==undefined)out.initiator=req.initiator;
  out.timeStamp=typeof d.timestamp==='number'?d.timestamp:Date.now();
  if(event==='onBeforeRequest'&&want.requestBody){const body=requestBody(d,type);if(body)out.requestBody=body;}
  if((event==='onBeforeSendHeaders'||event==='onSendHeaders')&&want.requestHeaders)out.requestHeaders=headerList(d.requestHeaders);
  if(event==='onHeadersReceived'||event==='onAuthRequired'||event==='onResponseStarted'||event==='onBeforeRedirect'||event==='onCompleted'){
   if(event!=='onHeadersReceived'&&event!=='onAuthRequired'){if(typeof d.ip==='string'&&d.ip)out.ip=d.ip;out.fromCache=!!d.fromCache;}
   out.statusCode=Number.isInteger(d.statusCode)?d.statusCode:0;out.statusLine=typeof d.statusLine==='string'?d.statusLine:'';
   if(event==='onBeforeRedirect')out.redirectUrl=d.redirectURL;
   if(want.responseHeaders)out.responseHeaders=headerList(d.responseHeaders);
  }
  if(event==='onErrorOccurred'){if(typeof d.ip==='string'&&d.ip)out.ip=d.ip;out.fromCache=!!d.fromCache;out.error=String(d.error||'net::ERR_FAILED');}
  return out;
 }
 /** Context targets for one event: Map(contextKey -> {context, ids, want}) */
 function targetsFor(event,req){
  const targets=new Map();
  for(const record of byEvent[event]){
   if(!listenerMatches(record,req))continue;
   let target=targets.get(record.context.key);
   if(!target){target={context:record.context,ids:[],blockingIds:[],want:{requestHeaders:false,responseHeaders:false,requestBody:false}};targets.set(record.context.key,target);}
   target.ids.push(record.id);if(record.blocking||record.asyncBlocking)target.blockingIds.push(record.id);
   if(record.requestHeaders)target.want.requestHeaders=true;if(record.responseHeaders)target.want.responseHeaders=true;if(record.requestBody)target.want.requestBody=true;
  }
  return targets;
 }
 const waking=new Map();
 function deliver(context,payload){
  if(context.worker){
   const sw=context.sender;
   if(sw&&!read(()=>sw.isDestroyed?.(),true)&&!waking.has(context.key)){try{sw.send(CHANNEL,payload);return;}catch{}}
   // A stopped worker: Chrome's lazy listeners wake it; its top-level code registers the same listener ids again.
   const chain=(waking.get(context.key)||Promise.resolve()).then(async()=>{const worker=await session.serviceWorkers.startWorkerForScope(context.scope);context.sender=worker;worker.send(CHANNEL,payload);}).catch(()=>{});
   waking.set(context.key,chain);chain.then(()=>{if(waking.get(context.key)===chain)waking.delete(context.key);});
   return;
  }
  const wc=context.sender;
  if(!wc||read(()=>wc.isDestroyed(),true)){contexts.delete(context.key);rebuild();return;}
  try{wc.send(CHANNEL,payload);}catch{}
 }
 function dispatch(event,req){
  const targets=targetsFor(event,req);
  for(const target of targets.values())deliver(target.context,{e:event,ids:target.ids,d:detailsFor(event,req,target.want)});
 }
 function notify(phase,details){
  if(phase==='headers'&&(details.statusCode===401||details.statusCode===407)&&byEvent.onAuthRequired.length){
   recentAuth.set(details.url,{details,at:Date.now()});if(recentAuth.size>64)recentAuth.delete(recentAuth.keys().next().value);
  }
  const event=EVENT_OF[phase];if(!event||!byEvent[event].length)return;
  const req=requestOf(details);if(!req)return;
  dispatch(event,req);
 }

 // ----------------------------------------------------------------------------------------------- onAuthRequired (Electron's 'login')
 /** Called from the app 'login' hook: null when no blocking listener matches (Acira's own prompt goes on), else Promise<response|null>. */
 function authRequired(wc,login,authInfo){
  if(!byEvent.onAuthRequired.length||!login)return null;
  const seen=recentAuth.get(login.url);recentAuth.delete(login.url);
  const base=seen&&Date.now()-seen.at<60000?seen.details:{id:++authSeq,url:login.url,method:'GET',webContents:wc||undefined,frame:wc?read(()=>wc.mainFrame,null):null,resourceType:'mainFrame',timestamp:Date.now(),statusCode:authInfo?.isProxy?407:401,statusLine:''};
  const req=requestOf({...base,webContents:base.webContents||wc||undefined});if(!req)return null;
  const targets=targetsFor('onAuthRequired',req);if(!targets.size)return null;
  const info={isProxy:!!authInfo?.isProxy,...(authInfo?.scheme?{scheme:String(authInfo.scheme)}:{}),...(authInfo?.realm?{realm:String(authInfo.realm)}:{}),challenger:{host:String(authInfo?.host||req.parts.host),port:Number(authInfo?.port)||Number(req.parts.port)||(req.parts.scheme==='https'?443:80)}};
  const blocking=[...targets.values()].filter(target=>target.blockingIds.length);
  if(!blocking.length){for(const target of targets.values())deliver(target.context,{e:'onAuthRequired',ids:target.ids,d:{...detailsFor('onAuthRequired',req,target.want),...info}});return null;}
  const token=`a${++authToken}`;
  return new Promise(resolve=>{
   const pending={waiting:new Set(blocking.map(target=>target.context.key)),responses:[],finish:null};
   const timer=setTimeout(()=>pending.finish(),5*60*1000);timer.unref?.();
   pending.finish=()=>{clearTimeout(timer);pendingAuth.delete(token);
    // Chrome (MergeOnAuthRequiredResponses): credentials win, else cancel, else no action.
    const credentials=pending.responses.find(r=>r.response.authCredentials&&typeof r.response.authCredentials.username==='string'&&typeof r.response.authCredentials.password==='string');
    if(credentials)resolve({authCredentials:{username:credentials.response.authCredentials.username,password:credentials.response.authCredentials.password}});
    else resolve(pending.responses.some(r=>r.response.cancel===true)?{cancel:true}:null);};
   pendingAuth.set(token,pending);
   for(const target of targets.values())deliver(target.context,{e:'onAuthRequired',ids:target.ids,d:{...detailsFor('onAuthRequired',req,target.want),...info},...(target.blockingIds.length?{b:token,k:target.context.key.startsWith('f:')?target.context.key.split(':').slice(2).join(':'):'w'}:{})});
  });
 }

 const host={
  get active(){return !!observer;},
  authRequired,
  listeners:()=>Object.fromEntries(EVENTS.map(name=>[name,byEvent[name].length])),
  contexts:()=>[...contexts.values()].map(c=>({key:c.key,extensionId:c.extensionId,worker:c.worker,listeners:[...c.listeners.keys()]}))
 };
 Object.defineProperty(session,HOST,{value:host,configurable:true});
 installLoginHook();
 const extensions=session.extensions||session;
 const unloaded=(_event,extension)=>{const id=extension?.id;if(!id)return;access.delete(id);for(const [key,context] of contexts)if(context.extensionId===id)contexts.delete(key);rebuild();};
 try{extensions.on?.('extension-unloaded',unloaded);}catch{}
 return {
  forget(id){unloaded(null,{id});behaviorCalls.delete(id);},
  dispose(){observer?.dispose();observer=null;try{extensions.removeListener?.('extension-unloaded',unloaded);}catch{}try{delete session[HOST];}catch{}}
 };
}

// One app-wide 'login' hook, ahead of Acira's own prompt (website-auth.cjs): extensions that block onAuthRequired answer first. When they
// give no answer, the challenge goes on to Acira's prompt exactly as before (re-emitted with the same callback).
let loginHooked=false;
function installLoginHook(){
 if(loginHooked)return;
 let app;try{app=require('electron').app;}catch{return;}
 if(!app||typeof app.prependListener!=='function')return;
 loginHooked=true;
 app.prependListener('login',(event,wc,details,authInfo,callback)=>{
  if(event?.aciraExtensionsAsked)return;
  const host=read(()=>wc?.session?.[HOST],null);if(!host)return;
  let pending=null;try{pending=host.authRequired(wc,details,authInfo);}catch{pending=null;}
  if(!pending)return;
  event.preventDefault();event.aciraExtensionAuth=true;
  pending.then(answer=>{
   if(answer?.authCredentials){callback(answer.authCredentials.username,answer.authCredentials.password);return;}
   if(answer?.cancel){callback();return;}
   const again={defaultPrevented:false,aciraExtensionsAsked:true,preventDefault(){this.defaultPrevented=true;}};
   try{app.emit('login',again,wc,details,authInfo,callback);}catch{}
   if(!again.defaultPrevented)callback();
  },()=>callback());
 });
}

module.exports={namespaces:['webRequest'],install,HOST,CHANNEL,MESSAGES,requestBody,headerList,sensitive};
