const {cleanupChoice}=require('./browser-services/exit-cleanup.cjs');
const inventory=require('./transfer/inventory.cjs');
const GENERAL_LIMIT=20000;
// Native accepts100strings of2048UTF-16 units. JSON escaping can use6characters
// per unit; the bounded exception belongs only to this exact cleanup envelope.
const CLEANUP_LIMIT=100*2048*6+4096;
// A profile transfer's send and file-save carry the interface preferences the renderer collected (Favorites with icons, the reading list, the new tab choices),
// which can reach a few hundred KB. The same kind of bounded exception: exactly these two types, exactly their keys, a shape check, and 2 MiB.
const TRANSFER_LIMIT=2*1024*1024;
// transfer.summary asks for the checklist's counts and sizes and carries the same collected `ui`, nothing else.
// 14.4 live wallpaper: artwork.video-commit carries the video's first frame (a JPEG of at most 1920 px, at most 2 MiB: desktop/workspace-video.cjs
// MAX_STILL_BYTES) as base64. The same kind of bounded exception: exactly this type, exactly its keys and their types, and 3 MiB.
const VIDEO_COMMIT_LIMIT=3*1024*1024;
function videoCommitEnvelope(request){
 if(Object.keys(request).sort().join(',')!=='duration,height,id,powerEfficient,still,type,width')return false;
 if(typeof request.id!=='string'||request.id.length>64||typeof request.still!=='string'||!Number.isSafeInteger(request.width)||!Number.isSafeInteger(request.height)||typeof request.duration!=='number'||typeof request.powerEfficient!=='boolean')return false;
 return JSON.stringify(request).length<=VIDEO_COMMIT_LIMIT;
}
const TRANSFER_KEYS={'transfer.send':'historyDays,include,type,ui','transfer.saveFile':'historyDays,include,password,type,ui','transfer.summary':'type,ui'};
const UI_PROFILE=inventory.UI_PREFS.filter(pref=>pref.scope==='profile'&&pref.id!=='readingList').map(pref=>pref.id),UI_GLOBAL=inventory.UI_PREFS.filter(pref=>pref.scope==='global').map(pref=>pref.id);
const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key));
function transferEnvelope(request){
 if(Object.keys(request).filter(key=>request[key]!==undefined).sort().join(',')!==TRANSFER_KEYS[request.type].split(',').filter(key=>key!=='password'||request.password!==undefined).join(','))return false;
 if(request.type!=='transfer.summary'){
  if(!only(request.include,inventory.ROWS)||Object.values(request.include).some(value=>typeof value!=='boolean'))return false;
  if(![0,30,90].includes(request.historyDays))return false;
 }
 if(request.password!==undefined&&(typeof request.password!=='string'||request.password.length>1024))return false;
 const ui=request.ui;
 if(!only(ui,['profile','global','readingList']))return false;
 if(ui.profile!==undefined&&(!only(ui.profile,UI_PROFILE)||(ui.profile.sidebarApps&&(!Array.isArray(ui.profile.sidebarApps.apps)||ui.profile.sidebarApps.apps.length>inventory.CAPS.favorites))))return false;
 if(ui.global!==undefined&&!only(ui.global,UI_GLOBAL))return false;
 if(ui.readingList!==undefined&&(!Array.isArray(ui.readingList)||ui.readingList.length>inventory.CAPS.readingList))return false;
 return JSON.stringify(request).length<=TRANSFER_LIMIT;
}
function validServiceEnvelope(request){
 try{
  if(!request||typeof request!=='object'||Array.isArray(request))return false;
  if(Object.hasOwn(TRANSFER_KEYS,request.type))return transferEnvelope(request);
  if(request.type==='artwork.video-commit')return videoCommitEnvelope(request);
  if(request.type!=='cleanup.set')return JSON.stringify(request).length<=GENERAL_LIMIT;
  if(Object.keys(request).sort().join(',')!=='choice,type')return false;
  const value=request.choice;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='categories,enabled,keepOrigins'||!Array.isArray(value.categories)||value.categories.length>4||!Array.isArray(value.keepOrigins)||value.keepOrigins.length>100||value.keepOrigins.some(origin=>typeof origin!=='string'||origin.length>2048))return false;
  cleanupChoice(value);
  return JSON.stringify(request).length<=CLEANUP_LIMIT;
 }catch{return false;}
}
module.exports={validServiceEnvelope,GENERAL_LIMIT,CLEANUP_LIMIT,TRANSFER_LIMIT,VIDEO_COMMIT_LIMIT};
