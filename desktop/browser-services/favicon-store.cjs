'use strict';
const fs=require('node:fs'),path=require('node:path');
// Site icons for History, Bookmarks, Downloads and the New Tab tiles. Those pages never ask the network for an icon: while you are on a site,
// the icon the tab already fetched (the tab's own request, without cookies, so nothing more is asked of the site) is kept on this computer as
// an image up to 96px (a New Tab tile draws 24 CSS px, 48 to 72 device pixels), so the page can show it later with no request at all. An .ico
// is cut down to its one best picture and an SVG is kept as it is. Private windows keep nothing, and an icon is forgotten as soon as the
// profile no longer has the site in its history, bookmarks or open tabs.
const {normalizeIcon}=require('./icon-image.cjs');
const MAX_BYTES=262144,MAX_PER_PROFILE=400,FRESH=7*86400000,SIDE=96,ENTRY_MAX=24*1024,NEED=48,VERSION=2;

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

 const shape=bytes=>normalizeIcon({bytes,need:NEED,maxSide:SIDE,maxOut:ENTRY_MAX,nativeImage});
 /** `iconUrl` is the icon the page announced; `icon` ({bytes}) is that file as the tab already fetched it, so nothing is asked of the site a
  *  second time. Without `icon` the file is fetched here through `session` (no cookies). Resolves true when a new icon was stored. */
 async function remember({session,profileId,privateMode,pageUrl,iconUrl,icon}){
  if(privateMode||typeof profileId!=='string'||!profileId)return false;
  const host=hostOf(pageUrl);
  if(!host||!/^https?:\/\//i.test(iconUrl||''))return false;
  if(!session&&!(icon&&Buffer.isBuffer(icon.bytes)))return false;
  load();
  const profile=(data.profiles[profileId]??={}),known=profile[host];
  if(known&&known.url===iconUrl&&known.v===VERSION&&now()-known.at<FRESH)return false;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
  try{
   let bytes=icon&&Buffer.isBuffer(icon.bytes)?icon.bytes:null;
   if(!bytes){
    const response=await session.fetch(iconUrl,{credentials:'omit',signal:controller.signal});
    if(!response.ok||!/^image\//i.test(response.headers.get('content-type')||''))return false;
    bytes=Buffer.from(await response.arrayBuffer());
   }
   if(!bytes.length||bytes.length>MAX_BYTES)return false;
   const kept=shape(bytes);
   if(!kept)return false;
   profile[host]={url:iconUrl,data:kept.data,at:now(),v:VERSION};
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
   try{const kept=shape(bytes);if(!kept)continue;profile[host]={url:'',data:kept.data,at:0,v:VERSION};added++;}catch{}
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
