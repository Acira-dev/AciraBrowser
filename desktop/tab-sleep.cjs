'use strict';
// Tab sleep: hidden tabs are first frozen (no timers or scripts, memory kept) and, after a longer idle time, discarded
// (the native page is closed; URL, title, icon and history stay in the tab list and the page reloads when it is opened).
// This module decides; desktop/main.cjs supplies the adapter that actually touches pages.
// The protections mirror Chromium's performance manager (BSD-3-Clause, see THIRD_PARTY_NOTICES.md): chrome/browser/performance_manager/policies/
// discard_eligibility_policy.cc (visible, recently audible 1 min, audible, picture-in-picture, PDF, non-web, notifications, capture, active, pinned,
// DevTools, background title/icon updates, form interactions and edits) and components/performance_manager/freezing/{freezing_policy,cannot_freeze_reason}.cc.
// Chromium's Memory Saver waits 2, 4 or 6 hours (memory_saver_mode_policy.cc); Acira defaults to 15 minutes and offers 5 minutes to 4 hours.
const DEFAULTS=Object.freeze({enabled:true,idleMinutes:15,neverSleep:[]});
const IDLE_CHOICES=[5,15,30,60,120];

/** Validated memory saver settings; anything malformed falls back to the defaults. */
function memorySaverChoice(value){
 const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const idleMinutes=Number.isInteger(source.idleMinutes)&&source.idleMinutes>=1&&source.idleMinutes<=720?source.idleMinutes:DEFAULTS.idleMinutes;
 const neverSleep=Array.isArray(source.neverSleep)?[...new Set(source.neverSleep.filter(item=>typeof item==='string').map(normalizeSite).filter(Boolean))].slice(0,100):[];
 return {enabled:source.enabled!==false,idleMinutes,neverSleep};
}
/** "https://Mail.Example.com/inbox", "mail.example.com" and "*.example.com" all name a host. */
function normalizeSite(value){
 const text=String(value||'').trim().toLowerCase();if(!text||text.length>253)return null;
 const bare=text.replace(/^https?:\/\//,'').replace(/^\*\./,'').replace(/[/?#].*$/,'').replace(/:\d+$/,'').replace(/\.$/,'');
 return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(bare)?bare:null;
}
// Calls, chat and music keep running in the background by design (Dia ships a similar keep-alive list, see docs/launch/research/DIA_PACKAGE_STUDY.md).
const KEEP_ALIVE=Object.freeze(['meet.google.com','zoom.us','zoom.com','teams.microsoft.com','teams.live.com','discord.com','slack.com','webex.com','whereby.com','skype.com','open.spotify.com','music.youtube.com','music.apple.com','soundcloud.com','deezer.com','tidal.com','pandora.com','web.whatsapp.com','web.telegram.org','messenger.com','twitch.tv']);
function neverSleeps(url,list){
 let host;try{host=new URL(url).hostname.toLowerCase();}catch{return false;}
 return [...KEEP_ALIVE,...list].some(site=>host===site||host.endsWith('.'+site));
}

/** Real memory pressure: less than 12% of the machine's memory free, and never less than 1 GB (so a 4 GB laptop acts at 1 GB, a 32 GB desktop at 3.8 GB). */
function underPressure({free,total}){return Number.isFinite(free)&&Number.isFinite(total)&&total>0&&free<Math.max(1024*1024*1024,total*.12);}
// Under pressure a hidden tab that has been frozen long enough is discarded without waiting for the idle time, oldest first, a couple per sweep so the
// machine gets room without every background tab vanishing at once. The same protections apply: nothing audible, edited, pinned or kept awake is touched.
const PRESSURE_BUDGET=2;
function createTabSleep({adapter,settings,now=Date.now,freezeAfterMs=5*60*1000,discardAfterMs,retryMs=10*60*1000,memory=()=>({free:require('node:os').freemem(),total:require('node:os').totalmem()})}){
 const records=new Map();
 const record=id=>{let value=records.get(id);if(!value){value={lastVisible:now(),frozen:false,retryAfter:0};records.set(id,value);}return value;};
 /** One pass over the tabs that have a native page. Returns what it did, for tests and the task view. */
 async function sweep(){
  const choice=memorySaverChoice(settings()),report={frozen:[],woke:[],slept:[],protected:{}};
  const tabs=adapter.tabs(),live=new Set(tabs.map(tab=>tab.id));
  for(const id of records.keys())if(!live.has(id))records.delete(id);
  const discardMs=discardAfterMs??choice.idleMinutes*60*1000,time=now();
  let pressure=false;try{pressure=choice.enabled&&underPressure(memory());}catch{}
  let budget=PRESSURE_BUDGET;if(pressure)tabs.sort((a,b)=>(records.get(a.id)?.lastVisible??time)-(records.get(b.id)?.lastVisible??time));
  report.pressure=pressure;
  for(const tab of tabs){
   const item=record(tab.id);
   if(adapter.isVisible(tab.id)){item.lastVisible=time;if(item.frozen){item.frozen=false;try{await adapter.unfreeze(tab.id);report.woke.push(tab.id);}catch{}}continue;}
   if(!choice.enabled){if(item.frozen){item.frozen=false;try{await adapter.unfreeze(tab.id);report.woke.push(tab.id);}catch{}}continue;}
   const idle=time-item.lastVisible,early=pressure&&budget>0&&idle>=freezeAfterMs&&idle<discardMs,limit=early?freezeAfterMs:discardMs;
   if(idle<Math.min(freezeAfterMs,discardMs))continue;
   // A frozen page cannot run the safety check; nothing to do for it until it is old enough to discard (or the machine is short of memory).
   if(item.frozen&&idle<limit)continue;
   if(item.frozen){item.frozen=false;try{await adapter.unfreeze(tab.id);}catch{}}
   // The adapter is told whether the machine is short of memory: a pinned tab is kept awake only while it is not (desktop/main.cjs protectedReason).
   const reason=await adapter.protectedReason(tab,choice,{pressure});
   if(reason){report.protected[tab.id]=reason;continue;}
   if(idle>=limit&&time>=item.retryAfter){
    const result=await adapter.sleep(tab.id);
    if(result?.slept){report.slept.push(tab.id);records.delete(tab.id);if(early)budget--;continue;}
    item.retryAfter=time+retryMs;report.protected[tab.id]=result?.reason||'not-safe';
   }
   if(!item.frozen&&idle>=freezeAfterMs){try{if(await adapter.freeze(tab.id)){item.frozen=true;report.frozen.push(tab.id);}}catch{}}
  }
  return report;
 }
 /** Call when a tab is shown or touched so the idle clock restarts. */
 function touch(id){const item=record(id);item.lastVisible=now();item.retryAfter=0;}
 /** The user's own "Put to sleep" (a tab's menu, a group's, a workspace's): the same protections as the sweep and the same adapter.sleep, none of the waiting.
  *  The tab on screen, anything protectedReason names (audio, capture, edits, pinned, never-sleep sites, ...) and a page that asks to stay all stay awake, each with its reason.
  *  The Memory Saver switch does not matter: it governs the automatic sleep, this is a request. A tab with no native page is already asleep (or gone) and is listed apart.
  *  Returns {slept: ids, stayed: {id: reason}, asleep: ids}. */
 async function sleepNow(ids){
  const choice=memorySaverChoice(settings()),report={slept:[],stayed:{},asleep:[]};
  const byId=new Map(adapter.tabs().map(tab=>[tab.id,tab]));
  const one=async id=>{
   const tab=byId.get(id);
   if(!tab){report.asleep.push(id);return;}
   if(adapter.isVisible(id)){report.stayed[id]='visible';return;}
   const item=records.get(id);
   // A frozen page cannot run the safety check (the sweep wakes it first too); the next sweep freezes it again if it stays.
   if(item?.frozen){item.frozen=false;try{await adapter.unfreeze(id);}catch{}}
   const reason=await adapter.protectedReason(tab,choice);
   if(reason){report.stayed[id]=reason;return;}
   const result=await adapter.sleep(id);
   if(result?.slept){report.slept.push(id);records.delete(id);}else report.stayed[id]=result?.reason||'not-safe';
  };
  const wanted=[...new Set((Array.isArray(ids)?ids:[]).filter(id=>typeof id==='string'))];
  // A few at a time: each check may wait on its page for a moment, and a workspace can hold dozens of tabs.
  for(let at=0;at<wanted.length;at+=SLEEP_NOW_BATCH)await Promise.all(wanted.slice(at,at+SLEEP_NOW_BATCH).map(id=>one(id).catch(()=>{report.stayed[id]='not-safe';})));
  return report;
 }
 return {sweep,touch,sleepNow,frozen:id=>!!records.get(id)?.frozen};
}
const SLEEP_NOW_BATCH=4;
/** Why a tab stayed awake, in the few kinds the toast can say plainly: 'screen' (it is the tab on screen), 'media' (sound, camera, microphone, screen, video, picture-in-picture),
 *  'edits' (typed form input, a password, a chosen file, an editable page or canvas), or 'other'. */
function stayAwakeKind(reason){
 if(reason==='visible')return 'screen';
 if(['audio','recently-audible','capturing','playing-media-or-live-stream','picture-in-picture'].includes(reason))return 'media';
 if(['edited-form','credential-or-file-input','editable-or-canvas-content'].includes(reason))return 'edits';
 return 'other';
}
/** Runs inside the page (serialised with toString): is it safe to close? Edited fields, credentials, editable/canvas pages and live media are not.
 *  skipSelects (13.5): true leaves the drop-downs out. A select that differs from its default is reported with select:true so the caller can ask whether the PERSON ever touched one (inspectLive). */
function inspectPage(skipSelects){
 const controls=document.querySelectorAll('input,textarea,select');if(controls.length>5000||document.getElementsByTagName('*').length>50000)return {safe:false,reason:'page-too-large'};
 if(document.designMode==='on'||document.querySelector('[contenteditable]:not([contenteditable="false"]),canvas'))return {safe:false,reason:'editable-or-canvas-content'};
 for(const element of controls){
  if(element.tagName==='INPUT'){if(element.type==='password'&&element.value||element.type==='file'&&element.files.length)return {safe:false,reason:'credential-or-file-input'};if(['checkbox','radio'].includes(element.type)){if(element.checked!==element.defaultChecked)return {safe:false,reason:'edited-form'};}else if(!['hidden','button','submit','reset','image','file'].includes(element.type)){const baseline=document.createElement('input');for(const name of ['type','min','max','step','value'])if(element.hasAttribute(name))baseline.setAttribute(name,element.getAttribute(name));if(element.value!==baseline.value)return {safe:false,reason:'edited-form'};}}
  else if(element.tagName==='TEXTAREA'&&element.value!==element.defaultValue)return {safe:false,reason:'edited-form'};
  else if(element.tagName==='SELECT'){if(skipSelects===true)continue;const options=[...element.options],selected=options.filter(option=>option.selected).map(option=>option.index),defaults=options.filter(option=>option.defaultSelected).map(option=>option.index);if(!element.multiple&&!defaults.length&&options.length)defaults.push(0);if(JSON.stringify(selected)!==JSON.stringify(defaults))return {safe:false,reason:'edited-form',select:true};}
 }
 // A looping video with its sound off (a page's background or hero clip) has no place to lose and nothing to hear: it starts again when the page wakes. Anything else that plays, and any live stream, keeps the tab awake.
 const ambient=media=>media.tagName==='VIDEO'&&media.loop===true&&(media.muted===true||media.volume===0)&&!(media.srcObject instanceof MediaStream);
 for(const media of document.querySelectorAll('audio,video'))if(!media.paused&&!media.ended&&!ambient(media)||media.srcObject instanceof MediaStream&&media.srcObject.getTracks().some(track=>track.readyState==='live'))return {safe:false,reason:'playing-media-or-live-stream'};
 return {safe:true};
}
// What the page check runs in the page: picture-in-picture and PDF (Chromium's discard_eligibility_policy.cc) on top of inspectPage. skipSelects: see inspectPage.
function sleepProbe(skipSelects){return `(()=>{if(document.pictureInPictureElement)return {safe:false,reason:'picture-in-picture'};if(document.contentType==='application/pdf')return {safe:false,reason:'pdf'};return (${inspectPage.toString()})(${skipSelects===true});})()`;}
// 13.5: the page preload (desktop/page-input-preload.cjs) records whether the person ever touched a drop-down in this document. It lives in Electron's isolated world 999 (the
// world of contextIsolation preloads), out of reach of the page's scripts. Anything but a clear {touched:false} (no preload, a page that never ran it, an error, a slow page) is "unknown".
const SELECT_WORLD=999;
const SELECT_RECORD="(()=>{const record=window.__aciraSelectRecord;return record&&record.v===1&&typeof record.touched==='boolean'?{touched:record.touched,nav:String(record.nav||''),baseline:record.baseline===true}:null;})()";
/** The page check for a live page (webContents): inspectPage in the page itself, and, only when a drop-down differs from its default, whether the page's own script put it there.
 *  A select the person never touched (no trusted change, key, pointer or click on a select since the document began) is not an edit: the check runs again without the selects.
 *  The document must have been reached by an ordinary navigation, or by Back / Forward when it is the page Acira restored itself on waking a tab (appRestored): after a person's own Back, Reload or
 *  anything unknown Chromium may have put an earlier choice of theirs back into a drop-down. Everything else is as before, and every doubt keeps the tab awake: the record unreadable, touched or of
 *  an unknown kind, or any other reason found. Rejects when the page does not answer in `ms`. */
async function inspectLive(wc,ms=1500,appRestored=false){
 const within=promise=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('slow')),ms);})]).finally(()=>clearTimeout(timer));};
 const untouched=()=>within(Promise.resolve().then(()=>wc.executeJavaScriptInIsolatedWorld(SELECT_WORLD,[{code:SELECT_RECORD}]))).then(value=>Boolean(value)&&value.touched===false&&(value.nav==='navigate'||appRestored===true&&value.nav==='back_forward'),()=>false);
 let found=await within(Promise.resolve(wc.executeJavaScript(sleepProbe(false))));
 // Only a drop-down that differs from its default asks about the record (every other page costs nothing extra). The second pass leaves the drop-downs out, so the record is read again
 // alongside it: if the document was replaced in between, the new one must be trusted too.
 if(found&&found.safe===false&&found.select===true&&await untouched()){const [second,again]=await Promise.all([within(Promise.resolve(wc.executeJavaScript(sleepProbe(true)))),untouched()]);if(again)found=second;}
 return found;
}
module.exports={underPressure,inspectPage,sleepProbe,inspectLive,SELECT_WORLD,SELECT_RECORD,createTabSleep,memorySaverChoice,normalizeSite,neverSleeps,stayAwakeKind,KEEP_ALIVE,DEFAULTS,IDLE_CHOICES};
