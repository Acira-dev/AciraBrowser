'use strict';
// The registry for Chrome extension API work packages (contract: docs/launch/EXTENSION_WORK_PACKAGES.md).
//
// A package is one or two files in this folder, found by name; nothing else is edited to add one:
//   <name>.cjs           main process:  module.exports = {namespaces: ['tabGroups'], install(api) { api.handle('tabGroups.get', …); return {forget(id) {}}; }}
//   <name>-renderer.cjs  extension pages and service workers (the engine's preload main world):
//                        module.exports = {namespaces: ['tabGroups'], renderer(acira) { return {tabGroups: {factory: base => acira.build('tabGroups', {…})}}; }}
// Files whose name starts with '_' and sub-folders are not packages (a package keeps its helpers in ext-api/<name>/ and requires them from
// its main file). Each namespace has one owner. A renderer function is written into the preload as source text, so it may use only its
// argument (`acira`, see rendererRuntime below) and the page's own globals: no require, no closures over its module.
//
// Order inside an extension context: the engine (electron-chrome-extensions) and Acira's older shims (extension-apis-renderer.cjs) build
// `chrome` first; then Acira's permission table decides which namespaces this extension gets (Chromium's _api_features / _permission_features
// rules, with the 39 permissions Electron calls "unknown"), and each package's factory gets what is there for its namespace (Chromium's
// native object, the engine's or the older shim's, or undefined) and returns the object extensions see, on `chrome` and on Chromium's
// separate `browser`. When the user grants or removes an optional permission, running pages and workers gain or lose namespaces at once.
const fs=require('node:fs'),path=require('node:path');
const signature=require('../extension-api-signature.cjs');
const {createBindings,surface}=signature;

const NAME=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const cache=new Map();

/** Every package in `dir`: [{name, namespaces, install?, renderer?, files}]. Throws on a malformed package or a namespace claimed twice. */
function loadPackages({dir=__dirname,fresh=false}={}){
 const key=path.resolve(dir);if(!fresh&&cache.has(key))return cache.get(key);
 let files=[];try{files=fs.readdirSync(key,{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.cjs')&&entry.name!=='index.cjs'&&!entry.name.startsWith('_')).map(entry=>entry.name).sort();}catch{files=[];}
 const byName=new Map(),known=surface().namespaces;
 for(const file of files){
  const renderer=file.endsWith('-renderer.cjs'),name=file.slice(0,renderer?-'-renderer.cjs'.length:-'.cjs'.length);
  if(!NAME.test(name))throw new Error(`ext-api/${file}: a package name is lower-case words joined by '-'`);
  const mod=require(path.join(key,file)),entry=byName.get(name)||{name,namespaces:new Set(),files:[]};
  entry.files.push(file);
  for(const ns of Array.isArray(mod.namespaces)?mod.namespaces:[]){
   if(typeof ns!=='string'||!known[ns]||known[ns].status==='types')throw new Error(`ext-api/${file}: '${ns}' is not a namespace Chromium exposes to extensions`);
   entry.namespaces.add(ns);
  }
  if(renderer){if(typeof mod.renderer!=='function')throw new Error(`ext-api/${file} must export renderer(acira)`);entry.renderer=mod.renderer;}
  else{if(typeof mod.install!=='function')throw new Error(`ext-api/${file} must export install(api)`);entry.install=mod.install;}
  byName.set(name,entry);
 }
 const owners=new Map();
 for(const entry of byName.values())for(const ns of entry.namespaces){
  if(owners.has(ns))throw new Error(`ext-api: namespace '${ns}' is claimed by both '${owners.get(ns)}' and '${entry.name}'`);
  owners.set(ns,entry.name);
 }
 const packages=[...byName.values()].map(entry=>({...entry,namespaces:[...entry.namespaces]}));
 cache.set(key,packages);return packages;
}

const ACCESS_DENIED='Access to extension API denied.';
// Members the engine or Acira's older shims implement in JavaScript without Chromium's argument checks, among the essential ones (used by at
// least 5 of the 258 census extensions, EXTENSION_API_COVERAGE.json; declarativeNetRequest validates its rules itself). Each gets the
// signature layer (guardLegacy): a call Chromium would reject throws Chromium's exact error; an accepted call reaches the old code unchanged.
// A package that rebuilds a namespace with acira.build() checks every member anyway.
const ESSENTIAL_GUARDS=['action.setTitle','action.setIcon','action.setPopup','action.setBadgeText','action.getBadgeText','action.setBadgeBackgroundColor',
 'action.enable','action.disable','action.getUserSettings','action.openPopup','commands.getAll','contextMenus.create','contextMenus.update','contextMenus.remove',
 'contextMenus.removeAll','cookies.get','cookies.getAll','cookies.set','cookies.remove','downloads.download','downloads.search','extension.getViews',
 'extension.isAllowedIncognitoAccess','extension.isAllowedFileSchemeAccess','identity.getAuthToken','identity.getProfileUserInfo','identity.removeCachedAuthToken',
 'identity.launchWebAuthFlow','identity.getRedirectURL','idle.setDetectionInterval','notifications.create','notifications.clear','offscreen.createDocument',
 'offscreen.closeDocument','permissions.getAll','permissions.contains','permissions.request','permissions.remove','runtime.openOptionsPage','runtime.connectNative',
 'runtime.sendNativeMessage','runtime.getContexts','sidePanel.setOptions','sidePanel.setPanelBehavior','sidePanel.open','storage.sync.remove','storage.sync.clear','storage.managed.get',
 'tabs.get','tabs.getCurrent','tabs.create','tabs.query','tabs.update','tabs.reload','tabs.remove','tabs.captureVisibleTab','webNavigation.getFrame',
 'webNavigation.getAllFrames','windows.get','windows.getCurrent','windows.getLastFocused','windows.getAll','windows.create','windows.update','windows.remove'];
const failure=message=>({__acira_error:String(message)});
const messageOf=error=>String(error&&typeof error==='object'&&'message' in error?error.message:error);
/** The exposed namespace a handler name belongs to ('system.storage.getInfo' -> 'system.storage'), or null for Acira-internal names. */
function namespaceOfHandler(name){
 const namespaces=surface().namespaces,parts=String(name).split('.');
 for(let i=parts.length-1;i>0;i--){const ns=parts.slice(0,i).join('.');if(namespaces[ns])return namespaces[ns].status==='exposed'?ns:null;}
 return null;
}

// ------------------------------------------------------------------------------------------------ who may listen to an event
// The engine's router (electron-chrome-extensions) registers any extension's `crx-add-listener` for ANY event name and its sendEvent /
// broadcastEvent then deliver to every registered listener: the permission checks of chrome.<namespace> live only in the extension's own
// page (the namespace is absent without the permission). An extension page can build an ExtensionEvent of its own, though
// (chrome.tabs.onReplaced.constructor), name any event and hear what Acira or the engine broadcasts for other extensions: downloads,
// history visits, every navigation, the idle state, and the engine's cookies.onChanged with the value of every cookie of the profile.
// The router is therefore guarded in the main process: a listener is accepted, and an event delivered, only while the extension holds the
// namespace the event belongs to (Chromium's feature rules over Acira's permission table, as the guarded() handlers do).
/** Events whose raw delivery has no per-extension check at all: the engine's cookies.onChanged (every cookie change, no host permission)
 *  is replaced by 'acira.cookies.onChanged', which ext-api/cookies.cjs sends only to extensions with host access to the cookie. */
const RETIRED_EVENTS=new Set(['cookies.onChanged']);
/** Internal event names -> the namespace whose permission the listener needs. A name that is neither here nor a namespace's is not gated. */
const EVENT_NAMESPACE=[['acira.cookies.','cookies'],['aciraWebNavigation.','webNavigation'],['aciraWebRequest.','webRequest'],['storage.relay','storage']];
/** Engine names that do not belong to a namespace of the extension's manifest (action.onClicked travels as browserAction.onClicked in MV3). */
const UNGATED_NAMESPACES=new Set(['browserAction','pageAction']);
function namespaceOfEvent(name){
 if(typeof name!=='string')return null;
 for(const [prefix,namespace] of EVENT_NAMESPACE)if(name===prefix||name.startsWith(prefix))return namespace;
 const namespace=namespaceOfHandler(name);
 return namespace&&!UNGATED_NAMESPACES.has(namespace.split('.')[0])?namespace:null;
}
function installEventGate(base){
 const router=base.router;
 if(!router||typeof router.addListener!=='function'||typeof router.sendEvent!=='function')return {dispose(){}};
 const table=base.permissions;
 /** May this listener (an engine record {type, extensionId, host?}) hear this event now? */
 const mayHear=(listener,eventName)=>{
  if(RETIRED_EVENTS.has(eventName))return false;
  const namespace=namespaceOfEvent(eventName);
  if(!namespace)return true;
  let extension=null;try{extension=base.getExtension?.(listener.extensionId)||null;}catch{extension=null;}
  if(!extension)return false;
  try{
   return signature.namespaceAvailable(namespace,{has:permission=>table?table.has(extension,permission):Array.isArray(extension.manifest?.permissions)&&extension.manifest.permissions.includes(permission),
    manifest:extension.manifest||{},isWorker:listener.type==='service-worker'});
  }catch{return false;}
 };
 const addOriginal=router.addListener,sendOriginal=router.sendEvent;
 // Never throws: the engine calls addListener from an ipcMain.on handler, where a throw is an uncaught exception of the main process.
 const add=function(listener,extensionId,eventName){
  // An extension that is not loaded (its page outlived a disable or removal) would make the engine throw, which is an uncaught exception in the main process.
  let loaded=null;try{loaded=base.getExtension?.(extensionId)||null;}catch{loaded=null;}
  if(!loaded||!mayHear({...(listener||{}),extensionId},eventName))return undefined;
  return addOriginal.call(this,listener,extensionId,eventName);
 };
 const send=function(target,eventName,...args){
  if(RETIRED_EVENTS.has(eventName))return undefined;
  const all=this.listeners&&typeof this.listeners.get==='function'?this.listeners.get(eventName):null;
  if(!Array.isArray(all)||!all.length)return sendOriginal.call(this,target,eventName,...args);
  const allowed=all.filter(listener=>mayHear(listener,eventName));
  if(allowed.length===all.length)return sendOriginal.call(this,target,eventName,...args);
  // The engine delivers to this.listeners.get(eventName) synchronously: it sees only the listeners that may hear, then the full list is back.
  this.listeners.set(eventName,allowed);
  try{return sendOriginal.call(this,target,eventName,...args);}
  finally{if(this.listeners.get(eventName)===allowed)this.listeners.set(eventName,all);}
 };
 router.addListener=add;router.sendEvent=send;
 return {dispose(){if(router.addListener===add)router.addListener=addOriginal;if(router.sendEvent===send)router.sendEvent=sendOriginal;}};
}

/**
 * Main-process side: installs every package on one profile session's engine. `base` comes from extension-apis.cjs (installExtensionApis):
 * {session, runtime, router, userData, storeKey, getWindow, getExtension, emit, dialog, t, permissions, log}.
 * Returns {packages, forget(id), dispose()}.
 */
function installPackages(base,{packages=loadPackages(),log=(...args)=>console.warn(...args)}={}){
 const installed=[];
 const gate=installEventGate(base);
 for(const pkg of packages){
  if(!pkg.install)continue;
  try{const result=pkg.install(packageApi(base,pkg))||{};installed.push({name:pkg.name,forget:result.forget,dispose:result.dispose});}
  catch(error){log(`[ext-api] ${pkg.name} was not installed:`,messageOf(error));}
 }
 return {
  packages:installed.map(entry=>entry.name),
  forget(id){for(const entry of installed)try{entry.forget?.(id);}catch{}},
  dispose(){for(const entry of installed)try{entry.dispose?.();}catch{}gate.dispose();}
 };
}

/**
 * The guard every package handler runs behind: the caller must have the namespace by Chromium's rules and Acira's permission table (a page
 * cannot call what its bindings would not have), a thrown error or a rejection becomes {__acira_error} (the extension sees a rejection or
 * runtime.lastError; Electron would otherwise log a stack for every failing call).
 */
function guarded(base,name,callback,{check=true}={}){
 const ns=check?namespaceOfHandler(name):null;
 return (event,...args)=>{
  try{
   if(ns){
    const extension=event?.extension,table=base.permissions;
    const has=table&&extension?permission=>table.has(extension,permission):permission=>Array.isArray(extension?.manifest?.permissions)&&extension.manifest.permissions.includes(permission);
    if(!extension||!signature.namespaceAvailable(ns,{has,manifest:extension.manifest||{},isWorker:event.type==='service-worker'}))return failure(ACCESS_DENIED);
   }
   const result=callback(event,...args);
   return result&&typeof result.then==='function'?result.then(value=>value,error=>failure(messageOf(error))):result;
  }catch(error){return failure(messageOf(error));}
 };
}

/** What a main-side package gets (EXTENSION_WORK_PACKAGES.md lists every field). */
function packageApi(base,pkg){
 const router=base.router;
 const api={
  name:pkg.name,session:base.session,runtime:base.runtime,userData:base.userData,storeKey:base.storeKey,
  getWindow:base.getWindow||(()=>null),getExtension:base.getExtension||(()=>null),dialog:base.dialog||null,t:base.t||((id)=>id),
  /** Acira's permission table for this profile (extension-permission-table.cjs): has, hasOrigin, active, granted, grant, revoke, request, onChange. */
  permissions:base.permissions||null,
  /** The engine's tab/window store (electron-chrome-extensions' ctx.store), or null. */
  store:()=>base.runtime?.ctx?.store||null,
  /** Answer an extension call. callback(event, ...args): event = {type: 'frame' | 'service-worker', sender, extension}. options.check: false
   *  skips the permission check (only for names outside Chromium's namespaces, which are never checked anyway). */
  handle(name,callback,options){if(typeof name!=='string'||typeof callback!=='function')throw new TypeError('handle(name, callback)');router.handle(name,guarded(base,name,callback,options));},
  /** Replace an existing handler (the engine's or another layer's), keeping it callable: wrap(name, original => (event, ...args) => …). */
  wrap(name,make,options){
   const current=router.handlers.get(name),original=typeof current?.callback==='function'?current.callback:null;
   const next=make(original?(event,...args)=>original(event,...args):null);if(typeof next!=='function')throw new TypeError(`wrap(${name}) must return a handler`);
   router.handlers.set(name,{...(current||{extensionContext:true,allowRemote:false}),permission:undefined,callback:guarded(base,name,next,options)});
  },
  /** The engine's current handler for a name, or null. */
  handler:name=>{const found=router.handlers.get(name);return typeof found?.callback==='function'?found.callback:null;},
  /** Send an event to one extension's listeners (all its pages and its worker; a stopped worker is started). */
  emit:(extensionId,name,...args)=>{try{router.sendEvent(extensionId,name,...args);}catch{}},
  /** Send an event to every extension of this session that listens for it. */
  broadcast:(name,...args)=>{try{router.broadcastEvent(name,...args);}catch{}},
  /** The extension IDs of this session that listen for an event now. */
  listening:name=>[...new Set((router.listeners?.get?.(name)||[]).map(listener=>listener.extensionId))],
  /** May this extension use chrome.<namespace> (Chromium's feature rules over Acira's permission table)? */
  available:(extensionId,namespace,{isWorker=false}={})=>{
   const extension=base.getExtension?.(extensionId);if(!extension)return false;
   const table=base.permissions;
   return signature.namespaceAvailable(namespace,{has:permission=>table?table.has(extension,permission):(extension.manifest?.permissions||[]).includes(permission),manifest:extension.manifest||{},isWorker});
  },
  failure,value:v=>({__acira_value:v}),errors:signature.errors,
  log:(...args)=>(base.log||console.warn)(`[ext-api:${pkg.name}]`,...args)
 };
 return Object.freeze(api);
}

// ------------------------------------------------------------------------------------------------ renderer side

const DROP=new Set(['deprecated','nodoc','nocompile','file','status','returns','platforms','permissions','manifestKeys','anyOf','contexts',
 'minManifestVersion','featureFlag','notInServiceWorkers','id','maxListeners']);
/** A member's feature, reduced to what decides whether it is bound for an extension. */
function slimFeature(feature){
 if(!feature||typeof feature!=='object')return undefined;
 if(feature.ok===false)return {ok:false};
 const out={};
 for(const key of ['permissions','manifestKeys'])if(Array.isArray(feature[key])&&feature[key].length)out[key]=feature[key];
 if(Array.isArray(feature.anyOf)&&feature.anyOf.length)out.anyOf=feature.anyOf.map(set=>({permissions:set.permissions||[],manifestKeys:set.manifestKeys||[]}));
 for(const key of ['notInServiceWorkers','minManifestVersion','maxManifestVersion'])if(feature[key]!==undefined)out[key]=feature[key];
 return Object.keys(out).length?out:undefined;
}
/** The schema the preload carries: everything argument checks, builders and gating use, nothing else (no docs). */
function slimSpec(spec,depth=0){
 if(Array.isArray(spec))return spec.map(item=>slimSpec(item,depth+1));
 if(!spec||typeof spec!=='object')return spec;
 const out={};
 if(depth===0&&spec.status){
  // The namespace's own feature: who gets chrome.<name> at all.
  out.gate=spec.status!=='exposed'?{ok:false}:{permissions:spec.permissions||[],manifestKeys:spec.manifestKeys||[],...(Array.isArray(spec.anyOf)&&spec.anyOf.length?{anyOf:spec.anyOf.map(set=>({permissions:set.permissions||[],manifestKeys:set.manifestKeys||[]}))}:{})};
 }
 for(const [key,value] of Object.entries(spec)){
  if(DROP.has(key))continue;
  if(key==='feature'){const slim=slimFeature(value);if(slim)out.feature=slim;continue;}
  if(key==='value'||key==='enum'||key==='default'){out[key]=value;continue;}
  if((key==='properties'||key==='types'||key==='functions'||key==='events')&&value&&typeof value==='object'&&!Array.isArray(value)){
   out[key]=Object.fromEntries(Object.entries(value).map(([name,child])=>[name,slimSpec(child,depth+1)]));continue;
  }
  out[key]=slimSpec(value,depth+1);
 }
 return out;
}
/**
 * The preload is parsed by every page of the profile (web pages too, even though only extension contexts run it), so it carries only what
 * the runtime reads: argument checks need function parameters and the types they reach; buildNamespace needs enums (constants), typed
 * properties' methods and member features. Event parameters, callback parameter shapes and types only used in results are left out.
 */
function slimSurface(){
 const namespaces=surface().namespaces,reachable=new Set(),queue=[];
 const lookup=ref=>{const cut=ref.lastIndexOf('.');const ns=namespaces[ref.slice(0,cut)];return ns&&ns.types&&ns.types[ref.slice(cut+1)]||null;};
 const collect=value=>{if(Array.isArray(value)){value.forEach(collect);return;}if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(key==='$ref'&&typeof child==='string'){if(!reachable.has(child)){reachable.add(child);queue.push(child);}}else collect(child);}};
 const functionsOf=spec=>Object.values(spec&&spec.functions||{});
 for(const [name,ns] of Object.entries(namespaces)){
  for(const fn of functionsOf(ns))collect(fn.parameters||[]);
  for(const prop of Object.values(ns.properties||{}))collect(prop);
  // Typed objects with methods (StorageArea, ChromeSetting, Port, Resource …) stay whole: packages build them with buildType().
  for(const [typeName,type] of Object.entries(ns.types||{}))if(type&&(type.functions||type.events)){const ref=`${name}.${typeName}`;if(!reachable.has(ref)){reachable.add(ref);queue.push(ref);}}
 }
 while(queue.length){const type=lookup(queue.shift());if(!type)continue;const {functions,events,...shape}=type;collect(shape);for(const fn of functionsOf(type))collect(fn.parameters||[]);}
 // Namespaces keep members in objects keyed by name, types (StorageArea, ChromeSetting) in arrays of named entries: keep each shape.
 const each=(list,map)=>(Array.isArray(list)?list.map(map):Object.fromEntries(Object.entries(list||{}).map(([name,item])=>[name,map(item)])));
 const trimFunctions=functions=>each(functions,fn=>(fn&&fn.returns_async?{...fn,returns_async:{...fn.returns_async,parameters:(fn.returns_async.parameters||[]).length?[{}]:[]}}:fn));
 const trimEvents=events=>each(events,ev=>{const {parameters,...rest}=ev||{};return rest;});
 const out={};
 for(const [name,ns] of Object.entries(namespaces)){
  const types={};
  for(const [typeName,type] of Object.entries(ns.types||{})){
   if(reachable.has(`${name}.${typeName}`))types[typeName]={...type,...(type.functions?{functions:trimFunctions(type.functions)}:{}),...(type.events?{events:trimEvents(type.events)}:{})};
   else if(type.enum)types[typeName]={enum:type.enum};
  }
  out[name]=slimSpec({...ns,functions:trimFunctions(ns.functions),events:trimEvents(ns.events),types});
 }
 return out;
}
let schemaText=null;
/** An expression for a lazy schema lookup: one JSON string per namespace, parsed the first time it is needed. */
function schemaSource(){
 if(schemaText)return schemaText;
 const entries=Object.entries(slimSurface()).map(([name,ns])=>`${JSON.stringify(name)}:${JSON.stringify(JSON.stringify(ns))}`);
 return schemaText=`(() => { const raw = {${entries.join(',')}}; const parsed = Object.create(null); return (name) => { if (!(name in parsed)) parsed[name] = Object.prototype.hasOwnProperty.call(raw, name) ? JSON.parse(raw[name]) : null; return parsed[name] || undefined; }; })()`;
}
/** A function's source as an expression (an object-literal method `renderer(acira) {…}` becomes `function renderer(acira) {…}`). */
function asExpression(fn){
 const text=fn.toString().trim();
 if(/^(async\s+)?function\b/.test(text)||/^(async\s*)?\(/.test(text)||/^(async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(text))return text;
 const method=/^(async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(text);
 if(method)return `${method[1]||''}function ${text.slice((method[1]||'').length)}`;
 throw new Error('A package renderer must be a function');
}

/**
 * Runs inside every extension page and service worker (the engine preload's main world), before the engine builds `chrome`.
 * ctx: {electron, extensionId, manifest, ExtensionEvent, withLastError, createBindings, schema, packages, grants}.
 * Gives packages `acira` (see EXTENSION_WORK_PACKAGES.md), gates namespaces by Acira's permission table and applies the packages'
 * namespaces on chrome and browser (after()).
 */
function rendererRuntime(ctx){
 const {electron,extensionId,manifest,ExtensionEvent,withLastError,createBindings,schema,packages}=ctx;
 const g=globalThis;
 const bindings=createBindings(schema,{withLastError});
 // A service worker has no document (pages, popups, side panels and offscreen documents do).
 const isWorker=typeof g.document==='undefined'&&typeof g.window==='undefined';
 const minVersion=ctx.permissionMinVersion||{};
 const strings=value=>(Array.isArray(value)?value.filter(item=>typeof item==='string'&&item):[]);
 const isPattern=value=>value==='<all_urls>'||/^[a-z*][a-z0-9+.*-]*:\/\//i.test(value);
 // Acira's permission table for this extension: the manifest's permissions plus the optional ones the user granted (baked into the preload
 // when it was written, then kept current by 'acira.permissions.changed' from the main process).
 const optional=strings(manifest.optional_permissions),optionalOrigins=[...strings(manifest.optional_host_permissions),...optional.filter(isPattern)];
 const baked=ctx.grants&&typeof ctx.grants==='object'&&ctx.grants[extensionId]||{};
 // _permission_features: some permissions exist only from a manifest version on (tabGroups, sidePanel, offscreen … need MV3).
 const allowed=name=>!isPattern(name)&&!(minVersion[name]>manifest.manifest_version);
 let permissions=new Set([...strings(manifest.permissions).filter(allowed),...strings(baked.permissions).filter(name=>optional.includes(name)&&allowed(name))]);
 let origins=[...strings(manifest.host_permissions),...strings(manifest.permissions).filter(isPattern),...strings(baked.origins)];
 const has=name=>permissions.has(name);
 const context={has,manifest,isWorker};
 const available=namespace=>bindings.namespaceAvailable(namespace,context);
 const known=namespace=>!!schema(namespace);
 const unwrap=result=>{
  if(result&&typeof result==='object'&&typeof result.__acira_error==='string')throw new Error(result.__acira_error);
  return result&&typeof result==='object'&&Object.prototype.hasOwnProperty.call(result,'__acira_value')?result.__acira_value:result;
 };
 /** A main-process call: call('tabGroups.get')(groupId) -> Promise. No argument checks here: build() checks before behaviour runs. */
 const call=name=>(...args)=>Promise.resolve(electron.invokeExtension(extensionId,name,{},...args)).then(unwrap);
 /** An event the main process sends with api.emit(): subscribed while it has listeners, Chromium's addListener rules on top. */
 const event=(name,options={})=>{
  const cut=name.lastIndexOf('.'),spec=(()=>{try{const ns=schema(name.slice(0,cut));return ns&&ns.events&&ns.events[name.slice(cut+1)];}catch(e){return undefined;}})();
  let source=null;
  const relay=(...args)=>evt.dispatch(...args);
  const evt=bindings.createEvent(name,{supportsFilters:!!(spec&&(spec.filters||spec.supportsFilters)),...options,
   add:(...args)=>{if(!source){try{source=new ExtensionEvent(name);source.addListener(relay);}catch(e){source=null;}}if(typeof options.add==='function')options.add(...args);},
   remove:(...args)=>{if(typeof options.remove==='function')options.remove(...args);if(source&&!evt.hasListeners()){try{source.removeListener(relay);}catch(e){}source=null;}}});
  return evt;
 };
 const build=(namespace,impl)=>bindings.buildNamespace(namespace,impl,{setLastError:withLastError,context});
 const buildType=(ref,impl,options)=>bindings.buildType(ref,impl,{setLastError:withLastError,context,...(options||{})});
 /** An object that answers `overrides` first and `base` for the rest (base may be a frozen or native object). */
 const extend=(base,overrides)=>{
  if(!base||typeof base!=='object')return {...overrides};
  const fixed=Object.keys(overrides).some(key=>{const d=Object.getOwnPropertyDescriptor(base,key);return !!d&&d.configurable===false;});
  if(fixed||Object.isFrozen(base)){const derived=Object.create(base);for(const key of Object.keys(overrides))Object.defineProperty(derived,key,{value:overrides[key],enumerable:true,configurable:true,writable:true});return derived;}
  const bound=new Map();
  return new Proxy(base,{
   get(target,key){if(Object.prototype.hasOwnProperty.call(overrides,key))return overrides[key];const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(!bound.has(key))bound.set(key,value.bind(target));return bound.get(key);},
   has(target,key){return Object.prototype.hasOwnProperty.call(overrides,key)||Reflect.has(target,key);},
   ownKeys(target){return [...new Set([...Reflect.ownKeys(target),...Object.keys(overrides)])];},
   getOwnPropertyDescriptor(target,key){if(Object.prototype.hasOwnProperty.call(overrides,key))return {value:overrides[key],enumerable:true,configurable:true,writable:true};return Reflect.getOwnPropertyDescriptor(target,key);}
  });
 };
 const getAt=(root,path)=>{let value=root;for(const part of path.split('.')){if(!value||typeof value!=='object'&&typeof value!=='function')return undefined;try{value=value[part];}catch(e){return undefined;}}return value;};
 // A pinned namespace (see pin()) is non-configurable but writable: it is replaced by assignment.
 const setOn=(target,key,value)=>{try{Object.defineProperty(target,key,{value,enumerable:true,configurable:true,writable:true});}catch(e){try{target[key]=value;}catch(e2){return false;}}try{return target[key]===value;}catch(e){return false;}};
 /** Puts `value` at a dotted path ('system.storage'); a parent that refuses the property is replaced by a copy that holds it. */
 const setAt=(root,path,value)=>{
  const parts=path.split('.'),key=parts.pop();
  if(!parts.length)return setOn(root,key,value);
  const parentPath=parts.join('.');let parent=getAt(root,parentPath);
  if(!parent||typeof parent!=='object'){parent={};if(!setAt(root,parentPath,parent))return false;}
  if(setOn(parent,key,value))return true;
  const copy={};for(const name of Object.keys(parent))try{copy[name]=parent[name];}catch(e){}
  copy[key]=value;return setAt(root,parentPath,copy);
 };
 const removeAt=(root,path)=>{const parts=path.split('.'),key=parts.pop(),parent=parts.length?getAt(root,parts.join('.')):root;if(!parent||typeof parent!=='object')return;let gone=false;try{gone=delete parent[key];}catch(e){gone=false;}if(!gone)try{parent[key]=undefined;}catch(e){}};
 /**
  * Chromium rebuilds an extension context's bindings whenever the renderer hears of an extension load or a permission change
  * (NativeExtensionBindingsSystem::UpdateBindingsForContext): every namespace Electron knows is put back as its native lazy property and
  * every namespace Electron does not know (contextMenus, notifications, downloads, … the 39 "unknown" permissions) is deleted. At app start,
  * when profiles' extensions load one after another, that wiped the engine's and Acira's namespaces from workers already running
  * (chrome.tabs.create undefined in uBO Lite and Privacy Badger until their worker restarted). The library froze `chrome` against it,
  * which broke extensions that proxy `chrome` (Proton Pass). Instead each namespace Acira manages is pinned: non-configurable (Chromium's
  * redefinition and delete fail, as they did on the frozen object) but writable, so a Proxy over `chrome` may return any value for it.
  */
 const pin=(target,key)=>{try{const d=Object.getOwnPropertyDescriptor(target,key);if(!d||d.configurable===false||!('value' in d)||d.value===undefined)return;Object.defineProperty(target,key,{value:d.value,enumerable:true,configurable:false,writable:true});}catch(e){}};
 function pinAll(object){
  if(!object||typeof object!=='object')return;
  for(const path of [...Object.keys(engineDefinitions),...Object.keys(definitions),'system.storage']){
   const parts=path.split('.');let target=object;
   for(const part of parts){if(!target||typeof target!=='object')break;pin(target,part);try{target=target[part];}catch(e){target=null;}}
  }
 }
 const report=(message,error)=>{try{console.error(message,error);}catch(e){}};
 const api=Object.freeze({extensionId,manifest,isWorker,has,available,
  /** True in a private session that runs this extension ("Allow in private tabs"): the extension is allowed in incognito. */
  incognito:ctx.incognito===true,
  /** The permissions and host patterns this extension holds now: {permissions, origins}. */
  permissions:()=>({permissions:[...permissions],origins:[...origins]}),
  call,event,build,buildType,extend,bindings,errors:bindings.errors,withLastError,
  chrome:()=>g.chrome,later:bindings.later,callbackArgs:bindings.callbackArgs});
 const definitions=Object.create(null),owned=new Set();
 for(const pkg of packages){
  let defs;try{defs=pkg.renderer(api)||{};}catch(error){report(`Acira: extension API package ${pkg.name} failed to start`,error);continue;}
  for(const [namespace,def] of Object.entries(defs)){
   if(!def||typeof def.factory!=='function'||owned.has(namespace)||!strings(pkg.namespaces).includes(namespace))continue;
   owned.add(namespace);definitions[namespace]={...def,package:pkg.name};
  }
 }
 let engineDefinitions={},root=null;
 const applied=new Map();   // namespace -> {before, value} for package namespaces
 const engineState=new Map(); // package namespace -> the engine object the gate removed (no permission yet)
 const wanted=namespace=>{const def=definitions[namespace];try{return typeof def.gate==='function'?!!def.gate(api):available(namespace);}catch(e){return false;}};
 /** Chromium's argument checks in front of the engine's / older shims' essential members (ESSENTIAL_GUARDS in ext-api/index.cjs). */
 function guardEngine(chrome){
  for(const path of strings(ctx.guards)){
   const parts=path.split('.');let ns=null,rest=null;
   for(let i=parts.length-1;i>0;i--){const candidate=parts.slice(0,i).join('.');if(known(candidate)){ns=candidate;rest=parts.slice(i);break;}}
   if(!ns||rest.length>2)continue;
   let spec,fn,label,owner;
   try{
    spec=schema(ns);
    const member=(list,name)=>(Array.isArray(list)?list.find(item=>item&&item.name===name):list&&list[name]);
    if(rest.length===1){fn=member(spec.functions,rest[0]);label=`${ns}.${rest[0]}`;owner=getAt(chrome,ns);}
    else{const prop=spec.properties&&spec.properties[rest[0]],type=prop&&prop.$ref?bindings.lookupType(prop.$ref):null;fn=type&&member(type.functions,rest[1]);label=`${prop&&prop.$ref?bindings.typeLabel(prop.$ref):ns}.${rest[1]}`;owner=getAt(chrome,`${ns}.${rest[0]}`);}
   }catch(e){continue;}
   const key=rest[rest.length-1];
   if(!fn||!owner||typeof owner!=='object')continue;
   let impl;try{impl=owner[key];}catch(e){continue;}
   const checkedFn=bindings.guardLegacy(label,fn,impl);
   if(checkedFn!==impl)setOn(owner,key,checkedFn);
  }
 }
 /** Brings `chrome` in line with the permission table: engine namespaces Chromium would not bind go, granted ones come; then packages. */
 function sync(chrome,changes){
  for(const [namespace,def] of Object.entries(engineDefinitions)){
   if(!known(namespace)||Object.prototype.hasOwnProperty.call(definitions,namespace))continue;
   const present=getAt(chrome,namespace)!==undefined,want=available(namespace);
   if(present&&!want){const value=getAt(chrome,namespace);removeAt(chrome,namespace);changes.set(namespace,{before:value,after:undefined});}
   // The engine's own shouldInject is honoured as the engine does: its i18n stand-in is for MV3 contexts only, and the engine preload also
   // runs in websites' service workers (no manifest), where building it threw "chrome.i18n could not be built" at every worker start.
   else if(!present&&want&&def&&typeof def.factory==='function'&&(()=>{try{return typeof def.shouldInject!=='function'||!!def.shouldInject();}catch(e){return false;}})()){
    let value;try{value=def.factory(getAt(chrome,namespace));}catch(error){report(`Acira: chrome.${namespace} could not be built`,error);continue;}
    if(value!==undefined&&setAt(chrome,namespace,value))changes.set(namespace,{before:undefined,after:value});
   }
  }
  guardEngine(chrome);
  for(const namespace of Object.keys(definitions)){
   const def=definitions[namespace],want=wanted(namespace),done=applied.get(namespace);
   if(done&&!want){removeAt(chrome,namespace);applied.delete(namespace);changes.set(namespace,{before:done.value,after:undefined});continue;}
   if(done||!want){if(!want&&getAt(chrome,namespace)!==undefined&&known(namespace)){const value=getAt(chrome,namespace);removeAt(chrome,namespace);engineState.set(namespace,value);changes.set(namespace,{before:value,after:undefined});}continue;}
   let before=getAt(chrome,namespace),value;
   // Granted after start: the engine's (or older shim's) object is built first, so a factory that extends it gets it as at startup.
   const engine=engineDefinitions[namespace];
   if(before===undefined&&engineState.has(namespace))before=engineState.get(namespace);
   else if(before===undefined&&engine&&typeof engine.factory==='function'&&root&&(typeof engine.shouldInject!=='function'||engine.shouldInject()))try{before=engine.factory(undefined);}catch(e){before=undefined;}
   try{value=def.factory(before);}catch(error){report(`Acira: ${def.package} could not build chrome.${namespace}`,error);continue;}
   if(value===undefined)continue;
   if(setAt(chrome,namespace,value)){applied.set(namespace,{before,value});changes.set(namespace,{before,after:value});}
  }
 }
 /** Chromium's `browser` object (a separate object holding only native namespaces) gets every namespace Acira changed on `chrome`. */
 function mirror(browser,changes){
  if(!browser)return;
  for(const [namespace,{before,after}] of changes){
   const current=getAt(browser,namespace);
   if(after===undefined){if(current!==undefined&&(current===before||!available(namespace)))removeAt(browser,namespace);continue;}
   setAt(browser,namespace,after);
  }
 }
 const browserOf=chrome=>(g.browser&&typeof g.browser==='object'&&g.browser!==chrome?g.browser:null);
 function refresh(){
  if(!root)return;
  const changes=new Map();
  try{sync(root,changes);}catch(error){report('Acira: extension API update failed',error);}
  mirror(browserOf(root),changes);
  pinAll(root);pinAll(browserOf(root));
 }
 /** Called by the patched engine preload once its table is applied: apiDefinitions is the engine's table (with Acira's older shims). */
 function after(chrome,apiDefinitions,extra){
  root=chrome;engineDefinitions=apiDefinitions&&typeof apiDefinitions==='object'?apiDefinitions:{};
  if(extra)try{extra.after(chrome,Object.keys(engineDefinitions));}catch(error){report('Acira: extension API setup failed',error);}
  refresh();
  // Optional permissions can change while this page or worker runs (permissions.request / remove, Settings): follow them.
  if(optional.length||optionalOrigins.length)try{new ExtensionEvent('acira.permissions.changed').addListener(next=>{
   if(!next||typeof next!=='object')return;
   permissions=new Set(strings(next.permissions).filter(allowed));origins=strings(next.origins);refresh();
  });}catch(e){}
 }
 return {owned,has,after,bindings,definitions,available,refresh};
}

/** The preload text for one session: an expression that evaluates to the renderer runtime of every package.
 *  options: {packages, grants} (grants: the permission table's snapshot(), {id: {permissions, origins}}). */
function rendererSource({packages=loadPackages(),grants={},incognito=false}={}){
 const list=packages.filter(pkg=>pkg.renderer).map(pkg=>`{name: ${JSON.stringify(pkg.name)}, namespaces: ${JSON.stringify(pkg.namespaces)}, renderer: (${asExpression(pkg.renderer)})}`);
 const granted={};for(const [id,value] of Object.entries(grants&&typeof grants==='object'?grants:{}))if(/^[a-p]{32}$/.test(id)&&value&&typeof value==='object')granted[id]={permissions:Array.isArray(value.permissions)?value.permissions:[],origins:Array.isArray(value.origins)?value.origins:[]};
 const minVersions={};for(const [name,rule] of Object.entries(surface().permissions||{}))if(rule&&rule.minManifestVersion)minVersions[name]=rule.minManifestVersion;
 return `(${rendererRuntime.toString()})({ electron, extensionId, manifest, ExtensionEvent, withLastError: acira_withLastError, createBindings: (${createBindings.toString()}), schema: ${schemaSource()}, permissionMinVersion: ${JSON.stringify(minVersions)}, guards: ${JSON.stringify(ESSENTIAL_GUARDS)}, grants: ${JSON.stringify(granted)}, packages: [${list.join(', ')}], incognito: ${incognito===true} })`;
}

module.exports={loadPackages,installPackages,installEventGate,namespaceOfEvent,rendererSource,rendererRuntime,schemaSource,slimSpec,asExpression,failure,namespaceOfHandler,ACCESS_DENIED};
