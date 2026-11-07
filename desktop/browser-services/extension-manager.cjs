'use strict';
const {t}=require('./tx.cjs');
/** Every permission Acira's engine knows (extension-permission-table.cjs), in words; a few share a line. */
const PERMISSION_IDS={activeTab:'ext.perm.activeTab',storage:'ext.perm.storage',tabs:'ext.perm.tabs',cookies:'ext.perm.cookies',history:'ext.perm.history',bookmarks:'ext.perm.bookmarks',downloads:'ext.perm.downloads',notifications:'ext.perm.notifications',scripting:'ext.perm.scripting',webRequest:'ext.perm.webRequest',contextMenus:'ext.perm.contextMenus',clipboardWrite:'ext.perm.clipboardWrite','<all_urls>':'ext.perm.allUrls',alarms:'ext.perm.alarms',identity:'ext.perm.identity',declarativeNetRequest:'ext.perm.declarativeNetRequest',sidePanel:'ext.perm.sidePanel',webNavigation:'ext.perm.webNavigation',proxy:'ext.perm.proxy',privacy:'ext.perm.privacy',idle:'ext.perm.idle',tabCapture:'ext.perm.tabCapture',offscreen:'ext.perm.offscreen',management:'ext.perm.management',
 'accessibilityFeatures.read':'ext.perm.accessibilityRead','accessibilityFeatures.modify':'ext.perm.accessibilityModify',background:'ext.perm.background',browsingData:'ext.perm.browsingData',clipboardRead:'ext.perm.clipboardRead',contentSettings:'ext.perm.contentSettings',debugger:'ext.perm.debugger',declarativeContent:'ext.perm.declarativeContent',declarativeNetRequestFeedback:'ext.perm.declarativeNetRequestFeedback',declarativeNetRequestWithHostAccess:'ext.perm.declarativeNetRequest',webRequestBlocking:'ext.perm.declarativeNetRequest',
 desktopCapture:'ext.perm.desktopCapture',devtools:'ext.perm.devtools','downloads.open':'ext.perm.downloadsOpen','downloads.shelf':'ext.perm.downloadsUi','downloads.ui':'ext.perm.downloadsUi',favicon:'ext.perm.favicon',fontSettings:'ext.perm.fontSettings',gcm:'ext.perm.gcm',geolocation:'ext.perm.geolocation','identity.email':'ext.perm.identityEmail',nativeMessaging:'ext.perm.nativeMessaging',pageCapture:'ext.perm.pageCapture',plugin:'ext.perm.plugin',power:'ext.perm.power',printerProvider:'ext.perm.printerProvider',readingList:'ext.perm.readingList',
 search:'ext.perm.search',sessions:'ext.perm.sessions','system.cpu':'ext.perm.system','system.display':'ext.perm.system','system.memory':'ext.perm.system','system.storage':'ext.perm.system',tabGroups:'ext.perm.tabGroups',topSites:'ext.perm.topSites',tts:'ext.perm.tts',ttsEngine:'ext.perm.ttsEngine',unlimitedStorage:'ext.perm.unlimitedStorage',userScripts:'ext.perm.userScripts',webAuthenticationProxy:'ext.perm.webAuthenticationProxy',webRequestAuthProvider:'ext.perm.webRequestAuthProvider'};
/** Gives nothing a person would notice (Chrome shows no warning for it). */
const SILENT_PERMISSIONS=new Set(['runtime']);
/** Every profile's session has one `extensions` emitter, and each extension package (the engine's own, runtime, commands, context menus,
 * notifications, web request, declarativeNetRequest, settings, offscreen / side panel ...) listens to it once, at start: 15 listeners
 * for `extension-unloaded` today, the same after any number of installs, removals, reloads, turn-offs, windows and profiles (counted in
 * the running app). Node warns from 11 on ("possible EventEmitter memory leak", printed at every launch), so the limit is raised here,
 * once, to twice the steady count: a real leak, a listener added per extension or per window, still warns. */
const EXTENSION_EVENT_LISTENERS=30;
/** What an extension asks for, as lines a person reads (the install review, the permissions.request prompt, "What it can access"): the websites first, in one
 * line ("every website", one site, or the sites named), then each permission in words. File addresses are left out: extensions get no file access here,
 * and the review says so. Permissions the engine doesn't know share one line. */
const ALL_SITES=new Set(['<all_urls>','*://*/*','http://*/*','https://*/*']),SHOWN_SITES=5;
function accessText(t,{permissions:asked=[],origins=[]}={}){
 const lines=[],seen=new Set(),add=line=>{if(!seen.has(line)){seen.add(line);lines.push(line);}},sites=new Set();let everySite=false;
 for(const origin of strings(origins)){
  if(ALL_SITES.has(origin)){everySite=true;continue;}
  const m=/^([^:]+):\/\/(\*\.)?([^/]*)/.exec(origin);if(m&&m[1].toLowerCase()==='file')continue;
  const host=m&&m[3]&&m[3]!=='*'?m[3].toLowerCase():'';if(host)sites.add(host);else everySite=true;
 }
 if(everySite)add(t('ext.perm.allUrls'));
 else if(sites.size===1)add(t('ext.perm.site',{site:[...sites][0]}));
 else if(sites.size)add(t('ext.perm.sites',{sites:[...sites].slice(0,SHOWN_SITES).join(', ')+(sites.size>SHOWN_SITES?', …':'')}));
 let other=false;
 for(const name of strings(asked)){if(SILENT_PERMISSIONS.has(name))continue;if(PERMISSION_IDS[name])add(t(PERMISSION_IDS[name]));else other=true;}
 if(other)add(t('ext.perm.other'));
 return lines;
}
const accessLines=(t,request)=>accessText(t,request).map(line=>'• '+line);
/** The same, from a manifest's merged list (permissions(), registry entries): host patterns and permission names apart. */
const isOrigin=item=>item==='<all_urls>'||item.includes('://');
const accessFor=list=>accessText(t,{permissions:strings(list).filter(item=>!isOrigin(item)),origins:strings(list).filter(isOrigin)});
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{downloadStorePackage}=require('./extension-packages.cjs');
const {correctCurrentTab,currentTabCorrected}=require('./extension-tab-context.cjs');
const {observeOnce,releaseWindows}=require('./extension-store-events.cjs');
const {installedExtensionOrigins}=require('./extension-storage-origins.cjs'),compatibility=require('./extension-compat.cjs');
const registries=new Map(),runtimes=new WeakMap(),extraApis=new WeakMap();
/** The engine's router (electron-chrome-extensions 4.9.0) listens to the app's 'web-contents-created' for its session and has no way to stop:
 * what its constructor added is noted per session, so a removed profile's runtime can let go of it. */
const engineListeners=new WeakMap(),disposedRuntimes=new WeakSet();
const appCreatedListeners=()=>{try{return require('electron').app?.listeners?.('web-contents-created')||[];}catch{return [];}};
/** A removed profile (profile-lifecycle.cjs onRemoved): its extensions are unloaded (background pages and workers stop), and its runtime stops
 * its timers, its app-wide listeners (web-contents-created, power lock/unlock, display changes) and its engine's listeners on the windows the
 * profiles share. Created and removed profiles used to add one of each for good (MaxListenersExceededWarning from about ten). The runtime stays registered for the session so nothing builds another. */
function disposeProfileRuntime(session){
 if(!session||!runtimes.has(session)||disposedRuntimes.has(session))return false;disposedRuntimes.add(session);
 try{const api=session.extensions;for(const extension of api.getAllExtensions())try{api.removeExtension(extension.id);}catch{}}catch{}
 try{extraApis.get(session)?.dispose?.();}catch{}
 try{releaseWindows(runtimes.get(session));}catch{}
 try{const app=require('electron').app;for(const listener of engineListeners.get(session)||[])app.removeListener('web-contents-created',listener);}catch{}
 engineListeners.delete(session);return true;
}
const supportNote='Supported local and verified Chrome Web Store extensions. Chrome APIs remain a subset; compatibility errors are shown. Extensions run in private tabs and windows only if you allow them. No background store update or Chrome Sync.';
const strings=value=>Array.isArray(value)?value.filter(v=>typeof v==='string').slice(0,100).map(v=>v.slice(0,1024)):[];
const permissions=manifest=>[...new Set([...strings(manifest.permissions),...strings(manifest.host_permissions),...strings(manifest.content_scripts?.flatMap(script=>script.matches||[]))])].sort();
function describe(extension){const manifest=extension.manifest||{},access=permissions(manifest);return {id:String(extension.id),name:String(extension.name||manifest.name||'Extension').slice(0,256),version:String(extension.version||manifest.version||'').slice(0,64),description:String(manifest.description||'').slice(0,2048),manifestVersion:manifest.manifest_version,permissions:access,optionalPermissions:strings(manifest.optional_permissions),access:accessFor(access),supportWarnings:access.includes('nativeMessaging')?[t('ext.note.nativeMessaging')]:[],hasAction:!!(manifest.action||manifest.browser_action),wantsUserScripts:strings(manifest.permissions).includes('userScripts'),overridesNewTab:typeof manifest.chrome_url_overrides?.newtab==='string',status:'loaded'};}
function validateExtensionRequest(input,profiles){if(!input||typeof input!=='object'||Array.isArray(input)||!['list','load','install','remove','enable','disable','reload','update','pin','userScripts','newTab','private'].includes(input.type))throw new Error('Invalid extension request');const allowed=['type','profileId',...(!['list','load'].includes(input.type)?['extensionId']:[]),...(input.type==='pin'?['pinned']:[]),...(input.type==='userScripts'||input.type==='newTab'||input.type==='private'?['allowed']:[])];if((input.type==='userScripts'||input.type==='newTab'||input.type==='private')&&typeof input.allowed!=='boolean')throw new Error(input.type==='newTab'?'Invalid New Tab choice':input.type==='private'?'Invalid private browsing choice':'Invalid user scripts choice');if(Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('Unexpected extension request field');if(typeof input.profileId!=='string'||!profiles.some(p=>p.id===input.profileId))throw new Error('Unknown browsing profile');if(!['list','load'].includes(input.type)&&(typeof input.extensionId!=='string'||!/^[a-p]{32}$/.test(input.extensionId)))throw new Error('Invalid extension identity');if(input.type==='pin'&&typeof input.pinned!=='boolean')throw new Error('Invalid toolbar pin choice');return {...input};}
function readManifest(folder){if(!path.isAbsolute(folder)||folder.startsWith('\\\\')||!fs.statSync(folder).isDirectory())throw new Error('Choose a local extension folder.');const filename=path.join(folder,'manifest.json');if(fs.statSync(filename).size>1024*1024)throw new Error('Extension manifest is too large.');const manifest=JSON.parse(fs.readFileSync(filename,'utf8'));if(!manifest||![2,3].includes(manifest.manifest_version)||typeof manifest.name!=='string'||typeof manifest.version!=='string')throw new Error('This folder does not contain a supported extension manifest.');return localize(folder,manifest);}
/** Store packages name themselves with __MSG_key__ placeholders; resolve them from the default locale for review text. */
function localize(folder,manifest){const messages=(()=>{try{const file=path.join(folder,'_locales',String(manifest.default_locale||'en').replace(/[^A-Za-z0-9_-]/g,''),'messages.json');return fs.statSync(file).size<2*1024*1024?JSON.parse(fs.readFileSync(file,'utf8')):{};}catch{return {};}})(),resolve=value=>typeof value==='string'?value.replace(/^__MSG_([A-Za-z0-9_@]+)__$/,(whole,key)=>{const found=Object.entries(messages).find(([name])=>name.toLowerCase()===key.toLowerCase());return typeof found?.[1]?.message==='string'?found[1].message:whole;}):value;return {...manifest,name:resolve(manifest.name),description:resolve(manifest.description)};}

function loadRegistry(key){let registry=registries.get(key);if(!registry){registry={saved:[],errors:new Map(),busy:false,pendingData:[]};try{if(fs.statSync(key).size<2*1024*1024){const parsed=JSON.parse(fs.readFileSync(key,'utf8'));if(Array.isArray(parsed.entries))registry.saved=parsed.entries.filter(e=>e&&/^[a-p]{32}$/.test(e.id)&&typeof e.profileId==='string'&&typeof e.path==='string'&&path.isAbsolute(e.path)&&!e.path.startsWith('\\\\')).slice(0,100);if(Array.isArray(parsed.pendingData))registry.pendingData=parsed.pendingData.filter(e=>e&&/^[a-p]{32}$/.test(e.id)&&typeof e.profileId==='string').slice(0,100).map(e=>({id:e.id,profileId:e.profileId}));}}catch{}registries.set(key,registry);}return registry;}
/** True when a new private window or tab of this profile should get a session that can run extensions (some enabled extension of it is allowed in private). Reads the saved list only. */
function privateWantedFor(registryPath,profileId){try{return typeof profileId==='string'&&loadRegistry(path.resolve(registryPath)).saved.some(e=>e.profileId===profileId&&e.allowPrivate===true&&e.enabled!==false);}catch{return false;}}
function createExtensionManager({getSession,getProfiles,getWindow,dialog,registryPath,browser={},createRuntime,downloadPackage=downloadStorePackage,extensionData=require('./extension-data.cjs')}){
 const key=path.resolve(registryPath);let registry=loadRegistry(key);
 const profileFor=id=>getProfiles().find(p=>p.id===id&&!p.private&&p.partition?.startsWith('persist:'));
 const sessionFor=id=>{const profile=profileFor(id);return profile?getSession(profile.partition):null;};
 const errorKey=(profile,id)=>profile+'|'+id;
 function runtimeFor(session,options={}){if(!session)return null;if(!runtimes.has(session)){try{session.extensions?.setMaxListeners?.(EXTENSION_EVENT_LISTENERS);}catch{}const profile=options.profile||getProfiles().find(p=>getSession(p.partition)===session),implementation=options.implementation||(typeof browser==='function'?browser(profile):browser);const created=appCreatedListeners(),runtime=createRuntime?createRuntime(session):new (require('electron-chrome-extensions').ElectronChromeExtensions)({license:'GPL-3.0',session,...implementation,requestPermissions:async(extension,request)=>{const access=accessLines(t,{permissions:strings(request.permissions),origins:strings(request.origins)});const answer=await dialog.showMessageBox(getWindow(),{type:'question',title:t('ext.accessTitle'),message:t('ext.accessMessage',{name:extension.name}),detail:access.join('\n'),buttons:[t('dialog.cancel'),t('permission.allow')],defaultId:0,cancelId:0});return answer.response===1;}});engineListeners.set(session,appCreatedListeners().filter(listener=>!created.includes(listener)));correctCurrentTab(runtime);observeOnce(runtime);if(!createRuntime)try{const userData=options.runtimeDir||require('electron').app.getPath('userData');if(!options.private)require('./native-messaging.cjs').installNativeMessaging(runtime,{userData,getWindowHandle:()=>{try{return getWindow()?.getNativeWindowHandle().readBigUInt64LE(0).toString();}catch{return 0;}}});
   /* offscreen, sidePanel, identity, userScripts, runtime.getContexts (extension-apis.cjs); user scripts only for extensions whose switch is on */
   const apis=require('./extension-apis.cjs').installExtensionApis(runtime,{session,userData,storeKey:profile?.id||'default',getWindow,t,sidePanelHost:implementation?.sidePanel||null,stores:implementation?.stores||null,userScriptsAllowed:id=>userScriptIds(profile?.id).includes(id),dialog,refreshPreload:()=>require('./extension-runtime-patch.cjs').installPatchedPreload(session,userData,preloadOptions(session,profile?.id))});if(apis){extraApis.set(session,apis);apis.syncUserScriptPreload(userScriptIds(profile?.id).length>0);}if(!options.private)try{require('./ext-api/management/bridge.cjs').attach(session,managementHooks(profile?.id));}catch{}
   require('./extension-runtime-patch.cjs').installPatchedPreload(session,userData,preloadOptions(session,profile?.id));}catch{}runtimes.set(session,runtime);}return runtimes.get(session);}
 /** What the engine preload's text depends on: the extensions allowed to run user scripts, and the optional permissions each was granted. */
 function preloadOptions(session,profileId){let grants={};try{grants=extraApis.get(session)?.permissions?.snapshot?.()||{};}catch{grants={};}return {userScriptsAllowed:userScriptIds(profileId),grants,incognito:privateSessions.has(session)};}
 /** What chrome.management (ext-api/management.cjs) may ask of this manager for one profile: the installed list, including disabled ones, and enable / disable / remove. */
 function managementHooks(profileId){return {profileId,entries:()=>registry.saved.filter(e=>e.profileId===profileId).map(e=>({id:e.id,path:e.path,name:e.name,version:e.version,source:e.source,enabled:e.enabled!==false})),/* management.uninstall asked already (or the extension removes itself, which Chrome allows without asking) */command:request=>command({...request,profileId},{confirmed:true})};}
 /** Extensions of this profile whose "Allow user scripts" switch is on (Settings › Extensions; off by default, as in Chrome). */
 function userScriptIds(profileId){return registry.saved.filter(e=>e.profileId===profileId&&e.userScripts===true&&e.enabled!==false).map(e=>e.id);}
 const apiFor=id=>{const session=sessionFor(id),api=session?.extensions;if(!api||!['getAllExtensions','loadExtension','removeExtension'].every(name=>typeof api[name]==='function'))return null;runtimeFor(session);return api;};
 function persist(){fs.mkdirSync(path.dirname(key),{recursive:true});fs.writeFileSync(key+'.tmp',JSON.stringify({version:2,entries:registry.saved,...(registry.pendingData.length?{pendingData:registry.pendingData}:{})},null,2));fs.renameSync(key+'.tmp',key);}
 /** A removed extension's data that could not all be deleted (extension-data.cjs) is deleted at the next start, unless it was added again meanwhile. */
 function notePending(profileId,id,done){registry.pendingData=registry.pendingData.filter(e=>!(e.profileId===profileId&&e.id===id));if(!done)registry.pendingData.push({profileId,id});}
 async function retryPendingData(){let changed=false;for(const entry of [...registry.pendingData]){const session=sessionFor(entry.profileId),back=registry.saved.some(e=>e.id===entry.id&&e.profileId===entry.profileId);if(back||!profileFor(entry.profileId)){notePending(entry.profileId,entry.id,true);changed=true;continue;}if(!session)continue;let failed=['unknown'];try{failed=await extensionData.deleteExtensionData(session,entry.id);}catch{}if(!failed.length){notePending(entry.profileId,entry.id,true);changed=true;}}if(changed)try{persist();}catch{}}
 function prunePackages(profileId,id,keep=[]){const base=path.resolve(path.dirname(key),'extension-packages'),profileKey=createHash('sha256').update(profileId).digest('hex').slice(0,8),root=path.resolve(base,profileKey,id);if(!/^[a-p]{32}$/.test(id)||!root.startsWith(base+path.sep)||!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())return;const kept=new Set(keep.filter(Boolean).map(p=>path.resolve(p)));for(const entry of fs.readdirSync(root,{withFileTypes:true})){const target=path.resolve(root,entry.name);if(entry.isDirectory()&&!entry.isSymbolicLink()&&target.startsWith(root+path.sep)&&!kept.has(target))fs.rmSync(target,{recursive:true,force:true});}}
 function list(profileId){const api=apiFor(profileId),loaded=api?api.getAllExtensions().map(describe):[],ids=new Set(loaded.map(e=>e.id));for(const entry of loaded){const saved=registry.saved.find(e=>e.id===entry.id&&e.profileId===profileId);Object.assign(entry,{enabled:true,pinned:saved?.pinned??false,source:saved?.source||'Local folder',sourceURL:saved?.sourceURL,packageVerified:!!saved?.publisherVerified,userScriptsAllowed:saved?.userScripts===true,newTabChosen:saved?.newTab===true,privateAllowed:saved?.allowPrivate===true,compat:compatibility.lookup(entry.id)});}
  const unloaded=registry.saved.filter(e=>e.profileId===profileId&&!ids.has(e.id)).map(e=>({id:e.id,name:e.name,version:e.version,permissions:e.permissions||[],access:accessFor(e.permissions||[]),status:e.enabled===false?'disabled':'unavailable',enabled:false,pinned:e.pinned??false,privateAllowed:e.allowPrivate===true,source:e.source||'Local folder',sourceURL:e.sourceURL,packageVerified:!!e.publisherVerified,compat:compatibility.lookup(e.id),error:e.enabled===false?undefined:registry.errors.get(errorKey(profileId,e.id))||'The extension is not loaded. Review its source or reload it.'}));return {profileId,supported:!!api,supportNote,nativeCurrentTab:currentTabCorrected(runtimes.get(sessionFor(profileId))),extensions:[...loaded,...unloaded]};}
 async function review(profileId,manifest,verb='Load'){const NL=String.fromCharCode(10);const details=describe({id:'review',manifest}),access=details.access.length?details.access.map(line=>'• '+line).join(NL):t('ext.noAccess'),notes=details.supportWarnings.length?NL+NL+details.supportWarnings.join(NL):'';const answer=await dialog.showMessageBox(getWindow(),{type:'question',title:verb==='Install'?t('ext.addTitle'):t('ext.loadTitle'),message:t('ext.reviewMessage',{name:details.name}),detail:t('ext.reviewDetail',{profile:profileFor(profileId)?.name||profileId,access,notes}),buttons:[t('dialog.cancel'),t('ext.addTitle')],defaultId:0,cancelId:0});return answer.response===1;}
 async function restore(){await retryPendingData();for(const entry of registry.saved){if(entry.enabled===false)continue;const api=apiFor(entry.profileId);if(!api||api.getAllExtensions().some(e=>e.id===entry.id))continue;try{const manifest=readManifest(entry.path),current=permissions(manifest);if(entry.permissions&&current.some(p=>!entry.permissions.includes(p)))throw new Error('The extension now requests additional access. Reload it to review permissions.');if(entry.source==='Chrome Web Store')try{require('./extension-shims.cjs').applyStorageSyncShim(entry.path);}catch{}/* a package shimmed by an older Acira gets the current storage.sync script (sync is its own area now) */const extension=await api.loadExtension(entry.path,{allowFileAccess:false});if(extension.id!==entry.id){api.removeExtension(extension.id);throw new Error('The extension identity changed. Review its source again.');}}catch(error){registry.errors.set(errorKey(entry.profileId,entry.id),String(error.message||error).slice(0,1024));}}}
 /** Reload/Update/Enable/user-scripts restart an extension by unloading it and loading it again. removeExtension returns before the engine has
 * stopped the old MV3 service worker (and dropped its registration), so loading at once could leave that first worker running and stale, or answer
 * the new content script with "Receiving end does not exist". Wait (bounded) until the extension is gone and no worker of its scope runs, then a
 * short settle for the registration to be dropped, as Chrome's own reload does. Never throws: the load that follows is the real test. */
 async function unloadFully(session,api,id,limit=4000,settle=150){
  const scope=`chrome-extension://${id}/`,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),active=()=>{try{return Object.values(session?.serviceWorkers?.getAllRunning?.()||{}).some(info=>String(info?.scope||'').startsWith(scope));}catch{return false;}};
  try{api.removeExtension(id);}catch{}
  const until=Date.now()+limit;while(Date.now()<until&&(active()||api.getAllExtensions().some(e=>e.id===id)))await sleep(25);
  await sleep(active()?0:settle);
 }
 /** Chrome's "Remove" question, in Acira's own dialog: Cancel is the default, and it says the extension's data goes with it. */
 async function confirmRemoval(profileId,found,loaded){const name=loaded?.name||found?.name||'Extension';const answer=await dialog.showMessageBox(getWindow(),{type:'warning',title:t('ext.removeTitle'),message:t('ext.removeMessage',{name}),detail:t('ext.removeDataDetail'),buttons:[t('dialog.cancel'),t('ext.remove')],defaultId:0,cancelId:0});return answer?.response===1;}
 /** The one warning for "Allow in private tabs": Cancel is the default. */
 async function confirmPrivate(name){const answer=await dialog.showMessageBox(getWindow(),{type:'warning',title:t('ext.privateTitle'),message:t('ext.privateMessage',{name}),detail:t('ext.privateDetail'),buttons:[t('dialog.cancel'),t('permission.allow')],defaultId:0,cancelId:0});return answer?.response===1;}
 async function command(input,{confirmed=false}={}){const request=validateExtensionRequest(input,getProfiles()),api=apiFor(request.profileId),session=sessionFor(request.profileId);if(request.type==='list'||!api)return list(request.profileId);if(registry.busy)return {...list(request.profileId),error:'Another extension change is being reviewed.'};const found=registry.saved.find(e=>e.id===request.extensionId&&e.profileId===request.profileId),loaded=api.getAllExtensions().find(e=>e.id===request.extensionId);if(!['load','install'].includes(request.type)&&!found&&!loaded)throw new Error('This extension does not belong to this browsing profile.');registry.busy=true;let packageFolder;
  try{
   if(request.type==='pin'){if(!found)throw new Error('Reload this extension to remember toolbar choices.');found.pinned=request.pinned;persist();return list(request.profileId);}
   if(request.type==='userScripts'){
    /* Chrome's per-extension "Allow user scripts" switch. The extension restarts so its pages and worker see chrome.userScripts with the new state. */
    if(!found)throw new Error('Reload this extension to remember this choice.');const manifest=readManifest(found.path);if(!(manifest.permissions||[]).includes('userScripts'))throw new Error('This extension does not use user scripts.');
    found.userScripts=request.allowed;persist();const ids=userScriptIds(request.profileId);
    try{require('./extension-runtime-patch.cjs').installPatchedPreload(session,require('electron').app.getPath('userData'),preloadOptions(session,request.profileId));}catch{}
    extraApis.get(session)?.syncUserScriptPreload(ids.length>0);
    if(loaded){await unloadFully(session,api,loaded.id,4000,loaded.manifest?.background?.service_worker?150:0);await api.loadExtension(found.path,{allowFileAccess:false});}
    return list(request.profileId);
   }
   if(request.type==='private'){
    /* "Allow in private tabs" (Chrome's "Allow in Incognito"): off by default. Turning it on asks first; the extension can see what is done in private. */
    if(!found)throw new Error('Reload this extension to remember this choice.');
    if(request.allowed&&!found.allowPrivate&&!confirmed&&!await confirmPrivate(loaded?.name||found.name))return {...list(request.profileId),cancelled:true};
    if(request.allowed)found.allowPrivate=true;else{delete found.allowPrivate;leavePrivate(request.profileId,found.id);}persist();return list(request.profileId);
   }
   if(request.type==='newTab'){
    /* "Use as New Tab page": an explicit choice for an extension that declares chrome_url_overrides.newtab; one per profile. */
    if(!found)throw new Error('Reload this extension to remember this choice.');const manifest=readManifest(found.path);if(typeof manifest.chrome_url_overrides?.newtab!=='string')throw new Error('This extension has no New Tab page.');
    for(const entry of registry.saved)if(entry.profileId===request.profileId&&entry!==found&&request.allowed)delete entry.newTab;if(request.allowed)found.newTab=true;else delete found.newTab;persist();return list(request.profileId);
   }
   if(request.type==='disable'){if(loaded)api.removeExtension(loaded.id);leavePrivate(request.profileId,request.extensionId);if(found)found.enabled=false;registry.errors.delete(errorKey(request.profileId,request.extensionId));persist();return list(request.profileId);}
   if(request.type==='remove'){
    if(!confirmed&&!await confirmRemoval(request.profileId,found,loaded))return {...list(request.profileId),cancelled:true};
    /* As Chrome's uninstall: the extension's data goes with it (extension-data.cjs). chrome.storage is emptied while it still runs, then it is unloaded
     * (its worker stopped), then its origin's storage and folders, and the copy of a store package Acira unpacked, are deleted. */
    extraApis.get(session)?.forget(request.extensionId);leavePrivate(request.profileId,request.extensionId);
    let cleared=true;if(loaded){cleared=await extensionData.clearStorageAreas(session,loaded.id);await unloadFully(session,api,loaded.id,4000,0);}
    registry.saved=registry.saved.filter(e=>e!==found);registry.errors.delete(errorKey(request.profileId,request.extensionId));notePending(request.profileId,request.extensionId,false);persist();
    /* the extension is removed whatever happens next; what is left of its data is retried at the next start (retryPendingData) */
    const failed=await extensionData.deleteExtensionData(session,request.extensionId);notePending(request.profileId,request.extensionId,cleared&&!failed.length);persist();
    if(found?.source==='Chrome Web Store')try{prunePackages(request.profileId,request.extensionId,[]);}catch{}
    return list(request.profileId);
   }
   let folder,metadata=found?{...found}:{source:'Local folder'};
   if(request.type==='install'||request.type==='update'){
    if(request.type==='update'&&found?.source!=='Chrome Web Store')throw new Error('Local folders update through Reload; store updates require a verified store source.');const profileKey=createHash('sha256').update(request.profileId).digest('hex').slice(0,8);packageFolder=path.join(path.dirname(key),'extension-packages',profileKey,request.extensionId,randomUUID().slice(0,8));const result=await downloadPackage(request.extensionId,packageFolder,session);folder=result.path;try{require('./extension-shims.cjs').applyStorageSyncShim(folder);}catch{}metadata={...metadata,...result};if(found&&found.packageHash===result.packageHash)return {...list(request.profileId),upToDate:true};
   }else if(request.type==='load'){const selected=await dialog.showOpenDialog(getWindow(),{title:t('ext.loadUnpackedTitle'),properties:['openDirectory'],buttonLabel:t('ext.chooseFolder')});if(selected.canceled||!selected.filePaths?.[0])return {...list(request.profileId),cancelled:true};folder=selected.filePaths[0];}else folder=found.path;
   const manifest=readManifest(folder),needsReview=request.type!=='enable'||!found.permissions||permissions(manifest).some(p=>!found.permissions.includes(p));if(needsReview&&!await review(request.profileId,manifest,request.type==='update'?'Update':'Load'))return {...list(request.profileId),cancelled:true};
   if(loaded)await unloadFully(session,api,loaded.id,4000,loaded.manifest?.background?.service_worker?150:0);let extension;try{extension=await api.loadExtension(folder,{allowFileAccess:false});if(request.extensionId&&extension.id!==request.extensionId){api.removeExtension(extension.id);throw new Error('Loaded identity does not match the selected extension.');}}catch(error){if(loaded&&found)try{await api.loadExtension(found.path,{allowFileAccess:false});}catch{}throw error;}
   registry.saved=registry.saved.filter(e=>!(e.profileId===request.profileId&&(e.id===extension.id||e.path===folder)));notePending(request.profileId,extension.id,true);registry.saved.push({id:extension.id,profileId:request.profileId,path:folder,name:extension.name||manifest.name,version:extension.version||manifest.version,permissions:permissions(manifest),enabled:true,pinned:found?.pinned??false,...(found?.userScripts===true?{userScripts:true}:{}),...(found?.newTab===true?{newTab:true}:{}),...(found?.allowPrivate===true?{allowPrivate:true}:{}),source:metadata.source,sourceURL:metadata.sourceURL,packageHash:metadata.packageHash,publisherVerified:metadata.publisherVerified,previousPath:metadata.source==='Chrome Web Store'?found?.path:undefined});registry.errors.delete(errorKey(request.profileId,extension.id));persist();if(metadata.source==='Chrome Web Store')try{prunePackages(request.profileId,extension.id,[folder,found?.path]);}catch{}packageFolder=null;return list(request.profileId);
  }catch(error){if(found)registry.errors.set(errorKey(request.profileId,found.id),String(error.message||error));return {...list(request.profileId),error:String(error.message||error).slice(0,1024)};}finally{registry.busy=false;if(packageFolder){const root=path.resolve(path.dirname(key),'extension-packages'),target=path.resolve(packageFolder);if(target.startsWith(root+path.sep))try{fs.rmSync(target,{recursive:true,force:true});}catch{}}}
 }
 /** The New Tab page the person chose for this profile ({extensionId, url}), or null: only a loaded, enabled extension that declares one. */
 function newTabOverride(profileId){try{const entry=registry.saved.find(e=>e.profileId===profileId&&e.newTab===true&&e.enabled!==false);if(!entry)return null;const loaded=apiFor(profileId)?.getAllExtensions().find(e=>e.id===entry.id),page=loaded?.manifest?.chrome_url_overrides?.newtab;if(typeof page!=='string'||!page)return null;const url=new URL(page.replace(/^\/+/,''),`chrome-extension://${entry.id}/`);return url.hostname===entry.id?{extensionId:entry.id,url:url.href}:null;}catch{return null;}}

 /* ---- Allow in private tabs (private-extension-sessions.cjs) ----
  * A private session made for it (a temporary folder, because the engine loads no extension into a memory-only one) gets a runtime of its own and a copy of
  * each allowed extension, loaded from its package folder. What the extensions keep there (their settings copy, runtime files, proxy values) lives in that
  * session's folder and goes with it. Never for Tor or secured workspaces: main.cjs does not ask. */
 const privateSessions=new Map();/* session -> {profile, sourceProfileId}, until detachPrivate */
 const privateEntries=profileId=>registry.saved.filter(e=>e.profileId===profileId&&e.allowPrivate===true&&e.enabled!==false);
 /** True when a new private window or tab of this profile should get a session that can run extensions. */
 function privateWanted(profileId){try{return typeof profileId==='string'&&privateEntries(profileId).length>0;}catch{return false;}}
 async function attachPrivate({session,profile,sourceProfileId,implementation={},runtimeDir,settingsFrom}){
  const result={loaded:[],failed:[]};
  if(!session||!profile||profile.private!==true||profile.tor||privateSessions.has(session)||!privateWanted(sourceProfileId)||!runtimeDir)return result;
  const wanted=privateEntries(sourceProfileId);privateSessions.set(session,{profile,sourceProfileId});
  try{fs.mkdirSync(runtimeDir,{recursive:true});}catch{}
  /* Each private session is new, but its extensions are not: record them as already installed at their current versions, so none runs its first-run page or onInstalled('install') in every private tab. */
  try{const dir=path.join(runtimeDir,'extension-install-state'),extensions={};fs.mkdirSync(dir,{recursive:true});for(const entry of wanted){let version='';try{version=String(readManifest(entry.path).version||'');}catch{}extensions[entry.id]={version};}fs.writeFileSync(path.join(dir,`${String(profile.id).replace(/[^\w.-]/g,'_')}.json`),JSON.stringify({browser:require('./ext-api/runtime.cjs').internals.browserVersion(),extensions}));}catch{}
  /* What these extensions hold in the profile's settings store (a VPN's proxy) starts in the private session too, one way. */
  try{require('./extension-chrome-settings.cjs').seedPrivateStore({userData:require('electron').app.getPath('userData'),fromKey:sourceProfileId,toUserData:runtimeDir,toKey:profile.id,extensionIds:wanted.map(e=>e.id)});}catch{}
  runtimeFor(session,{profile,implementation,runtimeDir,private:true});
  const sessionsApi=require('./private-extension-sessions.cjs');
  for(const entry of wanted){
   try{
    const manifest=readManifest(entry.path),current=permissions(manifest);
    if(entry.permissions&&current.some(p=>!entry.permissions.includes(p)))throw new Error('The extension now requests additional access. Reload it to review permissions.');
    sessionsApi.copySettings(settingsFrom,sessionsApi.folderOf(session),entry.id);
    const extension=await session.extensions.loadExtension(entry.path,{allowFileAccess:false});
    if(extension.id!==entry.id){try{session.extensions.removeExtension(extension.id);}catch{}throw new Error('The extension identity changed.');}
    result.loaded.push(entry.id);
   }catch(error){result.failed.push({id:entry.id,name:entry.name,error:String(error.message||error).slice(0,300)});}
  }
  /* A proxy extension sets its proxy a moment after it starts: give it that moment before the page loads, so the first request is not sent direct. */
  if(result.loaded.some(id=>strings(wanted.find(e=>e.id===id)?.permissions).includes('proxy'))){const settings=require('./extension-chrome-settings.cjs'),until=Date.now()+1200;while(Date.now()<until&&!settings.proxyOverride(profile.id,session))await new Promise(resolve=>setTimeout(resolve,50));try{const held=settings.proxyOverride(profile.id,session);if(held)await session.setProxy(held.native);}catch{}/* in force before the page loads */}
  return result;
 }
 /** The private session is ending: its extensions are unloaded, its runtime lets go of its listeners and timers. */
 function detachPrivate(session){if(!privateSessions.delete(session))return false;try{disposeProfileRuntime(session);}catch{}return true;}
 /** The switch was turned off, or the extension was turned off or removed: it leaves the private sessions that are open. */
 function leavePrivate(profileId,extensionId){for(const [session,info] of privateSessions)if(info.sourceProfileId===profileId)try{session.extensions.removeExtension(extensionId);}catch{}}
 const isPrivateSession=session=>privateSessions.has(session);
 /** What the toolbar shows for a page of a private session that runs extensions (the pinned ones of its profile), or null. */
 function privateTarget(wc){
  const info=wc&&!wc.isDestroyed()?privateSessions.get(wc.session):null;if(!info||!/^https?:\/\//i.test(wc.getURL()))return null;
  let actions=[];try{actions=wc.session.extensions.getAllExtensions().filter(e=>e.manifest?.action||e.manifest?.browser_action).map(e=>String(e.id));}catch{}
  const pinned=new Set(registry.saved.filter(e=>e.profileId===info.sourceProfileId&&e.pinned).map(e=>e.id));
  return {supported:true,profileId:info.profile.id,partition:info.profile.partition,webContentsId:wc.id,pinnedIds:actions.filter(id=>pinned.has(id)),actionIds:actions};
 }
 return {restore,command,list,newTabOverride,privateWanted,attachPrivate,detachPrivate,leavePrivate,isPrivateSession,privateTarget,storageOrigins(profileId){if(registry.busy||!profileFor(profileId))return {complete:false,profileId,origins:[],error:'Installation metadata is changing or this is not an ordinary profile.'};return installedExtensionOrigins({session:sessionFor(profileId),profileId,registryPath:key,installedIds:registry.saved.filter(entry=>entry.profileId===profileId).map(entry=>entry.id)});},attachTab(wc,window){if(profileFor(getProfiles().find(p=>getSession(p.partition)===wc.session)?.id))runtimeFor(wc.session)?.addTab(wc,window);else if(privateSessions.has(wc.session))runtimes.get(wc.session)?.addTab(wc,window);},selectTab(wc){runtimes.get(wc.session)?.selectTab(wc);},removeTab(wc){runtimes.get(wc.session)?.removeTab(wc);},getContextMenuItems(wc,params){return runtimes.get(wc.session)?.getContextMenuItems(wc,params)||[];}};
}
module.exports={EXTENSION_EVENT_LISTENERS,createExtensionManager,privateWantedFor,disposeProfileRuntime,validateExtensionRequest,supportNote,describe,accessLines,PERMISSION_IDS};
