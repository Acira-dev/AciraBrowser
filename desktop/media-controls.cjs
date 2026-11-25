'use strict';
const {createUnseenMediaGate}=require('./unseen-media-gate.cjs');
const {MEDIA_LIST,withAll}=require('./media-list.cjs');
// Which elements have sound (Beta 14.2, D129; Chromium: WebMediaPlayerImpl::HasUnmutedAudio, "pretend that the media has no audio if it never played unmuted", and MediaSessionController::IsMediaSessionNeeded: a player takes part in the media session only
// when it has audio). In the page: an element is marked (symbol acira.audible) the first time it is seen unmuted with a volume above 0 and keeps the mark, as Chromium keeps "has been audible"; one whose decoder has produced no audio after a
// second of play (a video file with no audio track) has none. `loud(e)` is that test and `sel(list)` the elements with sound, or, when none of them has any, the list as it is: a page whose elements are all silent (a video the person
// muted) is read exactly as before, and so is any page whose elements all have sound. Only a mix (a song and a muted looping clip beside it) is told apart.
const SOUND="const AUD=Symbol.for('acira.audible'),loud=e=>{try{if(!e.muted&&e.volume>0)e[AUD]=true;if(!e[AUD])return false;const p=e.played;return !(e.webkitAudioDecodedByteCount===0&&p&&p.length>0&&p.end(p.length-1)>1);}catch{return true;}},sel=l=>{const s=l.filter(loud);return s.length?s:l;};";
// Media controls (Zen idea 9: several media controls at once in the sidebar footer). Which tabs have media worth a control,
// and play/pause for them.
//
// A tab gets `media: 'playing'` while a page is playing sound (or is muted by the person), and `media: 'paused'` once it was
// and stopped, so a control you paused from the sidebar can resume there. A silent autoplay video never gets one. The state
// travels as an ordinary tab update (`send({media})`, the reducer keeps it, a restart forgets it). A paused control goes away
// after ten minutes, and with a navigation or the tab. The page is asked to play or pause with two fixed scripts (no page data
// goes into them), run in every frame of the tab with a user gesture, so an embedded player works too.
const PAUSED_KEEP_MS=10*60*1000,MAX_FRAMES=16;
// Every media element of the page, attached or not (Beta 14.1, Spotify's web player): media-list.cjs. Every script below that looks for media runs through withAll, which puts the list where the
// script asks the document for its media.
// Chromium's rule (content::MediaSessionImpl::DidReceiveAction / SeekTo): when the page registered a handler for the action, the action goes to the page's handler (the player's own state
// machine: Spotify, YouTube, Twitch keep it); only when it did not, the media elements are driven directly. A handler that throws falls through to the elements. The handler is called as the
// page's media key would call it, with a user gesture (the script runs with one), and with `this` the page's own MediaSession.
// Pause: only a frame that is playing something (an element, or a session that says it plays) calls its handler; marks what was playing, so Play and the card go back to exactly that.
const PAUSE_BODY="const mark=Symbol.for('acira.paused'),note=window[Symbol.for('acira.mediaSession')]||null,all=document.querySelectorAll('video,audio'),going=[...all].filter(el=>!el.paused&&!el.ended);let state='';try{state=navigator.mediaSession.playbackState;}catch{}"
 +"const h=note&&note.handlers&&note.handlers.pause;if(typeof h==='function'&&(going.length||state==='playing')){for(const el of going)el[mark]=true;try{h.call(navigator.mediaSession,{action:'pause'});return Math.max(1,going.length);}catch{}}"
 +"let n=0;for(const el of going){try{el.pause();el[mark]=true;n++;}catch{}}";
/** The play script. `lead` is the frame the card follows (the one that had the sound, entry.frame, or any frame while none is known): there a page that registered `play` is also asked when its player has moved on to a track
 *  it has not started (a session with metadata that does not say it plays: Spotify after a track ended); once the card's frame is known, every other frame gets the strict one (PLAY_OTHER_SCRIPT): asked only for media that
 *  stopped, so an embedded player's frame is not started by a Play meant for the card's own. */
const playScript=lead=>withAll("(()=>{"+SOUND+"const mark=Symbol.for('acira.paused'),note=window[Symbol.for('acira.mediaSession')]||null;const all=[...document.querySelectorAll('video,audio')];let state='',md=null;try{state=navigator.mediaSession.playbackState;md=navigator.mediaSession.metadata;}catch{}"
 +"const h=note&&note.handlers&&note.handlers.play;if(typeof h==='function'&&!sel(all).some(el=>!el.paused&&!el.ended)&&(all.some(el=>el.paused&&!el.ended&&(el[mark]||el.currentTime>0))||("+(lead?"md&&state!=='playing'":"!all.length&&md&&state!=='playing'")+"))){for(const el of all)el[mark]=false;try{h.call(navigator.mediaSession,{action:'play'});return 1;}catch{}}"
 +"let list=all.filter(el=>el[mark]&&el.paused);if(!list.length)list=all.filter(el=>el.paused&&!el.ended&&el.currentTime>0).slice(0,1);let n=0;for(const el of list){try{el[mark]=false;const p=el.play();if(p&&p.catch)p.catch(()=>{});n++;}catch{}}return n;})()");
const PLAY_OTHER_SCRIPT=playScript(false);
const SCRIPTS={
 // Pauses everything that is playing and marks what it paused, so Play resumes exactly that.
 pause:withAll("(()=>{"+PAUSE_BODY+"return n;})()"),
 // Resumes what Pause stopped, else the first paused media element that had started. A page that registered `play` is asked through it when nothing in this frame plays and the frame has media that stopped,
 // or no media at all but a session (metadata) that does not say it is playing; a frame with a play handler but no content (an ad frame) is left alone, and so is a track that is already playing.
 play:playScript(true),
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
// Beta 14.1: an element that is not in the document is reached too (MEDIA_LIST above), and the hook also goes into the page's note (`note.hooks`, called when `play()` is called on an
// element): a detached element never sees the document's capture `play` listener, since its events do not reach the document.
const VOLUME_KEY="Symbol.for('acira.volume')";
const roundLevel=value=>{const n=Number(value);return Number.isFinite(n)?Math.round(Math.min(1,Math.max(0,n))*100)/100:0;};
/** Sets `level` on the frame's media elements: all of them when the person moved the slider (`all`), else only ones not given a level yet. */
const volumeScript=(level,all)=>withAll(`(()=>{const v=${roundLevel(level)},all=${all?'true':'false'},key=${VOLUME_KEY};let s=window[key];if(!s){s={v,seen:new WeakSet()};try{Object.defineProperty(window,key,{value:s});}catch{return -1;}document.addEventListener('play',e=>{const el=e.target;if(!(el instanceof HTMLMediaElement)||s.seen.has(el))return;s.seen.add(el);try{el.volume=s.v;}catch{}},true);try{const note=window[Symbol.for('acira.mediaSession')];if(note&&Array.isArray(note.hooks))note.hooks.push(el=>{if(s.seen.has(el))return;s.seen.add(el);try{el.volume=s.v;}catch{}});}catch{}}s.v=v;let n=0;for(const el of document.querySelectorAll('video,audio')){if(!all&&s.seen.has(el))continue;s.seen.add(el);try{el.volume=v;n++;}catch{}}return n;})()`);
/** The level the page plays at now: the loudest playing element, else the loudest element, else -1. */
const VOLUME_READ=withAll("(()=>{"+SOUND+"let playing=-1,any=-1;for(const el of sel([...document.querySelectorAll('video,audio')])){const v=Number(el.volume);if(!Number.isFinite(v))continue;if(!el.paused&&!el.ended)playing=Math.max(playing,v);any=Math.max(any,v);}return playing>=0?playing:any;})()");


// Beta 14, the now-playing card: what is playing (title, artist, artwork, position, live or not, picture in picture), and the
// card's controls. All fixed scripts, run in the page's frames like the ones above; the only things put into them are numbers main
// has checked (a second, a direction). The page's own words come back as data and are cleaned in main (cleanInfo) before the
// card sees them. Previous / Next and Seek call the handler the page registered for a media key (browser-services/
// media-session-preload.cjs notes them), else step 10 seconds; Seek asks the page's `seekto` handler, else sets the element's time (Chromium's rule, see PAUSE_BODY above); Picture in picture asks the page's biggest
// video, with a user gesture, as the video's own right-click menu does.
// The length and the position are the page's own declaration first (Beta 14.2, D129; Chromium's rule: content::MediaSessionImpl::RebuildAndNotifyMediaPositionChanged takes the position blink has from setPositionState and only
// without one the single player's), carried on by the clock (the page note keeps blink's state, browser-services/media-session-preload.cjs), and the media element's own only when the page declared none. The element the card
// follows (PICK) is one with sound before a silent one (SOUND above): Spotify's signed-in player plays a muted looping clip of about 8 seconds beside the song, and the card used to read that clip's length and position.
// A page that declares a position but never says whether it plays (playbackState 'none': Chromium's clock then runs on whether or not the media stops) is held to the media: with the element in reach and its length the declared one (within a second) the card
// reads the element's own time; with another length the declared position runs only while that element plays, is held from the moment it is first seen paused and goes on after a resume; a newer declaration always wins. The declared LENGTH is always trusted.
// Of several playing elements with sound of the same picture size (none, for audio) the card follows the longest (a stream counts as the longest), not the one whose play() was called last (Beta 14.4, D129 recheck): a short sound that plays beside a track (a few seconds) is not the track, and with no declared position it used to give the card its few seconds.
// A page whose element cannot be found (not in the document, never played through play()) still shows what its media session says: its metadata and that position.
const PICK=withAll(SOUND+"const note=window[Symbol.for('acira.mediaSession')]||null,mark=Symbol.for('acira.paused'),all=[...document.querySelectorAll('video,audio')],area=e=>(e.videoWidth||0)*(e.videoHeight||0),len=e=>e.duration===Infinity?1e12:Number.isFinite(e.duration)?e.duration:0,seen=all.filter(e=>(!e.paused&&!e.ended)||e[mark]||(e.readyState>0&&!e.ended&&e.currentTime>0)),over=all.filter(e=>e.ended&&e.currentTime>0&&loud(e)),use=seen.length&&over.length&&!seen.some(loud)?over:sel(seen),going=use.filter(e=>!e.paused&&!e.ended),held=use.filter(e=>e[mark]),rest=use.filter(e=>e.readyState>0&&!e.ended&&e.currentTime>0),pool=going.length?going:held.length?held:rest.length?rest:use===over?over:[],el=pool.length?pool.reduce((a,b)=>area(b)>area(a)||(area(b)===area(a)&&len(b)>len(a))?b:a):null;");
const INFO_SCRIPT="(()=>{"+PICK+"let md=null;try{md=navigator.mediaSession&&navigator.mediaSession.metadata;}catch{}const s=(v,n)=>typeof v==='string'?v.slice(0,n):'',fin=n=>Number.isFinite(n)?n:null,art=[];try{for(const a of(md&&md.artwork)||[]){if(art.length<8&&a&&typeof a.src==='string'&&a.src.length<=(a.src.startsWith('data:')?8000:2048))art.push({src:a.src,sizes:s(a.sizes,64)});}}catch{}let og='';try{for(const m of document.querySelectorAll('meta')){const k=m.getAttribute('property')||m.getAttribute('name'),c=m.content;if(c&&(k==='og:image'||k==='og:image:url'||k==='twitter:image')){og=new URL(c,document.baseURI).href;break;}}}catch{}const poster=el&&el.poster?s(el.poster,2048):'';const pos=note&&note.position,h=note?note.handlers:{};let ps='';try{ps=navigator.mediaSession.playbackState;}catch{}const sp=pos&&Number.isFinite(pos.duration)&&Number.isFinite(pos.position)?pos:null,sessionAt=()=>{if(!sp)return null;const eff=ps==='paused'?0:Number.isFinite(sp.rate)?sp.rate:1,t=sp.position+(Number.isFinite(sp.at)?Math.max(0,Date.now()-sp.at)/1000*eff:0);return t<=0?0:t>=sp.duration?sp.duration:t;},dr=sp&&Number.isFinite(sp.declared)&&sp.declared?sp.declared:(sp&&Number.isFinite(sp.rate)&&sp.rate?sp.rate:1),ed=el?el.duration:NaN,lv=(!!el&&el.duration===Infinity)||(!!pos&&pos.duration===Infinity),HOLD=Symbol.for('acira.held'),ge=el||over[0],unsure=!!sp&&!!ge&&ps!=='playing'&&ps!=='paused',heldAt=()=>{if(Number.isFinite(ge.duration)&&Math.abs(ge.duration-sp.duration)<=1)return fin(ge.currentTime);const now=Date.now(),run=!ge.paused&&!ge.ended,rate=Number.isFinite(sp.declared)&&sp.declared?sp.declared:1;let H=ge[HOLD];const fresh=!H||H.decl!==sp.at||H.dp!==sp.position;if(fresh)H={decl:sp.at,dp:sp.position,pos:sp.position,at:Number.isFinite(sp.at)?sp.at:now,run:run};if(H.run)H.pos+=Math.min(fresh?1e9:3000,Math.max(0,now-H.at))/1000*rate;H.at=now;H.run=run;ge[HOLD]=H;return H.pos<=0?0:H.pos>=sp.duration?sp.duration:H.pos;};let pip='none';try{if(document.pictureInPictureElement)pip='active';else if(el&&el.tagName==='VIDEO'&&document.pictureInPictureEnabled&&!el.disablePictureInPicture&&el.videoWidth>0)pip='available';}catch{}return{has:!!el||!!md,element:!!el,playing:el?!el.paused&&!el.ended:ps==='playing',title:md?s(md.title,300):'',artist:md?s(md.artist,200):'',album:md?s(md.album,200):'',art,og:s(og,2048),poster,duration:lv?null:sp?sp.duration:Number.isFinite(ed)?ed:null,position:sp?(unsure?heldAt():sessionAt()):el?fin(el.currentTime):null,rate:sp?dr:el?(fin(el.playbackRate)||1):1,live:lv,volume:el?fin(el.volume):null,pip,prev:typeof h.previoustrack==='function',next:typeof h.nexttrack==='function'};})()";
const clampSeconds=value=>{const n=Number(value);return Number.isFinite(n)?Math.round(Math.min(1e7,Math.max(0,n))*100)/100:0;};
/** Asks the page's own `seekto` handler (Chromium's rule: a page that registered one owns its seeking; Spotify's player keeps its buffers and its position), else sets the media element's time. */
const seekScript=seconds=>`(()=>{${PICK}const t=${clampSeconds(seconds)};const h=note&&note.handlers.seekto;if(typeof h==='function'){try{h.call(navigator.mediaSession,{action:'seekto',seekTime:t,fastSeek:false});return true;}catch{}}if(el&&Number.isFinite(el.duration)){try{el.currentTime=Math.min(t,el.duration);return true;}catch{}}return false;})()`;
/** Previous / Next: the page's handler (a playlist's own step), else 10 seconds back or forward. */
const skipScript=direction=>`(()=>{${PICK}const d=${direction<0?-1:1},name=d<0?'previoustrack':'nexttrack',h=note&&note.handlers[name];if(typeof h==='function'){try{h.call(navigator.mediaSession,{action:name});return 'handler';}catch{}}if(el&&Number.isFinite(el.duration)){try{el.currentTime=Math.max(0,Math.min(el.duration,el.currentTime+d*10));return 'step';}catch{}}return false;})()`;
/** Picture in picture: out when the page has the video in the small window, else the biggest video goes in. */
const PIP_SCRIPT="(async()=>{"+PICK+"try{if(document.pictureInPictureElement){await document.exitPictureInPicture();return 'inactive';}if(el&&el.tagName==='VIDEO'&&document.pictureInPictureEnabled&&!el.disablePictureInPicture&&el.videoWidth>0){try{if(note&&typeof note.pipDefaults==='function')note.pipDefaults(el);}catch{}await el.requestPictureInPicture();return 'active';}}catch{return 'error';}return 'unavailable';})()";
/** Close (x) on the card: stop this sound. Pauses everything playing and brings a popped-out video back first. */
const STOP_SCRIPT=withAll("(()=>{try{if(document.pictureInPictureElement)document.exitPictureInPicture().catch(()=>{});}catch{}"+PAUSE_BODY+"return n;})()");
// Short sounds (Beta 14.0, the mini player): a chime, a notification ding or a click is not something to "play, pause or skip", and a card that flashed in for it and then sat there paused for ten minutes would be noise.
// A sound whose media element is in the page and is shorter than SHORT_MS never gets a card; a sound the page makes from a script (`new Audio()`, not in the document) cannot be measured, so its card waits GRACE_MS
// (a ding is over by then); and a sound that stops by itself within SHORT_MS of beginning leaves no paused card behind. A person's own pause (the card's, the volume's mute) is never taken for the end of a sound.
const SHORT_MS=3000,GRACE_MS=1000,LENGTH_MS=500;
/** What is playing in this frame: how many media elements, and whether every one of them is shorter than SHORT_MS (a finite duration; a stream or an unknown length is long). */
const LENGTH_SCRIPT=withAll("(()=>{let n=0,short=0;for(const el of document.querySelectorAll('video,audio'))if(!el.paused&&!el.ended){n++;const d=Number(el.duration);if(Number.isFinite(d)&&d>0&&d<"+SHORT_MS/1000+")short++;}return {n,short};})()");
/** How many media elements with sound are playing in this frame (Beta 14.4, D182): Chromium says "paused" for one element at a time, and a player that swaps its element at a track change (Spotify) can pause the old one after the new one has begun. */
const PLAYING_SCRIPT=withAll("(()=>{"+SOUND+"return sel([...document.querySelectorAll('video,audio')]).filter(e=>!e.paused&&!e.ended).length;})()");
const PLAY_CHECK_MS=500;
const READ_MS=1800;
const withTimeout=(promise,ms=READ_MS)=>Promise.race([promise,new Promise(resolve=>{const t=setTimeout(resolve,ms,undefined);t.unref?.();})]);
/** What a frame said, made safe for the card: fixed keys, plain values, lengths and ranges held. A page's words are data. */
function cleanInfo(raw){
 const o=raw&&typeof raw==='object'?raw:{},text=(v,n)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g,' ').trim().slice(0,n):'',num=(v,lo,hi)=>typeof v==='number'&&Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):null,web=v=>typeof v==='string'&&/^https?:\/\//i.test(v.trim())&&v.trim().length<=2048?v.trim():'';
 const live=o.live===true,duration=live?null:num(o.duration,0,1e7),pip=o.pip==='active'||o.pip==='available'?o.pip:'none';
 return {has:o.has===true,element:o.element===true,playing:o.playing===true,title:text(o.title,300),artist:text(o.artist,200),album:text(o.album,200),
  art:(Array.isArray(o.art)?o.art:[]).filter(a=>a&&typeof a.src==='string').slice(0,8).map(a=>({src:a.src,sizes:text(a.sizes,64)})),
  /* where the page's own address and its other pictures are, for an artwork the media session does not name (media-artwork.cjs candidates): web addresses only */
  page:web(o.page),og:web(o.og),poster:web(o.poster),
  duration:duration&&duration>0?duration:null,position:num(o.position,0,1e8),rate:num(o.rate,.0625,16)||1,live,volume:num(o.volume,0,1),pip,prev:o.prev===true,next:o.next===true};
}
/** The card's main sound: the latest to begin (`mediaAt`); pausing does not demote it. The same rule as src/ui/mediaRows.ts mainMediaTab (tests/now-playing-main.test.ts holds them together). */
function mainMediaTab(tabs){
 let top=null;
 for(const tab of Array.isArray(tabs)?tabs:[]){if(tab.media!=='playing'&&tab.media!=='paused')continue;if(!top||(tab.mediaAt??0)>=(top.mediaAt??0))top=tab;}
 return top;
}
let lastStamp=0;
/** A "this sound began" stamp that never repeats, so two tabs that start in one millisecond still have an order. */
const nextStamp=(clock=Date.now)=>{lastStamp=Math.max(clock(),lastStamp+1);return lastStamp;};

function createMediaControls({keep=PAUSED_KEEP_MS,artwork=null,clock=Date.now,gate:gateOption=null,note=()=>{},popped:onPopped=()=>{}}={}){
 const entries=new Map(),levels=new Map();
 const framesOf=wc=>{try{return [...(wc.mainFrame.framesInSubtree||[wc.mainFrame])].slice(0,MAX_FRAMES);}catch{return [];}};
 /** Section Q: a page nobody has looked at yet does not start playing (desktop/unseen-media-gate.cjs). */
 const gate=gateOption||createUnseenMediaGate({framesOf,note});
 async function applyVolume(wc,level,all){
  if(!wc||wc.isDestroyed?.())return 0;
  const done=await Promise.allSettled(framesOf(wc).map(frame=>frame.executeJavaScript(volumeScript(level,all),false)));
  return done.reduce((n,item)=>n+(item.status==='fulfilled'&&Number(item.value)>0?Number(item.value):0),0);
 }
 /** Called once per page view (ensurePage): follows its media events. `send` is the tab's state sender, `muted()` says whether the person muted it. */
 function attach(tabId,wc,send,{muted=()=>false,unseen=()=>false}={}){
  const entry={wc,pausing:0,playing:false,audible:false,seen:false,shown:null,timer:null,startedAt:0,frame:null,inheritAt:0,offs:[],hold:false,began:0,byPerson:false,kind:'long',judging:0,graceTimer:null};
  // A page that changes owner keeps what it was doing (Discord, EDICT, 19 Nov: a video playing in a link preview became a tab and the card never came, because Chromium
  // said "started playing" once, long before this tab existed). The earlier owner of the same page (the preview's own entry) hands over what it knew, and stops listening.
  let prior=null;for(const [otherId,other] of entries)if(otherId!==tabId&&other.wc===wc){prior=other;break;}
  if(prior){entry.playing=prior.playing;entry.audible=prior.audible;entry.seen=prior.seen;entry.inheritAt=prior.startedAt||0;prior.detach?.();}
  entries.set(tabId,entry);
  const on=(name,fn)=>{wc.on(name,fn);entry.offs.push(()=>{try{wc.removeListener(name,fn);}catch{/* the page is gone */}});};
  const set=value=>{
   if(entry.shown===value)return;const before=entry.shown;entry.shown=value;clearTimeout(entry.timer);
   // The moment a sound begins (or resumes) is sent with the state: the card's main one is the latest to begin, pausing does not demote it.
   // A page handed over by another owner keeps the stamp it began with, so the card does not jump to the front when a preview becomes a tab.
   try{if(value==='playing'&&before!=='playing'){const at=entry.inheritAt||nextStamp(clock);entry.inheritAt=0;send({media:value,mediaAt:entry.startedAt=at});}else send({media:value});}catch{}
   if(value==='paused'){entry.timer=setTimeout(()=>set(null),keep);entry.timer?.unref?.();}
  };
  const refresh=()=>{
   const loud=entry.audible||Boolean(muted());
   if(entry.hold&&!entry.seen){set(null);return;}      // a sound that has not shown it is long enough yet (judge below)
   if(entry.playing&&loud){entry.seen=true;set('playing');}
   else if(entry.playing)set(entry.seen?'playing':null);      // a silent stretch in a track keeps its row; a silent video never gets one
   else set(entry.seen?'paused':null);
  };
  /** A sound has just begun: measure it, and decide whether it earns a card (see SHORT_MS above). Fails open: a page that does not answer, or answers in another shape, shows its card at once. */
  async function judge(){
   const turn=++entry.judging,open=()=>{if(turn===entry.judging){entry.hold=false;refresh();}};
   // The first frame that has a long element opens the card at once; the others (an ad frame that does not answer) are waited for only when nothing long has been found.
   const answers=[];let longFound=false;
   try{await Promise.all(framesOf(wc).map(frame=>withTimeout(frame.executeJavaScript(LENGTH_SCRIPT,false),LENGTH_MS).then(a=>{answers.push(a);if(!longFound&&a&&typeof a==='object'&&a.n>0&&(Number(a.short)||0)<a.n){longFound=true;open();}}).catch(()=>{})));}catch{open();return;}
   if(longFound||turn!==entry.judging||entry.seen||!entry.playing)return;
   const found=answers.filter(a=>a&&typeof a==='object'&&Number.isFinite(a.n));if(!found.length){open();return;}      // no usable answer: no hold
   const n=found.reduce((sum,a)=>sum+a.n,0),short=found.reduce((sum,a)=>sum+(Number(a.short)||0),0);
   if(n>0&&short===n)return;                                                                                       // every playing element is a short sound: never a card (the hold stays)
   if(n===0){                                                                                                      // a sound no element in the page explains: it waits a moment
    entry.kind='unknown';clearTimeout(entry.graceTimer);
    entry.graceTimer=setTimeout(()=>{if(turn!==entry.judging||!entry.playing)return;entry.hold=false;refresh();},GRACE_MS);entry.graceTimer?.unref?.();
    return;
   }
   open();                                                                                                           // a long sound: its card, with no wait
  }
  const reset=()=>{entry.pausing++;entry.playing=false;entry.audible=false;entry.seen=false;entry.frame=null;entry.inheritAt=0;entry.hold=false;entry.judging++;clearTimeout(entry.graceTimer);set(null);};
  entry.dismiss=reset;entry.refresh=refresh;
  /** This owner stops following the page (it became a tab, or the preview closed): no listener stays, no card, the entry is gone. */
  entry.detach=()=>{for(const off of entry.offs.splice(0))off();clearTimeout(entry.timer);clearTimeout(entry.graceTimer);entry.judging++;entry.pausing++;entry.playing=false;entry.audible=false;entry.seen=false;entry.inheritAt=0;try{set(null);}catch{}if(entries.get(tabId)===entry)entries.delete(tabId);};
  // A tab with a level keeps it: a new document or frame gets the hook, and an element that starts is given the level if new.
  const reapply=()=>{const level=levels.get(tabId);if(level!==undefined)void applyVolume(wc,level,false);};
  on('dom-ready',reapply);on('did-frame-finish-load',reapply);
  // A page nobody has looked at yet (section Q): what starts is paused at once and kept for the first visit (seen() below); it is neither "playing" nor given a card.
  on('media-started-playing',()=>{note({k:'started',tab:tabId,unseen:unseen()});if(unseen()){void gate.hold(tabId,wc);return;}entry.pausing++;entry.playing=true;if(!entry.seen){entry.began=clock();entry.byPerson=false;entry.kind='long';entry.hold=true;void judge();}refresh();reapply();});
  // Chromium says "paused" for ONE media element. A page that swaps its element at a track change (Spotify) can pause the old one after the new one has begun, and the tab is then not paused: before the card, the row
  // and the chip are told "paused", the page's frames are asked whether an element with sound still plays (PLAYING_SCRIPT) while the tab is still audible; if one does, nothing changed. Otherwise this is the pause it always was.
  const stillPlays=async()=>{
   if(!wc||wc.isDestroyed?.())return false;
   const answers=await Promise.all(framesOf(wc).map(frame=>withTimeout(Promise.resolve().then(()=>frame.executeJavaScript(PLAYING_SCRIPT,false)),PLAY_CHECK_MS).catch(()=>0)));
   return answers.some(value=>Number(value)>0);
  };
  const settlePause=()=>{entry.playing=false;entry.judging++;clearTimeout(entry.graceTimer);entry.hold=false;
   // A sound no element in the page explains (a script's `new Audio()`) that stopped by itself within SHORT_MS of beginning (a chime long enough to show) leaves no paused card. Media in the page, however briefly it played, is paused, not gone; so is a pause the person made.
   if(entry.shown==='playing'&&entry.kind==='unknown'&&!entry.byPerson&&clock()-entry.began<SHORT_MS){entry.seen=false;set(null);return;}
   refresh();};
  on('media-paused',()=>{note({k:'media-paused',tab:tabId,unseen:unseen()});const turn=++entry.pausing;
   if(!entry.audible){settlePause();return;}      // nothing is coming out of the tab (Chromium's own word): it is a pause, at once, as it always was
   stillPlays().then(yes=>{if(turn!==entry.pausing)return;if(yes){note({k:'media-paused-another-plays',tab:tabId});if(entry.playing)return;entry.playing=true;refresh();return;}settlePause();}).catch(()=>{if(turn===entry.pausing)settlePause();});});
  on('audio-state-changed',event=>{if(unseen())return;entry.audible=Boolean(event?.audible);refresh();});
  // A new page in the tab ends its media; a hash change or a pushState does not.
  on('did-start-navigation',(event,_url,inPlace,isMainFrame)=>{if((event?.isMainFrame??isMainFrame)&&!(event?.isSameDocument??inPlace))reset();});
  // A page whose process crashed or was killed plays nothing, and a card for it would sit there paused with buttons that do nothing: it goes (Beta 14.0, the mini player).
  on('render-process-gone',()=>reset());
  wc.once('destroyed',()=>{clearTimeout(entry.timer);gate.forget(tabId);if(entries.get(tabId)===entry)entries.delete(tabId);});
  // What the page was already doing when this owner began: handed over (above), else a sound that is audible now. Never for a page nobody has looked at yet.
  try{if(!prior&&!unseen()&&wc.isCurrentlyAudible?.()){entry.playing=true;entry.audible=true;}}catch{}
  if(entry.playing||entry.seen)refresh();
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
  if(action==='stop')return stop(tabId);
  const entry=entries.get(tabId),wc=entry?.wc;
  if(!entry||!wc||wc.isDestroyed())return false;
  const which=action==='toggle'?(entry.playing?'pause':'play'):action;
  if(which==='pause')entry.byPerson=true;
  if(!Object.hasOwn(SCRIPTS,which))return false;
  const frames=framesOf(wc);if(!frames.length)return false;
  const lead=entry.frame;      // the frame the card follows (its last info answer); none known yet: every frame is treated as the card's
  const done=await Promise.allSettled(frames.map(frame=>frame.executeJavaScript(which==='play'&&lead&&frame!==lead?PLAY_OTHER_SCRIPT:SCRIPTS[which],true)));
  return done.some(item=>item.status==='fulfilled'&&Number(item.value)>0);
 }
 /** Every frame's answer to a fixed script, each held to `READ_MS`; with `only`, just that frame's. */
 async function ask(entry,script,gesture=false,only=null){
  const wc=entry.wc;if(!wc||wc.isDestroyed?.())return [];
  const frames=only?[only]:framesOf(wc);
  return Promise.all(frames.map(async frame=>{try{return {frame,value:await withTimeout(frame.executeJavaScript(script,gesture),READ_MS)};}catch{return {frame,value:undefined};}}));
 }
 /** The frame that has the sound: one with a media element that is playing, else one that has an element, else one with only metadata. */
 const rank=info=>info.playing?3:info.element?2:info.has?1:0;
 function best(answers){
  let top=null;
  for(const {frame,value} of answers){if(!value||typeof value!=='object')continue;const info=cleanInfo(value);if(!info.has)continue;if(!top||rank(info)>rank(top.info))top={frame,info};}
  return top;
 }
 /** What the card shows for a tab. `have` is the artwork address the card already holds: its picture is sent only when it differs. Resolves null when nothing answers. */
 async function info(tabId,{have}={}){
  const entry=entries.get(tabId);if(!entry)return null;
  // The frame that was playing last time is asked first, alone: a page with many frames (ads) is not asked in full once a second.
  let answers=entry.frame&&framesOf(entry.wc).includes(entry.frame)?await ask(entry,INFO_SCRIPT,false,entry.frame):[];
  if(!(answers[0]?.value&&answers[0].value.playing&&answers[0].value.element))answers=await ask(entry,INFO_SCRIPT);
  const top=best(answers);
  // A popped-out video may live in another frame than the one that is playing: any frame that says so makes it active.
  const popped=answers.some(({value})=>value&&value.pip==='active');
  if(!top)return popped?{...cleanInfo({}),pip:'active',artSrc:null,art:null}:null;
  entry.frame=top.frame;
  const result={...top.info};
  try{result.page=/^https?:\/\//i.test(top.frame?.url||'')?String(top.frame.url).slice(0,2048):'';}catch{result.page='';}   // the playing frame's address, from main (the page is not asked for it)
  if(popped)result.pip='active';
  // The card's picture: what the media session names, else the video's own thumbnail, else the page's og:image or the video's poster (artworkCandidates).
  // Each is tried in turn within one answer, so a dead address (a missing maxres thumbnail) moves on at once; one still coming is waited for by the card.
  let artSrc=null,artData=null;
  if(artwork&&typeof artwork.candidates==='function'&&typeof artwork.settle==='function'){
   const session=entry.wc.session,partition=session?.storagePath||'';let budget=1600;
   for(const candidate of artwork.candidates(result)){
    const t0=Date.now();let got=null;try{got=await artwork.settle(session,partition,candidate,Math.max(250,budget));}catch{got=null;}
    budget-=Date.now()-t0;
    if(got&&got!=='pending'){artSrc=candidate;artData=got;break;}
    if(got==='pending'){artSrc=candidate;break;}
   }
  }else if(artwork){
   artSrc=artwork.pick(result.art);
   if(artSrc){try{artData=artwork.peek(entry.wc.session,entry.wc.session?.storagePath||'',artSrc);}catch{artData=null;}}
  }
  result.artSrc=artSrc;result.art=artSrc&&artSrc!==have?artData:null;
  return result;
 }
 /** Seek to a second. Live streams and pages with nothing to seek answer false. */
 async function seek(tabId,seconds){
  const entry=entries.get(tabId);if(!entry||typeof seconds!=='number'||!Number.isFinite(seconds))return false;
  const top=best(await ask(entry,INFO_SCRIPT));if(!top||top.info.live)return false;
  try{return (await withTimeout(top.frame.executeJavaScript(seekScript(seconds),true)))===true;}catch{return false;}
 }
 /** Previous (-1) or next (1): the page's own step, else ten seconds. Resolves 'handler', 'step' or false. */
 async function skip(tabId,direction){
  const entry=entries.get(tabId);if(!entry||(direction!==-1&&direction!==1))return false;
  const top=best(await ask(entry,INFO_SCRIPT));if(!top)return false;
  try{return (await withTimeout(top.frame.executeJavaScript(skipScript(direction),true)))||false;}catch{return false;}
 }
 /** Pop the video out, or bring it back. Resolves 'active', 'inactive', 'unavailable' or 'error'. */
 async function pip(tabId){
  const entry=entries.get(tabId);if(!entry)return 'unavailable';
  const answers=await ask(entry,INFO_SCRIPT),popped=answers.find(({value})=>value&&value.pip==='active'),top=popped?{frame:popped.frame}:best(answers);
  if(!top)return 'unavailable';
  try{const result=(await withTimeout(top.frame.executeJavaScript(PIP_SCRIPT,true),4000))||'error';if(result==='active'){try{onPopped(tabId);}catch{/* a Space flag that cannot be set changes nothing for the video */}}return result;}catch{return 'error';}
 }
 /** Close (x): the sound stops and the card goes; the next time the page starts a sound it comes back. */
 async function stop(tabId){
  const entry=entries.get(tabId),wc=entry?.wc;
  if(!entry||!wc||wc.isDestroyed?.())return false;
  const frames=framesOf(wc);
  entry.dismiss();
  const done=await Promise.allSettled(frames.map(frame=>withTimeout(frame.executeJavaScript(STOP_SCRIPT,true))));
  return done.some(item=>item.status==='fulfilled'&&Number(item.value)>0);
 }
 /** The tab's page was shown for the first time (main calls this from the layout): what the gate held starts, and a sound the page made that
  * could not be held (Web Audio) is picked up as the page's own. */
 async function seen(tabId){
  const entry=entries.get(tabId),wc=entry?.wc;
  note({k:'seen',tab:tabId,entry:!!entry});
  if(!entry||!wc||wc.isDestroyed?.())return 0;
  const started=await gate.release(tabId,wc);
  try{if(!entry.playing&&wc.isCurrentlyAudible?.()){entry.playing=true;entry.audible=true;entry.refresh();}}catch{}
  return started;
 }
 /** Closed tabs lose their level (main calls this with the window's tab ids). */
 function prune(live){const keep=new Set(live);for(const id of [...levels.keys()])if(!keep.has(id))levels.delete(id);}
 return {attach,command,info,seek,skip,pip,stop,prune,seen,holding:tabId=>gate.holding(tabId),level:tabId=>levels.get(tabId),state:tabId=>entries.get(tabId)?.shown??null,dispose(){for(const entry of entries.values())clearTimeout(entry.timer);entries.clear();levels.clear();}};
}
module.exports={PLAYING_SCRIPT,createMediaControls,mainMediaTab,nextStamp,SCRIPTS,PAUSED_KEEP_MS,volumeScript,VOLUME_READ,INFO_SCRIPT,PIP_SCRIPT,STOP_SCRIPT,seekScript,skipScript,cleanInfo,LENGTH_SCRIPT,PAUSE_BODY,MEDIA_LIST,PLAY_OTHER_SCRIPT,playScript};
