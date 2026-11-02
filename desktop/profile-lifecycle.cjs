'use strict';
// Native side of profile removal and bulk tab closing. The reducer (src/runtime/profileActions.ts) owns the
// state change; this module closes the pages first, commits in every window, then erases the partition.
const fs=require('node:fs'),path=require('node:path');
const {bulkCloseTargets}=require('./runtime.cjs');

const PENDING='removed-partitions.json';
const folderNames=(root,partition)=>{const name=String(partition).replace(/^persist:/,'').toLowerCase();return fs.existsSync(root)?fs.readdirSync(root).filter(entry=>entry.toLowerCase()===name||entry.toLowerCase()===encodeURIComponent(name).toLowerCase()):[];};
const readPending=file=>{try{const list=JSON.parse(fs.readFileSync(file,'utf8')).partitions;return Array.isArray(list)?list.filter(item=>typeof item==='string'&&item.startsWith('persist:')&&item.length<300):[];}catch{return [];}};
/** The engine keeps a live partition's files open, so removal that cannot finish now is finished at the next start, before any session opens. */
function sweepRemovedPartitions(userData){
 const file=path.join(userData,PENDING),root=path.join(userData,'Partitions'),left=[];
 for(const partition of readPending(file)){for(const folder of folderNames(root,partition)){const target=path.join(root,folder);if(path.dirname(target)!==root)continue;try{fs.rmSync(target,{recursive:true,force:true});}catch{left.push(partition);break;}}}
 try{if(left.length)fs.writeFileSync(file,JSON.stringify({partitions:left}));else fs.rmSync(file,{force:true});}catch{}
 return left;
}
function createProfileLifecycle({controllers,database,electronSession,permissions,certificates,downloads,cookieRestore,partitionsRoot,onRemoved=()=>{}}){
 const removing=new Set();
 const ordinary=()=>[...controllers].filter(c=>!c.privateMode&&!c.closing);

 // The engine releases its files a moment after storage is cleared, so the folder removal retries briefly.
 async function removePartitionFolder(partition){
  if(!partitionsRoot)return {pending:false};
  let pending=false;
  for(const folder of folderNames(partitionsRoot,partition)){
   const target=path.join(partitionsRoot,folder);if(path.dirname(target)!==partitionsRoot)continue;
   try{fs.rmSync(target,{recursive:true,force:true});}catch{pending=true;}
  }
  if(pending){const file=path.join(path.dirname(partitionsRoot),PENDING);const list=[...new Set([...readPending(file),partition])];fs.writeFileSync(file+'.tmp',JSON.stringify({partitions:list}));fs.renameSync(file+'.tmp',file);}
  return {pending};
 }
 async function erase(profile){
  const failures=[];
  const attempt=async(label,fn)=>{try{await fn();}catch(error){failures.push(`${label}: ${error.message}`);}};
  await attempt('permissions',()=>permissions?.clear(profile.id));
  await attempt('certificates',()=>certificates?.clearProfile(profile.id));
  await attempt('downloads',()=>downloads?.clearPrivate(profile.id));
  await attempt('records',()=>database?.removeProfile(profile.id));
  await attempt('sign-ins',()=>cookieRestore?.removeProfile(profile.partition));
  const session=electronSession.fromPartition(profile.partition);
  await attempt('storage',()=>session.clearStorageData());
  await attempt('cache',()=>session.clearCache());
  await attempt('auth',()=>session.clearAuthCache());
  await attempt('dns',()=>session.clearHostResolverCache());
  await attempt('connections',()=>session.closeAllConnections());
  let folderPending=false;await attempt('partition folder',async()=>{folderPending=(await removePartitionFolder(profile.partition)).pending;});
  failures.folderPending=folderPending;
  return failures;
 }

 /** Removes a profile and everything stored for it. Resolves {ok,reason?,failures?}; reason is one of unknown|private|last-profile|busy|vetoed. */
 async function remove(profileId,origin){
  const named=origin.state.browserProfiles.find(p=>p.id===profileId);
  if(!named)return {ok:false,reason:'unknown'};
  if(named.private||origin.privateMode)return {ok:false,reason:'private'};
  const profile=named;
  if(origin.state.browserProfiles.filter(p=>!p.private).length<2){origin.toast('Keep at least one profile.');return {ok:false,reason:'last-profile'};}
  if(removing.has(profileId))return {ok:false,reason:'busy'};
  removing.add(profileId);
  try{
   // A window that is still starting has no state to edit yet; wait for it so none keeps the removed profile.
   await Promise.all(ordinary().map(c=>c.ready));
   const windows=ordinary();
   // Closing pages first lets a page's beforeunload prompt veto the removal before anything is deleted.
   for(const c of windows)for(const tab of c.state.tabs.filter(t=>t.browserProfileId===profileId))
    if(!await c.closePage(tab.id)){origin.toast('Close the page that asked to stay open first.');return {ok:false,reason:'vetoed'};}
   for(const c of windows)for(const [,popup] of c.auxiliaries)if(!popup.isDestroyed()&&popup.webContents.session===electronSession.fromPartition(profile.partition))popup.close();
   const onlyRemoved=windows.filter(c=>c.state.tabs.every(t=>t.browserProfileId===profileId));
   for(const c of windows)c.commitAction({type:'browser.profile.remove',id:profileId});
   // A window that existed only for this profile closes when another window remains to keep the browser open.
   for(const c of onlyRemoved)if(windows.length>1&&c.window&&!c.window.isDestroyed())c.window.close();
   const failures=await erase(profile);
   for(const c of ordinary())c.save();
   onRemoved(profile);
   return {ok:true,failures:[...failures],...(failures.folderPending?{folderPending:true}:{})};
  }finally{removing.delete(profileId);}
 }

 /** Closes the tabs a bulk action targets through the same per-tab path as a single close (beforeunload honoured). */
 async function closeBulk(action,origin){
  const targets=bulkCloseTargets(origin.state,action);
  let closed=0;
  // R4-35: pages with unsaved changes are listed once, before the first tab closes; Cancel leaves every tab as it was.
  if(origin.confirmTabsClose&&targets.length&&!await origin.confirmTabsClose(targets))return {closed:0,skipped:targets.length};
  for(const id of targets){
   if(!origin.state.tabs.some(t=>t.id===id))continue;
   if(!await origin.closePage(id,{user:true}))break;
   origin.commitAction({type:'tab.close',id});closed++;
  }
  return {closed,skipped:targets.length-closed};
 }

 return {remove,closeBulk,pending:()=>[...removing]};
}
module.exports={createProfileLifecycle,sweepRemovedPartitions};
