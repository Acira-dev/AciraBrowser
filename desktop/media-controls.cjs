'use strict';
// Media controls (Zen idea 9: several media controls at once in the sidebar footer). Which tabs have media worth a control,
// and play/pause for them.
//
// A tab gets `media: 'playing'` while a page is playing sound (or is muted by the person), and `media: 'paused'` once it was
// and stopped, so a control you paused from the sidebar can resume there. A silent autoplay video never gets one. The state
// travels as an ordinary tab update (`send({media})`, the reducer keeps it, a restart forgets it). A paused control goes away
// after ten minutes, and with a navigation or the tab. The page is asked to play or pause with two fixed scripts (no page data
// goes into them), run in every frame of the tab with a user gesture, so an embedded player works too.
const PAUSED_KEEP_MS=10*60*1000,MAX_FRAMES=16;
const SCRIPTS={
 // Pauses everything that is playing and marks what it paused, so Play resumes exactly that.
 pause:"(()=>{const mark=Symbol.for('acira.paused');let n=0;for(const el of document.querySelectorAll('video,audio'))if(!el.paused&&!el.ended){try{el.pause();el[mark]=true;n++;}catch{}}return n;})()",
 // Resumes what Pause stopped, else the first paused media element that had started.
 play:"(()=>{const mark=Symbol.for('acira.paused');const all=[...document.querySelectorAll('video,audio')];let list=all.filter(el=>el[mark]&&el.paused);if(!list.length)list=all.filter(el=>el.paused&&!el.ended&&el.currentTime>0).slice(0,1);let n=0;for(const el of list){try{el[mark]=false;const p=el.play();if(p&&p.catch)p.catch(()=>{});n++;}catch{}}return n;})()",
};

// Volume (founder, 27 Oct: the sidebar card's speaker turns the card into a volume slider). Electron has no per-tab volume, so
// the level is set on the tab's media elements, in every frame. The level is a number main rounds itself; no page data goes
// into the script. The first time, the script leaves a small hook in the frame's document (a capture `play` listener) that
// gives an element the level the first time it plays: a player added later, the next track's element. Once per element, and
// a later run only reaches elements not seen yet, so the site's own volume control keeps working: Acira sets the volume when
// the person moves the slider and when a new element appears, never in between, and never reads it back or resets it. A new
// document (a navigation in the tab, a frame that loads) gets the hook and the level again from main. Not reached: an element
// that is not in the document (a script's `new Audio()`), media inside a shadow root, and Web Audio graphs (a site's own gain).
// Levels are per tab and in memory (private and Tor tabs alike), dropped with the tab (prune). 0 is not a level here: the
// renderer mutes the tab (`tab.mute`, setAudioMuted), so the sound badge and the equaliser say so.
const VOLUME_KEY="Symbol.for('acira.volume')";
const roundLevel=value=>{const n=Number(value);return Number.isFinite(n)?Math.round(Math.min(1,Math.max(0,n))*100)/100:0;};
/** Sets `level` on the frame's media elements: all of them when the person moved the slider (`all`), else only ones not given a level yet. */
const volumeScript=(level,all)=>`(()=>{const v=${roundLevel(level)},all=${all?'true':'false'},key=${VOLUME_KEY};let s=window[key];if(!s){s={v,seen:new WeakSet()};try{Object.defineProperty(window,key,{value:s});}catch{return -1;}document.addEventListener('play',e=>{const el=e.target;if(!(el instanceof HTMLMediaElement)||s.seen.has(el))return;s.seen.add(el);try{el.volume=s.v;}catch{}},true);}s.v=v;let n=0;for(const el of document.querySelectorAll('video,audio')){if(!all&&s.seen.has(el))continue;s.seen.add(el);try{el.volume=v;n++;}catch{}}return n;})()`;
/** The level the page plays at now: the loudest playing element, else the loudest element, else -1. */
const VOLUME_READ="(()=>{let playing=-1,any=-1;for(const el of document.querySelectorAll('video,audio')){const v=Number(el.volume);if(!Number.isFinite(v))continue;if(!el.paused&&!el.ended)playing=Math.max(playing,v);any=Math.max(any,v);}return playing>=0?playing:any;})()";

function createMediaControls({keep=PAUSED_KEEP_MS}={}){
 const entries=new Map(),levels=new Map();
 const framesOf=wc=>{try{return [...(wc.mainFrame.framesInSubtree||[wc.mainFrame])].slice(0,MAX_FRAMES);}catch{return [];}};
 async function applyVolume(wc,level,all){
  if(!wc||wc.isDestroyed?.())return 0;
  const done=await Promise.allSettled(framesOf(wc).map(frame=>frame.executeJavaScript(volumeScript(level,all),false)));
  return done.reduce((n,item)=>n+(item.status==='fulfilled'&&Number(item.value)>0?Number(item.value):0),0);
 }
 /** Called once per page view (ensurePage): follows its media events. `send` is the tab's state sender, `muted()` says whether the person muted it. */
 function attach(tabId,wc,send,{muted=()=>false}={}){
  const entry={wc,playing:false,audible:false,seen:false,shown:null,timer:null};entries.set(tabId,entry);
  const set=value=>{
   if(entry.shown===value)return;entry.shown=value;clearTimeout(entry.timer);
   try{send({media:value});}catch{}
   if(value==='paused'){entry.timer=setTimeout(()=>set(null),keep);entry.timer?.unref?.();}
  };
  const refresh=()=>{
   const loud=entry.audible||Boolean(muted());
   if(entry.playing&&loud){entry.seen=true;set('playing');}
   else if(entry.playing)set(entry.seen?'playing':null);      // a silent stretch in a track keeps its row; a silent video never gets one
   else set(entry.seen?'paused':null);
  };
  const reset=()=>{entry.playing=false;entry.audible=false;entry.seen=false;set(null);};
  // A tab with a level keeps it: a new document or frame gets the hook, and an element that starts is given the level if new.
  const reapply=()=>{const level=levels.get(tabId);if(level!==undefined)void applyVolume(wc,level,false);};
  wc.on('dom-ready',reapply);wc.on('did-frame-finish-load',reapply);
  wc.on('media-started-playing',()=>{entry.playing=true;refresh();reapply();});
  wc.on('media-paused',()=>{entry.playing=false;refresh();});
  wc.on('audio-state-changed',event=>{entry.audible=Boolean(event?.audible);refresh();});
  // A new page in the tab ends its media; a hash change or a pushState does not.
  wc.on('did-start-navigation',(event,_url,inPlace,isMainFrame)=>{if((event?.isMainFrame??isMainFrame)&&!(event?.isSameDocument??inPlace))reset();});
  wc.once('destroyed',()=>{clearTimeout(entry.timer);if(entries.get(tabId)===entry)entries.delete(tabId);});
  return entry;
 }
 /** Play, pause or toggle for a tab. Resolves when every frame has answered; never throws (a page that refuses is just not moved). */
 /** The tab's volume: with a level (0..1) sets it and resolves with how many elements took it; without one resolves with the
  * level: what the page plays at now (the site's own control may have moved it since), else the one set here, else null. */
 async function volume(tabId,level){
  const entry=entries.get(tabId),wc=entry?.wc;
  if(level===undefined){
   const read=wc&&!wc.isDestroyed()?await Promise.allSettled(framesOf(wc).map(frame=>frame.executeJavaScript(VOLUME_READ,false))):[];
   const best=Math.max(-1,...read.map(item=>item.status==='fulfilled'&&Number.isFinite(Number(item.value))?Number(item.value):-1));
   return best>=0?roundLevel(best):levels.get(tabId)??null;
  }
  if(typeof level!=='number'||!Number.isFinite(level))return 0;
  const next=roundLevel(level);levels.set(tabId,next);
  return applyVolume(wc,next,true);
 }
 /** Play, pause or toggle for a tab. Resolves when every frame has answered; never throws (a page that refuses is just not moved). */
 async function command(tabId,action,level){
  if(action==='volume')return volume(tabId,level);
  const entry=entries.get(tabId),wc=entry?.wc;
  if(!entry||!wc||wc.isDestroyed())return false;
  const which=action==='toggle'?(entry.playing?'pause':'play'):action;
  if(!Object.hasOwn(SCRIPTS,which))return false;
  const frames=framesOf(wc);if(!frames.length)return false;
  const done=await Promise.allSettled(frames.map(frame=>frame.executeJavaScript(SCRIPTS[which],true)));
  return done.some(item=>item.status==='fulfilled'&&Number(item.value)>0);
 }
 /** Closed tabs lose their level (main calls this with the window's tab ids). */
 function prune(live){const keep=new Set(live);for(const id of [...levels.keys()])if(!keep.has(id))levels.delete(id);}
 return {attach,command,prune,level:tabId=>levels.get(tabId),state:tabId=>entries.get(tabId)?.shown??null,dispose(){for(const entry of entries.values())clearTimeout(entry.timer);entries.clear();levels.clear();}};
}
module.exports={createMediaControls,SCRIPTS,PAUSED_KEEP_MS,volumeScript,VOLUME_READ};
