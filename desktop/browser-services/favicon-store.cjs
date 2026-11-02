'use strict';
const fs=require('node:fs'),path=require('node:path');
// Site icons for History, Bookmarks and Downloads. Those pages never ask the network for an icon: while you are on a site, its icon is
// fetched once (the same request the tab already made, without cookies), shrunk to 32px and kept on this computer as an image, so the
// page can show it later with no request at all. Private windows keep nothing, and an icon is forgotten as soon as the profile no longer
// has the site in its history, bookmarks or open tabs.
const MAX_BYTES=65536,MAX_PER_PROFILE=400,FRESH=7*86400000,SIZE=32;

function createFaviconStore({file,nativeImage,now=()=>Date.now()}){
 let data={version:1,profiles:{}},loaded=false,timer=null;
 const load=()=>{
  if(loaded)return;loaded=true;
  try{const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw&&raw.version===1&&raw.profiles&&typeof raw.profiles==='object')data=raw;}catch{/* No icons yet. */}
 };
 const save=()=>{
  clearTimeout(timer);
  timer=setTimeout(()=>{
   try{fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(data));fs.renameSync(temporary,file);}catch{/* Icons are only a convenience. */}
  },2000);
  timer.unref?.();
 };
 const hostOf=url=>{
  try{const parsed=new URL(url);return /^https?:$/.test(parsed.protocol)&&parsed.hostname?parsed.hostname.replace(/^www\./,'').toLowerCase():null;}catch{return null;}
 };

 /** `iconUrl` is the icon the page just announced. Resolves true when a new icon was stored. */
 async function remember({session,profileId,privateMode,pageUrl,iconUrl}){
  if(privateMode||!session||typeof profileId!=='string'||!profileId)return false;
  const host=hostOf(pageUrl);
  if(!host||!/^https?:\/\//i.test(iconUrl||''))return false;
  load();
  const profile=(data.profiles[profileId]??={}),known=profile[host];
  if(known&&known.url===iconUrl&&now()-known.at<FRESH)return false;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
  try{
   const response=await session.fetch(iconUrl,{credentials:'omit',signal:controller.signal});
   if(!response.ok||!/^image\//i.test(response.headers.get('content-type')||''))return false;
   const bytes=Buffer.from(await response.arrayBuffer());
   if(!bytes.length||bytes.length>MAX_BYTES)return false;
   let image=nativeImage.createFromBuffer(bytes);
   if(!image||image.isEmpty())return false;
   if(image.getSize().width>SIZE)image=image.resize({width:SIZE,quality:'best'});
   profile[host]={url:iconUrl,data:image.toDataURL(),at:now()};
   const hosts=Object.keys(profile);
   if(hosts.length>MAX_PER_PROFILE)for(const old of hosts.sort((a,b)=>profile[a].at-profile[b].at).slice(0,hosts.length-MAX_PER_PROFILE))delete profile[old];
   save();
   return true;
  }catch{return false;}
  finally{clearTimeout(timeout);}
 }

 /** The icons for sites this profile still has; everything else is forgotten (and so is gone from disk). */
 function list(profileId,keepHosts){
  load();
  const profile=data.profiles[profileId];
  if(!profile)return {};
  const out={};let dropped=false;
  for(const host of Object.keys(profile)){
   if(keepHosts.has(host))out[host]=profile[host].data;
   else{delete profile[host];dropped=true;}
  }
  if(dropped)save();
  return out;
 }
 /** Icons an import brought from the other browser's own icon database ({host: PNG/ICO bytes}). A site this profile already has
  *  an icon for keeps it; imported ones count as oldest (at 0), so icons from real visits replace them first. Returns how many were added. */
 function adopt(profileId,icons){
  if(typeof profileId!=='string'||!profileId||!icons)return 0;
  load();
  const profile=(data.profiles[profileId]??={});let added=0;
  for(const [rawHost,bytes]of icons){
   if(Object.keys(profile).length>=MAX_PER_PROFILE)break;
   const host=typeof rawHost==='string'?rawHost.replace(/^www\./,'').toLowerCase():'';
   if(!host||profile[host]||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)continue;
   try{let image=nativeImage.createFromBuffer(bytes);if(!image||image.isEmpty())continue;if(image.getSize().width>SIZE)image=image.resize({width:SIZE,quality:'best'});profile[host]={url:'',data:image.toDataURL(),at:0};added++;}catch{}
  }
  if(added)save();
  return added;
 }
 function forgetProfile(profileId){load();if(data.profiles[profileId]){delete data.profiles[profileId];save();}}
 /** Writes anything pending (used when the app quits). */
 function flush(){
  if(!timer)return;
  clearTimeout(timer);timer=null;
  try{fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(data));fs.renameSync(temporary,file);}catch{/* Best effort. */}
 }
 /** One site's stored icon (a data URL), or '' when there is none. Read-only: it never drops anything. */
 function get(profileId,host){load();return data.profiles[profileId]?.[host]?.data||'';}
 return {remember,adopt,list,get,forgetProfile,flush,hostOf};
}

let shared;
/** The one store for this app, kept under the user data folder. */
function sharedFaviconStore(){
 if(!shared){const electron=require('electron');shared=createFaviconStore({file:path.join(electron.app.getPath('userData'),'favicons.json'),nativeImage:electron.nativeImage});}
 return shared;
}

module.exports={createFaviconStore,sharedFaviconStore};
