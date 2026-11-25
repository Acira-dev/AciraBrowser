'use strict';
// Side panel sites (Beta 14, brief section AF): a pinned website opens in a panel over the page with one click, without a tab and without a tab switch.
//
// This is the window's HOST for those panels. What a site is (a saved address, name, icon, width, dock choice) lives on the profile and is decided in the
// interface's state (src/runtime/sidePanelSites.ts); this file holds the live pages and the surface they are shown on. It uses the way the extension side panel
// already puts a page above the page (browser-services/extension-side-panel.cjs, "do not add a third way"): TWO native views, a transparent Acira frame
// (side-panel-sites-frame.html: the card, its slim header, the veil) and the site's own page in the profile's own session, raised above the page views and below the popup
// layer. Differences, all from the brief:
//   - it FLOATS over the page (the page is never resized); docked, it takes a column beside the page like the extension panel does;
//   - it comes from the sidebar's side (the right in the top-tabs layout), is 400 px wide by default and 340 up to three quarters of the page area (14.1) by dragging its inner edge, remembered per site;
//   - the frame is a layer over the whole page area so a click outside closes the panel, as Peek's does;
//   - the site's page is a view that cannot fade, so the card's veil (the site's icon on the card's surface) covers it while it opens, closes or switches: the frame sits
//     ABOVE the page then and below it at rest, and the veil is what fades (200 ms in, 160 ms out, the exact reverse; 120 ms between two sites);
//   - a closed panel's page keeps running (music plays, messages arrive) until it has been unused for the chosen time and is not playing sound, then it sleeps like a
//     tab (the page is closed; the pinned site stays and loads again when it is clicked). A page never opened this session is never loaded.
//   - links to the same site stay in the panel; links to other sites open as a normal tab; Open as tab gives the live page itself to a new tab (Peek's way).
// Everything that is not specific to a panel (which session, which protections a page gets, which tab a link opens in) is given in by main: this file never reaches for main's state.
const path=require('node:path');
const FRAME=path.join(__dirname,'side-panel-sites-frame.html'),FRAME_PRELOAD=path.join(__dirname,'side-panel-sites-frame-preload.cjs');
const MARGIN=12,HEADER=40,INSET=4,DOCK_GAP=6,MIN_PAGE_DOCKED=420,MIN_CARD=240;
/* the narrowest a panel is dragged to, and (14.1) the share of the page area it may take at most: the same numbers as src/runtime/sidePanelSites.ts */
const MIN_WIDTH=340,MAX_SHARE=.75;
const IN_MS=200,OUT_MS=160,VEIL_MS=120,RECENTLY_AUDIBLE_MS=60000,PAINT_CAP_MS=1800,FRAME_IDLE_MS=60000,SWEEP_MS=30000,ESC_PROBE_MS=300;
/* closing (14.1): the most each step waits (the page's picture, then its paint in the frame) before the next way is taken */
const STILL_MS=150;
/* D155: the longest the host waits for a closing panel page's leave handlers (beforeunload, pagehide, unload) before it closes the page as before */
const LEAVE_MS=1000;
/* the page's glide into a docked panel's column (desktop/page-motion.cjs SPRING over 480 ms, Fast at half): the docked card's way out takes the same */
const DOCK_OUT_MS=480;
/* D124: when a docked card sliding in on that spring is within `within` window pixels of its rest place, (1 - spring(t)) * width <= within, read off the same
   33 points the frame's CSS linear() runs between (no measuring): the card has landed for the eye (400 px at Premium: 412 of 480 ms; the last 1 px takes the rest) */
const {SPRING}=require('./page-motion.cjs');
function landingMs(width,ms,within=1){
 if(!(ms>0)||!(width>0))return 0;
 const need=1-within/width,n=SPRING.length-1;
 if(need<=0)return 0;
 for(let i=1;i<=n;i++)if(SPRING[i]>=need)return Math.ceil((i-1+(need-SPRING[i-1])/(SPRING[i]-SPRING[i-1]))/n*ms);
 return ms;
}
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const rounded=box=>({x:Math.round(box.x),y:Math.round(box.y),width:Math.max(1,Math.round(box.width)),height:Math.max(1,Math.round(box.height))});

/** Can a docked panel keep its column here: at its narrowest, does the page keep its minimum beside it? `page` in window pixels. Pure. */
const dockFits=(page,scale=1)=>!!page&&page.width/scale-MIN_WIDTH-DOCK_GAP>=MIN_PAGE_DOCKED;
/** Beta 14.1 (a Windows member: "its width is very limited"): the widest the card may be in this page area, in interface pixels. Three quarters of the page area, never past
 *  the page area's margins (floating), never so wide that the page beside a docked column falls under its minimum; never under the narrowest (340). The window decides it,
 *  so a smaller window shows a remembered width narrower and the remembered width is not touched. `page` in window pixels, `scale` the interface scale. Pure. */
function maxWidthFor(page,{docked=false,scale=1}={}){
 if(!page||!(page.width>0))return MIN_WIDTH;
 const area=page.width/scale,room=docked&&dockFits(page,scale)?area-DOCK_GAP-MIN_PAGE_DOCKED:area-2*MARGIN;
 return Math.max(MIN_WIDTH,Math.floor(Math.min(area*MAX_SHARE,room)));
}
/** Where the card goes in a page area (window pixels): floating, in the margin of the page area from `side`; docked, in a column the page gives up (`reserve` is that column's
 *  width with its gap). `width` is in interface pixels (400 by default, 340 up to `maxWidthFor` the page area), `scale` the interface scale. A page area too narrow to keep the
 *  minimum page beside a docked panel floats it instead. Pure. */
function cardGeometry(page,{width=400,side='right',docked=false,scale=1}={}){
 if(!page||!(page.width>0)||!(page.height>0))return null;
 const margin=Math.round(MARGIN*scale),header=Math.round(HEADER*scale),gap=Math.round(DOCK_GAP*scale);
 if(page.width<Math.round(MIN_CARD*scale)+2*margin)return null;
 const canDock=docked&&dockFits(page,scale);
 const wanted=Math.round(clamp(width,MIN_WIDTH,maxWidthFor(page,{docked:canDock,scale}))*scale),room=Math.max(MIN_CARD,Math.round(page.width-2*margin));
 /* docked, the page's minimum is kept in window pixels too (rounding at 110 or 125 % must never tip the widest docked panel into floating) */
 const w=canDock?Math.min(wanted,room,page.width-gap-Math.round(MIN_PAGE_DOCKED*scale)):Math.min(wanted,room);
 const dock=canDock&&page.width-w-gap>=Math.round(MIN_PAGE_DOCKED*scale);
 const h=dock?page.height:Math.max(MIN_CARD,Math.round(page.height-2*margin));
 const y=dock?page.y:page.y+margin;
 const x=dock?(side==='left'?page.x:page.x+page.width-w):(side==='left'?page.x+margin:page.x+page.width-margin-w);
 const card={x,y,width:w,height:h},inset=Math.round(INSET*scale);
 /* the frame of a floating panel covers the page area (a click outside the card closes it); a docked panel's frame is only its column and the gap beside it (14.1): the page
    beside a docked panel is the person's to click, and a click there never closes the panel */
 const frame=dock?{x:side==='left'?x:x-gap,y,width:w+gap,height:h}:page;
 return {card:rounded(card),content:rounded({x:card.x+inset,y:card.y+header,width:Math.max(1,card.width-2*inset),height:Math.max(1,card.height-header-inset)}),header,inset,docked:dock,reserve:dock?w+gap:0,side:side==='left'?'left':'right',
  /* the card's place inside the frame */
  frame:rounded(frame),inner:{x:Math.round(card.x-frame.x),y:Math.round(card.y-frame.y),width:Math.round(card.width),height:Math.round(card.height)}};
}
/** A page view that touches the docked panel's edge of the page area gives the panel its column. Pure. */
function trimBounds(bounds,page,geometry){
 if(!geometry||!geometry.docked||!bounds||!page)return bounds;
 if(geometry.side==='left'){if(bounds.x>page.x+24)return bounds;return {...bounds,x:bounds.x+geometry.reserve,width:Math.max(1,bounds.width-geometry.reserve)};}
 const right=page.x+page.width;if(bounds.x+bounds.width<right-24)return bounds;
 return {...bounds,width:Math.max(1,bounds.width-geometry.reserve)};
}
/** Speed names to the two numbers the frame uses. */
const speedOf=(reduced,speed)=>reduced||speed==='off'?'off':speed==='fast'?'fast':'premium';
/* `dock`: a docked panel's close slides the card out of its column on the page's own glide (page-motion.cjs: 480 ms at Premium, half at Fast), so the two move as one (14.1) */
const timesOf=speed=>speed==='off'?{in:0,out:0,veil:0,dock:0}:speed==='fast'?{in:Math.round(IN_MS*.6),out:Math.round(OUT_MS*.6),veil:Math.round(VEIL_MS*.6),dock:DOCK_OUT_MS/2}:{in:IN_MS,out:OUT_MS,veil:VEIL_MS,dock:DOCK_OUT_MS};

/** May this closed site's page sleep now? `rec` = {lastUsedAt, audible, open}. keepMs 0 = never by idle time. `pressure` sleeps every silent closed page. Pure. */
function mayIdleSleep(rec,{now,keepMs,pressure=false}){
 if(!rec||rec.open||rec.audible)return false;
 /* Chromium's discard policy: a page that was audible in the last minute is not discarded (discard_eligibility_policy.cc) */
 if(rec.lastAudibleAt&&now-rec.lastAudibleAt<RECENTLY_AUDIBLE_MS)return false;
 if(pressure)return true;
 return keepMs>0&&now-(rec.lastUsedAt||0)>=keepMs;
}
/** What the page says of Esc: true when the site has something open that Esc should close first (a dialog, a menu, an open list, a full-screen layer). Runs in the page. */
const ESC_PROBE=`(()=>{try{const open=selector=>{for(const element of document.querySelectorAll(selector)){const box=element.getBoundingClientRect();if(box.width>0&&box.height>0)return true;}return false;};
 const active=document.activeElement;
 if(document.fullscreenElement||document.pictureInPictureElement)return true;
 if(open('dialog[open],[aria-modal="true"],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'))return true;
 if(active&&active.closest&&active.closest('[aria-expanded="true"]'))return true;
 if(active&&active.matches&&active.matches('[aria-expanded="true"],input[aria-autocomplete]'))return true;
 return false;}catch(e){return false;}})()`;

function createSidePanelSites(deps){
 const {WebContentsView,getWindow,pageBounds,sitesOf,sessionOf,webPreferences,attachPage,runtime}=deps;
 const {unreadFromTitle,staysInPanel,siteWidth,keepMinutes}=runtime;
 const live=new Map();                 // site id -> the site's page this window keeps: {id,url,view,wc,painted,lastUsedAt,audible,title,iconKey,iconChanged,open,sleeping,crashed,profileId}
 let panel=null,frameRec=null,sweepTimer=null,sizing=null,handedOver=null,runs=0;
 const now=()=>(deps.now||Date.now)();
 const timers={set:(fn,ms)=>(deps.setTimeout||setTimeout)(fn,ms),clear:id=>(deps.clearTimeout||clearTimeout)(id)};
 const scale=()=>{try{return Number(deps.uiScale?.())||1;}catch{return 1;}};
 const speed=()=>speedOf(!!deps.reducedMotion?.(),deps.motionSpeed?.()||'premium');
 const win=()=>{const w=getWindow();return w&&!w.isDestroyed()?w:null;};
 const profileId=()=>deps.profileId();
 const sites=()=>{try{return sitesOf(profileId())||[];}catch{return [];}};
 const siteById=id=>sites().find(site=>site.id===id)||null;
 const alive=rec=>!!rec&&!!rec.wc&&!rec.wc.isDestroyed();
 /* the page card's radius (window pixels, as the layout gives it): the panel's card has it, the site's own card inside is one inset smaller so the two corners stay concentric */
 const cardRadius=()=>Math.max(6,Math.round(deps.pageRadius?.()??12));
 const contentRadius=()=>Math.max(4,cardRadius()-Math.round(INSET*scale()));
 const sideNow=()=>deps.side?.()==='left'?'left':'right';

 /* What the interface needs to draw the icons' marks and the open one. */
 function snapshot(){
  const marks={};
  /* `media` / `mediaAt` / `muted`: the now-playing card's row for this site (desktop/media-controls.cjs follows the page like a tab's: playing, paused, and when the sound began) */
  for(const [id,rec] of live)marks[id]={live:alive(rec),audible:!!rec.audible&&alive(rec),unread:rec.unread||0,dot:!!(rec.unread||rec.iconChanged)&&!rec.open,media:alive(rec)?rec.media||null:null,mediaAt:alive(rec)?rec.mediaAt||0:0,muted:!!rec.muted&&alive(rec)};
  /* a private window shows no icons, but its command bar lists the profile's sites by name: it asks for them here */
  return {open:panel?panel.siteId:null,docked:!!panel?.docked,marks,...(deps.ephemeral?.()?{sites:sites().map(site=>({id:site.id,title:site.title}))}:{})};
 }
 let emitted='';
 function publish(){
  const state=snapshot(),key=JSON.stringify(state);
  if(key===emitted)return;emitted=key;
  try{deps.emit?.({type:'side-panel-state',...state});}catch{/* the icons keep their last marks */}
 }

 /* ---- live pages ---- */
 function recFor(site){
  let rec=live.get(site.id);
  if(rec&&alive(rec)&&rec.profileId===profileId())return rec;
  if(rec)discard(rec,{keepRecord:false});
  return null;
 }
 function create(site){
  const pid=profileId(),session=sessionOf(pid),view=new WebContentsView({webPreferences:webPreferences(pid,site)});
  const wc=view.webContents,rec={id:site.id,url:site.url,view,wc,profileId:pid,painted:false,lastUsedAt:now(),audible:false,title:'',unread:0,iconKey:'',iconChanged:false,open:false,sleeping:false,crashed:false,history:0,listeners:[]};
  live.set(site.id,rec);
  const on=(emitter,name,fn)=>{emitter.on(name,fn);rec.listeners.push(()=>emitter.removeListener(name,fn));};
  try{wc.setMaxListeners?.(32);}catch{}
  try{view.setBorderRadius?.(contentRadius());}catch{}
  /* this page's keys first (Esc, Cmd+W): main's shortcut handler, added by attachPage, skips an event that is already handled */
  on(wc,'before-input-event',(event,input)=>onPageKey(rec,event,input));
  try{attachPage?.(wc,{site,rec,session,host:api});}catch(error){try{deps.warn?.('Side panel page setup:',error&&error.message);}catch{}}
  /* Beta 14: the page's sound reaches the now-playing card like a tab's (the card asks main about it by this id): playing, paused, and when it began; the page is always one somebody has opened, never an unseen one */
  try{deps.attachMedia?.(site.id,wc,patch=>{if(!patch)return;let changed=false;if(Object.hasOwn(patch,'media')&&rec.media!==(patch.media||null)){rec.media=patch.media||null;changed=true;}if(typeof patch.mediaAt==='number')rec.mediaAt=patch.mediaAt;if(changed)publish();},{muted:()=>!!rec.muted,unseen:()=>false});}catch(error){try{deps.warn?.('Side panel media:',error&&error.message);}catch{}}
  on(wc,'page-title-updated',(_event,title)=>{rec.title=String(title||'');const count=unreadFromTitle(rec.title);if(count!==rec.unread){rec.unread=count;publish();}if(panel&&panel.siteId===site.id)pushFrame();});
  on(wc,'page-favicon-updated',(_event,icons)=>{
   const key=Array.isArray(icons)?icons.filter(item=>typeof item==='string').slice(0,3).join('|'):'';
   if(rec.iconKey&&key&&key!==rec.iconKey&&!rec.open){rec.iconChanged=true;publish();}
   rec.iconKey=key||rec.iconKey;
   try{deps.noteIcon?.(site.id,wc,icons);}catch{}
  });
  on(wc,'audio-state-changed',event=>{const audible=!!(event&&event.audible);if(audible!==rec.audible){rec.audible=audible;rec.lastAudibleAt=now();publish();try{deps.audioChanged?.(site.id,audible);}catch{}}});
  on(wc,'dom-ready',()=>{rec.painted=true;if(panel&&panel.siteId===site.id)settleVeil();});
  on(wc,'did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3){rec.painted=true;if(panel&&panel.siteId===site.id)settleVeil();}});
  on(wc,'did-start-navigation',event=>{if(event&&event.isMainFrame&&!event.isSameDocument){rec.crashed=false;if(panel&&panel.siteId===site.id)pushFrame();}});
  for(const name of ['did-navigate','did-navigate-in-page','did-start-loading','did-stop-loading'])on(wc,name,()=>{if(panel&&panel.siteId===site.id)pushFrame();});
  on(wc,'enter-html-full-screen',()=>enterFullscreen(rec));
  on(wc,'leave-html-full-screen',()=>leaveFullscreen(rec));
  on(wc,'render-process-gone',()=>{rec.crashed=true;rec.painted=true;if(panel&&panel.siteId===site.id){place();settleVeil();pushFrame();}publish();});
  on(wc,'destroyed',()=>{rec.listeners.length=0;if(live.get(site.id)===rec){live.delete(site.id);if(panel&&panel.siteId===site.id&&!panel.closing)close();publish();}});
  try{view.setVisible(false);}catch{}
  const w=win();if(w)w.contentView.addChildView(view);
  rec.loading=wc.loadURL(site.url).catch(()=>{});
  return rec;
 }
 /* D155: a panel page is closed the way a tab's is, with its leave handlers run (beforeunload, pagehide, unload), so what a site saves as its page goes reaches the
    profile's storage. A plain close() destroys the page without them: Discord keeps its sign-in in memory and saves it then, so in the panel it was signed out at every
    launch (0 of 4 leave-time writes reached disk from a panel page, 4 of 4 from a tab, at the same quit). A site's "stay on this page?" is answered for it, with no
    dialog (a panel page put to sleep, unpinned or closed with its window never asked, and does not now). Resolves once the page is gone, or after LEAVE_MS, when a
    page still busy in its handlers is closed as before. */
 function closePage(wc){
  return new Promise(resolve=>{
   let timer=null;
   const gone=()=>{if(timer!==null){timers.clear(timer);timer=null;}resolve();};
   try{
    if(!wc||wc.isDestroyed()){resolve();return;}
    wc.once('destroyed',gone);
    wc.once('will-prevent-unload',event=>event.preventDefault());
    timer=timers.set(()=>{timer=null;try{wc.removeListener('destroyed',gone);if(!wc.isDestroyed())wc.close();}catch{}resolve();},LEAVE_MS);
    wc.close({waitForBeforeUnload:true});
   }catch{
    /* a page that cannot take part (gone meanwhile, or a stand-in without listeners) is closed as before */
    if(timer!==null){timers.clear(timer);timer=null;}
    try{if(wc&&!wc.isDestroyed())wc.close();}catch{}
    resolve();
   }
  });
 }
 /** Close the page (it sleeps): the pinned site stays, the next click loads it again. The view goes first, then the page with its leave handlers run (closePage);
     the promise is for whoever must wait until it is gone (a closing window). */
 function discard(rec,{keepRecord=false}={}){
  if(!rec)return Promise.resolve();
  for(const off of rec.listeners.splice(0))try{off();}catch{}
  const w=win();try{w?.contentView.removeChildView(rec.view);}catch{}
  const closed=closePage(rec.wc);
  if(keepRecord){rec.sleeping=true;rec.audible=false;rec.media=null;rec.mediaAt=0;rec.muted=false;rec.painted=false;rec.view=null;rec.wc=null;}else if(live.get(rec.id)===rec)live.delete(rec.id);
  publish();
  return closed;
 }
 function ensureLive(site){
  let rec=recFor(site);
  if(rec&&rec.url!==site.url){discard(rec);rec=null;}
  if(!rec)rec=create(site);
  rec.lastUsedAt=now();
  return rec;
 }

 /* ---- the frame ---- */
 function ensureFrame(){
  if(frameRec&&!frameRec.view.webContents.isDestroyed()){timers.clear(frameRec.idle);frameRec.idle=null;return frameRec;}
  const view=new WebContentsView({webPreferences:{preload:FRAME_PRELOAD,sandbox:true,contextIsolation:true,nodeIntegration:false,spellcheck:false}});
  view.setBackgroundColor?.('#00000000');
  const wc=view.webContents,rec={view,ready:null,idle:null};frameRec=rec;
  /* zoomed with the interface: Chromium puts a page's zoom back at a navigation, so it is set once the page is there (pushFrame sets it again if the interface size changes) */
  try{wc.setZoomFactor?.(scale());}catch{}
  wc.on('dom-ready',()=>{try{wc.setZoomFactor?.(scale());}catch{}});
  wc.ipc.on('acira:side-panel-sites-frame',(_event,command,x)=>onFrameCommand(command,x));
  wc.on('before-input-event',(event,input)=>{
   if(!input||input.type!=='keyDown'||input.isAutoRepeat||!panel)return;
   if(input.key==='Escape'&&!input.control&&!input.meta&&!input.alt){event.preventDefault();void close();}
   /* F6 moves the keyboard between the card's header buttons and the site (the two are separate views, so Tab cannot cross) */
   else if(input.key==='F6'&&!input.control&&!input.meta&&!input.alt){event.preventDefault();const rec=live.get(panel.siteId);if(alive(rec))try{deps.focusPage?.(rec.wc);}catch{}}
  });
  rec.ready=new Promise(resolve=>{wc.once('did-finish-load',resolve);});
  wc.loadFile(FRAME).catch(()=>{});
  const w=win();if(w)w.contentView.addChildView(view);
  try{view.setVisible(false);}catch{}
  return rec;
 }
 function dropFrame(){
  if(!frameRec)return;const rec=frameRec;frameRec=null;timers.clear(rec.idle);
  const w=win();try{w?.contentView.removeChildView(rec.view);}catch{}
  try{if(!rec.view.webContents.isDestroyed())rec.view.webContents.close();}catch{}
 }
 function frameState(extra={}){
  const rec=panel&&live.get(panel.siteId),site=panel&&siteById(panel.siteId),g=panel&&panel.geometry,labels=deps.labels?.()||{};
  const wc=alive(rec)?rec.wc:null,s=speed();
  return {
   phase:undefined,run:panel?panel.run:0,scale:scale(),inset:INSET,card:g?g.inner:{x:0,y:0,width:0,height:0},radius:cardRadius(),
   /* 14.1: the site's own place in the card, in window pixels and with its own corner, exactly where main puts the page's view: the close's picture is laid there (at 110 % or 125 % a CSS inset of 4 px is not the view's rounded 4 window pixels) */
   hole:g?{x:g.content.x-g.card.x,y:g.content.y-g.card.y,width:g.content.width,height:g.content.height,radius:contentRadius()}:null,
   /* 14.1: what the frame needs to move the card with the pointer itself, in step with the page (the same limits and room main's drag uses) */
   size:g&&!g.docked?{min:MIN_WIDTH,max:maxWidthFor(pageBounds(),{docked:false,scale:scale()}),room:Math.max(MIN_CARD,Math.round(g.frame.width-2*Math.round(MARGIN*scale())))}:null,side:g?g.side:sideNow(),docked:!!(g&&g.docked),dark:!!deps.dark?.(),speed:s,reduced:s==='off',
   lang:deps.lang?.()||'en',rtl:/^(ar|he|fa|ur)(-|$)/i.test(deps.lang?.()||''),labels,
   site:{id:site?.id||'',title:(wc&&!wc.isDestroyed()&&wc.getTitle())||site?.title||'',icon:site?.icon||''},
   canGoBack:!!(wc&&!wc.isDestroyed()&&wc.navigationHistory.canGoBack()),loading:!!(wc&&!wc.isDestroyed()&&wc.isLoading()),crashed:!!rec?.crashed,
   veiled:panel?!(panel.entered&&rec&&rec.painted&&!panel.switching):true,
   /* D124: a docked card says it has landed this long after it starts to slide in: when it is within 1 window pixel of its place (main then takes the column under it and lifts the veil) */
   land:g&&g.docked?landingMs(g.card.width,timesOf(s).dock):undefined,
   ...extra
  };
 }
 function pushFrame(extra){
  if(!panel||!frameRec)return;const wc=frameRec.view.webContents;if(wc.isDestroyed())return;
  /* the frame page is zoomed with the interface, and a frame kept ready outlives a change of the interface size */
  try{if(wc.getZoomFactor&&wc.getZoomFactor()!==scale())wc.setZoomFactor(scale());}catch{}
  try{const state=frameState(extra);panel.darkSent=state.dark;wc.send('acira:side-panel-sites-frame-state',state);}catch{}
 }

 /* ---- stacking and place ---- */
 /** Above the pages, below the popup layer. At rest the frame is under the site's page (header and edge are the frame's); while the panel opens, closes or switches it is above, so the veil can fade over the page. */
 function raise(){
  if(!panel||!frameRec)return;const w=win();if(!w)return;
  const rec=live.get(panel.siteId),views=[frameRec.view,...(alive(rec)?[rec.view]:[])];
  const ordered=panel.frameOnTop?[...(alive(rec)?[rec.view]:[]),frameRec.view]:views;
  const children=w.contentView.children,others=children.filter(v=>!ordered.includes(v));
  const above=deps.raiseAbove?deps.raiseAbove(others):undefined,at=typeof above==='number'&&above>=0&&above<=others.length?above:others.length;
  const placed=ordered.every((view,i)=>children.indexOf(view)===at+i);
  if(placed)return;
  /* 14.1: MOVED, never taken out. A view taken out of the window and added back is detached and attached again: its page is hidden and shown (on Windows it comes back blank
     for a frame, the flicker a Windows member saw when the panel closed). addChildView of a view that is already a child only reorders it (Electron's View.addChildView), so
     each view that is out of place goes straight to its final place, in order, and the others keep theirs. */
  const target=[...others.slice(0,at),...ordered,...others.slice(at)];
  for(let i=0;i<target.length;i++){if(w.contentView.children[i]!==target[i])try{w.contentView.addChildView(target[i],i);}catch{}}
 }
 function geometry(){
  if(!panel)return null;
  const page=pageBounds();if(!page)return null;
  const site=siteById(panel.siteId);
  return cardGeometry(page,{width:panel.width??siteWidth(site),side:sideNow(),docked:panel.docked,scale:scale()});
 }
 function place(){
  if(!panel)return;
  const w=win(),g=geometry();
  if(!w||!g){hideAll();return;}
  panel.geometry=g;
  const rec=live.get(panel.siteId);
  if(panel.fullscreen&&alive(rec)){presentFullscreen(rec);return;}
  raise();
  if(frameRec&&!frameRec.view.webContents.isDestroyed()){frameRec.view.setBounds(g.frame);frameRec.view.setVisible(true);}
  /* A site's page is a native view and cannot fade: it is hidden while the card is opening or closing (the card is translucent then and would show the page through it, still and unmoved) and while the veil swaps one site for another. */
  if(alive(rec)){rec.view.setBounds(g.content);rec.view.setVisible(!rec.crashed&&!panel.pageHidden);}
  /* the interface's appearance reaches main with the layout, a moment after the action that changed it (sync() above sees the old one): the card follows it here */
  if(frameRec&&!!deps.dark?.()!==panel.darkSent)pushFrame();
 }
 function hideAll(){
  try{frameRec?.view.setVisible(false);}catch{}
  const rec=panel&&live.get(panel.siteId);try{if(alive(rec))rec.view.setVisible(false);}catch{}
 }


 /* ---- a video in the panel goes truly fullscreen ---- */
 /** The panel's page asked for HTML fullscreen (its own player's button): the window goes fullscreen and the page's view takes the whole window, above everything, as a tab's page does
  *  (page-fullscreen.cjs); the card goes away meanwhile and comes back when the page leaves fullscreen. Only the panel that is shown can ask. */
 function canFullscreen(wc){return !!panel&&!panel.closing&&!!wc&&alive(live.get(panel.siteId))&&live.get(panel.siteId).wc===wc;}
 function presentFullscreen(rec){
  const w=win();if(!w)return;
  let size;try{size=w.getContentBounds();}catch{size=null;}
  if(!size)return;
  try{frameRec?.view.setVisible(false);}catch{}
  const children=w.contentView.children;if(children.at(-1)!==rec.view){try{w.contentView.removeChildView(rec.view);}catch{}w.contentView.addChildView(rec.view);}
  rec.view.setBorderRadius?.(0);rec.view.setBounds({x:0,y:0,width:size.width,height:size.height});rec.view.setVisible(true);
 }
 function enterFullscreen(rec){
  if(!canFullscreen(rec.wc)||panel.fullscreen)return;
  const w=win();if(!w)return;
  panel.fullscreen={windowWas:w.isFullScreen()};
  const again=()=>{if(panel&&panel.fullscreen&&alive(rec))presentFullscreen(rec);};
  w.once?.('enter-full-screen',again);
  w.setFullScreen(true);presentFullscreen(rec);
 }
 function leaveFullscreen(rec){
  if(!panel||!panel.fullscreen)return;
  const was=panel.fullscreen.windowWas;panel.fullscreen=null;
  const w=win();if(w&&!was)try{w.setFullScreen(false);}catch{}
  try{rec?.view.setBorderRadius?.(contentRadius());}catch{}
  if(panel){panel.frameOnTop=false;}place();pushFrame();
 }
 /* ---- open, switch, close ---- */
 /** The interface's request: open this site, or close it when it is the one shown (the same icon again). */
 async function toggle(siteId,options={}){
  if(panel&&panel.siteId===siteId&&!panel.closing)return close();
  return open(siteId,options);
 }
 async function open(siteId,{keepFocus=false}={}){
  const site=siteById(siteId);if(!site)return {ok:false,code:'unknown'};
  try{lastActive=deps.activeTabId?.()??lastActive;}catch{}
  if(deps.available&&!deps.available())return {ok:false,code:'unavailable'};
  const page=pageBounds();if(!page||!win())return {ok:false,code:'hidden'};
  if(!cardGeometry(page,{width:siteWidth(site),side:sideNow(),docked:false,scale:scale()}))return {ok:false,code:'narrow'};
  if(panel&&panel.siteId===siteId){if(panel.closing)reopen();return {ok:true,reused:true};}
  try{deps.beforeOpen?.();}catch{}
  try{deps.noteOpen?.();}catch{}
  if(panel&&!panel.closing)return switchTo(site);
  if(panel)await panel.closePromise;
  const rec=ensureLive(site);
  rec.open=true;rec.iconChanged=false;
  const docked=site.docked===true;
  panel={siteId,run:++runs,pageHidden:true,docked,width:undefined,geometry:null,entered:false,closing:false,switching:false,frameOnTop:true,focusBefore:keepFocus?null:(deps.focusedContents?.()||null),entering:true};
  const frame=ensureFrame();
  place();
  /* 14.1 (D124): a DOCKED panel arrives by sliding into its column, opaque, from the column's outer edge, over the page as it is; the page gives up the column only once the
     card has landed and covers it ('entered'), so the column is never bare and the page never vanishes from it in one frame. A floating panel never moves the page. */
  if(panel.geometry?.docked)panel.landing=true;
  else if(deps.relayout)deps.relayout();
  await frame.ready;
  if(!panel||panel.siteId!==siteId)return {ok:true};
  pushFrame({phase:'in'});
  panel.cap=timers.set(()=>{rec.painted=true;settleVeil();},PAINT_CAP_MS);
  publish();
  return {ok:true};
 }
 /** The frame's card has formed (opening) or the page painted: the veil fades when both are true. */
 function settleVeil(){
  if(!panel)return;const rec=live.get(panel.siteId);
  if(panel.entered&&rec&&rec.painted){timers.clear(panel.cap);pushFrame();}
 }
 /** The veil is gone: the page is what shows; the frame goes under it again and the keyboard goes to the site. */
 function veilGone(){
  if(!panel||panel.closing)return;
  panel.frameOnTop=false;panel.switching=false;raise();place();
  const rec=live.get(panel.siteId);
  if(alive(rec)&&deps.focusPage)try{deps.focusPage(rec.wc);}catch{}
  publish();
 }
 async function switchTo(site){
  const from=panel.siteId;if(from===site.id)return {ok:true};
  const previous=live.get(from),t=timesOf(speed());
  panel.switching=true;panel.frameOnTop=true;panel.entered=true;
  if(alive(previous)){previous.open=false;previous.lastUsedAt=now();}
  /* the new page starts loading now (a head start); it is shown only under the veil */
  const rec=ensureLive(site);rec.open=true;rec.iconChanged=false;
  timers.clear(panel.swapTimer);timers.clear(panel.cap);
  const swap=()=>{
   panel.swapTimer=null;if(!panel||panel.closing)return;
   try{if(alive(previous))previous.view.setVisible(false);}catch{}
   panel.siteId=site.id;panel.docked=site.docked===true;panel.width=undefined;panel.pageHidden=false;
   panel.cap=timers.set(()=>{rec.painted=true;settleVeil();},PAINT_CAP_MS);
   place();pushFrame({phase:'rest',veiled:true});
   timers.set(()=>{if(!panel||panel.siteId!==site.id)return;panel.switching=false;settleVeil();pushFrame();},1);
   if(deps.relayout)deps.relayout();
   publish();
  };
  raise();
  /* the veil comes up over the old site (it keeps showing until the veil is whole), then the two swap */
  pushFrame({phase:'rest',veiled:true});
  if(t.veil)panel.swapTimer=timers.set(swap,Math.round(t.veil*.7)+10);else swap();
  publish();
  return {ok:true};
 }
 function reopen(){
  if(!panel)return;
  timers.clear(panel.exit);timers.clear(panel.stillTimer);panel.closing=false;panel.out=false;panel.covered=false;panel.frameOnTop=true;panel.entered=false;panel.pageHidden=true;panel.run=++runs;place();
  /* a docked panel gave its column back when it began to close: it takes it again once its card has slid back in (D124) */
  if(panel.geometry?.docked)panel.landing=true;
  else if(panel.docked&&deps.relayout)deps.relayout();
  pushFrame({phase:'in'});publish();
 }
 /** Closing (14.1, a Windows member: "the closing animation is not smooth and flickers"). The card leaves in ONE glide with the site in it. The site's page is a native view:
  *  it can neither fade nor move with the card, and it used to stay put, fully drawn, while its header and edge slid away, then vanish in one frame. Now a picture of the page
  *  is laid in the card's hole first, UNDER the live page (nothing changes on screen); once the frame says it is painted the live page is hidden (the picture shows the same
  *  pixels) and the card, picture and all, fades and slides out on its own curve. Nothing is restacked (raise never takes a view out), nothing is drawn twice, the content never
  *  stands still while its card moves. No picture in time (a crashed or hidden page, a slow capture): the card's veil is painted there instead, the same way, before the page
  *  goes. Docked, the page takes its column back at once, under the card that covers the column while it goes, never after it. */
 function close({restoreFocus=true}={}){
  if(!panel||panel.closing)return Promise.resolve();
  const p=panel,rec=live.get(p.siteId);
  if(p.fullscreen)leaveFullscreen(rec);
  p.closing=true;p.out=false;p.covered=false;timers.clear(p.cap);timers.clear(p.swapTimer);
  if(alive(rec)){rec.open=false;rec.lastUsedAt=now();}
  p.restoreFocus=restoreFocus;
  if(p.docked&&deps.relayout)deps.relayout();
  const t=timesOf(speed());
  p.closePromise=new Promise(resolve=>{
   p.done=()=>{if(p.finished)return;p.finished=true;timers.clear(p.exit);timers.clear(p.stillTimer);resolve();finish(p);};
   if(!t.out||!frameRec||frameRec.view.webContents.isDestroyed()){p.done();return;}
   publish();
   /* nothing of the page on screen (still opening under the veil, crashed): the card goes at once */
   if(!(alive(rec)&&!p.pageHidden&&!rec.crashed)){goOut(p);return;}
   const run=p.run;
   p.stillTimer=timers.set(()=>cover(p),STILL_MS);
   Promise.resolve().then(()=>rec.wc.capturePage()).then(image=>{
    if(panel!==p||!p.closing||p.run!==run||p.out||p.covered)return;
    /* the picture's own pixels (Electron's capture is a bitmap of the page's real device pixels, in sRGB): the frame paints them on a canvas as they are. Pixel for pixel the
       live page's (a bare Electron 45 check: mean 0, worst 0 levels), where a JPEG in an <img> left fringes of up to 54 levels at coloured edges */
    let still=null;try{const size=image&&!image.isEmpty()?image.getSize():null,pixels=size?image.toBitmap():null;if(size&&pixels&&pixels.length===size.width*size.height*4)still={width:size.width,height:size.height,pixels};}catch{still=null;}
    if(!still){cover(p);return;}
    timers.clear(p.stillTimer);p.stillTimer=timers.set(()=>cover(p),STILL_MS);
    pushFrame({phase:'still',still});
   },()=>cover(p));
  });
  return p.closePromise;
 }
 /** No picture in time: the card's veil (the site's icon on the card's surface) comes up at once in the hole, under the live page, before the page goes. */
 function cover(p){
  if(panel!==p||!p.closing||p.out||p.covered)return;
  p.covered=true;timers.clear(p.stillTimer);p.stillTimer=timers.set(()=>goOut(p),STILL_MS);
  pushFrame({phase:'cover',veiled:true});
 }
 /** The picture (or the veil) is painted under the live page: the page goes and the card glides out. */
 function goOut(p){
  if(panel!==p||!p.closing||p.out)return;
  p.out=true;timers.clear(p.stillTimer);p.pageHidden=true;
  const rec=live.get(p.siteId);try{if(alive(rec))rec.view.setVisible(false);}catch{}
  pushFrame({phase:'out',...(p.covered?{veiled:true}:{})});
  /* docked: the card slides out of its column on the page's glide, the page coming in under it (the relayout went out as the close began, so the page leads by the picture's few ms and the column is never bare) */
  const t=timesOf(speed());p.exit=timers.set(p.done,(p.geometry?.docked?t.dock:t.out)+80);
 }
 function finish(p){
  if(panel!==p)return;
  panel=null;
  const rec=live.get(p.siteId);try{if(alive(rec))rec.view.setVisible(false);}catch{}
  /* a private window's panel is forgotten on close: the page, its session's traces and all go with it */
  if(rec&&deps.ephemeral?.())discard(rec);
  try{frameRec?.view.setVisible(false);}catch{}
  if(frameRec){timers.clear(frameRec.idle);frameRec.idle=timers.set(dropFrame,FRAME_IDLE_MS);}
  if(deps.relayout)deps.relayout();
  if(p.restoreFocus!==false&&p.focusBefore){try{deps.restoreFocus?.(p.focusBefore);}catch{}}
  publish();
 }
 function onFrameCommand(command,x){
  if(!panel)return;
  switch(command){
   case 'close':case 'outside':void close();break;
   case 'entered':if(panel.closing)break;panel.entered=true;
    /* a docked card has landed in its column (D124): the page gives up the column now, under it */
    if(panel.landing){panel.landing=false;if(deps.relayout)deps.relayout();}
    if(panel.pageHidden&&!panel.swapTimer){panel.pageHidden=false;place();}settleVeil();pushFrame();break;
   case 'gone':panel.done?.();break;
   /* the picture of the page (or the veil) is painted under the live page, for this close (the frame answers with the run it was told) */
   case 'still-ready':if(panel.closing&&!panel.out&&(x===undefined||x===panel.run))goOut(panel);break;
   case 'veil-gone':veilGone();break;
   case 'back':{const rec=live.get(panel.siteId);if(alive(rec)&&rec.wc.navigationHistory.canGoBack())rec.wc.navigationHistory.goBack();break;}
   case 'reload':{const rec=live.get(panel.siteId);if(alive(rec)){rec.crashed=false;try{rec.wc.reload();}catch{}place();pushFrame();}break;}
   case 'dock':setDocked(!panel.docked);break;
   case 'tab':void openAsTab();break;
   case 'resize-start':sizing={x,width:(panel.geometry?.card.width||0)/scale()};break;
   /* 14.1: as wide as the window allows (maxWidthFor: three quarters of the page area), as narrow as 340; what is saved at the end is what the person sees */
   case 'resize-move':if(sizing&&Number.isFinite(x)){const delta=(x-sizing.x)*(sideNow()==='left'?1:-1)/scale(),most=maxWidthFor(pageBounds(),{docked:!!panel.geometry?.docked,scale:scale()});panel.width=clamp(Math.round(sizing.width+delta),MIN_WIDTH,most);place();pushFrame();}break;
   case 'resize-end':if(sizing){sizing=null;if(panel.width)try{deps.setWidth?.(panel.siteId,panel.width);}catch{}}break;
   case 'reset-width':{const id=panel.siteId;panel.width=400;sizing=null;place();pushFrame();try{deps.setWidth?.(id,400);}catch{}break;}
   default:break;
  }
 }
 function setDocked(docked){
  if(!panel)return;
  /* the header's dock button on an open panel: the column is taken (or given back) at once, as before */
  panel.docked=!!docked;panel.landing=false;place();pushFrame();
  try{deps.setDocked?.(panel.siteId,!!docked);}catch{}
  if(deps.relayout)deps.relayout();
 }

 /* ---- the site's own page ---- */
 /** Esc: closes the panel unless the site has a dialog, menu or open list that wants it first. The key is held, the page is asked, and either the panel closes or the key is given back to the page. */
 function onPageKey(rec,event,input){
  if(!panel||panel.siteId!==rec.id||panel.closing||!input||rec.replaying)return;
  const key=String(input.key||''),mod=process.platform==='darwin'?input.meta:input.control;
  if(input.type==='keyDown'&&(key==='w'||key==='W')&&mod&&!input.alt&&!input.shift&&!input.isAutoRepeat){event.preventDefault();void close();return;}
  if(key==='F6'&&input.type==='keyDown'&&!input.control&&!input.meta&&!input.alt){event.preventDefault();if(frameRec&&!frameRec.view.webContents.isDestroyed())try{if(deps.focusPage)deps.focusPage(frameRec.view.webContents);else frameRec.view.webContents.focus();}catch{}return;}
  if(key!=='Escape'||input.control||input.meta||input.alt||input.shift)return;
  if(input.type==='keyUp'){if(rec.escHeld){event.preventDefault();}return;}
  if(input.type!=='keyDown'||input.isAutoRepeat)return;
  event.preventDefault();rec.escHeld=true;
  const wc=rec.wc;
  const answer=Promise.race([Promise.resolve(wc.executeJavaScript(ESC_PROBE)),new Promise(resolve=>timers.set(()=>resolve(true),ESC_PROBE_MS))]).catch(()=>true);
  void answer.then(needs=>{
   rec.escHeld=false;
   if(!panel||panel.siteId!==rec.id||wc.isDestroyed())return;
   if(needs){rec.replaying=true;try{wc.sendInputEvent({type:'keyDown',keyCode:'Escape'});wc.sendInputEvent({type:'keyUp',keyCode:'Escape'});}catch{}finally{rec.replaying=false;}}
   else void close();
  });
 }
 /** Open as tab: the live page itself becomes a normal tab (history, scroll and form state kept); the panel closes. */
 async function openAsTab(){
  if(!panel)return {ok:false};
  const rec=live.get(panel.siteId);if(!alive(rec))return {ok:false};
  const url=rec.wc.getURL()||rec.url;
  handedOver={rec,url};
  panelDone();
  try{deps.openAsTab?.({url,profileId:rec.profileId});}catch{}
  /* nothing took the page (the tab could not be made): it stays a live page of the panel, hidden, as a closed panel's is */
  if(handedOver){handedOver=null;rec.open=false;try{rec.view.setVisible(false);}catch{}}
  return {ok:true};
 }
 function panelDone(){
  const p=panel;if(!p)return;timers.clear(p.cap);timers.clear(p.exit);p.finished=true;panel=null;
  try{if(frameRec)frameRec.view.setVisible(false);}catch{}
  if(frameRec){timers.clear(frameRec.idle);frameRec.idle=timers.set(dropFrame,FRAME_IDLE_MS);}
  if(deps.relayout)deps.relayout();publish();
 }
 /** A new tab asks for the page this panel gave away (ensurePage, like Peek's adopt): the same view, the live page, history and all. Null when nothing was handed over. */
 function adopt(){
  const claim=handedOver;if(!claim)return null;handedOver=null;
  const {rec}=claim;
  if(!alive(rec)){live.delete(rec.id);return null;}
  for(const off of rec.listeners.splice(0))try{off();}catch{}
  live.delete(rec.id);
  const w=win();try{w?.contentView.removeChildView(rec.view);}catch{}
  try{rec.view.setBorderRadius?.(0);}catch{}
  try{rec.wc.setWindowOpenHandler(()=>({action:'deny'}));}catch{}
  publish();
  return rec.view;
 }
 /** Unpinned, or another profile: the page goes. */
 /* 14.3 (a member's ask): "Close side panel when switching tabs or Favorites", a setting, off by default (deps.closeOnSwitch). Every committed action comes through
    sync(): when the window's active tab is another one than at the last action, the person switched (another tab, a Favorite, Command search, a workspace, a new tab
    or a closed one); a tab that only loads or changes its title is the same tab and changes nothing. A tab the panel's own page opens (a link to another site, Open as
    tab) is not a switch the person made: fromPanel() marks the opening. The panel closes with its normal close motion, and the keyboard stays where the switch put it. */
 let lastActive=(()=>{try{return deps.activeTabId?.()??null;}catch{return null;}})(),panelOpening=0;
 function noteActive(){
  let active=null;try{active=deps.activeTabId?.()??null;}catch{}
  const was=lastActive;
  if(active===was)return;
  lastActive=active;
  if(was===null||panelOpening>0||!panel||panel.closing)return;
  let wanted=false;try{wanted=deps.closeOnSwitch?.()===true;}catch{}
  if(wanted)void close({restoreFocus:false});
 }
 function fromPanel(fn){panelOpening++;try{return fn();}finally{panelOpening--;}}
 function sync(){
  for(const rec of [...live.values()]){
   const site=siteById(rec.id);
   if(!site||rec.profileId!==profileId()){
    if(panel&&panel.siteId===rec.id){panelDone();}
    discard(rec);
  }else if(rec.url!==site.url&&!rec.open)discard(rec);}
  if(panel&&!siteById(panel.siteId))panelDone();
  noteActive();
  /* every committed action comes through here: the card is only re-placed and the frame only told when something it draws changed */
  if(panel){const key=JSON.stringify([panel.siteId,siteById(panel.siteId),sideNow(),!!deps.dark?.(),speed(),scale(),deps.lang?.()]);if(key!==panel.synced){panel.synced=key;place();pushFrame();}}
  publish();
 }

 /* ---- staying alive, staying light ---- */
 function sweep({pressure=false}={}){
  const keepMs=keepMinutes(deps.keepMinutes?.())*60000;
  for(const rec of [...live.values()]){
   if(!alive(rec))continue;
   if(!mayIdleSleep(rec,{now:now(),keepMs,pressure}))continue;
   const wc=rec.wc;
   Promise.resolve(deps.inspect?deps.inspect(wc):{safe:true}).then(found=>{
    if(found&&found.safe===false)return;
    if(!alive(rec)||rec.open||rec.audible||live.get(rec.id)!==rec)return;
    discard(rec,{keepRecord:false});
   },()=>{});
  }
 }
 function startSweeping(){if(sweepTimer)return;sweepTimer=(deps.setInterval||setInterval)(()=>sweep({pressure:!!deps.underPressure?.()}),SWEEP_MS);try{sweepTimer.unref?.();}catch{}}
 startSweeping();

 const api={
  toggle,open,close,adopt,sync,sweep,place,raise,publish,fromPanel,
  /** A shortcut or the palette: the n-th pinned site of this profile (counted from 0), opened or, when it is the one shown, closed. */
  toggleIndex(index){const site=sites()[index];return site?toggle(site.id):Promise.resolve({ok:false,code:'unknown'});},
  /** The pointer is on a pinned icon: the card's frame (a small local page, never a site) is made while the person decides, so the click does not wait for a new process (the way the tab card is built during its delay). It goes again after a minute unused. */
  warm(){
   if(panel||!win())return;
   const had=frameRec&&!frameRec.view.webContents.isDestroyed();
   const rec=ensureFrame();timers.clear(rec.idle);rec.idle=timers.set(dropFrame,FRAME_IDLE_MS);
   return had?'warm':'made';
  },
  /** The interface's requests (main's 'acira:side-panel'). */
  handle(request){
   if(!request||typeof request!=='object')return {ok:false,code:'invalid'};
   const id=typeof request.id==='string'?request.id:'';
   if(request.type==='sidepanel.toggle')return toggle(id);
   if(request.type==='sidepanel.open')return open(id);
   if(request.type==='sidepanel.close')return close().then(()=>({ok:true}));
   /* 14.1: a click on empty sidebar space closes the panel only where it floats over the page (as a click on the page outside it does); a docked panel is part of the layout and stays */
   if(request.type==='sidepanel.dismiss'){if(!panel||panel.closing||panel.fullscreen)return Promise.resolve({ok:false,code:'none'});if(panel.geometry?panel.geometry.docked:panel.docked)return Promise.resolve({ok:false,code:'docked'});return close().then(()=>({ok:true}));}
   if(request.type==='sidepanel.state')return Promise.resolve(snapshot());
   if(request.type==='sidepanel.warm')return Promise.resolve({ok:true,frame:api.warm()||null});
   /* the now-playing card's volume slider at 0 (and back) on a panel site's row: the page is muted, as a tab's is by `tab.mute` */
   if(request.type==='sidepanel.mute'){const rec=live.get(id);if(!alive(rec)||typeof request.muted!=='boolean')return {ok:false,code:'invalid'};rec.muted=request.muted;try{rec.wc.setAudioMuted(rec.muted);}catch{}publish();return {ok:true};}
   if(request.type==='sidepanel.menu'){const site=siteById(id),a=request.anchor;if(!site||!a||![a.x,a.y,a.width,a.height].every(Number.isFinite))return {ok:false,code:'invalid'};try{deps.showMenu?.({site,anchor:{x:a.x,y:a.y,width:a.width,height:a.height}});}catch{}return {ok:true};}
   return {ok:false,code:'unknown'};
  },
  /** The interface asks for the state of the icons (marks, which is open). */
  snapshot,
  isOpen:()=>!!panel&&!panel.closing,
  /** Main's fullscreen permission: only the shown panel's page may take the window fullscreen. */
  canFullscreen,
  current:()=>panel?{siteId:panel.siteId,docked:panel.docked,closing:panel.closing}:null,
  /** The page (webContents) of one site, for the extension of main's protections and for tests. */
  pageOf:id=>{const rec=live.get(id);return alive(rec)?rec.wc:null;},
  owns:wc=>!!wc&&[...live.values()].some(rec=>alive(rec)&&rec.wc===wc),
  /** A click on a notification the site's page showed (page-input-preload.cjs tells main, main asks the permission service and finds the site): the window comes forward and the site's panel opens, as a tab's notification brings its tab
   *  (a page's own script cannot do it: only a click the engine dispatched is `trusted`; a test app also takes the one a script made, since no rig can press a system notification). */
  notificationClicked:(id,{trusted=false}={})=>{
   const rec=live.get(id);if(!alive(rec)||!siteById(id))return Promise.resolve({ok:false,code:'unknown'});
   if(!trusted&&!deps.testMode?.())return Promise.resolve({ok:false,code:'untrusted'});
   try{deps.reveal?.();}catch{}
   if(panel&&panel.siteId===id&&!panel.closing)return Promise.resolve({ok:true,already:true});
   return open(id);
  },
  /** The sites whose page has a sound the now-playing card lists: {id, media, mediaAt}, the shape main's `mainMediaTab` (Alt+P) reads a tab's by. */
  mediaTabs:()=>[...live.values()].filter(rec=>alive(rec)&&(rec.media==='playing'||rec.media==='paused')).map(rec=>({id:rec.id,media:rec.media,mediaAt:rec.mediaAt||0})),
  siteIds:()=>sites().map(site=>site.id),
  siteOfContents:wc=>{for(const rec of live.values())if(alive(rec)&&rec.wc===wc)return rec.id;return null;},
  /** Called once per layout pass before page views are placed, and for each page view: a docked panel takes its column. */
  begin(){},
  /* a docked card still sliding in (`landing`) leaves the page whole: the card covers the column before the page gives it up (D124) */
  trim:(bounds,page)=>{const g=panel&&!panel.closing&&!panel.landing?(panel.geometry||geometry()):null;return trimBounds(bounds,page,g&&g.docked?g:null);},
  setDocked,
  /** Memory: what each live site costs is read by main (process metrics); this lists them. */
  liveSites:()=>[...live.values()].filter(alive).map(rec=>({id:rec.id,pid:rec.wc.getOSProcessId?.(),open:rec.open,audible:rec.audible,lastUsedAt:rec.lastUsedAt})),
  /** The window is closing. Resolves when every live site's page is gone (D155: the window waits for it before it goes on closing, so what the pages save as they go
      is in the profile's storage before the quit's flush; each page is waited for LEAVE_MS at most). */
  destroy(){
   if(sweepTimer){(deps.clearInterval||clearInterval)(sweepTimer);sweepTimer=null;}
   if(panel){timers.clear(panel.cap);timers.clear(panel.exit);panel=null;}
   const gone=[...live.values()].map(rec=>discard(rec));
   dropFrame();
   return Promise.all(gone).then(()=>undefined);
  }
 };
 return api;
}

module.exports={createSidePanelSites,LEAVE_MS,landingMs,cardGeometry,maxWidthFor,MIN_WIDTH,MAX_SHARE,trimBounds,mayIdleSleep,speedOf,timesOf,ESC_PROBE,MARGIN,HEADER,DOCK_GAP,IN_MS,OUT_MS,VEIL_MS};
