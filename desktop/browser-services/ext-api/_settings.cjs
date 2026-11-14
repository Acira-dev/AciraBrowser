'use strict';
// Main-process half of Chrome's ChromeSetting type (chrome.proxy.settings, chrome.privacy.*.*): get / set / clear / onChange over the
// profile's extension-settings store (../extension-chrome-settings.cjs). Shared by the proxy and privacy packages; not a package itself.
//
// A setting is described by a definition:
//   {path, key, validate(value), fixed(ctx), resolve(winnerValue|undefined, ctx), accept(value, ctx), apply(ctx)}
//     path     handler prefix ('proxy.settings', 'privacy.network.webRTCIPHandlingPolicy'); events are `${path}.onChange`
//     key      store key (same as path here)
//     fixed    Acira fixes the value: levelOfControl is not_controllable and an extension's set() changes nothing (as for a managed Chrome pref)
//     resolve  the value in effect given the winning extension's value (undefined: nobody controls it)
//     accept   false = Acira refuses this value (it would weaken a default); set() resolves and stores nothing
//     apply    makes the browser follow the store (proxy: session.setProxy …); awaited by set / clear, run in the background otherwise
const chromeSettings=require('../extension-chrome-settings.cjs');

const GRACE_MS=15000;
const INCOGNITO_SCOPES=new Set(['incognito_persistent','incognito_session_only']);
/** Chromium's message when an extension without incognito access asks for incognito settings (Acira runs no extension in private windows). */
const INCOGNITO_ERROR='You do not have permission to access incognito preferences.';

/**
 * Opens the profile's store and ties it to the extensions that are really running. Idempotent per session: the proxy and privacy
 * packages both call it. Right after a start the persisted values count for every extension (they are loaded a moment later; a VPN
 * extension's proxy must not wait for its service worker), then only loaded ones count.
 */
function openStore(api,{grace=GRACE_MS}={}){
 const store=chromeSettings.forProfile(api.storeKey,{userData:api.userData});
 const host=chromeSettings.hostFor(api.session);
 if(host&&host.store===store&&host.wired)return {store,dispose(){}};
 const started=Date.now(),gone=new Set(),extensions=api.session&&api.session.extensions;
 const name=id=>{const extension=api.getExtension(id);return extension&&(extension.name||extension.manifest&&extension.manifest.name)||null;};
 store.setResolver({
  // `gone` (unloaded since this run began) is authoritative: the engine may still list an extension for a moment after 'extension-unloaded'
  active:id=>!gone.has(id)&&(!!api.getExtension(id)||Date.now()-started<grace),
  name:(id,stored)=>name(id)||stored||id
 });
 const onLoaded=(_event,extension)=>{const id=extension&&extension.id;if(!id)return;gone.delete(id);store.rename(id,extension.name||extension.manifest&&extension.manifest.name);store.refresh();};
 const onUnloaded=(_event,extension)=>{const id=extension&&(extension.id||extension);if(typeof id==='string'){gone.add(id);store.refresh();const again=setTimeout(()=>{try{store.refresh();}catch{}},300);if(again.unref)again.unref();}};
 try{extensions&&extensions.on&&extensions.on('extension-loaded',onLoaded);extensions&&extensions.on&&extensions.on('extension-unloaded',onUnloaded);}catch{}
 const timer=setTimeout(()=>{try{store.refresh();}catch{}},grace+50);if(timer.unref)timer.unref();
 chromeSettings.registerHost(api.session,{store,wired:true});
 return {store,dispose(){clearTimeout(timer);try{extensions&&extensions.removeListener&&extensions.removeListener('extension-loaded',onLoaded);extensions&&extensions.removeListener&&extensions.removeListener('extension-unloaded',onUnloaded);}catch{}}};
}

/** Sets the WebRTC IP handling policy on every page of this profile's session (never a Tor page: those are locked by tor-window.cjs). */
function pushWebRtcPolicy(session,{contents}={}){
 if(!session||session.__aciraTor)return 0;
 const host=chromeSettings.hostFor(session),choice=host&&host.userChoice&&host.userChoice();
 const base=choice&&choice.mode==='fixed_servers'?'disable_non_proxied_udp':'default_public_interface_only';
 const policy=chromeSettings.webRtcPolicy(session,base);
 let list=[];
 const provider=contents||hooks.contents;
 try{list=typeof provider==='function'?provider():require('electron').webContents.getAllWebContents();}catch{list=[];}
 let count=0;
 for(const wc of list){
  try{
   if(!wc||wc.isDestroyed()||wc.session!==session||wc.__aciraTorLocked)continue;
   wc.setWebRTCIPHandlingPolicy(policy);count++;
  }catch{/* a page that closes while we look */}
 }
 return count;
}

/**
 * Installs get/set/clear handlers and onChange events for `definitions`. Returns {store, forget(id), dispose(), details(def, id), runApply(def)}.
 * options: {log, contents} (contents: test hook listing web contents).
 */
function installSettings(api,definitions,options={}){
 const {store,dispose:closeStore}=openStore(api,options);
 const session=api.session;
 const ctx={api,session,store,options};
 const byKey=new Map(definitions.map(def=>[def.key,def]));
 const log=(...args)=>{try{(options.log||api.log)(...args);}catch{}};
 const isFixed=def=>!!session.__aciraTor||(typeof def.fixed==='function'?!!def.fixed(ctx):!!def.fixed);
 const extensionId=event=>{const id=event&&event.extension&&event.extension.id;if(typeof id!=='string')throw new Error('Access to extension API denied.');return id;};

 /** {value, levelOfControl} as `get` answers it for one extension. */
 function details(def,id){
  const fixed=isFixed(def),win=fixed?null:store.winner(def.key);
  return {value:def.resolve?def.resolve(win?win.value:undefined,ctx):win?win.value:undefined,levelOfControl:store.levelOfControl(def.key,id,{fixed})};
 }

 // onChange: every extension that listens hears when the value or its own levelOfControl changes. `last` holds what each one saw last.
 const last=new Map();
 function check(defs=definitions){
  for(const def of defs)for(const id of api.listening(`${def.path}.onChange`)){
   const now=details(def,id),json=JSON.stringify(now),slot=`${def.key}|${id}`,before=last.get(slot);
   last.set(slot,json);
   if(before!==undefined&&before!==json)api.emit(id,`${def.path}.onChange`,now);
  }
 }

 // apply(): serialized per definition so two quick changes never interleave their session.setProxy calls
 const chains=new Map();
 // def.signature(ctx) names what apply() would put in place; a store refresh (some other extension loaded or unloaded) that does not change it
 // applies nothing, so 26 extensions loading at start never re-set the proxy and close connections 26 times.
 const signature=def=>(typeof def.signature==='function'?def.signature(ctx):undefined);
 const applied=new Map(definitions.filter(def=>typeof def.signature==='function').map(def=>[def.key,signature(def)]));
 function runApply(def,{strict=false,ifChanged=false}={}){
  if(typeof def.apply!=='function')return Promise.resolve();
  const previous=chains.get(def.key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{if(ifChanged&&typeof def.signature==='function'&&signature(def)===applied.get(def.key))return;await def.apply(ctx);if(typeof def.signature==='function')applied.set(def.key,signature(def));});
  chains.set(def.key,next.catch(()=>{}));
  return strict?next:next.catch(error=>{log(`${def.path}: could not apply:`,error&&error.message||error);});
 }
 let own=0;
 const unsubscribe=store.subscribe(keys=>{
  if(own>0)return;// the handler that made this change applies and notifies itself
  const defs=keys.map(key=>byKey.get(key)).filter(Boolean);
  for(const def of defs)if(typeof def.signature!=='function'||signature(def)!==applied.get(def.key))void runApply(def);
  check(defs);
 });

 function scopeOf(details){
  const scope=details&&details.scope!==undefined?details.scope:'regular';
  if(INCOGNITO_SCOPES.has(scope))throw new Error(INCOGNITO_ERROR);
  return scope;
 }

 for(const def of definitions){
  api.handle(`${def.path}.get`,(event,request)=>{
   const id=extensionId(event);
   if(request&&request.incognito===true)throw new Error(INCOGNITO_ERROR);
   const answer=details(def,id);last.set(`${def.key}|${id}`,JSON.stringify(answer));
   return answer;
  });
  api.handle(`${def.path}.set`,async(event,request)=>{
   const id=extensionId(event),scope=scopeOf(request),value=def.validate?def.validate(request&&request.value):request&&request.value;
   if(isFixed(def)){log(`${def.path}: fixed by Acira; the extension's value is not used`);return;}
   if(typeof def.accept==='function'&&!def.accept(value,ctx)){log(`${def.path}: Acira keeps its own value; the extension's is not used`);return;}
   check();
   // def.also: settings the same set() controls too (Chromium: the deprecated autofillEnabled also sets the card and address prefs).
   const keys=[def.key,...(Array.isArray(def.also)?def.also.filter(key=>byKey.has(key)):[])];
   const before=keys.map(key=>store.scopeValue(key,id,scope)),extension=api.getExtension(id),name=extension&&(extension.name||extension.manifest&&extension.manifest.name);
   own++;try{for(const key of keys)store.setValue(key,id,value,scope,name);}finally{own--;}
   try{await runApply(def,{strict:true,ifChanged:true});}
   catch(error){
    own++;try{keys.forEach((key,at)=>{if(before[at].has)store.setValue(key,id,before[at].value,scope);else store.clearValue(key,id,scope);});}finally{own--;}
    await runApply(def);throw error;
   }
   check(keys.map(key=>byKey.get(key)));
  });
  api.handle(`${def.path}.clear`,async(event,request)=>{
   const id=extensionId(event),scope=scopeOf(request);
   check();
   own++;let removed;try{removed=store.clearValue(def.key,id,scope);}finally{own--;}
   if(removed){await runApply(def,{strict:true,ifChanged:true});check([def]);}
  });
 }

 return {
  store,details,runApply,check,
  forget(id){own++;try{store.forget(id);}finally{own--;}for(const def of definitions)if(typeof def.signature!=='function'||signature(def)!==applied.get(def.key))void runApply(def);check();},
  dispose(){unsubscribe();closeStore();}
 };
}

/** Tests list their own web contents here (the packages are installed by the loader, which passes no options). */
const hooks={contents:null};
module.exports={installSettings,openStore,pushWebRtcPolicy,hooks,INCOGNITO_ERROR,GRACE_MS};
