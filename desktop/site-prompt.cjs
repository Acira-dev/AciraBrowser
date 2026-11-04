'use strict';
// Site prompts (R3-73): everything a website asks of you, as ONE card in the window instead of a separate system window.
//   anchored  permissions, "open this app?": a 320px glass card that grows out of the site-identity icon in the address bar,
//             never takes focus (typing in the page or the address bar carries on), waits its turn behind other requests;
//   centred   JavaScript alert / confirm / prompt, "Leave this site?": a 400px card in the middle of the page, which dims.
// It takes the same call shape as dialog.showMessageBox (buttons, defaultId, cancelId, popover) plus a `site` description, so
// the permission engine and the other callers keep their logic and only the surface changes. The card is a small native view
// above the page (made like the tab hover card), drawn by desktop/site-prompt.html; the text a website supplies is only ever
// shown as text there. Requests are asked one at a time; a request waits while its tab is not the one on screen or another
// popup is open, and is dropped (answered "dismissed") when its page goes away or moves on.
const path=require('node:path');
const FILE=path.join(__dirname,'site-prompt.html'),PRELOAD=path.join(__dirname,'site-prompt-preload.cjs');
// Interface pixels (the card's page is zoomed with the interface, so a view is `px × uiScale` window pixels).
const WIDTH=320,GAP=8,EDGE=8,MARGIN=24,EXIT_MS=150,NEXT_MS=40,IDLE_MS=60000,SIZE_WAIT_MS=600,ESTIMATE=120;
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

/** Where the anchored card and its native view go. `anchor` (the site-identity icon) and `window` are in window pixels,
 * `height` in interface pixels, `scale` is the interface scale. The card hangs 8px under the icon, left edges aligned, and is
 * kept 8px inside the window. The view is the card plus room for its shadow, and on top only the gap, so it never covers the
 * icon it grew from. `origin` is where the aperture opens (the icon's centre, in card pixels). With no icon on screen (focus
 * mode, a hidden toolbar) the card sits at the top-left of the page. Pure. */
function anchoredPlacement({anchor,page=null,window:win,height,scale=1}){
 const width=Math.round(WIDTH*scale),tall=Math.round(height*scale),gap=GAP*scale,edge=EDGE*scale,margin=MARGIN*scale;
 const has=Boolean(anchor&&anchor.width>0&&anchor.height>0);
 let x=has?anchor.x:(page?page.x:0)+12*scale,y=has?anchor.y+anchor.height+gap:(page?page.y:0)+6*scale;
 x=Math.round(clamp(x,edge,Math.max(edge,win.width-width-edge)));y=Math.round(clamp(y,edge,Math.max(edge,win.height-tall-edge)));
 const top=has?clamp(y-(anchor.y+anchor.height),0,margin):margin;
 const bx=Math.max(0,Math.round(x-margin)),by=Math.max(0,Math.round(y-top));
 const bounds={x:bx,y:by,width:Math.min(win.width-bx,width+(x-bx)+margin),height:Math.min(win.height-by,tall+(y-by)+margin)};
 const originX=has?clamp((anchor.x+anchor.width/2-x)/scale,0,WIDTH):24;
 return {card:{x,y,width,height:tall},bounds,inset:{left:(x-bx)/scale,top:(y-by)/scale},origin:{x:originX,y:0}};
}
/** Where the site-identity icon is, in window pixels: read from Acira's own interface (a constant script, never page content).
 * The interface may be scaled, so CSS pixels are multiplied by its factor. null when the icon isn't on screen (focus mode, a
 * hidden toolbar); the address field stands in when the icon isn't there. */
const IDENTITY_SCRIPT="(()=>{const e=document.querySelector('.address-security')||document.querySelector('.address-field');if(!e)return null;const b=e.getBoundingClientRect();return b.width>0&&b.height>0?{x:b.left,y:b.top,width:b.width,height:b.height}:null;})()";
async function readIdentityRect({contents,scale=1}){
 if(!contents||contents.isDestroyed())return null;
 const r=await contents.executeJavaScript(IDENTITY_SCRIPT);
 if(!r||![r.x,r.y,r.width,r.height].every(n=>typeof n==='number'&&Number.isFinite(n)))return null;
 const f=scale>0?scale:1;return {x:r.x*f,y:r.y*f,width:r.width*f,height:r.height*f};
}
/** The centred card's view is the page area itself (the page dims behind the card, and a press on it never reaches the website). */
function centredBounds({page,window:win}){
 const box=page&&page.width>0&&page.height>0?page:{x:0,y:0,width:win.width,height:win.height};
 const x=clamp(Math.round(box.x),0,win.width),y=clamp(Math.round(box.y),0,win.height);
 return {x,y,width:Math.max(1,Math.min(win.width-x,Math.round(box.width))),height:Math.max(1,Math.min(win.height-y,Math.round(box.height)))};
}

const validIndex=(value,count)=>Number.isInteger(value)&&value>=0&&value<count;
/** A message-box description (buttons, ids, popover, site) as the card shows it. Windows order: the actions first, the safe
 * (cancel) answer last. A prompt (popover) accents its first action; a dialog accents its default, and a warning's other
 * actions read as destructive (red text). Pure. */
function describe(options){
 const o=options&&typeof options==='object'?options:{},site=o.site&&typeof o.site==='object'?o.site:{};
 const buttons=(Array.isArray(o.buttons)&&o.buttons.length?o.buttons:['OK']).map(String).slice(0,5);
 const cancelId=validIndex(o.cancelId,buttons.length)?o.cancelId:buttons.length-1;
 const defaultId=validIndex(o.defaultId,buttons.length)?o.defaultId:0;
 const centred=Boolean(site.centered)||!o.popover;
 const natural=buttons.map((_,index)=>index).sort((a,b)=>(a===cancelId)-(b===cancelId));
 const accent=centred?defaultId:(natural.find(index=>index!==cancelId)??defaultId);
 // The "close" variant (R4-47, closing the browser): the primary button is last, after Cancel, like Back / Continue in setup.
 const variant=site.variant==='close'&&site.centered?'close':'';
 const order=variant?natural.slice().sort((a,b)=>(a===accent)-(b===accent)):natural;
 const sites=value=>value&&typeof value==='object'&&Array.isArray(value.hosts)?{hosts:value.hosts.filter(h=>typeof h==='string'&&h).slice(0,8).map(h=>h.slice(0,200)),more:Number.isInteger(value.more)&&value.more>0?Math.min(value.more,999):0}:null;
 const warning=o.type==='warning';
 return {
  mode:centred?'centered':'anchored',host:typeof site.host==='string'?site.host.slice(0,200):'',
  message:String(o.message||'').slice(0,centred?400:300),detail:String(site.detail!==undefined?site.detail:o.detail||'').slice(0,centred?4000:600),
  buttons:order.map(index=>({index,label:buttons[index].slice(0,60),role:index===accent?'primary':(centred&&warning&&index!==cancelId?'danger':'secondary')})),
  count:buttons.length,cancelId,defaultId,
  variant,strip:variant?sites(site.strip):null,list:variant?sites(site.list):null,
  top:Boolean(variant&&site.top),caption:variant?String(site.caption||'').slice(0,200):'',body:variant?String(site.body||'').slice(0,400):'',
  app:Boolean(site.app),urgent:Boolean(site.urgent),manage:Boolean(site.manage),private:Boolean(site.private),input:site.input&&typeof site.input==='object'?{value:String(site.input.value??'').slice(0,10000)}:null,
  mute:site.mute&&typeof site.mute.label==='string'?{label:site.mute.label.slice(0,120)}:null,
 };
}

const INTERNAL_PAGES=require('./internal-pages.json');

function createSitePrompt({WebContentsView,getWindow,getState=()=>null,tabOf=()=>null,anchorOf=async()=>null,pageBounds=()=>null,blocked=()=>false,
 isDark=()=>true,speed=()=>'premium',reducedMotion=()=>false,uiScale=()=>1,faviconFor=()=>'',appIcon=()=>'',say=id=>id,onManage=()=>{},restoreFocus=()=>{},enabled=()=>true}){
 const queue=[];
 let view=null,ready=null,readyDone=null,sizeWaiter=null,shown=null,showing=null,exiting=null,exitTimer=null,idleTimer=null,nextTimer=null,gen=0,counter=0,scale=1,disposed=false,visible=false,crashes=[];

 /* An open Acira page ("acira://settings") draws the glyph its tab and the sidebar wear (src/ui/internalPageIcon.ts), never a letter; the New tab keeps the mark. */
 const pageItem=(host,entry)=>{
  if(!/^acira:\/\//.test(host))return null;
  const route=host.slice(8).split(/[?#/]/)[0];
  if(route===''||route==='new'||route==='home')return {host:'',favicon:appIcon()||''};
  const shapes=INTERNAL_PAGES.glyphs[INTERNAL_PAGES.routes[route]||INTERNAL_PAGES.fallback];
  return {host:'',favicon:'',glyph:shapes.map(shape=>'s' in shape?{s:shape.s}:'f' in shape?{f:shape.f}:{d:shape.d})};
 };
 const iconOf=(entry,host)=>{try{return host&&!entry.private?faviconFor(host)||'':'';}catch{return '';}};
 const windowSize=()=>{try{const box=getWindow().contentView.getBounds();return {width:box.width,height:box.height};}catch{return null;}};
 const motion=()=>reducedMotion()?'off':speed();
 const live=()=>view&&!view.webContents.isDestroyed();

 function prepare(){
  clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(!shown&&!showing&&!queue.length)destroy();else prepare();},IDLE_MS);idleTimer.unref?.();
  if(ready)return ready;
  const win=getWindow();if(!win||win.isDestroyed?.())return Promise.resolve(false);
  scale=uiScale();
  const made=new WebContentsView({webPreferences:{preload:PRELOAD,contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'acira-site-prompt',zoomFactor:scale}});
  view=made;made.setBackgroundColor?.('#00000000');made.setBounds?.({x:0,y:0,width:Math.round(WIDTH*scale)+2*MARGIN,height:Math.round(ESTIMATE*scale)+2*MARGIN});made.setVisible?.(false);
  const wc=made.webContents;
  wc.setZoomFactor?.(scale);
  wc.setWindowOpenHandler?.(()=>({action:'deny'}));
  wc.on?.('will-navigate',event=>event.preventDefault());
  wc.ipc.on('acira:site-prompt',(_event,message)=>{if(view===made)onMessage(message);});
  wc.on?.('render-process-gone',(_event,details)=>{if(view===made&&details?.reason!=='clean-exit')gone();});
  win.contentView.addChildView(made);
  ready=new Promise(resolve=>{readyDone=resolve;setTimeout(()=>resolve(false),4000);wc.loadFile(FILE).catch(()=>resolve(false));});
  return ready;
 }
 function destroy(){
  clearTimeout(idleTimer);clearTimeout(exitTimer);clearTimeout(nextTimer);visible=false;sizeWaiter?.(null);sizeWaiter=null;readyDone?.(false);readyDone=null;
  const old=view;view=null;ready=null;if(!old)return;
  try{getWindow()?.contentView.removeChildView(old);}catch{}
  try{if(!old.webContents.isDestroyed())old.webContents.close();}catch{}
 }
 /** The card's page stopped (its renderer crashed or was killed). It used to stay blank and unanswered, and every later request waited behind it. The
  *  request stays queued and a new card shows it again; when the card keeps stopping (three times in a minute), every waiting request is answered the safe
  *  way (its cancel button), so nothing waits for good. */
 function gone(){
  const now=Date.now();crashes=crashes.filter(at=>now-at<60000);crashes.push(now);
  shown=null;showing=null;gen++;exiting=null;
  destroy();
  if(crashes.length>=3){for(const entry of [...queue])finish(entry,{response:entry.cancelId,dismissed:true});return;}
  clearTimeout(nextTimer);nextTimer=setTimeout(pump,0);
 }
 const send=state=>{if(live())try{view.webContents.send('acira:site-prompt-state',state);}catch{}};

 function onMessage(message){
  if(!message||typeof message.type!=='string')return;
  if(message.type==='ready'){readyDone?.(true);readyDone=null;return;}
  if(message.type==='size'){const wake=sizeWaiter;sizeWaiter=null;wake?.(message.height);return;}
  const entry=shown;if(!entry||message.token!==entry.token)return;
  if(message.type==='manage'){finish(entry,{response:entry.cancelId,dismissed:true});try{onManage(entry);}catch{}return;}
  if(message.type==='answer'&&validIndex(message.index,entry.count))finish(entry,{response:message.index,dismissed:message.dismissed===true&&message.index===entry.cancelId,
   ...(typeof message.value==='string'&&entry.input?{value:message.value}:{}),...(typeof message.muted==='boolean'?{muted:message.muted}:{})});
 }

 const stale=entry=>{
  if(entry.done)return true;
  try{if(entry.contents&&entry.contents.isDestroyed?.())return true;}catch{return true;}
  const state=getState();if(entry.tabId&&state&&!state.tabs.some(tab=>tab.id===entry.tabId))return true;
  try{return Boolean(entry.stale&&entry.stale());}catch{return true;}
 };
 const eligible=entry=>{
  // A window-level question (closing the window or the browser) is about the whole window, not one tab, and cannot wait behind a menu.
  if(entry.urgent)return true;
  const state=getState();
  if(entry.tabId&&state&&state.activeTabId!==entry.tabId)return false;
  try{return !blocked(entry.mode);}catch{return false;}
 };

 /** The card answers and goes: the caller continues at once, the card takes its exit, then the next request is shown. */
 function finish(entry,result){
  if(entry.done)return;entry.done=true;
  const at=queue.indexOf(entry);if(at>=0)queue.splice(at,1);
  const wasShown=shown===entry;
  if(wasShown){shown=null;gen++;hideCard(entry);}
  if(showing===entry){showing=null;gen++;}
  entry.resolve({response:result.response,checkboxChecked:false,...(result.dismissed?{dismissed:true}:{}),...(result.value===undefined?{}:{value:result.value}),...(result.muted===undefined?{}:{muted:result.muted})});
  if(wasShown&&(entry.mode==='centered'||view?.webContents?.isFocused?.()))try{restoreFocus();}catch{}
  clearTimeout(nextTimer);nextTimer=setTimeout(pump,wasShown?(reducedMotion()?0:EXIT_MS)+NEXT_MS:0);
 }
 /** Takes the card off screen with its exit; the request stays queued when it is only waiting (tab, popup), or is already answered. */
 function hideCard(entry){
  if(!live()||!visible)return;
  visible=false;const hidden=view;
  send({type:'leave',token:entry?.token,origin:entry?.origin});
  clearTimeout(exitTimer);
  const ms=reducedMotion()||motion()==='off'?0:EXIT_MS;
  exiting=new Promise(resolve=>{exitTimer=setTimeout(()=>{exiting=null;if(!visible&&view===hidden&&live()){try{hidden.setVisible?.(false);hidden.setBounds?.({x:0,y:0,width:0,height:0});}catch{}send({type:'hide'});}resolve();},ms);});
 }

 function prune(){
  for(const entry of [...queue])if(stale(entry))finish(entry,{response:entry.cancelId,dismissed:true});
 }
 /** Shows the first request that may be shown now and hides a card that may not (another tab, another popup). */
 function pump(){
  if(disposed||!enabled())return;
  prune();
  const want=queue.find(eligible)||null;
  if(shown&&shown!==want){const parked=shown;shown=null;gen++;hideCard(parked);}
  if(showing&&showing!==want){showing=null;gen++;}
  if(want&&!shown&&!showing)void present(want);
 }

 async function present(entry){
  const token=++gen;showing=entry;
  const still=()=>token===gen&&showing===entry&&!entry.done&&!disposed;
  if(!await prepare()){if(still())finish(entry,{response:entry.cancelId,dismissed:true});return;}
  if(!still())return;
  if(exiting)await exiting;
  if(!still())return;
  const win=windowSize();if(!win){showing=null;return;}
  const anchor=entry.mode==='anchored'?await Promise.resolve().then(anchorOf).catch(()=>null):null;
  if(!still())return;
  const page=pageBounds(),state=getState();
  const flags={dark:isDark(),speed:motion(),reducedMotion:reducedMotion()};
  const heard=new Promise(resolve=>{sizeWaiter=resolve;setTimeout(()=>{if(sizeWaiter===resolve){sizeWaiter=null;resolve(null);}},SIZE_WAIT_MS);});
  scale=uiScale();view.webContents.setZoomFactor?.(scale);
  const guess=entry.mode==='anchored'?anchoredPlacement({anchor,page,window:win,height:ESTIMATE,scale}):null;
  if(guess)view.setBounds(guess.bounds);else view.setBounds(centredBounds({page,window:win}));
  const icons=group=>group?{items:group.hosts.map(host=>pageItem(host,entry)||({host,favicon:iconOf(entry,host)})),more:group.more,moreLabel:group.more?say('closeGuard.andMore',{count:group.more}):''}:null;
  send({type:'show',token:entry.token,mode:entry.mode,host:entry.host,message:entry.message,detail:entry.detail,favicon:entry.favicon(),variant:entry.variant,top:entry.top,caption:entry.caption,body:entry.body,strip:icons(entry.strip),list:icons(entry.list),
   buttons:entry.buttons,cancelIndex:entry.cancelId,defaultIndex:entry.defaultId,input:entry.input,mute:entry.mute,
   manage:entry.manage?{label:say('sitePrompt.manage')}:null,note:entry.private?say('sitePrompt.privateNote'):'',closeLabel:say('toast.dismiss'),
   inset:guess?guess.inset:{left:0,top:0},origin:guess?guess.origin:{x:0,y:0},...flags});
  const measured=await heard;
  if(!still())return;
  const height=Number.isFinite(measured)?measured:ESTIMATE;entry.height=height;
  let placed=null;
  if(entry.mode==='anchored'){placed=anchoredPlacement({anchor,page,window:win,height,scale});view.setBounds(placed.bounds);}
  else view.setBounds(centredBounds({page,window:win}));
  try{getWindow().contentView.addChildView(view);}catch{}
  clearTimeout(exitTimer);view.setVisible?.(true);visible=true;shown=entry;showing=null;entry.origin=placed?placed.origin:undefined;
  send({type:'reveal',token:entry.token,inset:placed?placed.inset:undefined,origin:placed?placed.origin:undefined,focus:entry.mode==='centered'&&Boolean(getWindow()?.isFocused?.()),...flags});
  if(entry.mode==='centered'&&getWindow()?.isFocused?.())try{view.webContents.focus();}catch{}
  void state;
 }

 /** Asks one question. `options` has the dialog.showMessageBox shape plus `site`: {host, contents, centered, manage, private, input,
  * mute, stale}. Resolves {response, dismissed?, value?, muted?}; "dismissed" means nobody decided (Esc, ×, the page went away). */
 function showMessageBox(options){
  const d=describe(options),site=(options&&options.site)||{};
  return new Promise(resolve=>{
   if(disposed){resolve({response:d.cancelId,checkboxChecked:false,dismissed:true});return;}
   let tabId=null;try{tabId=site.contents?tabOf(site.contents):null;}catch{}
   const entry={...d,token:++counter,resolve,contents:site.contents||null,tabId,stale:typeof site.stale==='function'?site.stale:null,done:false,
    favicon:()=>{try{if(d.app)return appIcon()||'';return d.host&&!d.private?faviconFor(d.host)||'':'';}catch{return '';}}};
   queue.push(entry);
   prune();
   if(!entry.done)pump();
  });
 }

 /** The window's layout changed: stay above the page views, follow the icon, or step aside for a popup that took the space. */
 function relayout(){
  if(disposed)return;
  pump();
  if(!shown||!live())return;
  try{getWindow().contentView.addChildView(view);}catch{}
  const entry=shown;
  if(entry.mode==='anchored'){
   const win=windowSize();if(!win)return;
   Promise.resolve().then(anchorOf).catch(()=>null).then(anchor=>{
    if(shown!==entry||!live())return;
    const placed=anchoredPlacement({anchor,page:pageBounds(),window:win,height:entry.height||ESTIMATE,scale});view.setBounds(placed.bounds);
   });
  }else{const win=windowSize();if(win)view.setBounds(centredBounds({page:pageBounds(),window:win}));}
 }
 /** After every committed action: a tab that went away drops its requests; a tab switch shows the right one. */
 function onState(){if(!disposed&&(queue.length||shown))pump();}
 function dispose(){
  disposed=true;
  for(const entry of [...queue])finish(entry,{response:entry.cancelId,dismissed:true});
  destroy();
 }
 /** A window that was closing and was kept open (a page asked to stay) takes questions again. */
 const reopen=()=>{disposed=false;};
 return {showMessageBox,relayout,onState,dispose,reopen,pump,enabled,
  get visible(){return visible;},get pending(){return queue.length;},get current(){return shown?{token:shown.token,host:shown.host,mode:shown.mode}:null;},get webContents(){return view?.webContents||null;}};
}
module.exports={createSitePrompt,anchoredPlacement,centredBounds,describe,readIdentityRect,IDENTITY_SCRIPT,WIDTH,GAP,EDGE,MARGIN,EXIT_MS,NEXT_MS};
