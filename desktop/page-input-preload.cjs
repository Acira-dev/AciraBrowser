const {ipcRenderer}=require('electron');
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
// Settings › Tabs › Link preview (on by default): when it is off the browser says so, and these gestures are Chromium's again.
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
 const overControl=event=>{for(const node of event.composedPath?.()||[])if(node instanceof Element&&node.matches?.(CONTROL))return true;return false;};
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
