'use strict';
// Beta 14 section R: the screenshot of the page. Three kinds: Area (a box dragged over the page), Visible page (what is on screen) and Full page (top to bottom, past what needs scrolling).
// The picture is copied to the clipboard AND saved where the person says (the Save dialog opens for every screenshot; the file is listed like any download), and a toast with a thumbnail says so. Everything happens on the device; the page is not told.
// Only the page is captured: a page view's own surface, so never the sidebar, the toolbar or our pop-ups. Parts that need no Electron: page-capture-core.cjs.
const path=require('node:path');
const {writeImageToClipboard}=require('./clipboard-image.cjs');
const core=require('./page-capture-core.cjs');

const CAPTURE_TIMEOUT_MS=8000;
const THUMB_SIDE=88,THUMB_MAX_CHARS=3600;   // the toast's picture: 44px at 2x; a few KB, so three toasts stay inside the native overlay's 16 kB layout (validation.cjs)
const CLIPBOARD_MAX_PIXELS=60_000_000;      // a picture larger than this is saved but not put on the clipboard (decoding it for the clipboard would hold hundreds of MB)
const HOLD="Symbol.for('acira.screenshot.hold')";   // where the few lines run in the page keep what they must put back (a symbol: a page's own scripts do not see it by name)
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const withTimeout=(promise,ms,what='Capture')=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(what+' timed out.')),ms);})]).finally(()=>clearTimeout(timer));};

/** The small picture the toast shows: the picture scaled so its short side is THUMB_SIDE, then the top (the centre, for a wide one) cut to a square, as a JPEG data URL under THUMB_MAX_CHARS. */
function thumbnailOf(image){
 try{
  const {width,height}=image.getSize();if(!width||!height)return null;
  const k=THUMB_SIDE/Math.min(width,height),w=Math.max(THUMB_SIDE,Math.round(width*k)),h=Math.max(THUMB_SIDE,Math.round(height*k));
  const scaled=image.resize({width:w,height:h,quality:'good'}),square=scaled.crop({x:Math.max(0,Math.floor((w-THUMB_SIDE)/2)),y:0,width:THUMB_SIDE,height:THUMB_SIDE});
  for(const quality of [72,58,46,36,26]){const url='data:image/jpeg;base64,'+square.toJPEG(quality).toString('base64');if(url.length<=THUMB_MAX_CHARS)return url;}
 }catch{}
 return null;
}

function createPageCapture({debug=()=>{},getWindow,getChrome,getState,getPageEntry,getPageBounds,pageVisible=()=>true,displayScale=()=>1,isDark=()=>true,closeOverlay=()=>{},layer,acquire=()=>null,downloads,ownerFor,clipboard,ClipboardItem,nativeImage,tr,toast,setLast=()=>{},focusPage=()=>{},now=()=>Date.now(),screenshotFolder=()=>''}){
 let busy=false,picking=null;   // picking: the tab whose page the area layer is over
 const say=(text,options={})=>{try{toast(text,options);}catch{}};

 /** Where the capture comes from: a page view (its own box), or, for an Acira page (acira://, drawn by the interface view), the page area of the interface view. */
 function resolveTarget(tab){
  const entry=tab.contentKind==='web'?getPageEntry(tab.id):null,wc=entry?.view?.webContents;
  if(entry&&wc&&!wc.isDestroyed())return {tab,wc,bounds:entry.view.getBounds(),internal:false};
  const chrome=getChrome(),bounds=getPageBounds();
  if(!chrome||chrome.isDestroyed()||!bounds||!(bounds.width>0)||!(bounds.height>0))return null;
  return {tab,wc:chrome,bounds,internal:true};
 }
 /** NativeImage of a part of the target in its own pixels (the display's, not the page's zoom): rect in DIPs relative to the page view. */
 async function grab(target,rect){
  const area=rect?{x:Math.round(rect.x+(target.internal?target.bounds.x:0)),y:Math.round(rect.y+(target.internal?target.bounds.y:0)),width:Math.max(1,Math.round(rect.width)),height:Math.max(1,Math.round(rect.height))}
   :target.internal?{x:Math.round(target.bounds.x),y:Math.round(target.bounds.y),width:Math.round(target.bounds.width),height:Math.round(target.bounds.height)}:undefined;
  const image=await withTimeout(target.wc.capturePage(area,{stayHidden:true,stayAwake:false}),CAPTURE_TIMEOUT_MS);
  if(!image||image.isEmpty())throw new Error('The page returned no picture.');
  return image;
 }
 const inPage=(target,code)=>target.wc.executeJavaScript(code,false);   // no user gesture

 /** Facts about the page, read where the page lives (null for an Acira page): a PDF in the viewer, and a protected video on screen (it shows black: said, not hidden). */
 async function facts(target){
  if(target.internal)return {pdf:false,protectedVideo:false};
  try{return await withTimeout(inPage(target,`(()=>({pdf:document.contentType==='application/pdf'||!!document.querySelector('embed[type="application/pdf"]'),protectedVideo:[...document.querySelectorAll('video')].some(v=>{if(!v.mediaKeys||v.readyState<2)return false;const r=v.getBoundingClientRect();return r.width>1&&r.height>1&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;})}))()`),2000,'Page check');}
  catch{return {pdf:false,protectedVideo:false};}
 }

 // ---- Full page ----
 /** Scroll the page through once, so lazy pictures load, then to the top (where a sticky bar sits once). The page is under a still of itself (the cover): no scroll shows. Returns where the person was. */
 async function wakeAndPark(target){
  const code=`(async()=>{const html=document.documentElement,body=document.body,hold=html.style.getPropertyValue('scroll-behavior'),prio=html.style.getPropertyPriority('scroll-behavior');html.style.setProperty('scroll-behavior','auto','important');
   const at={x:scrollX,y:scrollY};const wait=ms=>new Promise(r=>setTimeout(r,ms));const tall=()=>Math.max(html.scrollHeight,body?body.scrollHeight:0);
   let height=tall(),step=Math.max(240,Math.round(innerHeight*.85)),turns=0,deadline=Date.now()+9000;
   for(let pass=0;pass<3&&Date.now()<deadline;pass++){for(let y=0;y<height&&Date.now()<deadline&&turns<60;y+=step,turns++){scrollTo(0,y);await wait(55);}scrollTo(0,height);await wait(110);const next=tall();if(next<=height+2)break;height=next;}
   const pending=[...document.images].filter(i=>!i.complete);if(pending.length)await Promise.race([Promise.all(pending.map(i=>new Promise(r=>{i.addEventListener('load',r,{once:true});i.addEventListener('error',r,{once:true});}))),wait(1800)]);
   scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await wait(40);
   window[${HOLD}]={hold,prio};return {x:at.x,y:at.y,height:tall()};})()`;
  return withTimeout(inPage(target,code),16000,'Page scroll');
 }
 const unpark=(target,at)=>inPage(target,`(async()=>{const html=document.documentElement,h=window[${HOLD}]||{hold:'',prio:''};scrollTo(${Number(at?.x)||0},${Number(at?.y)||0});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(h.hold)html.style.setProperty('scroll-behavior',h.hold,h.prio);else html.style.removeProperty('scroll-behavior');delete window[${HOLD}];})()`).catch(()=>{});

 /** Slices by DevTools (captureBeyondViewport: the page is drawn past the window without scrolling or resizing it), joined into one PNG. Null when the page cannot be driven that way. */
 async function fullByDevTools(target,notes){
  const lease=acquire(target.wc);if(!lease)return null;
  let at=null,parked=false;
  try{
   at=await wakeAndPark(target);parked=true;
   const metrics=await lease.sendCommand('Page.getLayoutMetrics'),size=metrics.cssContentSize||metrics.contentSize;
   if(!size||!(size.width>0)||!(size.height>0))throw new Error('The page reports no size.');
   // How many pixels a CSS pixel is in the picture (display scale and page zoom together): read from a probe, not assumed.
   const probe=await lease.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:0,width:16,height:16,scale:1}}),probeSize=nativeImage.createFromBuffer(Buffer.from(probe.data,'base64')).getSize();
   const ratio=probeSize.width>0?probeSize.width/16:displayScale(),plan=core.planFullPage({cssWidth:size.width,cssHeight:size.height,scale:ratio});
   if(plan.truncated)notes.push(tr('screenshot.tooLong',{saved:plan.deviceHeight.toLocaleString('en-US'),total:plan.pageDeviceHeight.toLocaleString('en-US')}));
   let firstImage=null,firstPng=null;
   const slice=async piece=>{
    const shot=await withTimeout(lease.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:piece.y,width:plan.cssWidth,height:piece.height,scale:1}}),CAPTURE_TIMEOUT_MS*2,'Capture');
    const png=Buffer.from(shot.data,'base64'),image=nativeImage.createFromBuffer(png);
    if(!firstImage){firstImage=image;firstPng=png;}
    return {png,image};
   };
   let png;
   if(plan.slices.length===1){const only=await slice(plan.slices[0]);png=only.png;}
   else{
    async function* stitched(){for(const piece of plan.slices){const {image}=await slice(piece),{width,height}=image.getSize();yield {width,height,data:core.bgraToRgba(Buffer.from(image.toBitmap()))};}}
    png=await core.encodePng(stitched());
   }
   const whole=plan.slices.length===1,finalSize=whole?firstImage.getSize():null;
   return {png,image:firstImage,whole,width:finalSize?finalSize.width:plan.deviceWidth,height:finalSize?finalSize.height:plan.deviceHeight,truncated:plan.truncated};
  }finally{
   if(parked&&at)await unpark(target,at);
   try{lease.release();}catch{}
  }
 }


 /** The same picture by scrolling, for a page DevTools cannot be attached to (a Tor window keeps its own client): the page, under a still of itself, is scrolled one window at a time and each
  *  window captured; a fixed or sticky bar is hidden after the first window so it is not repeated down the picture, then put back. Null when the page has no scroll to speak of. */
 async function fullByScrolling(target,notes){
  let at=null,hidden=false;
  try{
   at=await wakeAndPark(target);
   const view=await inPage(target,`({w:document.documentElement.clientWidth,h:innerHeight})`);
   if(!view||!(view.w>0)||!(view.h>0))throw new Error('The page reports no size.');
   const first=await grab(target),ratio=first.getSize().width/view.w,plan=core.planFullPage({cssWidth:view.w,cssHeight:at.height,scale:ratio});
   if(plan.truncated)notes.push(tr('screenshot.tooLong',{saved:plan.deviceHeight.toLocaleString('en-US'),total:plan.pageDeviceHeight.toLocaleString('en-US')}));
   async function* windows(){
    const total=plan.deviceHeight;let done=0;
    for(let top=0;done<total;top+=view.h){
     if(top>0&&!hidden){await inPage(target,`(()=>{for(const el of document.querySelectorAll('*')){const p=getComputedStyle(el).position;if(p==='fixed'||p==='sticky'){el.setAttribute('data-acira-shot',el.style.visibility||'-');el.style.setProperty('visibility','hidden','important');}}})()`);hidden=true;}
     const real=await inPage(target,`(async()=>{scrollTo(0,${top});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await new Promise(r=>setTimeout(r,70));return scrollY;})()`);
     const image=top===0?first:await grab(target),size=image.getSize(),skip=Math.max(0,Math.round((top-real)*ratio)),rows=Math.min(size.height-skip,total-done);
     if(rows<=0)break;
     const cut=skip||rows<size.height?image.crop({x:0,y:skip,width:size.width,height:rows}):image;
     yield {width:size.width,height:rows,data:core.bgraToRgba(Buffer.from(cut.toBitmap()))};done+=rows;
    }
   }
   const png=await core.encodePng(windows());
   return {png,image:first,whole:false,width:plan.deviceWidth,height:plan.deviceHeight,truncated:plan.truncated};
  }finally{
   if(hidden)await inPage(target,`(()=>{for(const el of document.querySelectorAll('[data-acira-shot]')){const v=el.getAttribute('data-acira-shot');if(v==='-')el.style.removeProperty('visibility');else el.style.setProperty('visibility',v);el.removeAttribute('data-acira-shot');}})()`).catch(()=>{});
   if(at)await unpark(target,at);
  }
 }

 // ---- the whole job ----
 async function capture(kind,tabId){
  const window=getWindow(),state=getState(),tab=state.tabs.find(item=>item.id===tabId);
  if(!window||window.isDestroyed()||window.isMinimized()||!window.isVisible()){say(tr('screenshot.minimized'),{tone:'error'});return {ok:false,reason:'minimized'};}
  if(!tab||!pageVisible(tab.id)){say(tr('screenshot.failed'),{tone:'error'});return {ok:false,reason:'no-page'};}
  const target=resolveTarget(tab);if(!target){say(tr('screenshot.failed'),{tone:'error'});return {ok:false,reason:'no-target'};}
  closeOverlay();
  const notes=[],page=await facts(target);
  let result=null,effective=kind;
  if(kind==='area'){
   picking=tab.id;
   const picked=await layer.pick({bounds:target.bounds,dark:isDark(),scale:displayScale(),hint:tr('screenshot.areaHint')}).finally(()=>{picking=null;});
   if(!picked){focusPage(tab.id);return {ok:false,reason:'cancelled'};}
   try{const image=await grab(target,picked.rect);result={png:image.toPNG(),image,whole:true,width:image.getSize().width,height:image.getSize().height};}
   finally{void picked.release().then(()=>focusPage(tab.id));}   // the dim fades out, the reverse of its fade in; the picture is already taken
  }else if(kind==='full'&&!target.internal&&!page.pdf){
   // A still of the page goes over it first, for every try below: the scroll-through must not be seen, and the page must not jump when it ends.
   let cover=null;
   try{cover=await layer.cover({bounds:target.bounds,src:(await grab(target)).toDataURL()});}catch{cover=null;}
   try{
    for(const attempt of [fullByDevTools,fullByScrolling]){   // DevTools first; a page it cannot be attached to (a Tor window keeps its own client) or that fails part-way is scrolled instead; if that fails too, what is on screen is saved, and it says so
     try{result=await attempt(target,notes);if(result)break;}catch(error){debug('full:'+attempt.name,error);notes.length=0;result=null;}
    }
   }finally{if(cover)await cover.release();}
   if(!result){notes.push(tr('screenshot.fullUnavailable'));effective='visible';}
  }else if(kind==='full'){notes.push(tr('screenshot.fullUnavailable'));effective='visible';}
  if(!result){const image=await grab(target);result={png:image.toPNG(),image,whole:true,width:image.getSize().width,height:image.getSize().height};}
  if(page.protectedVideo)notes.push(tr('screenshot.protectedVideo'));
  return finish({kind,effective,tab,target,notes,...result});
 }

 async function finish({kind,tab,target,notes,png,image,whole,width,height}){
  /* Beta 14 (D2): the picture is copied FIRST, so a Cancel in the Save dialog still leaves it on the clipboard. */
  let copied=false;
  if(image&&width*height<=CLIPBOARD_MAX_PIXELS){
   try{await writeImageToClipboard(clipboard,whole?image:nativeImage.createFromBuffer(png),ClipboardItem);copied=true;}catch(error){debug('copy',error);}
  }
  /* Beta 14 (D3): a screenshots folder set in Settings (and still there) takes every screenshot with no question, under a name no file has. Otherwise (not set, or the folder is gone) every screenshot
     asks where to save it (D2: the Save dialog opens in the last folder used, else the download folder); Cancel saves nothing. */
  let saved,into='';try{into=String(screenshotFolder()||'');}catch{into='';}
  try{saved=await downloads.saveFile(ownerFor(tab,target.wc),core.screenshotName(new Date(now())),png,into?{into}:{askWhere:'always'});}
  catch(error){say(tr('screenshot.saveFailed'),{tone:'error'});return {ok:false,reason:'save',error};}
  if(!saved){setLast(kind);if(copied)try{say(tr('error.copied'));}catch{}return {ok:false,reason:'cancelled',copied};}
  setLast(kind);
  const folder=path.basename(path.dirname(saved.path))||path.dirname(saved.path);
  const detail=[...notes,notes.length?'':copied?tr('screenshot.savedDetail',{folder}):tr('screenshot.savedNoCopy',{folder})].filter(Boolean).join(' ');
  const options={detail,action:{label:tr('dl.open'),command:{type:'download.act',id:saved.id,command:'open'}},action2:{label:tr('dl.showInFolder'),command:{type:'download.act',id:saved.id,command:'show'}}};
  const thumb=thumbnailOf(image);if(thumb)options.image=thumb;
  const speak=saved.owner&&typeof saved.owner.toast==='function'?saved.owner.toast:toast;
  try{speak(tr('screenshot.saved'),options);}catch{}
  return {ok:true,path:saved.path,id:saved.id,width,height,copied,notes};
 }

 /** The command: take a screenshot of `tabId`'s page. One at a time: a second request while one is running is dropped. */
 async function run({kind,tabId}){
  if(!core.isKind(kind))return {ok:false,reason:'kind'};
  if(busy)return {ok:false,reason:'busy'};
  busy=true;
  try{return await capture(kind,tabId);}
  catch(error){say(tr('screenshot.failed'),{tone:'error'});return {ok:false,reason:'error',error};}
  finally{busy=false;}
 }
 /** main's state changed: a box being dragged over a page that is no longer the one on screen is dropped */
 function onState(state){if(picking&&state&&state.activeTabId!==picking)layer.cancel();}
 return {run,onState,isBusy:()=>busy,cancel:()=>layer.cancel(),thumbnailOf};
}
module.exports={createPageCapture,thumbnailOf,CLIPBOARD_MAX_PIXELS,THUMB_MAX_CHARS};
