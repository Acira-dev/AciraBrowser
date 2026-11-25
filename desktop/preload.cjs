const {contextBridge,ipcRenderer}=require('electron');
// The interface subscribes to 'acira:browser-event' from a score of places (App, sidebar, features): Node's default limit of 10 turned that into a
// MaxListenersExceededWarning in every window's console. The count is steady (18 in the browser view after any amount of popup and tab churn).
if(typeof ipcRenderer.setMaxListeners==='function')ipcRenderer.setMaxListeners(48);
const subscription=channel=>listener=>{const handler=(_event,value)=>listener(value);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler);};
// The window starts loading while the browser services (content blocking, HTTPS-only, proxy, permissions, downloads) are still being set up.
// Reading the state is allowed at once; anything that acts on those services waits until the main process says the window is ready.
let windowReady=null;
const whenReady=()=>windowReady||(windowReady=ipcRenderer.invoke('acira:window-ready'));
// A request the main process refuses arrives as "Error invoking remote method '<channel>': Error: <message>". Every panel shows the message alone, so say it that way once, here.
const plain=error=>{if(error&&typeof error.message==='string')error.message=error.message.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/,'');throw error;};
const invoke=(channel,...args)=>whenReady().then(()=>ipcRenderer.invoke(channel,...args)).catch(plain);
const send=(channel,...args)=>{void whenReady().then(()=>ipcRenderer.send(channel,...args),()=>{});};
// A floating UI renderer has a bounded native input area. Rebase its virtual
// window canvas in CSS rather than extending a transparent native view across
// the website (which also intercepted wheel/click events outside a toast).
let popupViewport;
function applyPopupViewport(value){
 if(!value||!['x','y','width','height'].every(key=>Number.isFinite(value[key])))return;
 popupViewport=value;
 if(!document.documentElement)return;
 const style=document.getElementById('acira-popup-viewport')||Object.assign(document.createElement('style'),{id:'acira-popup-viewport'});
 style.textContent=`.native-popup-stage{left:${-value.x}px!important;top:${-value.y}px!important;right:auto!important;bottom:auto!important;width:${value.width}px!important;height:${value.height}px!important}`;
 if(!style.isConnected)document.documentElement.append(style);
}
ipcRenderer.on('acira:popup-viewport',(_event,value)=>applyPopupViewport(value));
window.addEventListener('DOMContentLoaded',()=>{if(popupViewport)applyPopupViewport(popupViewport);void ipcRenderer.invoke('acira:popup-viewport').then(applyPopupViewport,()=>{});},{once:true});
contextBridge.exposeInMainWorld('acira',{
 platform:process.platform,initialSnapshot:ipcRenderer.sendSync('acira:initial-snapshot'),
 systemTheme:()=>ipcRenderer.sendSync('acira:system-theme'),subscribeSystemTheme:subscription('acira:system-theme-changed'),
 /* 13.5: whether the window is drawn in software (gpu-drawing.cjs); Reduce motion follows it until the person chooses (runtime/motion.ts) */
 softwareDrawing:()=>ipcRenderer.sendSync('acira:software-drawing')===true,subscribeSoftwareDrawing:subscription('acira:software-drawing-changed'),
 getSnapshot:()=>ipcRenderer.invoke('acira:snapshot'),dispatch:action=>invoke('acira:dispatch',action).then(()=>{}),subscribe:subscription('acira:state'),
 browserCommand:command=>invoke('acira:browser-command',command),setBrowserLayout:layout=>send('acira:set-layout',layout),getBrowserLayout:()=>ipcRenderer.invoke('acira:get-layout'),subscribeLayout:subscription('acira:layout'),subscribeBrowser:subscription('acira:browser-event'),closeOverlay:id=>send('acira:close-overlay',id),overlayReady:(id,stage,provider)=>invoke('acira:overlay-ready',id,stage,provider),popupBackdrop:id=>invoke('acira:popup-backdrop',id),popupBackdropSnapshot:id=>invoke('acira:popup-backdrop-snapshot',id),startPopupCapture:(id,key)=>invoke('acira:start-popup-capture',id,key),
 extensions:request=>invoke('acira:extensions',request),
 websiteAuth:request=>invoke('acira:website-auth',request),subscribeWebsiteAuth:subscription('acira:website-auth-state'),
 setup:request=>invoke('acira:setup',request),
 service:request=>invoke('acira:service',request),
 native:request=>invoke('acira:native',request),
 feedback:request=>invoke('acira:feedback',request),
 /* Beta 14, the one-time Welcome: the page's requests (opened, leave, save, copy-image, show) and main's events (the frost has begun, a click away, leave-request): desktop/welcome-service.cjs */welcome:request=>invoke('acira:welcome',request),subscribeWelcome:subscription('acira:welcome-event'),
 /* Easy Files (Beta 14): the pop-up's answer. */easyFiles:request=>invoke('acira:easy-files',request),
 rewind:request=>invoke('acira:rewind',request), secured:request=>invoke('acira:secured',request),
 peek:request=>invoke('acira:peek',request), sidePanel:request=>invoke('acira:side-panel',request),
 passwords:request=>invoke('acira:passwords',request),
 openWindow:kind=>send('acira:open',kind),windowControl:command=>ipcRenderer.send('acira:window',command),exportData:(name,content)=>{void invoke('acira:export',name,content);}
});

// Ctrl+wheel over a page the interface draws (Settings, History, the new tab...). A wheel notch, or a trackpad's two-finger scroll with Control held,
// steps the page zoom in main as on a website. A pinch reaches the interface as a ctrl+wheel too, with small precise deltas and no Control key down:
// like Chromium on a website it magnifies the page without laying it out again (ui/pageMagnify.ts hears it as 'acira:pinch').
let controlDown=false;
window.addEventListener('keydown',event=>{if(event.key==='Control')controlDown=true;},{capture:true,passive:true});
window.addEventListener('keyup',event=>{if(event.key==='Control')controlDown=false;},{capture:true,passive:true});
window.addEventListener('blur',()=>{controlDown=false;},{passive:true});
window.addEventListener('wheel',event=>{if(event.isTrusted&&event.ctrlKey&&!event.altKey&&Number.isFinite(event.deltaY)&&event.deltaY&&event.target?.closest?.('.page-area')){event.preventDefault();if(controlDown||event.deltaMode!==0||Math.abs(event.deltaY)>=40)send('acira:internal-wheel-zoom',{deltaY:event.deltaY,deltaMode:event.deltaMode});else window.dispatchEvent(new CustomEvent('acira:pinch',{detail:JSON.stringify({deltaY:event.deltaY,x:event.clientX,y:event.clientY})}));}},{capture:true,passive:false});
// Windows and Linux: the sideways wheel over the sidebar's body (a two-finger swipe there switches workspace, desktop/swipe-nav.cjs) goes to main with the same message a page's
// preload sends. Passive and capturing, never touches the event; vertical events only while a sideways scroll is going. Window pixels (the interface view is zoomed by the interface scale).
if(process.platform==='win32'||process.platform==='linux'||(process.argv||[]).includes('--acira-web-swipe')){
 let recent=-1e9,attached=false;
 const zoomOf=()=>{try{const zoom=require('electron').webFrame.getZoomFactor();return Number.isFinite(zoom)&&zoom>0?zoom:1;}catch{return 1;}};
 const wheelListener=event=>{
  try{
   if(!event.isTrusted||!event.target?.closest?.('.acira-sidebar'))return;
   const dx=event.deltaX,dy=event.deltaY,at=performance.now(),sideways=dx!==0&&Math.abs(dx)>Math.abs(dy);
   if(!sideways&&at-recent>300)return;
   if(sideways)recent=at;
   const zoom=zoomOf();
   ipcRenderer.send('acira:swipe-wheel-ui',{t:performance.timeOrigin+event.timeStamp,dx:dx*zoom,dy:dy*zoom,x:event.clientX*zoom,y:event.clientY*zoom,mods:Boolean(event.shiftKey||event.ctrlKey||event.altKey||event.metaKey),mode:event.deltaMode});
  }catch{}
 };
 // Attached only while main says the swipe is wanted (the setting is on, or a recording was asked for).
 const enable=on=>{
  if(on&&!attached){attached=true;window.addEventListener('wheel',wheelListener,{capture:true,passive:true});}
  else if(!on&&attached){attached=false;window.removeEventListener('wheel',wheelListener,{capture:true});}
 };
 ipcRenderer.on('acira:swipe-enable',(_event,on)=>enable(on===true));
 if((process.argv||[]).includes('--acira-web-swipe'))enable(true);   // scripted runs on a Mac only
}

// Battery: whether this view can be seen at all. Chromium marks the page hidden when its window is minimised, hidden, fully covered or on another Space; main's edge poller
// (edge-reveal.cjs) sleeps for such a window and wakes when it is seen again. Told only when it changes; main listens to the window's own interface view only.
{let seenLast=true;const tellSeen=()=>{const seen=document.visibilityState!=='hidden';if(seen===seenLast)return;seenLast=seen;ipcRenderer.send('acira:ui-seen',seen);};if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('visibilitychange',tellSeen);}
