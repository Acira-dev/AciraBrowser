'use strict';
// Extension-controlled browser settings for one profile: Chromium's ExtensionPrefValueMap (chrome/browser/extensions/
// extension_pref_value_map.cc), shared by the ext-api packages proxy and privacy (docs/launch/EXTENSION_WORK_PACKAGES.md) and read by
// the code that really applies a setting (proxy-settings.cjs, main.cjs' WebRTC policy, the password prompt).
//
// Chrome's rules kept here:
//  - Each extension keeps its own value per setting and scope ('regular', 'regular_only'). A 'regular_only' value beats a 'regular' one of
//    the same extension. Incognito scopes do not exist in Acira: private windows run no extensions, so the API layer refuses them.
//  - The most recently installed extension that has a value wins; a disabled or unloaded extension's value is kept but does not count;
//    uninstalling forgets it. Acira has no install timestamp for an extension, so "installed" means the first time it used a setting.
//  - levelOfControl: not_controllable (Acira fixes the value), controlled_by_other_extensions (a later extension holds it),
//    controlled_by_this_extension, controllable_by_this_extension.
// One store per profile (storeKey = the Acira profile id), persisted in userData/extension-settings/. The session of the profile is linked
// to its store by `registerHost`, so code that only has a session (webContents, a proxy auth challenge) finds it.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');

const stores=new Map();
const hosts=new WeakMap();
const providers=Object.create(null);
const SCOPES=['regular','regular_only'];
const MAX_VALUE_BYTES=256*1024;
/** Strictest last. Acira's floor is default_public_interface_only (see webRtcPolicy). */
const WEBRTC_ORDER=['default','default_public_and_private_interfaces','default_public_interface_only','disable_non_proxied_udp'];

/** Facts and hooks main.cjs gives the packages (password prompt switch, Safe Browsing state…): provide({name: fn}) / fact(name, ...args). */
function provide(entries){for(const [name,fn] of Object.entries(entries||{}))if(typeof fn==='function')providers[name]=fn;}
function fact(name,...args){const fn=providers[name];if(typeof fn!=='function')return undefined;try{return fn(...args);}catch{return undefined;}}

function fileFor(userData,storeKey){
 const key=createHash('sha256').update(String(storeKey)).digest('hex').slice(0,16);
 return path.join(userData,'extension-settings',`${key}.json`);
}

function createStore({userData=null,storeKey='default',now=Date.now}={}){
 const file=userData?fileFor(userData,storeKey):null;
 let data={version:1,installed:{},names:{},prefs:{}};
 const object=value=>(value&&typeof value==='object'&&!Array.isArray(value)?value:{});
 if(file)try{const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw&&raw.version===1)data={version:1,installed:object(raw.installed),names:object(raw.names),prefs:object(raw.prefs)};}catch{/* first run */}
 const listeners=new Set();
 let isActive=()=>true;// the extension is loaded and enabled (the package that owns the session replaces this)
 let nameOf=(id,stored)=>stored||id;
 function persist(){
  if(!file)return;
  try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data));fs.renameSync(file+'.tmp',file);}catch{/* the values still apply for this run */}
 }
 /** Remembers when an extension first used a setting (Chrome orders by install time). Strictly increasing, so two extensions never tie. */
 function noteExtension(id,name){
  if(typeof id!=='string')return;
  if(typeof name==='string'&&name&&data.names[id]!==name.slice(0,256)){data.names[id]=name.slice(0,256);persist();}
  if(data.installed[id])return;
  const last=Math.max(0,...Object.values(data.installed).filter(Number.isFinite));
  data.installed[id]=Math.max(now(),last+1);persist();
 }
 /** The extension's current name, for an extension that already used a setting (the name shown in Settings). */
 function rename(id,name){if(data.installed[id]&&typeof name==='string'&&name&&data.names[id]!==name.slice(0,256)){data.names[id]=name.slice(0,256);persist();}}
 const installTime=id=>data.installed[id]||0;
 const byPrecedence=ids=>ids.filter(id=>isActive(id)).sort((a,b)=>installTime(b)-installTime(a));
 const has=(object,key)=>!!object&&Object.prototype.hasOwnProperty.call(object,key);
 const valueOf=scopes=>has(scopes,'regular_only')?{value:scopes.regular_only}:has(scopes,'regular')?{value:scopes.regular}:null;
 /** Every extension that holds a value for `key`: Map(id -> value), whether or not it counts now. */
 function holders(key){
  const out=new Map();
  for(const [id,scopes] of Object.entries(data.prefs[key]||{})){const found=valueOf(scopes);if(found)out.set(id,found.value);}
  return out;
 }
 /** The extension whose value is in effect, with that value, or null. */
 function winner(key){
  const values=holders(key),ids=byPrecedence([...values.keys()]);
  return ids.length?{extensionId:ids[0],name:nameOf(ids[0],data.names[ids[0]]||ids[0]),value:values.get(ids[0])}:null;
 }
 function levelOfControl(key,extensionId,{fixed=false}={}){
  if(fixed)return 'not_controllable';
  const current=winner(key);
  if(!current)return 'controllable_by_this_extension';
  if(current.extensionId===extensionId)return 'controlled_by_this_extension';
  return installTime(extensionId)>installTime(current.extensionId)?'controllable_by_this_extension':'controlled_by_other_extensions';
 }
 function changed(keys){for(const fn of [...listeners])try{fn(keys);}catch{/* one listener failing never stops the others */}}
 /** What one extension holds in one scope: {has, value}. */
 function scopeValue(key,extensionId,scope='regular'){const scopes=data.prefs[key]&&data.prefs[key][extensionId];return has(scopes,scope)?{has:true,value:scopes[scope]}:{has:false};}
 function setValue(key,extensionId,value,scope='regular',name){
  if(!SCOPES.includes(scope))throw new Error(`Invalid scope: ${scope}`);
  if(JSON.stringify(value===undefined?null:value).length>MAX_VALUE_BYTES)throw new Error('The value is too large.');
  noteExtension(extensionId,name);
  const prefs=data.prefs[key]||(data.prefs[key]={});
  (prefs[extensionId]||(prefs[extensionId]={}))[scope]=value;
  persist();changed([key]);
 }
 function clearValue(key,extensionId,scope='regular'){
  const scopes=data.prefs[key]&&data.prefs[key][extensionId];
  if(!scopes||!has(scopes,scope))return false;
  delete scopes[scope];
  if(!Object.keys(scopes).length)delete data.prefs[key][extensionId];
  if(!Object.keys(data.prefs[key]).length)delete data.prefs[key];
  persist();changed([key]);return true;
 }
 /** Uninstall: every value of the extension goes (Chrome removes an uninstalled extension's preferences). Returns the keys that changed. */
 function forget(extensionId){
  const keys=[];
  for(const [key,byExt] of Object.entries(data.prefs))if(byExt[extensionId]){delete byExt[extensionId];if(!Object.keys(byExt).length)delete data.prefs[key];keys.push(key);}
  delete data.installed[extensionId];delete data.names[extensionId];
  persist();if(keys.length)changed(keys);
  return keys;
 }
 return {
  storeKey,noteExtension,rename,installTime,winner,holders,levelOfControl,setValue,clearValue,scopeValue,forget,
  /** Which extensions count (loaded and enabled) and their names, from the package that owns this profile's engine. */
  setResolver({active,name}={}){if(typeof active==='function')isActive=active;if(typeof name==='function')nameOf=name;},
  /** Re-evaluate after extensions load or unload (a disabled extension's values stop counting). */
  refresh(keys){changed(keys||Object.keys(data.prefs));},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  keys:()=>Object.keys(data.prefs),
  file
 };
}

/** The store of one profile; the first caller with userData decides where it is saved. */
function forProfile(storeKey='default',{userData=null}={}){
 const key=String(storeKey||'default');
 let store=stores.get(key);
 if(!store){store=createStore({userData,storeKey:key});stores.set(key,store);}
 return store;
}
function appUserData(){try{const electron=require('electron');return electron&&electron.app&&typeof electron.app.getPath==='function'?electron.app.getPath('userData'):null;}catch{return null;}}
/** The store of a profile for code that must not create one: the open store, or the saved one when the profile has any. */
function existing(storeKey){
 const key=String(storeKey||'default');
 if(stores.has(key))return stores.get(key);
 const userData=appUserData();
 if(!userData)return null;
 try{if(!fs.existsSync(fileFor(userData,key)))return null;}catch{return null;}
 return forProfile(key,{userData});
}

// ------------------------------------------------------------------------------------------------ sessions

/**
 * Links a profile's Electron session to its store and to what only the owner of the real setting can do. Called by the packages
 * (store, extension names) and by proxy-settings.cjs (userChoice, reapply). Several callers fill in one host.
 */
function registerHost(session,parts){
 if(!session||typeof session!=='object')return null;
 const host=hosts.get(session)||{};
 Object.assign(host,parts);hosts.set(session,host);return host;
}
const hostFor=session=>(session&&typeof session==='object'?hosts.get(session):null)||null;
function unregisterHost(session,names){const host=hostFor(session);if(!host)return;for(const name of names||Object.keys(host))delete host[name];}

/**
 * The proxy an extension holds for a profile, as Electron wants it: {extensionId, name, mode, config, native} or null. Never for Tor or
 * private sessions: they have no profile store, and a Tor session is refused by its marker.
 */
function proxyOverride(profileId,session){
 if(session&&session.__aciraTor)return null;
 const host=hostFor(session),store=host?.store||existing(profileId);
 if(!store)return null;
 const found=store.winner('proxy');
 if(!found)return null;
 try{
  const native=require('./ext-api/proxy/convert.cjs').toElectron(found.value);
  return {extensionId:found.extensionId,name:found.name,mode:found.value.mode,config:found.value,native};
 }catch{return null;}// a value that no longer converts is ignored, never half-applied
}

/** The Chrome ProxyConfig of what Acira itself uses now (the profile's own choice), for `proxy.settings.get` without an extension. */
function userProxyConfig(session){
 const choice=hostFor(session)?.userChoice?.();
 if(!choice||choice.mode==='system'||!choice.mode)return {mode:'system'};
 if(choice.mode==='direct')return {mode:'direct'};
 if(choice.mode==='fixed_servers'&&choice.server)return {mode:'fixed_servers',rules:{singleProxy:{scheme:choice.server.scheme,host:choice.server.host,port:choice.server.port},bypassList:[...(choice.bypassHosts||[])]}};
 return {mode:'system'};
}

/**
 * The WebRTC IP handling policy for pages of this session. `base` is what main.cjs would use without extensions. An extension may make it
 * stricter (a VPN extension asks for disable_non_proxied_udp) but never looser: Acira's floor stays. A proxy chosen by an extension counts
 * like the person's own proxy: calls must not reveal the local address around it.
 */
function webRtcPolicy(session,base='default_public_interface_only'){
 const rank=policy=>WEBRTC_ORDER.indexOf(policy);
 const pick=(a,b)=>(rank(b)>rank(a)?b:a);
 let policy=rank(base)<0?'default_public_interface_only':base;
 policy=pick(policy,'default_public_interface_only');
 try{
  const host=hostFor(session),store=host?.store||null;
  if(!store||session?.__aciraTor)return policy;
  const proxy=store.winner('proxy');
  if(proxy&&['fixed_servers','pac_script','auto_detect'].includes(proxy.value?.mode))policy=pick(policy,'disable_non_proxied_udp');
  const rtc=store.winner('privacy.network.webRTCIPHandlingPolicy');
  if(rtc&&rank(rtc.value)>=0)policy=pick(policy,rtc.value);
 }catch{/* the base policy stands */}
 return policy;
}

/** True when an extension has switched the built-in password offer off for this profile (privacy.services.passwordSavingEnabled = false). */
function passwordSavingOffByExtension(profileId){
 try{const store=existing(profileId),win=store&&store.winner('privacy.services.passwordSavingEnabled');return !!win&&win.value===false;}catch{return false;}
}

/** For tests. */
function reset(){stores.clear();for(const key of Object.keys(providers))delete providers[key];}

/** What the extensions allowed in private hold in the ordinary profile's store (their proxy and privacy settings), copied ONE WAY into a private session's own store before
 *  it starts, as a private window inherits the regular settings in Chrome. Only those extensions' values; nothing the private session sets goes back. */
function seedPrivateStore({userData,fromKey,toUserData,toKey,extensionIds=[]}){
 try{
  const raw=JSON.parse(fs.readFileSync(fileFor(userData,fromKey),'utf8'));if(!raw||raw.version!==1)return false;
  const keep=new Set(extensionIds),object=value=>(value&&typeof value==='object'&&!Array.isArray(value)?value:{});
  const pick=source=>Object.fromEntries(Object.entries(object(source)).filter(([id])=>keep.has(id)));
  const prefs={};for(const [setting,perExtension] of Object.entries(object(raw.prefs))){const chosen=pick(perExtension);if(Object.keys(chosen).length)prefs[setting]=chosen;}
  const file=fileFor(toUserData,toKey);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({version:1,installed:pick(raw.installed),names:pick(raw.names),prefs}));return true;
 }catch{return false;}
}

module.exports={seedPrivateStore,fileFor,createStore,forProfile,existing,registerHost,unregisterHost,hostFor,proxyOverride,userProxyConfig,webRtcPolicy,passwordSavingOffByExtension,provide,fact,reset,SCOPES,WEBRTC_ORDER};
