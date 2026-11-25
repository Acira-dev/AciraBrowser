'use strict';
// Beta 14: the layer over the page that the page screenshot draws on: the area picker (the page dims, a box is dragged clear, its size shows at its corner) and the cover (a still
// of the page held over it while the page is scrolled through to wake its lazy pictures, so the person never sees the page jump). A transparent view of its own over the page
// view; a page view's capture never contains it. It lives only while it is needed: the web contents is closed when the layer has faded out.
const path=require('node:path');
const PAGE=path.join(__dirname,'screenshot-layer.html'),PRELOAD=path.join(__dirname,'screenshot-layer-preload.cjs');
const FADE_MS=180;

/* focus(wc): main's focus gate, so a picker that becomes ready after the person has gone to another app takes nothing from it (webContents.focus() alone activates Acira) */
function createScreenshotLayer({WebContentsView,getWindow,session,preload=PRELOAD,page=PAGE,focus=wc=>wc.focus()}){
 let current=null;   // {view, wc, waiters, done, bounds}
 const rectOk=rect=>rect&&[rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)&&rect.width>0&&rect.height>0;

 function open(bounds){
  const window=getWindow();
  if(!window||window.isDestroyed())throw new Error('There is no window to capture.');
  close(true);
  const view=new WebContentsView({webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,spellcheck:false,backgroundThrottling:false,...(session?{session}:{})}});
  view.setBackgroundColor('#00000000');
  const wc=view.webContents,layer={view,wc,bounds,waiters:new Map(),closed:false};
  current=layer;
  wc.setWindowOpenHandler(()=>({action:'deny'}));
  wc.on('will-navigate',event=>event.preventDefault());
  wc.ipc.on('acira:shot-layer',(event,message)=>{
   if(current!==layer||event.sender!==wc||!message||typeof message.type!=='string')return;
   const wait=layer.waiters.get(message.type);
   if(wait){layer.waiters.delete(message.type);wait(message);}
  });
  /* Esc, even before the layer page has the keyboard; and anything that moves or hides the window ends the pick (the box would be over the wrong place) */
  wc.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'){event.preventDefault();cancelLayer(layer);}});
  const away=()=>cancelLayer(layer),windowEvents=['resize','minimize','hide','will-move','closed'];
  for(const name of windowEvents)window.on(name,away);
  layer.unwatch=()=>{try{for(const name of windowEvents)window.removeListener(name,away);}catch{}};
  wc.once('destroyed',()=>{layer.closed=true;for(const wait of layer.waiters.values())wait(null);layer.waiters.clear();if(current===layer)current=null;});
  view.setBounds({x:Math.round(bounds.x),y:Math.round(bounds.y),width:Math.round(bounds.width),height:Math.round(bounds.height)});
  window.contentView.addChildView(view);
  void wc.loadFile(page).catch(()=>{});
  return layer;
 }
 const waitFor=(layer,type,ms=8000)=>new Promise(resolve=>{
  const timer=setTimeout(()=>{layer.waiters.delete(type);resolve(null);},ms);
  layer.waiters.set(type,message=>{clearTimeout(timer);resolve(message);});
 });
 function remove(layer){
  if(layer.closed)return;layer.closed=true;layer.unwatch?.();
  try{const window=getWindow();if(window&&!window.isDestroyed())window.contentView.removeChildView(layer.view);}catch{}
  try{if(!layer.wc.isDestroyed())layer.wc.close();}catch{}
  if(current===layer)current=null;
 }
 /** Fade the dim out (the reverse of its fade in), then take the layer away. */
 async function release(layer=current,{wait=true}={}){
  if(!layer||layer.closed)return;
  if(layer.releasing)return layer.releasing;
  layer.releasing=(async()=>{
   try{layer.wc.send('acira:shot-layer-state',{mode:'end',ms:FADE_MS});}catch{}
   if(wait)await waitFor(layer,'hidden',FADE_MS+700);
   remove(layer);
  })();
  return layer.releasing;
 }
 function cancelLayer(layer){const wait=layer&&layer.waiters.get('cancelled');if(wait){layer.waiters.delete('cancelled');wait({type:'cancelled'});return true;}return false;}
 function close(immediate=false){const layer=current;if(!layer)return;if(immediate){for(const wait of layer.waiters.values())wait(null);layer.waiters.clear();remove(layer);}else void release(layer);}

 /** Let the person drag a box over the page. `bounds` is the page view's box in window DIPs, `scale` the pixels of the picture per DIP.
  *  Resolves {rect} in DIPs of the layer (the page view's own space) when a box is let go, or null when the person cancelled (Esc, a right click, the layer going away).
  *  The layer stays up after a box so the caller can fade it out (release) when the capture is done. */
 async function pick({bounds,dark=true,scale=1,hint=''}){
  const layer=open(bounds);
  if(!await waitFor(layer,'ready')){remove(layer);return null;}
  layer.wc.send('acira:shot-layer-state',{mode:'area',dark,scale,hint});
  try{focus(layer.wc);}catch{}
  const result=await new Promise(resolve=>{
   const picked=message=>{if(!message){resolve(null);return;}resolve(message.type==='picked'&&rectOk(message.rect)?message.rect:null);};
   layer.waiters.set('picked',picked);layer.waiters.set('cancelled',()=>resolve(null));
  });
  layer.waiters.delete('picked');layer.waiters.delete('cancelled');
  if(!result){await release(layer);return null;}
  return {rect:result,release:()=>release(layer)};
 }
 /** Hold a still of the page (a data URL) over it, at once and without a fade; resolves when the still is on screen. Returns {release} (no fade: the still is the page). */
 async function cover({bounds,src}){
  const layer=open(bounds);
  if(!await waitFor(layer,'ready')){remove(layer);return null;}
  const covered=waitFor(layer,'covered');
  layer.wc.send('acira:shot-layer-state',{mode:'cover',src});
  if(!await covered){remove(layer);return null;}
  return {release:()=>release(layer)};
 }
 return {pick,cover,close,isOpen:()=>!!current&&!current.closed,cancel:()=>cancelLayer(current&&!current.closed?current:null)};
}
module.exports={createScreenshotLayer,FADE_MS};
