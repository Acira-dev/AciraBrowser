'use strict';
// Tab hover card (R3-14: the card with a picture that Brave and Helium show; Zen idea: look without switching). Rest the
// pointer on a tab and a small card shows its name, its site and a picture of the page.
//
// The picture is taken when you LEAVE a tab (not on hover, which is why Brave's feels slow), at a small size, and kept in
// memory only: a Map in this process, dropped when the tab closes or the setting changes, never written anywhere. Private
// and Tor tabs, every tab of a private window, sleeping tabs and Acira's own pages never get one (tabCardKind decides).
// Beta 14 (the Ctrl+Tab viewer, Settings > Tabs > While switching, show > Pictures) reads the same store: the dock uses the small picture, the large page a bigger one (LARGE_WIDTH)
// kept only for the most recently used tabs (LARGE_KEEP) and dropped, down to the small size, when a tab falls asleep; neither is ever taken just to fill the viewer while the person steps.
// No picture has the page's scrollbar in it: its share of the page's width is read in the page (a plain measurement, asked for as the tab becomes the current one) and cut off the right edge.
//
// The card is a small native view above the page (the page is a native view and covers the interface), made like Peek's
// frame: its page is desktop/tab-card.html. The interface only says which tab the pointer is on and where it is
// (the `tab-card` browser command); the timing lives here: 450ms before the first card, none between neighbouring tabs,
// 120ms of grace when the pointer leaves, and the view is built while the delay runs so the card never waits for a process.
const path=require('node:path');
const FILE=path.join(__dirname,'tab-card.html'),PRELOAD=path.join(__dirname,'tab-card-preload.cjs');
// Interface pixels (the card's page is zoomed with the interface, so a view is `px × uiScale` window pixels).
const WIDTH=264,GAP=6,EDGE=8,MARGIN=24,ESTIMATE={picture:226,bare:76};
const SHOW_MS=450,SKIP_MS=300,LEAVE_MS=120,IDLE_MS=30000,EXIT_MS=160;
const KEEP=40,PICTURE_WIDTH=480,JPEG_QUALITY=72;
const LARGE_KEEP=12,LARGE_WIDTH=960,LARGE_QUALITY=72,BAR_WAIT_MS=150;
// B14 Mini sidebar: a rail item's name is the house tooltip drawn in this view (over the page): one line, sized to its text, at most TIP_MAX wide.
const TIP_MAX=260;
// The tip's side toward the rail has only the gap as shadow room (the view must not reach over the rail and take its pointer): 12px holds
// the whole tooltip shadow (0 4px 12px -2px), so it fades to nothing instead of ending in a cut.
const TIP_GAP=12;

const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const scaled=(box,factor)=>({x:box.x*factor,y:box.y*factor,width:box.width*factor,height:box.height*factor});

/** Where the card and its native view go. `anchor` and `window` are in window pixels, `height` in interface pixels, `scale` is
 * the interface scale. The view is the card plus room for its shadow on the free sides and only the gap on the side that
 * touches the tab, so it never covers the tab it describes. `side` is where the card prefers to be (under the tab, or beside
 * it); it flips to the other side of the tab when it would not fit. `inset` is the card's offset inside the view, in
 * interface pixels, for the page to place it. `floor` is the window pixel row where the page area begins (the bottom of the tab strip, toolbar and
 * bookmarks bar): the card never starts above it, so it drops under the toolbar's back, forward and address controls instead of over them. Pure. */
function cardPlacement({anchor,side='below',height,window:win,scale=1,floor=0,cardWidth=WIDTH,cardGap=GAP}){
 const width=cardWidth*scale,tall=height*scale,gap=cardGap*scale,edge=EDGE*scale,margin=MARGIN*scale;
 const fit=(value,low,high)=>clamp(Math.round(value),Math.round(low),Math.round(Math.max(low,high)));
 let placed,x,y;
 // A sidebar tab asks for 'right' (a sidebar on the right asks for 'left'): the card opens on the page side of the tab, flips to the other
 // side when that does not fit, and drops under the tab in a window too narrow for either.
 const right=anchor.x+anchor.width+gap,left=anchor.x-gap-width,fitsRight=right+width+edge<=win.width,fitsLeft=left>=edge;
 const beside=side==='left'?(fitsLeft?'left':fitsRight?'right':null):side==='right'?(fitsRight?'right':fitsLeft?'left':null):null;
 if(beside){
  placed=beside;x=beside==='left'?left:right;y=fit(Math.max(anchor.y-4*scale,floor),edge,win.height-tall-edge);
 }else{
  const below=Math.max(anchor.y+anchor.height,floor)+gap,fits=below+tall+edge<=win.height;
  placed=fits?'below':'above';y=fits?below:anchor.y-gap-tall;x=fit(anchor.x,edge,win.width-width-edge);
 }
 x=Math.round(x);y=Math.round(y);
 // The view's shadow room takes the pointer like the card does, so beside a sidebar tab near the top it stops at the floor and never
 // reaches over the toolbar's back, forward and address controls (the card itself already starts at or below the floor).
 const inset={left:placed==='right'?gap:margin,right:placed==='left'?gap:margin,top:placed==='below'?gap:beside?Math.max(0,Math.min(margin,y-floor)):margin,bottom:placed==='above'?gap:margin};
 return {side:placed,card:{x,y,width:Math.round(width),height:Math.round(tall)},
  bounds:{x:Math.round(x-inset.left),y:Math.round(y-inset.top),width:Math.round(width+inset.left+inset.right),height:Math.round(tall+inset.top+inset.bottom)},
  inset:{left:inset.left/scale,top:inset.top/scale}};
}

function createTabCard({WebContentsView,getWindow,getState,pageOf=()=>null,blocked=()=>false,pictures:allowed=()=>true,uiScale=()=>1,isDark=()=>true,speed=()=>'premium',reducedMotion=()=>false,say=()=>'Renamed',viewerPictures=()=>false,onPicture=()=>{}}){
 const runtime=()=>require('./runtime.cjs');
 const pictures=new Map(); // tabId -> {data: 'data:image/jpeg;base64,…' (small), large?: 'data:image/jpeg;base64,…', at}
 let view=null,ready=null,readyDone=null,sizeWaiter=null,visible=false,want=null,gen=0,inflight=false,scale=1;
 let showTimer,hideTimer,exitTimer,idleTimer,lastHide=0;

 const windowSize=()=>{try{const box=getWindow().contentView.getBounds();return {width:box.width,height:box.height};}catch{return null;}};
 const profilePrivate=(state,tab)=>Boolean(state.browserProfiles.find(profile=>profile.id===tab?.browserProfileId)?.private);
 const kindOf=(state,tab)=>runtime().tabCardKind(state.settings,tab,profilePrivate(state,tab)||!allowed());
 const motion=()=>reducedMotion()?'off':speed();
 /** Whether a picture may be kept for this tab: the hover card asks for one (its setting), or the Ctrl+Tab viewer does; private and Tor tabs, a private window and Acira's own pages never have one either way. */
 const wantsPicture=(state,tab)=>{if(!tab||tab.sleeping)return false;if(kindOf(state,tab)==='preview')return true;return Boolean(viewerPictures())&&runtime().tabCardKind({tabHoverCard:'preview'},tab,profilePrivate(state,tab)||!allowed())==='preview';};

 /** The page is built early (while the delay runs) and dropped after a quiet half minute, so a browser that is not hovered pays nothing. */
 function prepare(){
  clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(visible)prepare();else destroy();},IDLE_MS);
  if(ready)return ready;
  const win=getWindow();if(!win||win.isDestroyed())return Promise.resolve(false);
  scale=uiScale();
  const made=new WebContentsView({webPreferences:{preload:PRELOAD,contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'acira-tab-card',zoomFactor:scale}});
  view=made;made.setBackgroundColor?.('#00000000');made.setBounds?.({x:0,y:0,width:Math.round(WIDTH*scale)+2*MARGIN,height:Math.round(ESTIMATE.picture*scale)+2*MARGIN});made.setVisible?.(false);
  const wc=made.webContents;
  wc.setZoomFactor?.(scale);
  wc.ipc.on('acira:tab-card',(_event,message)=>{
   if(view!==made)return;
   // Chromium restores the zoom it last kept for this page's origin as the page loads, over the zoomFactor asked for at creation: after an interface scale change the new card page came up zoomed at the old scale. Asked again once it is loaded.
   if(message==='ready'){wc.setZoomFactor?.(scale);readyDone?.(true);readyDone=null;}
   else if(message&&Number.isFinite(message.size)){const wake=sizeWaiter;sizeWaiter=null;wake?.(Number.isFinite(message.width)?{height:message.size,width:message.width}:message.size);}
  });
  win.contentView.addChildView(made);
  ready=new Promise(resolve=>{readyDone=resolve;setTimeout(()=>resolve(false),3000);wc.loadFile(FILE).catch(()=>resolve(false));});
  return ready;
 }
 function destroy(){
  clearTimeout(idleTimer);clearTimeout(showTimer);clearTimeout(exitTimer);visible=false;sizeWaiter?.(null);sizeWaiter=null;readyDone?.(false);readyDone=null;
  const old=view;view=null;ready=null;if(!old)return;
  try{getWindow()?.contentView.removeChildView(old);}catch{}
  try{if(!old.webContents.isDestroyed())old.webContents.close();}catch{}
 }

 /** Shows (or moves) the card for the tab wanted now. Waits for the page to be ready and to report its height, so the card
  * opens at its final size; between neighbouring tabs it just changes content and place. */
 async function present(token){
  const target=want;if(!target||token!==gen)return;
  if(!await prepare()||token!==gen||want!==target||!view)return;
  const state=getState(),labelled=Boolean(target.label),tab=labelled?null:state.tabs.find(t=>t.id===target.tabId),kind=labelled?'name':tab&&kindOf(state,tab);
  if(!(labelled||tab)||!kind||blocked()){hide();return;}
  const win=windowSize();if(!win)return;
  // The open tab is on screen already: its card never shows an older picture of itself.
  const picture=kind==='preview'&&tab&&tab.id!==state.activeTabId&&pictures.get(tab.id)?.data||null,wc=view.webContents;
  const tip=Boolean(target.label?.tip),tipWidth=tip?Math.min(TIP_MAX,Math.max(24,target.label.width||TIP_MAX)):WIDTH;
  const guess=cardPlacement({anchor:target.anchor,side:target.side,floor:target.floor,height:tip?24:picture?ESTIMATE.picture:ESTIMATE.bare,window:win,scale,cardWidth:tipWidth,...(tip?{cardGap:TIP_GAP}:{})});
  const heard=new Promise(resolve=>{sizeWaiter=resolve;setTimeout(()=>{if(sizeWaiter===resolve){sizeWaiter=null;resolve(null);}},400);});
  const fresh=!visible;
  if(fresh)view.setBounds(guess.bounds);
  wc.send('acira:tab-card-state',{tip,title:labelled?target.label.title:runtime().tabDisplayTitle(tab)||'',host:labelled?target.label.host:runtime().tabCardHost(tab.url),renamed:!labelled&&Boolean(tab.customTitle),picture,side:guess.side,inset:guess.inset,dark:isDark(),speed:motion(),reducedMotion:reducedMotion(),labels:{renamed:say('tabrename.renamedTip')}});
  const heardSize=await heard,measured=heardSize&&typeof heardSize==='object'?heardSize.height:heardSize,measuredWidth=heardSize&&typeof heardSize==='object'?heardSize.width:NaN;
  if(token!==gen||want!==target||!view)return;
  const placed=cardPlacement({anchor:target.anchor,side:target.side,floor:target.floor,height:Number.isFinite(measured)?measured:tip?24:picture?ESTIMATE.picture:ESTIMATE.bare,window:win,scale,cardWidth:tip&&Number.isFinite(measuredWidth)?measuredWidth:tipWidth,...(tip?{cardGap:TIP_GAP}:{})});
  view.setBounds(placed.bounds);
  if(fresh){
   clearTimeout(exitTimer);try{getWindow().contentView.addChildView(view);}catch{}
   view.setVisible?.(true);visible=true;
  }
  // The page is told its final inset too (the free sides keep their shadow room; the touching side its gap).
  wc.send('acira:tab-card-state',{reveal:true,instant:!fresh,side:placed.side,inset:placed.inset,speed:motion(),reducedMotion:reducedMotion(),dark:isDark()});
 }

 /** `instant`: a press, a key, a scroll or a drag ends the card on that frame (no fade); the pointer simply leaving the tab fades it. */
 function hide(instant=false){
  clearTimeout(showTimer);clearTimeout(hideTimer);gen++;want=null;sizeWaiter?.(null);sizeWaiter=null;
  if(!visible||!view)return;
  visible=false;lastHide=Date.now();
  const hidden=view;
  try{hidden.webContents.send('acira:tab-card-state',{leaving:true,side:'below',speed:motion(),reducedMotion:reducedMotion()});}catch{}
  clearTimeout(exitTimer);
  if(instant){try{hidden.setVisible?.(false);}catch{}return;}
  exitTimer=setTimeout(()=>{if(!visible&&view===hidden)try{hidden.setVisible?.(false);}catch{}},reducedMotion()?0:EXIT_MS);
 }
 const dismiss=()=>hide(true);

 function hover({tabId,anchor,side,floor,label}){
  const state=getState(),tab=state.tabs.find(t=>t.id===tabId),named=label&&typeof label.title==='string'?{title:label.title.slice(0,300),host:String(label.host||'').slice(0,300),...(label.tip?{tip:true,width:Number(label.width)||0}:{})}:null;
  // A saved page in the sidebar (a bookmark) has no tab: its title and address ride along, and the card is always the plain one.
  if(!(named||tab&&kindOf(state,tab))||!anchor||blocked()){hide();return;}
  clearTimeout(hideTimer);clearTimeout(showTimer);
  want={tabId,anchor:scaled(anchor,uiScale()),side:side==='right'||side==='left'?side:'below',label:named,floor:Number.isFinite(floor)?Math.max(0,floor)*uiScale():0};
  void prepare();
  const delay=visible||Date.now()-lastHide<SKIP_MS?0:SHOW_MS,token=++gen;
  showTimer=setTimeout(()=>{void present(token);},delay);
 }
 function leave(){clearTimeout(showTimer);clearTimeout(hideTimer);gen++;hideTimer=setTimeout(hide,LEAVE_MS);}

 /** The interface's request: the pointer is on a tab (hover), left it (leave), or pressed, typed or scrolled (dismiss). */
 function command(request){
  if(!request||typeof request.action!=='string')return;
  if(request.action==='hover')hover(request);else if(request.action==='leave')leave();else if(request.action==='dismiss')dismiss();
 }

 /** The share of the page's width its own scrollbar takes (0 when it has none or the answer is late): a picture must not carry the scrollbar. A plain read in the page, never a change. The answer for a tab is kept
  * (`bars`), asked for as the tab becomes the current one, so the picture taken as it is LEFT (the page is hidden a moment later, so that capture cannot wait) already knows it. */
 const bars=new Map();
 const measureBar=tabId=>{
  const wc=pageOf(tabId);if(!wc||wc.isDestroyed())return Promise.resolve(bars.get(tabId)??0);
  try{
   return Promise.race([Promise.resolve(wc.executeJavaScript('(()=>{const d=document.documentElement;return [innerWidth,Math.max(0,innerWidth-d.clientWidth)];})()',false)).then(box=>Array.isArray(box)&&box.every(Number.isFinite)&&box[0]>0?box[1]/box[0]:null).catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve(null),BAR_WAIT_MS))])
    .then(share=>{if(share!==null&&!wc.isDestroyed())bars.set(tabId,Math.min(.2,share));return bars.get(tabId)??0;});
  }catch{return Promise.resolve(bars.get(tabId)??0);}
 };
 /** The picture without its scrollbar: the right edge the scrollbar took is cut off. */
 const withoutBar=(image,share)=>{
  try{const size=image.getSize(),cut=Math.round(size.width*share);return cut>0&&cut<size.width?image.crop({x:0,y:0,width:size.width-cut,height:size.height}):image;}catch{return image;}
 };
 /** A picture of the page as it is now, in memory (a small one, and a larger one for the viewer's page). Called as a tab is left (the capture starts in that step: the page is hidden right after), and for the tab on screen as the
  * viewer is asked for (`current`). One at a time: a burst of tab switches never piles up captures (the bug-bash lesson about capturePage), and the encoding waits a beat so the switch itself stays smooth. */
 function capture(tabId,current=false){
  const state=getState(),tab=state.tabs.find(t=>t.id===tabId);
  if(!tab||inflight||!wantsPicture(state,tab))return;
  const wc=pageOf(tabId);if(!wc||wc.isDestroyed()||(wc.isLoading?.()&&!wc.getTitle?.()))return;
  inflight=true;
  let taken;try{taken=wc.capturePage();}catch{inflight=false;return;}
  // the tab on screen is asked for its scrollbar's share now (its page is not going anywhere); a tab being left uses the answer it already gave
  const bar=current?measureBar(tabId):Promise.resolve(bars.get(tabId)??0);
  Promise.all([taken,bar]).then(([picture,share])=>{
   if(!picture||picture.isEmpty())return;
   const image=withoutBar(picture,share);
   setTimeout(()=>{
    try{
     const now=getState().tabs.find(t=>t.id===tabId);if(!now||!wantsPicture(getState(),now))return;
     const size=image.getSize(),small=size.width>PICTURE_WIDTH?image.resize({width:PICTURE_WIDTH,quality:'good'}):image,large=size.width>LARGE_WIDTH?image.resize({width:LARGE_WIDTH,quality:'good'}):image;
     const made=remember(tabId,small.toJPEG(JPEG_QUALITY),viewerPictures()?large.toJPEG(LARGE_QUALITY):null);
     if(current&&made)onPicture(tabId,made);
    }catch{}
   },120);
  }).catch(()=>{}).finally(()=>{inflight=false;});
 }
 /** Keeps a JPEG in memory for a tab (the newest 40), and for the viewer's page a larger one for the newest few. Only the tab-card module reads them. Returns what is kept for the tab. */
 function remember(tabId,jpeg,largeJpeg=null){
  if(!jpeg||!jpeg.length)return null;
  const encode=bytes=>'data:image/jpeg;base64,'+Buffer.from(bytes).toString('base64');
  const before=pictures.get(tabId);
  pictures.delete(tabId);pictures.set(tabId,{data:encode(jpeg),...(largeJpeg&&largeJpeg.length?{large:encode(largeJpeg)}:before?.large?{large:before.large}:{}),at:Date.now()});
  while(pictures.size>KEEP)pictures.delete(pictures.keys().next().value);
  trimLarge();
  const kept=pictures.get(tabId);return {small:kept.data,...(kept.large?{large:kept.large}:{})};
 }
 /** The larger pictures are kept for the most recently used tabs only (the map is in the order they were taken). */
 function trimLarge(){let n=0;for(const key of [...pictures.keys()].reverse()){const entry=pictures.get(key);if(!entry.large)continue;if(++n>LARGE_KEEP)delete entry.large;}}
 /** What the viewer asks for: the pictures kept for these tabs (at most 16), never for a tab that may not have one. */
 function picturesOf(ids){
  const state=getState(),out={};
  for(const id of (Array.isArray(ids)?ids:[]).slice(0,16)){
   const tab=state.tabs.find(t=>t.id===id),kept=tab&&pictures.get(id);
   if(!kept||!wantsPicture(state,tab)&&!tab.sleeping)continue;
   out[id]={small:kept.data,...(kept.large?{large:kept.large}:{})};
  }
  return {pictures:out};
 }
 /** After every committed action: take a picture of the tab just left; forget tabs that are gone and, when the setting no
  * longer asks for pictures, all of them; the card closes when the tab under it goes or the selection moves. */
 function onState(previous,next){
  const mode=next.settings?.tabHoverCard??'preview';
  // the viewer keeps pictures too (Settings > Tabs > While switching, show > Pictures): they go only when neither the hover card nor the viewer asks for them
  if(mode!=='preview'&&!viewerPictures()&&pictures.size)pictures.clear();
  for(const id of [...pictures.keys()]){const tab=next.tabs.find(item=>item.id===id);if(!tab)pictures.delete(id);else if(tab.sleeping&&pictures.get(id).large)delete pictures.get(id).large;}
  for(const id of [...bars.keys()])if(!next.tabs.some(tab=>tab.id===id))bars.delete(id);
  const moved=Boolean(previous)&&previous.activeTabId!==next.activeTabId;
  if(moved){const left=next.tabs.find(tab=>tab.id===previous.activeTabId);if(left&&wantsPicture(next,left))capture(previous.activeTabId);}
  if(moved){const here=next.tabs.find(tab=>tab.id===next.activeTabId);if(here&&wantsPicture(next,here)){void measureBar(here.id);setTimeout(()=>{if(getState().activeTabId===here.id)void measureBar(here.id);},1500);}}
  if((visible||want)&&(moved||(mode==='off'&&!want?.label)||(!want?.label&&!next.tabs.some(tab=>tab.id===want?.tabId))))dismiss();
  if(view&&uiScale()!==scale)destroy();
 }
 /** The window's layout changed: keep the card above the page views, or close it if a menu or a peek took the space. */
 function relayout(){
  if(!visible||!view)return;
  if(blocked()){dismiss();return;}
  try{getWindow().contentView.addChildView(view);}catch{}
 }
 return {command,onState,relayout,capture,remember,picturesOf,clear:()=>pictures.clear(),dismiss,dispose:destroy,
  pictureOf:tabId=>pictures.get(tabId)?.data||null,get size(){return pictures.size;},get visible(){return visible;},get webContents(){return view?.webContents||null;}};
}
module.exports={createTabCard,cardPlacement,WIDTH,GAP,EDGE,MARGIN,SHOW_MS,SKIP_MS,LEAVE_MS,KEEP,LARGE_KEEP,LARGE_WIDTH};
