const {ipcRenderer}=require('electron');
// Tab sleep (13.5): did the PERSON touch a drop-down (<select>) on this page? A page's own script that sets a select's value (docs.python.org's version and language
// pickers) looks like a typed-in edit to the sleep check (desktop/tab-sleep.cjs inspectPage), so the tab never slept. This remembers, from the start of the document, what the
// person did, in this isolated world where the page's scripts can neither read nor forge it (event.isTrusted is true only for the browser's own events: a page's dispatchEvent and
// element.click() are never trusted). The main process reads it back with webContents.executeJavaScriptInIsolatedWorld(999, ...) (tab-sleep.cjs inspectLive); a missing or
// unreadable record means "unknown" and the tab is kept awake as before. "Touched" is any of:
//  - a trusted change / input / key / pointer / click on a select or inside one;
//  - a select whose chosen option is not what it was when the person first pressed a key or a pointer anywhere in the page (the state is read in the capture phase of that first press,
//    before any page handler runs): a custom drop-down (select2, Chosen, Radix, bootstrap-select...) keeps a hidden native select that its script sets after the person clicked its
//    widget, and so may an extension that fills a form after the person pressed something in the page; no trusted event ever reaches that select. A select the page creates after
//    that first press counts as changed. One that only the page's own script moved before the first press, or never, does not: that is the docs.python.org case.
//    (The window's own blur is NOT such a moment: in the real app it fires while a page is still loading, before its script has set its drop-downs, and the tab then never slept.)
// Registered first on purpose: no other listener of this file may stop an event before it is seen. One answer for the whole document (not per element): a page that rebuilds its select
// after the person chose still counts as touched. A full navigation is a new document and a new record; pushState keeps it. Main frame only (the check reads the main frame).
// The record also says how the document was reached (nav: 'navigate', 'back_forward', 'reload', ...). A document reached by Back / Forward or a reload may have had its drop-down values put
// back by Chromium's own form restoration, which is the person's earlier choice and not the page's script: the sleep check (tab-sleep.cjs inspectLive) only trusts 'navigate', and
// 'back_forward' only for the page Acira itself restored when it woke a sleeping tab.
if(process.isMainFrame){
 try{
  let kind='';try{kind=String(performance.getEntriesByType('navigation')[0]?.type||'');}catch{/* unknown */}
  let direct=false,baseline=null;
  const signature=select=>{try{return select.multiple?Array.prototype.map.call(select.selectedOptions,option=>option.index).join(','):String(select.selectedIndex);}catch{return '?';}};
  const changedSincePress=()=>{
   if(!baseline)return false;
   try{for(const select of document.querySelectorAll('select')){const before=baseline.get(select);if(before===undefined||before!==signature(select))return true;}}catch{return true;}
   return false;
  };
  const record={v:1,nav:kind,get baseline(){return baseline!==null;},get touched(){return direct||changedSincePress();}};
  const PRESS=new Set(['pointerdown','mousedown','click','keydown']);
  const note=event=>{
   if(direct||!event.isTrusted)return;
   if(!baseline&&PRESS.has(event.type)){try{const seen=new WeakMap();for(const select of document.querySelectorAll('select'))seen.set(select,signature(select));baseline=seen;}catch{direct=true;return;}}
   const first=typeof event.composedPath==='function'?event.composedPath()[0]:event.target;
   const select=first&&typeof first.closest==='function'?first.closest('select'):null;
   if(select)direct=true;
  };
  for(const type of ['change','input','pointerdown','mousedown','click','keydown'])window.addEventListener(type,note,{capture:true,passive:true});
  window.__aciraSelectRecord=record;
 }catch{/* no record: the sleep check treats that as unknown and keeps the tab awake */}
}
// No API is exposed to websites. Only trusted link-preview gestures and the address of a plain link click (for the Leave site?
// card, at the end) cross this sandboxed, isolated bridge; auth and page data do not. Zoom is not handled here: a trackpad pinch reaches a page as a cancelable Ctrl+wheel before Chromium turns it
// into visual-viewport zoom, so cancelling Ctrl+wheel in a page turned every pinch into reflowing page zoom. Chromium zooms the
// page itself (zoom-changed in main.cjs) and magnifies on pinch.
// macOS only: Chromium turns Ctrl+wheel into page zoom on every other platform and scrolls the page on a Mac, so the wheel with the
// Control key held is handled here (a notch is one preset step; a trackpad stream keeps a running total in main, as on Acira's own pages). A pinch also arrives as a ctrl+wheel but with no
// Control key down, so it stays Chromium's (the reason above for not cancelling Ctrl+wheel in general). The wheel listener exists only
// while Control is held (a non-passive wheel listener costs scrolling smoothness) and a page that cancels the wheel itself keeps it.
if(process.platform==='darwin'){
 let held=false;
 const zoom=event=>{if(!event.isTrusted||!event.ctrlKey||event.metaKey||event.altKey||event.defaultPrevented||!event.deltaY)return;event.preventDefault();ipcRenderer.send('acira:page-wheel-zoom',{deltaY:event.deltaY,deltaMode:event.deltaMode});};
 const hold=on=>{if(on===held)return;held=on;if(on)window.addEventListener('wheel',zoom,{passive:false});else window.removeEventListener('wheel',zoom);};
 window.addEventListener('keydown',event=>{if(event.key==='Control')hold(true);},{capture:true,passive:true});
 window.addEventListener('keyup',event=>{if(event.key==='Control')hold(false);},{capture:true,passive:true});
 window.addEventListener('blur',()=>hold(false),{passive:true});
 // A key reaches only the focused frame; main says when Control moves, so a wheel over an embedded frame is heard too.
 ipcRenderer.on('acira:control-held',(_event,down)=>hold(down===true));
}
// Alt+click or Shift+click on a link previews it (Peek, like Zen's Glance and Arc; Chromium would download it or open a
// window). One modifier only, and a drag that moved more than 4px is not a click (as in Zen's Glance). Only the link's
// http(s) address, where it was clicked and the box of the link (so the preview grows from the link) cross the bridge.
let pointerDown=null;
// Settings > Tabs > Link preview (on by default): when it is off the browser says so, and these gestures are Chromium's again.
let previewOn=true;
ipcRenderer.on?.('acira:link-preview',(_event,value)=>{previewOn=value?.on!==false;});
if(process.isMainFrame)window.addEventListener('mousedown',event=>{pointerDown=event.isTrusted&&event.button===0?{x:event.clientX,y:event.clientY}:null;},{capture:true,passive:true});
/** The link's own box (the line the pointer is on, for a link that wraps), in viewport pixels; none for an image map area. */
const linkBox=(link,at)=>{
 try{const boxes=[...link.getClientRects()],hit=boxes.find(r=>at.x>=r.left&&at.x<=r.right&&at.y>=r.top&&at.y<=r.bottom)||boxes[0];
  return hit&&hit.width>0&&hit.height>0?{x:Math.round(hit.left),y:Math.round(hit.top),width:Math.round(hit.width),height:Math.round(hit.height)}:undefined;}catch{return undefined;}
};
const sendPeek=(link,at)=>ipcRenderer.send('acira:page-peek-link',{url:String(link.href).slice(0,4096),x:Math.round(at.x),y:Math.round(at.y),rect:linkBox(link,at)});
if(process.isMainFrame)window.addEventListener('click',event=>{
 if(!previewOn||!event.isTrusted||!event.shiftKey||event.ctrlKey||event.metaKey||event.altKey||event.button!==0)return;
 if(pointerDown&&Math.hypot(event.clientX-pointerDown.x,event.clientY-pointerDown.y)>4)return;
 const link=event.composedPath().find(node=>node instanceof HTMLAnchorElement||node instanceof HTMLAreaElement);
 if(!link||!/^https?:/i.test(link.href||''))return;
 event.preventDefault();event.stopImmediatePropagation();sendPeek(link,{x:event.clientX,y:event.clientY});
},{capture:true});
// Press and hold a link (mouse or pen, 450ms, moving under 4px) previews it too, like Arc. Releasing earlier is an ordinary
// click; moving, dragging, scrolling or any other button cancels it; the click that follows a preview is swallowed.
const HOLD_MS=450;let hold=null,swallowUntil=0;
const cancelHold=()=>{if(hold){clearTimeout(hold.timer);hold=null;}};
if(process.isMainFrame){
 window.addEventListener('pointerdown',event=>{
  cancelHold();
  if(!previewOn||!event.isTrusted||event.button!==0||event.pointerType==='touch'||event.shiftKey||event.ctrlKey||event.metaKey||event.altKey)return;
  const link=event.composedPath().find(node=>node instanceof HTMLAnchorElement||node instanceof HTMLAreaElement);
  if(!link||!/^https?:/i.test(link.href||''))return;
  const at={x:event.clientX,y:event.clientY};
  hold={...at,timer:setTimeout(()=>{hold=null;swallowUntil=Date.now()+1500;sendPeek(link,at);},HOLD_MS)};
 },{capture:true,passive:true});
 window.addEventListener('pointermove',event=>{if(hold&&Math.hypot(event.clientX-hold.x,event.clientY-hold.y)>4)cancelHold();},{capture:true,passive:true});
 for(const name of ['pointerup','pointercancel','dragstart','scroll','wheel','blur','contextmenu'])window.addEventListener(name,cancelHold,{capture:true,passive:true});
 window.addEventListener('click',event=>{if(Date.now()<swallowUntil&&event.isTrusted){swallowUntil=0;event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
}
// Alt+click on a link previews it (Peek; Chromium would download it). Ctrl+Alt+click opens it in split view beside this page
// instead. A keyboard that types with AltGr reports Ctrl+Alt for that key: it is not a gesture. Only the link's own http(s)
// address of a trusted click crosses the bridge.
if(process.isMainFrame)window.addEventListener('click',event=>{
 if(!previewOn||!event.isTrusted||!event.altKey||event.metaKey||event.shiftKey||event.button!==0)return;
 if(event.ctrlKey&&event.getModifierState?.('AltGraph'))return;
 if(!event.ctrlKey&&pointerDown&&Math.hypot(event.clientX-pointerDown.x,event.clientY-pointerDown.y)>4)return;
 const link=event.composedPath().find(node=>node instanceof HTMLAnchorElement||node instanceof HTMLAreaElement);
 if(!link||!/^https?:/i.test(link.href||''))return;
 event.preventDefault();event.stopImmediatePropagation();
 if(event.ctrlKey)ipcRenderer.send('acira:page-split-link',String(link.href).slice(0,4096));else sendPeek(link,{x:event.clientX,y:event.clientY});
},{capture:true});
// Alt+Enter on a focused link previews it from the keyboard (the same gesture as Alt+click); it grows from the link's box.
if(process.isMainFrame)window.addEventListener('keydown',event=>{
 if(!previewOn||!event.isTrusted||event.key!=='Enter'||!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.repeat)return;
 if(event.getModifierState?.('AltGraph'))return;
 const link=event.composedPath().find(node=>node instanceof HTMLAnchorElement||node instanceof HTMLAreaElement);
 if(!link||!/^https?:/i.test(link.href||''))return;
 const box=linkBox(link,{x:-1,y:-1});
 event.preventDefault();event.stopImmediatePropagation();sendPeek(link,box?{x:box.x+box.width/2,y:box.y+box.height/2}:{x:0,y:0});
},{capture:true});
// R8 edge intent (edge-reveal.cjs): the sidebar and top bar come up when the pointer rests at the window's edge, and that is also where
// pages put a seek bar, a slider or a link. Near the edge only, say whether the pointer is over something to use (a control the
// page draws; text and custom cursors are told by the cursor itself in main), and whether an in-page drag or a pointer lock is on.
// A boolean each; nothing else leaves the page. Inside a cross-origin frame main's input-event and cursor-changed cover it.
if(process.isMainFrame){
 const BAND=24,CONTROL='a[href],button,input,select,textarea,summary,video,audio,canvas,[role=slider],[role=scrollbar],[role=button],[role=link],[role=tab],[role=menuitem],[draggable=true],[contenteditable]:not([contenteditable=false]),[tabindex]:not([tabindex^="-"])';
 const sent={hover:false,drag:false,lock:false};let beat=0;
 const send=patch=>{let changed=false;for(const key in patch)if(sent[key]!==patch[key]){sent[key]=patch[key];changed=true;}if(changed)ipcRenderer.send('acira:edge-intent',patch);};
 // A control that covers most of the window is the page's surface, not something to use at its edge: a video player filling the window (YouTube's theater and
 // "inline fullscreen" extensions make the player the whole page), a full-window canvas or wrapper. Every edge point of such a page counted as a control, so every rest
 // at the edge needed the long wait for a control under the pointer (650 ms, 400 in Fast; 260/180 pressed to the edge) and the bars seemed not to come at all.
 // Real controls (a seek bar, a link, a button, a slider) are small against the window.
 const covers=node=>{try{const r=node.getBoundingClientRect(),w=window.innerWidth||document.documentElement.clientWidth,h=window.innerHeight||document.documentElement.clientHeight;return w>0&&h>0&&r.width>=w*0.5&&r.height>=h*0.5;}catch(e){return false;}};
 const overControl=event=>{for(const node of event.composedPath?.()||[])if(node instanceof Element&&node.matches?.(CONTROL)&&!covers(node))return true;return false;};
 window.addEventListener('pointermove',event=>{if(event.isTrusted)send({hover:(event.clientX<=BAND||event.clientY<=BAND)&&overControl(event)});},{capture:true,passive:true});
 // Entering a frame: the page cannot see inside (the pointer leaves with no element to go to), so an unknown control is assumed
 // when a frame reaches the band; the next move in this document sets it again.
 const frameInBand=()=>{for(const el of document.querySelectorAll('iframe,embed,object')){const r=el.getBoundingClientRect();if(r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&(r.left<=BAND||r.top<=BAND))return true;}return false;};
 window.addEventListener('pointerout',event=>{if(!event.isTrusted)return;const to=event.relatedTarget;if(to instanceof HTMLIFrameElement||to instanceof HTMLEmbedElement||to instanceof HTMLObjectElement)send({hover:true});else if(!to)send({hover:frameInBand()});},{capture:true,passive:true});
 for(const name of ['dragstart','dragenter'])window.addEventListener(name,event=>{if(event.isTrusted)send({drag:true});},{capture:true,passive:true});
 // Main drops a drag it has not heard of for 2s (a drag that ended without an event): dragover keeps it alive.
 window.addEventListener('dragover',event=>{const now=Date.now();if(event.isTrusted&&now-beat>500){beat=now;sent.drag=true;ipcRenderer.send('acira:edge-intent',{drag:true});}},{capture:true,passive:true});
 for(const name of ['dragend','drop'])window.addEventListener(name,()=>send({drag:false}),{capture:true,passive:true});
 window.addEventListener('dragleave',event=>{if(!event.relatedTarget)send({drag:false});},{capture:true,passive:true});
 document.addEventListener('pointerlockchange',()=>send({lock:!!document.pointerLockElement}));
 window.addEventListener('pagehide',()=>{if(sent.hover||sent.drag||sent.lock){sent.hover=sent.drag=sent.lock=false;ipcRenderer.send('acira:edge-intent',{hover:false,drag:false,lock:false});}});
}
// A plain click on a link that replaces this page says where it goes. A page that asks "Leave site?" on the way out raises
// will-prevent-unload in main, which Electron asks synchronously and without the address: knowing the click lets main ask in the
// browser's own card (as for a typed address or a tab close) and repeat the click on Leave. Heard as the click bubbles out, so a
// click the page took over (a router's preventDefault) is not reported. Only the link's http(s) address crosses.
if(process.isMainFrame)window.addEventListener('click',event=>{
 if(!event.isTrusted||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
 const link=event.composedPath().find(node=>node instanceof HTMLAnchorElement||node instanceof HTMLAreaElement);
 if(!link||!/^https?:/i.test(link.href||'')||link.hasAttribute('download'))return;
 const target=String(link.target||document.querySelector('base[target]')?.target||'').toLowerCase();
 if(target&&target!=='_self'&&target!=='_top'&&target!=='_parent')return;
 ipcRenderer.send('acira:link-intent',String(link.href).slice(0,4096));
},{passive:true});
// A navigation the page starts itself (a script, a form, a meta refresh, a link the page handled) says where it goes just before the page's own "Leave site?"
// prompt: the Navigation API's navigate event comes first, then the unload check, which Electron asks main synchronously and without the address. Knowing
// where it goes lets main ask in the browser's own card and repeat the navigation on Leave (desktop/leave-gate.cjs). Only full-page web navigations cross.
// A form that posts cannot be repeated as an address: the form that was submitted is kept here, and main asks for the same submit again after Leave.
let lastSubmit=null;
if(process.isMainFrame){
 window.addEventListener('submit',event=>{if(event.isTrusted&&event.target instanceof HTMLFormElement)lastSubmit={form:event.target,submitter:event.submitter||null,at:Date.now()};},{capture:true,passive:true});
 ipcRenderer.on('acira:replay-submit',()=>{
  const last=lastSubmit;lastSubmit=null;
  if(!last||Date.now()-last.at>15000||!last.form.isConnected)return;
  try{last.form.requestSubmit(last.submitter&&last.form.contains(last.submitter)?last.submitter:undefined);}catch{}
 });
 if(window.navigation&&typeof window.navigation.addEventListener==='function')window.navigation.addEventListener('navigate',event=>{
  try{
   if(!event.isTrusted||event.hashChange||event.downloadRequest)return;
   const destination=event.destination;if(!destination||destination.sameDocument)return;
   const url=String(destination.url||'');if(!/^https?:/i.test(url))return;
   if(event.formData&&(!lastSubmit||Date.now()-lastSubmit.at>2000)){const source=event.sourceElement,form=source instanceof HTMLFormElement?source:(source&&source.form)||null;if(form)lastSubmit={form,submitter:source instanceof HTMLFormElement?null:source,at:Date.now()};}   // a submit the page made without the event
   ipcRenderer.send('acira:nav-intent',{url:url.slice(0,4096),type:String(event.navigationType||''),form:Boolean(event.formData)});
  }catch{}
 });
}
// Two-finger swipe between pages (macOS; desktop/swipe-nav.cjs). Main sees the trackpad's phases but not the page, so for a sideways wheel this says what
// the page could still scroll that way: the scrollers from the element under the pointer outward (overflow auto or scroll, how far each is scrolled and
// can scroll, its overscroll-behavior-x) and the page's own, plus whether the page cancelled the wheel. Main decides; nothing here starts a navigation.
// A passive listener, ignoring anything vertical, sent at most every 50 ms; a page never sees it and its scrolling is not touched.
if(process.platform==='darwin'&&process.isMainFrame){
 let lastSent=0,lastToward=0;
 const describe=(node,style)=>({scrolls:true,left:node.scrollLeft,max:node.scrollWidth-node.clientWidth,rtl:style.direction==='rtl',behavior:style.overscrollBehaviorX||'auto'});
 const chainOf=event=>{
  const chain=[],html=document.documentElement,body=document.body,root=document.scrollingElement||html;
  for(const node of event.composedPath()){
   if(!(node instanceof Element)||node===html||node===body||node===root)continue;
   const style=getComputedStyle(node),overflow=style.overflowX;
   if(overflow!=='auto'&&overflow!=='scroll'&&overflow!=='overlay')continue;
   chain.push(describe(node,style));
   if(chain.length>=24)break;
  }
  // The page's own scroller: the viewport takes the body's overflow when the root sets none of its own; hidden and clip do not scroll by wheel.
  const rootStyle=getComputedStyle(html),bodyStyle=body?getComputedStyle(body):rootStyle,source=rootStyle.overflowX==='visible'?bodyStyle:rootStyle;
  const behavior=rootStyle.overscrollBehaviorX!=='auto'?rootStyle.overscrollBehaviorX:bodyStyle.overscrollBehaviorX;
  chain.push({scrolls:source.overflowX!=='hidden'&&source.overflowX!=='clip',left:root.scrollLeft,max:root.scrollWidth-root.clientWidth,rtl:rootStyle.direction==='rtl',behavior:behavior||'auto'});
  return chain;
 };
 window.addEventListener('wheel',event=>{
  if(!event.isTrusted||event.ctrlKey||!event.deltaX||Math.abs(event.deltaX)<=Math.abs(event.deltaY))return;
  const toward=event.deltaX<0?-1:1,at=performance.now();
  if(toward===lastToward&&at-lastSent<50)return;
  lastSent=at;lastToward=toward;
  const chain=chainOf(event);   // the path is only there while the event is being dispatched
  // The page's handlers have all run once this task starts: only then is it known whether one of them cancelled the wheel.
  setTimeout(()=>{try{ipcRenderer.send('acira:swipe-facts',{toward,prevented:event.defaultPrevented,chain});}catch{}},0);
 },{capture:true,passive:true});
}
// 13.8 keyboard routing (desktop/key-routing.cjs, a port of Chromium's): a browser shortcut that is not reserved goes to the PAGE first, and the browser runs it only if the page did not
// consume the key. Electron does not tell the main process what the renderer did with a key, so this is the renderer's answer: once the page's own listeners have run for a keydown that
// could be a shortcut (a modifier is held, or it is a key with a name: Escape, F5, Delete...; plain typing never is), the answer {key, code, modifiers, prevented} goes to the main process.
// "prevented" is the event's defaultPrevented, which is what Chromium's input ack calls "consumed". It is registered in every frame (nodeIntegrationInSubFrames) before any script of the page runs (a preload
// runs first), so no page script can stop the event before it is seen; the frame says once that it is ready, and a frame that never says it keeps the old behaviour
// (the browser takes the key first). Everything is guarded: a failure here must never reach the page or the listeners below.
try{
 // The next task: the whole dispatch is over, so every listener of the page has had its say (a message to oneself is a task of its own, with no timer clamping).
 const channel=new MessageChannel(),jobs=[];
 channel.port1.onmessage=()=>{const job=jobs.shift();if(job)job();};
 if(typeof channel.port1.unref==='function')channel.port1.unref();/* Node (the tests) would otherwise wait for this port to close; a browser has no such thing */
 window.addEventListener('keydown',event=>{
  try{
   if(!event.isTrusted||event.isComposing)return;
   if(!(event.ctrlKey||event.metaKey||event.altKey||String(event.key||'').length>1))return;
   const answer={key:String(event.key||''),code:String(event.code||''),ctrl:!!event.ctrlKey,alt:!!event.altKey,shift:!!event.shiftKey,meta:!!event.metaKey,repeat:!!event.repeat};
   jobs.push(()=>{try{answer.prevented=!!event.defaultPrevented;ipcRenderer.send('acira:key-ack',answer);}catch{/* the frame is gone */}});
   channel.port2.postMessage(0);
  }catch{/* never reaches the page */}
 },true);
 ipcRenderer.send('acira:key-ack-ready');
}catch{/* no acknowledgement from this frame (no MessageChannel, no window): the main process keeps the key itself */}
