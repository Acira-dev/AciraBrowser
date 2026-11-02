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
 getSnapshot:()=>ipcRenderer.invoke('acira:snapshot'),dispatch:action=>invoke('acira:dispatch',action).then(()=>{}),subscribe:subscription('acira:state'),
 browserCommand:command=>invoke('acira:browser-command',command),setBrowserLayout:layout=>send('acira:set-layout',layout),getBrowserLayout:()=>ipcRenderer.invoke('acira:get-layout'),subscribeLayout:subscription('acira:layout'),subscribeBrowser:subscription('acira:browser-event'),closeOverlay:id=>send('acira:close-overlay',id),overlayReady:(id,stage,provider)=>invoke('acira:overlay-ready',id,stage,provider),popupBackdrop:id=>invoke('acira:popup-backdrop',id),popupBackdropSnapshot:id=>invoke('acira:popup-backdrop-snapshot',id),startPopupCapture:(id,key)=>invoke('acira:start-popup-capture',id,key),
 extensions:request=>invoke('acira:extensions',request),
 websiteAuth:request=>invoke('acira:website-auth',request),subscribeWebsiteAuth:subscription('acira:website-auth-state'),
 setup:request=>invoke('acira:setup',request),
 service:request=>invoke('acira:service',request),
 native:request=>invoke('acira:native',request),
 rewind:request=>invoke('acira:rewind',request), secured:request=>invoke('acira:secured',request),
 peek:request=>invoke('acira:peek',request),
 passwords:request=>invoke('acira:passwords',request),
 openWindow:kind=>send('acira:open',kind),windowControl:command=>ipcRenderer.send('acira:window',command),exportData:(name,content)=>{void invoke('acira:export',name,content);}
});

window.addEventListener('wheel',event=>{if(event.isTrusted&&event.ctrlKey&&!event.altKey&&Number.isFinite(event.deltaY)&&event.deltaY&&event.target?.closest?.('.page-area')){event.preventDefault();send('acira:internal-wheel-zoom',{deltaY:event.deltaY,deltaMode:event.deltaMode});}},{capture:true,passive:false});
