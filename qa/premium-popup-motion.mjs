// Run only while holding the coordinator's native/build lease. One isolated app,
// local fixture, no personal data. Frame sampling and pixel capture run separately.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';

const label=(process.argv[2]||'candidate').replace(/[^a-z0-9-]/gi,'-');
const output=path.resolve(`qa/artifacts/premium-popup-${label}-${Date.now()}`);
await fs.mkdir(output,{recursive:true});
const fixture=await httpFixture((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Motion fixture</title><body style="background:repeating-linear-gradient(45deg,#ded9d0 0 80px,#5e7889 80px 160px);font:20px system-ui"><h1>Controlled popup backdrop</h1></body>');});
const report={label,cases:[],readabilityMetric:'First row effective opacity multiplied by its unscaled area intersecting the current material silhouette exceeds .5; includes the deliberate .68 sharp-row start.',qualification:'Structural assertions plus instrumented measurements; captured texture and native-fallback attribution are explicit. Physical pixel verdict requires the separate screen capture review.',limitations:['rAF intervals describe renderer scheduling on this machine, not universal display performance. Pixel captures are separate from timing samples. A native fallback is not counted as captured first-frame texture.']};
let app;
try{
 app=await startApp({root:`.qa-profiles/premium-popup-${Date.now()}`});
 await app.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];w.setBounds({x:80,y:60,width:1280,height:900});w.showInactive();});
 const url=`http://127.0.0.1:${fixture.port}/`;
 await app.act({type:'tab.new',url});await app.waitWeb(url);
 for(let i=0;i<2;i++)await app.act({type:'tab.new',url:`${url}?tab=${i}`,background:true});
 const overlay=await poll(()=>app.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'overlay');
 await overlay.evaluate(()=>{window.__motionStreams=[];window.__motionCaptureMode='normal';const original=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getDisplayMedia=async options=>{if(window.__motionCaptureMode==='reject')throw new DOMException('Controlled capture rejection','NotAllowedError');const stream=await original(options);window.__motionStreams.push(stream);return stream;};const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(...args){if(!this.src.startsWith('data:image/png;base64,')||window.__motionCaptureMode==='normal')return Reflect.apply(decode,this,args);if(window.__motionCaptureMode==='reject')return Promise.reject(new DOMException('Controlled snapshot decode rejection','EncodingError'));return new Promise((resolve,reject)=>setTimeout(()=>{if(!this.src){reject(new DOMException('Controlled snapshot decode cancelled','AbortError'));return;}Reflect.apply(decode,this,args).then(resolve,reject);},420));};const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){if(!this.srcObject||window.__motionCaptureMode!=='late')return Reflect.apply(play,this,args);return new Promise((resolve,reject)=>setTimeout(()=>{if(!this.srcObject){reject(new DOMException('Controlled late playback cancelled','AbortError'));return;}Reflect.apply(play,this,args).then(resolve,reject);},320));};});
 const trace=process.env.POPUP_TRACE==='1'?await app.context.newCDPSession(overlay):null,events=[];
 if(trace)trace.on('Tracing.dataCollected',e=>events.push(...e.value));
 const close=async()=>{await app.ui.evaluate(async()=>{const o=(await window.acira.getBrowserLayout()).overlay;if(o)await window.acira.closeOverlay(o.id);});await poll(()=>overlay.locator('.sheet-popup').count(),n=>n===0,'popup closed');};
 const open=kind=>kind==='tabs-keyboard'?app.main(({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()==='acira-browser-ui://ui/index.html'),at=Date.now();wc.sendInputEvent({type:'keyDown',keyCode:'T',modifiers:['alt']});wc.sendInputEvent({type:'keyUp',keyCode:'T',modifiers:['alt']});return at;}):app.ui.getByRole('button',{name:kind==='menu'?'Acira menu':/^All open tabs/}).filter({visible:true}).first().evaluate(b=>{const at=performance.timeOrigin+performance.now();b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));b.click();return at;});
 const sample=async()=>{
  await overlay.evaluate(()=>{
   cancelAnimationFrame(window.__motionRAF||0);window.__motionToken=(window.__motionToken||0)+1;const token=window.__motionToken;
   window.__motionFrames=[];window.__motionStart=performance.now();const start=window.__motionStart;let last=start;
   const op=el=>{let n=1;for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e);if(s.visibility==='hidden'||s.display==='none')return 0;n*=Number(s.opacity);}return n;};
   const frame=now=>{
    if(window.__motionToken!==token)return;
    const root=document.querySelector('.sheet-popup'),plane=root?.querySelector('.popup-sheet-plane'),tint=root?.querySelector('.popup-backdrop-tint');
    const rows=root?[...root.querySelectorAll('.popup-contents:not([data-vapor-layer]) .menu-row,.popup-contents:not([data-vapor-layer]) .acira-menu-row,.popup-contents:not([data-vapor-layer]) .tab-result-row')]:[];
    const material=root?.querySelector('.popup-sheet-material'),materialRect=material?.getBoundingClientRect(),foreground=root?.querySelector('.popup-contents:not([data-vapor-layer])');const readable=el=>{const b=el.getBoundingClientRect(),m=materialRect;if(!m)return 0;return op(el)*Math.max(0,Math.min(b.right,m.right)-Math.max(b.left,m.left))*Math.max(0,Math.min(b.bottom,m.bottom)-Math.max(b.top,m.top))/Math.max(1,b.width*b.height);};const s=plane&&getComputedStyle(plane),r=root?.getBoundingClientRect(),capture=root?.querySelector('.popup-captured-material'),sources=root?[...root.querySelectorAll('.popup-sheet-material canvas[data-popup-source-frame=frozen]')].map(c=>{const source=JSON.parse(c.dataset.popupSource),b=source.sourceBounds;return{width:c.width,height:c.height,key:source.key,hasSourceBounds:!!b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0};}):[];
    window.__motionFrames.push({epoch:performance.timeOrigin+now,t:now-window.__motionStart,gap:now-last,shown:!!root,visible:plane?op(plane):0,ready:root?.dataset.formationReady,provider:root?.dataset.materialProvider,theme:document.querySelector('.app')?.dataset.theme,tint:tint&&getComputedStyle(tint).backgroundColor,ink:root&&getComputedStyle(root).color,rect:r&&{x:r.x,y:r.y,width:r.width,height:r.height},transform:s?.transform,materialRect:materialRect&&{x:materialRect.x,y:materialRect.y,width:materialRect.width,height:materialRect.height},materialTransform:material&&getComputedStyle(material).transform,contentTransform:foreground&&getComputedStyle(foreground).transform,morphSource:root?.dataset.morphSource,first:rows[0]?readable(rows[0]):null,last:rows.length?readable(rows.at(-1)):null,haze:!!root?.querySelector('[data-vapor-layer]'),captureOpacity:capture?Number(getComputedStyle(capture).opacity):null,sources,activeCaptureTracks:window.__motionStreams.flatMap(stream=>stream.getTracks()).filter(track=>track.readyState==='live').length,properties:plane?[...new Set(plane.getAnimations({subtree:true}).flatMap(a=>a.effect.getKeyframes().flatMap(k=>Object.keys(k))))]:[]});
    last=now;if(now-start<850)window.__motionRAF=requestAnimationFrame(frame);else window.__motionDone=true;
   };window.__motionDone=false;window.__motionRAF=requestAnimationFrame(frame);
  });
 };
 if(process.env.POPUP_PHASES_ONLY!=='1')for(const appearance of ['dark','light'])for(const interfaceScale of [100,150]){
  await close();await app.act({type:'settings.update',patch:{appearance,interfaceScale,reducedMotion:false,reducedTransparency:false}});await sleep(500);
  for(const kind of ['menu','tabs-keyboard']){
   const tracing=trace&&appearance==='dark'&&interfaceScale===100&&kind==='menu';
   if(tracing)await trace.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.animations,cc,viz,gpu',transferMode:'ReportEvents'});
   await sample();const inputAt=await open(kind);await poll(()=>overlay.evaluate(()=>window.__motionDone),Boolean,'frame trace');
   if(tracing){const done=new Promise(resolve=>trace.once('Tracing.tracingComplete',resolve));await trace.send('Tracing.end');await done;await fs.writeFile(path.join(output,'menu.trace.json'),JSON.stringify({traceEvents:events}));}
   const frames=await overlay.evaluate(()=>window.__motionFrames),visible=frames.filter(f=>f.visible>0),first=visible[0];
   const readable=frames.find(f=>f.first>.5);
   // The first gap includes a hidden renderer waking up; report input latency
   // separately and exclude that gap from intervals during visible motion.
   const decoded=frames.find(f=>f.sources.length),captured=visible.filter(f=>f.provider==='live');
   const firstBackend=first?.provider==='live'?(first.sources.length&&first.sources.every(source=>source.hasSourceBounds)?'Snapshot':'GDM'):first?.provider==='native'?'native':first?.provider||'unavailable';
   report.cases.push({appearance,interfaceScale,kind,inputAt,firstVisibleMs:first?first.epoch-inputAt:null,firstReadableMs:readable?readable.epoch-inputAt:null,decodedToSurfaceMs:first&&decoded?first.epoch-decoded.epoch:null,firstSurfaceMaterial:first?.provider,firstBackend,capturedTextureOnFirstVisibleFrame:first?.provider==='live'&&first.captureOpacity===1&&first.sources.length>0,worstOpeningFrameMs:Math.max(0,...visible.slice(1).filter(f=>f.t<(first?.t||0)+260).map(f=>f.gap)),animatedProperties:[...new Set(frames.flatMap(f=>f.properties))],frames});
   if(!label.startsWith('baseline')){
    assert.ok(first,`${appearance}/${interfaceScale}/${kind}: visible surface`);
    assert.ok(first.provider==='live'||first.provider==='native','First visible glass is captured or attributed native fallback');
    if(label.startsWith('candidate-snapshot-morph'))assert.equal(firstBackend,'Snapshot',`${appearance}/${interfaceScale}/${kind}: first visible material must be a validated snapshot; GDM and native fallback do not satisfy this candidate`);
    for(const frame of captured){assert.ok(frame.sources.length>0&&frame.sources.every(s=>s.width>0&&s.height>0),'Captured provider has decoded frozen pixels');assert.equal(frame.activeCaptureTracks,0,'Published glass owns no live capture tracks');assert.equal(frame.captureOpacity,1,'Captured glass contributes from first visible frame throughout opening');}
    assert.ok(!frames.some(f=>f.properties.some(p=>p.startsWith('--formation-'))),'Plane animates direct compositor properties');
   }

   await close();
   await poll(()=>overlay.evaluate(()=>window.__motionStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),Boolean,'Closed popup leaves no live capture');
  }
 }
 if(!label.startsWith('baseline')&&process.env.POPUP_PHASES_ONLY!=='1'){
  await app.act({type:'settings.update',patch:{appearance:'dark',interfaceScale:100,reducedMotion:false,reducedTransparency:false}});await sleep(200);
  for(const mode of ['late','reject']){
   await overlay.evaluate(mode=>{window.__motionCaptureMode=mode;},mode);await sample();const inputAt=await open('menu');await poll(()=>overlay.evaluate(()=>window.__motionDone),Boolean,'fallback trace');
   const frames=await overlay.evaluate(()=>window.__motionFrames),visible=frames.filter(f=>f.visible>0);
   assert.ok(visible.length,'Failure has a usable fallback surface');assert.ok(visible.every(f=>f.provider==='native'),'Failure remains attributed native fallback with no late provider swap');
   await poll(()=>overlay.evaluate(()=>window.__motionStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),Boolean,'Failed acquisition ends all tracks');
   report.cases.push({phase:'capture-fallback',mode,inputAt,firstVisibleMs:visible[0].epoch-inputAt,frames});await close();
  }
  await overlay.evaluate(()=>{window.__motionCaptureMode='late';});await open('menu');await sleep(30);await close();await sleep(350);
  assert.equal(await overlay.locator('.sheet-popup').count(),0,'Late work cannot resurrect a closed popup');
  assert.equal(await overlay.evaluate(()=>window.__motionStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),true,'Closing pending material ends tracks');
  report.cases.push({phase:'close-pending-capture',passed:true});await overlay.evaluate(()=>{window.__motionCaptureMode='normal';});
  await overlay.evaluate(()=>{window.__motionCaptureMode='late';});await sample();await open('menu');await sleep(30);
  await app.ui.evaluate(async()=>window.acira.closeOverlay((await window.acira.getBrowserLayout()).overlay.id));await sleep(35);const reopenedAt=await open('menu');
  await poll(()=>overlay.evaluate(()=>window.__motionDone),Boolean,'Cold pending-close/reopen trace');
  const pendingFrames=await overlay.evaluate(()=>window.__motionFrames),pendingVisible=pendingFrames.filter(f=>f.visible>0);
  assert.ok(pendingVisible.length&&pendingVisible[0].epoch>=reopenedAt,'Never-ready generation remains hidden until the reopened surface is ready');
  assert.ok(pendingVisible[0].visible>=.99,'First visible reopened surface starts dense, not as a false reversal from transparency');
  assert.ok(pendingVisible.every(f=>f.provider==='native'),'Deadline fixes the reopened generation to native glass');
  assert.equal(await overlay.evaluate(()=>window.__motionStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),true,'Pending generation replacement ends every capture');
  report.cases.push({phase:'cold-pending-close-reopen',reopenedAt,frames:pendingFrames});await close();await overlay.evaluate(()=>{window.__motionCaptureMode='normal';});
  await open('menu');await poll(()=>overlay.locator('.sheet-popup[data-formation-ready=true]').count(),n=>n===1,'Context baseline');
  const before=await app.state(),target=before.tabs.find(t=>t.id!==before.activeTabId);
  if(target){await sample();await app.act({type:'tab.select',id:target.id});await poll(()=>overlay.evaluate(()=>window.__motionDone),Boolean,'Visible context replacement');const frames=await overlay.evaluate(()=>window.__motionFrames);report.cases.push({phase:'visible-context-replacement',visibleOpaqueFrames:frames.filter(f=>f.visible>0&&f.provider==='opaque').length,requiresMaterialReview:frames.some(f=>f.visible>0&&(f.provider==='opaque'||f.provider==='pending')),frames});await close();}
  for(const selectionInput of ['pointer','keyboard']){
   await open('tabs-keyboard');await poll(()=>overlay.locator('.sheet-popup[data-formation-ready=true][data-material-provider=live][data-material-frame=frozen]').count(),n=>n===1,'Captured tab selection baseline');
   const baseline=await overlay.locator('.sheet-popup').evaluate(n=>({provider:n.dataset.materialProvider,sources:n.querySelectorAll('canvas[data-popup-source-frame=frozen]').length}));assert.equal(baseline.provider,'live');assert.ok(baseline.sources>0,'Selection must start with captured pixels');
   const beforeSelection=await app.state();await sample();
   const selected=overlay.locator('.tab-result:not([aria-current="page"])').first();
   if(selectionInput==='pointer')await selected.evaluate(button=>{button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));button.click();});else await selected.press('Enter');
   await poll(()=>app.state(),state=>state.activeTabId!==beforeSelection.activeTabId,'Different tab is actually selected');
   await poll(()=>overlay.locator('.sheet-popup').count(),n=>n===0,'Viewer closes after selection');
   const selectFrames=await overlay.evaluate(()=>window.__motionFrames),visibleSelection=selectFrames.filter(f=>f.visible>0),intermediate=visibleSelection.filter(f=>f.visible<.98&&f.visible>.02&&f.provider==='live'&&f.captureOpacity===1&&f.sources.length>0);
   assert.ok(intermediate.length>0,'Captured selection exit must show an intermediate glass fade, not disappear');
   assert.ok(visibleSelection.every(f=>f.provider==='live'&&f.sources.length&&f.activeCaptureTracks===0&&f.captureOpacity===1),'Every visible exit frame keeps frozen captured material');
   report.cases.push({phase:'different-tab-selection-close',selectionInput,baseline,intermediateCapturedFrames:intermediate.length,visibleOpaqueFrames:0,requiresMaterialReview:false,frames:selectFrames});
  }
 }
 for(const {reducedMotion,reducedTransparency} of [{reducedMotion:false,reducedTransparency:false},{reducedMotion:false,reducedTransparency:true},{reducedMotion:true,reducedTransparency:true}]){
  await app.act({type:'settings.update',patch:{appearance:'dark',interfaceScale:100,reducedMotion,reducedTransparency}});await sleep(250);
  await open('menu');await sleep(350);await sample();
  const closeAt=await app.ui.evaluate(async()=>{const at=performance.timeOrigin+performance.now();await window.acira.closeOverlay((await window.acira.getBrowserLayout()).overlay.id);return at;});
  await poll(()=>overlay.locator('.sheet-popup').count(),n=>n===0,'sampled close completes');
  const closingFrames=await overlay.evaluate(()=>window.__motionFrames);
  if(!label.startsWith('baseline'))for(const frame of closingFrames.filter(f=>f.visible>0&&f.provider==='live')){assert.equal(frame.captureOpacity,1,'Captured texture persists during the close');assert.equal(frame.activeCaptureTracks,0,'Closing uses frozen pixels, not live tracks');}
  report.cases.push({reducedMotion,reducedTransparency,phase:'close',inputAt:closeAt,frames:closingFrames});
  await sample();
  await open('menu');await poll(()=>overlay.locator('.sheet-popup:not([data-preparing])').count(),n=>n===1,'Reversal starts from an actual visible sheet');await sleep(45);await app.ui.evaluate(async()=>window.acira.closeOverlay((await window.acira.getBrowserLayout()).overlay.id));await sleep(35);await open('menu');
  await poll(()=>overlay.locator('.sheet-popup[data-formation-ready=true]').count(),n=>n===1,'interrupted sheet settles');
  const state=await overlay.evaluate(()=>{const n=document.querySelector('.sheet-popup');return{inert:n.inert,provider:n.dataset.materialProvider,opacity:getComputedStyle(n.querySelector('.popup-sheet-plane')).opacity,animations:n.getAnimations({subtree:true}).length,vapor:n.querySelectorAll('[data-vapor-layer]').length};});
  const reversalFrames=await overlay.evaluate(()=>window.__motionFrames);
  report.cases.push({reducedMotion,reducedTransparency,reversal:state,frames:reversalFrames});await close();
 }
 if(process.env.POPUP_CAPTURE==='1'){
  for(const appearance of ['dark','light']){
   await app.act({type:'settings.update',patch:{appearance,interfaceScale:100,reducedMotion:false,reducedTransparency:false}});await sleep(250);await open('tabs-keyboard');
   for(let i=0;i<8;i++){await overlay.screenshot({path:path.join(output,`${appearance}-tabs-${i}.png`)});await sleep(25);}await close();
  }
 }
 const materialCases=report.cases.filter(c=>c.firstSurfaceMaterial);
 report.capturedFirstVisibleCases=materialCases.filter(c=>c.capturedTextureOnFirstVisibleFrame).length;report.materialCaseCount=materialCases.length;
 report.capturedFirstFrameQualification=materialCases.length&&report.capturedFirstVisibleCases===materialCases.length?'Decoded captured pixels on every sampled first visible frame; physical pixel review still required':'Captured readiness partial or untested; native-fallback attribution and physical pixel review required';
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);throw error;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await app?.close();await fixture.close();console.log(JSON.stringify({output,status:report.status,cases:report.cases.map(({frames,...r})=>r)}));}
