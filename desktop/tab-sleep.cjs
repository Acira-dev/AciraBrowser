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
   const reason=await adapter.protectedReason(tab,choice);
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
 return {sweep,touch,frozen:id=>!!records.get(id)?.frozen};
}
/** Runs inside the page (serialised with toString): is it safe to close? Edited fields, credentials, editable/canvas pages and live media are not. */
function inspectPage(){
 const controls=document.querySelectorAll('input,textarea,select');if(controls.length>5000||document.getElementsByTagName('*').length>50000)return {safe:false,reason:'page-too-large'};
 if(document.designMode==='on'||document.querySelector('[contenteditable]:not([contenteditable="false"]),canvas'))return {safe:false,reason:'editable-or-canvas-content'};
 for(const element of controls){
  if(element.tagName==='INPUT'){if(element.type==='password'&&element.value||element.type==='file'&&element.files.length)return {safe:false,reason:'credential-or-file-input'};if(['checkbox','radio'].includes(element.type)){if(element.checked!==element.defaultChecked)return {safe:false,reason:'edited-form'};}else if(!['hidden','button','submit','reset','image','file'].includes(element.type)){const baseline=document.createElement('input');for(const name of ['type','min','max','step','value'])if(element.hasAttribute(name))baseline.setAttribute(name,element.getAttribute(name));if(element.value!==baseline.value)return {safe:false,reason:'edited-form'};}}
  else if(element.tagName==='TEXTAREA'&&element.value!==element.defaultValue)return {safe:false,reason:'edited-form'};
  else if(element.tagName==='SELECT'){const options=[...element.options],selected=options.filter(option=>option.selected).map(option=>option.index),defaults=options.filter(option=>option.defaultSelected).map(option=>option.index);if(!element.multiple&&!defaults.length&&options.length)defaults.push(0);if(JSON.stringify(selected)!==JSON.stringify(defaults))return {safe:false,reason:'edited-form'};}
 }
 for(const media of document.querySelectorAll('audio,video'))if(!media.paused&&!media.ended||media.srcObject instanceof MediaStream&&media.srcObject.getTracks().some(track=>track.readyState==='live'))return {safe:false,reason:'playing-media-or-live-stream'};
 return {safe:true};
}
module.exports={underPressure,inspectPage,createTabSleep,memorySaverChoice,normalizeSite,neverSleeps,KEEP_ALIVE,DEFAULTS,IDLE_CHOICES};
