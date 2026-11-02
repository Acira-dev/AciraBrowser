'use strict';
// Acira's permission table for Chrome extensions (one per profile session). Electron's extension system knows 25 of the 64 permissions
// Chromium offers Web Store extensions; the other 39 (bookmarks, contextMenus, downloads, history, notifications, privacy, tabGroups, …) it
// logs as "unknown" and drops, so neither its bindings nor its own permissions API can see them. This table is the source of truth instead:
//
//   active(id) = the manifest's required permissions (known to Chromium) and host patterns + the optional ones the user granted
//
// Grants of optional permissions (permissions.request) are kept per profile in <userData>/extension-permissions/<profile>.json and survive a
// restart, as in Chrome; uninstalling clears them (forget). Every change is announced to listeners (ext-api/index.cjs uses it to update the
// namespaces of running extension pages and workers, the permissions package fires permissions.onAdded / onRemoved).
// Chromium's names and rules: chrome/common/extensions/api/_permission_features.json, extensions/common/permissions/.
const fs=require('node:fs'),path=require('node:path');
const {surface}=require('./extension-api-signature.cjs');
const {globMatch}=require('./glob-match.cjs');

const strings=value=>(Array.isArray(value)?value.filter(item=>typeof item==='string'&&item):[]);
const unique=list=>[...new Set(list)];
// A host pattern ('<all_urls>', 'https://*.example.com/*', '*://*/*', 'file:///*') rather than an API permission name.
const isPattern=value=>value==='<all_urls>'||/^[a-z*][a-z0-9+.*-]*:\/\//i.test(value);
/** Every API permission Chromium offers Web Store extensions on Windows (from _permission_features via the generated surface). */
function knownPermissions(){return surface().permissions||{};}
const known=name=>Object.prototype.hasOwnProperty.call(knownPermissions(),name);

/** What a manifest asks for: required and optional, API permissions and host patterns (MV2 puts patterns in `permissions`). */
function declared(manifest={}){
 const required=strings(manifest.permissions),optional=strings(manifest.optional_permissions);
 const version=manifest.manifest_version;
 const api=list=>unique(list.filter(name=>!isPattern(name)&&known(name)&&!(knownPermissions()[name].minManifestVersion>version)));
 return {
  permissions:api(required),
  origins:unique([...strings(manifest.host_permissions),...required.filter(isPattern)]),
  optionalPermissions:api(optional),
  optionalOrigins:unique([...strings(manifest.optional_host_permissions),...optional.filter(isPattern)])
 };
}

/** Does `pattern` cover everything `asked` covers (Chrome's URLPattern containment, enough for permissions.contains/request)? */
function patternCovers(pattern,asked){
 if(pattern===asked||pattern==='<all_urls>')return true;
 if(asked==='<all_urls>')return false;
 // scheme://host[:port]/path. A pattern without a port covers every port (URLPattern's port is "*"); one with a port covers only that port.
 const parse=value=>{const m=/^(\*|[a-z][a-z0-9+.-]*):\/\/(\[[^\]]*\]|\*|\*\.[^/:]+|[^/:*]*)(?::(\*|\d+))?(\/.*)$/i.exec(value);return m?{scheme:m[1].toLowerCase(),host:m[2].toLowerCase(),port:m[3]||'*',path:m[4]}:null;};
 const p=parse(pattern),a=parse(asked);if(!p||!a)return false;
 const schemeOk=p.scheme===a.scheme||(p.scheme==='*'&&(a.scheme==='*'||/^(?:https?|wss?)$/.test(a.scheme)));
 const hostOk=p.host==='*'||p.host===a.host||(p.host.startsWith('*.')&&(a.host===p.host.slice(2)||a.host.endsWith(p.host.slice(1))||(a.host.startsWith('*.')&&a.host.endsWith(p.host.slice(1)))));
 return schemeOk&&hostOk&&(p.port==='*'||p.port===a.port)&&globMatch(p.path,a.path);
}
/** Does a granted pattern list give access to a URL? */
function originsCoverUrl(origins,url){
 let u;try{u=new URL(url);}catch{return false;}
 // The URL's port, or its scheme's default one (a pattern may name :80 or :443 explicitly); the path is matched with its query, as Chrome does.
 const port=u.port||{'http:':'80','https:':'443','ws:':'80','wss:':'443','ftp:':'21'}[u.protocol]||'';
 const asked=`${u.protocol.slice(0,-1)}://${u.protocol==='file:'?'':u.hostname+(port?':'+port:'')}${u.pathname||'/'}${u.search||''}`;
 return strings(origins).some(pattern=>(pattern==='<all_urls>'&&/^(?:https?|wss?|ftp|file):$/.test(u.protocol))||patternCovers(pattern,asked));
}

/**
 * createPermissionTable({userData, storeKey, getExtension, log}) for one profile session.
 *   getExtension(id) -> Electron's Extension ({id, manifest, …}) or null.
 */
function createPermissionTable({userData,storeKey='default',getExtension=()=>null,log=()=>{}}={}){
 const safeKey=String(storeKey).replace(/[^A-Za-z0-9_-]/g,'_')||'default';
 const file=userData?path.join(userData,'extension-permissions',`${safeKey}.json`):null;
 let grants=Object.create(null);
 if(file)try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved&&saved.version===1&&saved.grants&&typeof saved.grants==='object')for(const [id,value] of Object.entries(saved.grants))if(/^[a-p]{32}$/.test(id))grants[id]={permissions:strings(value?.permissions),origins:strings(value?.origins)};}catch{/* first run */}
 const listeners=new Set();
 function save(){
  if(!file)return;
  try{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify({version:1,grants}));fs.renameSync(tmp,file);}
  catch(error){log('extension permission grants not saved',error?.message);}
 }
 // Every function taking `id` also takes the Extension object itself (a router event's event.extension), whose manifest is then used.
 const idOf=id=>(id&&typeof id==='object'?String(id.id||''):String(id||''));
 const manifestOf=id=>{if(id&&typeof id==='object')return id.manifest||null;try{return getExtension(id)?.manifest||null;}catch{return null;}};
 const granted=id=>{const key=idOf(id);return {permissions:[...(grants[key]?.permissions||[])],origins:[...(grants[key]?.origins||[])]};};
 /** What the extension may use now: required (from its manifest) + granted optional ones. */
 function active(id){
  const manifest=manifestOf(id),mine=granted(id);
  if(!manifest)return mine;
  const d=declared(manifest);
  // A grant only counts while the manifest still lists it as optional (an update can drop it).
  return {permissions:unique([...d.permissions,...mine.permissions.filter(p=>d.optionalPermissions.includes(p))]),
   origins:unique([...d.origins,...mine.origins.filter(o=>d.optionalOrigins.some(pattern=>patternCovers(pattern,o)))])};
 }
 const has=(id,permission)=>active(id).permissions.includes(permission);
 const hasOrigin=(id,url)=>originsCoverUrl(active(id).origins,url);
 /** Does the extension hold everything in {permissions, origins}? (permissions.contains) */
 function contains(id,{permissions=[],origins=[]}={}){
  const now=active(id);
  return strings(permissions).every(p=>now.permissions.includes(p))&&strings(origins).every(o=>now.origins.some(pattern=>patternCovers(pattern,o)));
 }
 function notify(id,added,removed){
  const snapshot=active(id),key=idOf(id);
  for(const listener of listeners)try{listener(key,{added,removed,active:snapshot});}catch(error){log('permission listener failed',error?.message);}
 }
 /**
  * Records optional permissions the user granted. Only what the manifest lists as optional (and does not already hold) is added.
  * Returns what was added: {permissions, origins} (both empty when nothing changed).
  */
 function grant(target,{permissions=[],origins=[]}={}){
  const id=idOf(target),manifest=manifestOf(target);if(!manifest||!id)return {permissions:[],origins:[]};
  const d=declared(manifest),now=active(target);
  const addP=unique(strings(permissions).filter(p=>d.optionalPermissions.includes(p)&&!now.permissions.includes(p)));
  const addO=unique(strings(origins).filter(o=>d.optionalOrigins.some(pattern=>patternCovers(pattern,o))&&!now.origins.some(pattern=>patternCovers(pattern,o))));
  if(!addP.length&&!addO.length)return {permissions:[],origins:[]};
  const entry=grants[id]||(grants[id]={permissions:[],origins:[]});
  entry.permissions=unique([...entry.permissions,...addP]);entry.origins=unique([...entry.origins,...addO]);
  save();const added={permissions:addP,origins:addO};notify(target,added,{permissions:[],origins:[]});return added;
 }
 /** Takes back granted optional permissions. Returns what was removed. Required ones are never removed (the caller reports Chrome's error). */
 function revoke(target,{permissions=[],origins=[]}={}){
  const id=idOf(target),entry=grants[id];if(!entry)return {permissions:[],origins:[]};
  const askP=strings(permissions),askO=strings(origins);
  const remP=entry.permissions.filter(p=>askP.includes(p)),remO=entry.origins.filter(o=>askO.some(asked=>asked===o||patternCovers(asked,o)));
  if(!remP.length&&!remO.length)return {permissions:[],origins:[]};
  entry.permissions=entry.permissions.filter(p=>!remP.includes(p));entry.origins=entry.origins.filter(o=>!remO.includes(o));
  if(!entry.permissions.length&&!entry.origins.length)delete grants[id];
  save();const removed={permissions:remP,origins:remO};notify(target,{permissions:[],origins:[]},removed);return removed;
 }
 /** The extension was uninstalled: its grants go (Chrome asks again after a reinstall). */
 function forget(target){const id=idOf(target);if(!grants[id])return;delete grants[id];save();}
 return {
  declared:id=>{const manifest=manifestOf(id);return manifest?declared(manifest):declared({});},
  active,granted,has,hasOrigin,contains,grant,revoke,forget,
  /** Granted optional permissions of every extension of this profile: {id: {permissions, origins}} (written into the engine preload). */
  snapshot:()=>JSON.parse(JSON.stringify(grants)),
  /** listener(id, {added, removed, active}) after every grant or revoke. Returns a function that removes the listener. */
  onChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
  file
 };
}

module.exports={createPermissionTable,declared,knownPermissions,isPattern,patternCovers,originsCoverUrl};
