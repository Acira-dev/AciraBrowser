// App-owned native capture comparison. No pixel/URL/profile logging, screenshots, image files, uploads or audio.
// Run only under the root native lease, against one coherent build; D_APP_EXE selects an installed artifact.
import assert from 'node:assert/strict';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';

const report={checks:[],samples:[],limitations:['Synthetic owned chrome/page texture is not NASA artwork qualification. Timings are measured, never assumed faster. Future child coverage requires native auxiliary-bounds acknowledgment.']};
let stage='prepare',app;
function paint(){
 const canvas=document.createElement('canvas');canvas.id='qa-owned-texture';canvas.width=innerWidth;canvas.height=innerHeight;canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10000';
 const context=canvas.getContext('2d'),image=context.createImageData(canvas.width,canvas.height);let seed=3247;
 for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const index=(y*canvas.width+x)*4;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const band=x%96;image.data[index]=band<20?235:band<40?25:seed&255;image.data[index+1]=band<20?40:band<40?200:seed>>>8&255;image.data[index+2]=band<20?70:band<40?220:seed>>>16&255;image.data[index+3]=255;}
 context.putImageData(image,0,0);document.querySelector('#qa-owned-texture')?.remove();document.body.append(canvas);
}
const site=await httpFixture((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(`<!doctype html><title>Owned snapshot fixture</title><body style="margin:0"><script>(${paint})();</script>`);});
const stamp=Date.now(),base=`http://127.0.0.1:${site.port}`;
const ownWindow=async(show=true)=>app.main(({BaseWindow},show)=>{const window=BaseWindow.getAllWindows()[0];window.setFocusable(false);window.setIgnoreMouseEvents(true);window.setSkipTaskbar(true);window.setBounds({x:-20000,y:-20000,width:1500,height:960});if(show)window.showInactive();else window.hide();if(window.isFocused()||window.getBounds().x>-2000)throw Error('Synthetic ownership fixture moved or focused');},show);
const close=async overlay=>{await overlay.evaluate(async()=>window.acira.closeOverlay((await window.acira.getBrowserLayout()).overlay?.id));await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()),value=>!value.overlay,'owned popup closed');await sleep(250);};
const open=async()=>{await app.ui.getByRole('button',{name:'Acira menu',exact:true}).filter({visible:true}).first().evaluate(button=>button.click());const overlay=await poll(()=>app.context.pages().find(page=>page.url().includes('?view=overlay')),Boolean,'owned popup renderer');await overlay.waitForFunction(()=>!!window.acira);await poll(()=>overlay.evaluate(()=>window.acira.getBrowserLayout()),value=>value.overlay?.kind==='menu','menu generation');await sleep(80);return overlay;};
async function prepare(mode){
 app=await startApp({root:`.qa-profiles/popup-snapshot-${mode}-${stamp}`});await ownWindow();
 await app.act({type:'settings.update',patch:{reducedTransparency:true}});await app.act({type:'tab.navigate',url:base+'/fixture'});await app.waitWeb(base+'/fixture');await poll(app.state,value=>!value.tabs.find(tab=>tab.id===value.activeTabId).loading,'owned source loaded');await app.ui.evaluate(paint);
 const overlay=await open();
 await overlay.evaluate(mode=>{
  const original=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices),play=HTMLMediaElement.prototype.play,records=new WeakMap();window.__qaCapture={stage:'prepare',records:[],streams:[],calls:0};
  navigator.mediaDevices.getDisplayMedia=async constraints=>{const qa=window.__qaCapture;qa.calls++;if(mode==='snapshot')throw new DOMException('Synthetic snapshot-only comparison','NotSupportedError');const record={stage:qa.stage,start:performance.now(),acquired:null,decoded:null};qa.records.push(record);const stream=await original(constraints);record.acquired=performance.now();records.set(stream,record);qa.streams.push(stream);return stream;};
  HTMLMediaElement.prototype.play=function(...args){const result=Reflect.apply(play,this,args),record=this.srcObject&&records.get(this.srcObject);if(record){const check=()=>{if(this.readyState>=2&&this.videoWidth>0)record.decoded??=performance.now();};this.addEventListener('loadeddata',check,{once:true});void result.then(check,()=>{});}return result;};
 },mode);
 await close(overlay);await app.act({type:'settings.update',patch:{reducedTransparency:false}});return overlay;
}
async function probe(overlay,label){
 return overlay.evaluate(async label=>{
  const id=(await window.acira.getBrowserLayout()).overlay.id,before=window.__qaCapture.calls,start=performance.now(),snapshot=await window.acira.popupBackdropSnapshot(id),captured=performance.now();
  const sources=[];let bytes=0;
  for(const frame of snapshot.sources){
   bytes+=atob(frame.image.split(',')[1]).length;const image=new Image();image.src=frame.image;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,unique=new Set();let red=false,cyan=false;
   for(let i=0;i<pixels.length;i+=Math.max(4,Math.floor(pixels.length/2048/4)*4)){if(!pixels[i+3])continue;unique.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);red||=pixels[i]>180&&pixels[i+1]<100&&pixels[i+2]<140;cyan||=pixels[i]<100&&pixels[i+1]>140&&pixels[i+2]>140;}
   const b=frame.bounds,s=frame.sourceBounds;sources.push({kind:frame.key==='chrome'?'chrome':'page',bounds:b,radius:frame.radius,texture:unique.size>64,pattern:red&&cyan,inside:b.x>=s.x-.01&&b.y>=s.y-.01&&b.x+b.width<=s.x+s.width+.01&&b.y+b.height<=s.y+s.height+.01,small:canvas.width<=1024&&canvas.height<=1024});image.src='';canvas.width=canvas.height=0;
  }
  return {label,sources,bytes,captureMs:captured-start,decodeMs:performance.now()-captured,totalMs:performance.now()-start,noMediaRequest:before===window.__qaCapture.calls};
 },label);
}
try{
 stage='old-GDM-baseline';let overlay=await prepare('gdm');
 for(const temperature of ['cold','warm']){await overlay.evaluate(value=>window.__qaCapture.stage=value,temperature);overlay=await open();await sleep(350);const sample=await overlay.evaluate(label=>{const rows=window.__qaCapture.records.filter(row=>row.stage===label),decoded=rows.filter(row=>row.decoded!==null);return {label:'gdm-'+label,requests:rows.length,decoded:decoded.length,totalMs:decoded.length===rows.length&&rows.length?Math.max(...decoded.map(row=>row.decoded))-Math.min(...rows.map(row=>row.start)):null,provider:document.querySelector('.sheet-popup')?.dataset.materialProvider};},temperature);report.samples.push(sample);await close(overlay);assert(await overlay.evaluate(()=>window.__qaCapture.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))));}
 await app.close();app=null;
 stage='snapshot-pattern-crops';overlay=await prepare('snapshot');
 for(const [scale,zoom]of [[100,100],[150,125]]){
  await app.act({type:'settings.update',patch:{interfaceScale:scale}});const tab=(await app.state()).activeTabId;await app.cmd({type:'zoom',tabId:tab,zoom});await sleep(180);await app.ui.evaluate(paint);
  for(const temperature of ['cold','warm']){overlay=await open();const sample=await probe(overlay,`snapshot-${scale}-${zoom}-${temperature}`);assert.equal(sample.sources.length,2);assert(sample.sources.every(source=>source.inside&&source.small&&source.texture&&source.pattern));assert(sample.bytes<=2*1024*1024);assert(sample.noMediaRequest);report.samples.push(sample);await close(overlay);}
 }
 report.checks.push('Pattern/high-entropy owned chrome and page crops decode in memory at100/150% interface scale with independent100/125% page zoom; no snapshot media request');
 stage='snapshot-auxiliary-ack';overlay=await open();await probe(overlay,'parent-before-ack');
 const before=await app.ui.evaluate(()=>window.acira.getBrowserLayout()),box=before.overlay.bounds,aux={x:Math.max(12,box.x-228),y:box.y+60,width:220,height:240};
 await app.ui.evaluate(({before,aux})=>window.acira.setBrowserLayout({...before,overlay:{...before.overlay,auxiliaryBounds:aux}}),{before,aux});await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()),value=>value.overlay?.auxiliaryBounds?.x===aux.x,'native child bounds acknowledged');
 const child=await probe(overlay,'current-child-after-ack');assert(child.sources.length>0);assert(child.noMediaRequest);assert(child.sources[0].bounds.x<=aux.x);report.samples.push(child);await close(overlay);report.checks.push('Current acknowledged child receives a fresh guarded crop; parent frame does not anticipate future bounds');
 stage='snapshot-fail-closed';overlay=await open();const id=(await app.ui.evaluate(()=>window.acira.getBrowserLayout())).overlay.id;
 await assert.rejects(app.ui.evaluate(id=>window.acira.popupBackdropSnapshot(id),id));assert.equal((await overlay.evaluate(id=>window.acira.popupBackdropSnapshot(id+1000000),id)).sources.length,0);
 await ownWindow(false);assert.equal((await overlay.evaluate(id=>window.acira.popupBackdropSnapshot(id),id)).sources.length,0);await ownWindow();await close(overlay);
 await app.act({type:'settings.update',patch:{reducedTransparency:true}});overlay=await open();assert.equal((await overlay.evaluate(async()=>window.acira.popupBackdropSnapshot((await window.acira.getBrowserLayout()).overlay.id))).sources.length,0);await close(overlay);await app.act({type:'settings.update',patch:{reducedTransparency:false}});
 report.checks.push('Wrong renderer, stale generation, hidden owner and reduced transparency fail closed');
 stage='snapshot-navigation-race';overlay=await open();
 await app.main(({BaseWindow})=>{const visit=view=>{if(view.webContents&&/^http:\/\/127\.0\.0\.1:/.test(view.webContents.getURL()))return view.webContents;return (view.children||[]).map(visit).find(Boolean);};const wc=visit(BaseWindow.getAllWindows()[0].contentView),original=wc.capturePage.bind(wc);let release;const gate=new Promise(resolve=>{release=resolve;});globalThis.__qaSnapshotGate={started:0,release,restore:()=>{wc.capturePage=original;}};wc.capturePage=async(...args)=>{globalThis.__qaSnapshotGate.started++;const image=await original(...args);await gate;return image;};});
 const pending=overlay.evaluate(async()=>window.acira.popupBackdropSnapshot((await window.acira.getBrowserLayout()).overlay.id).then(value=>value.sources.length));await poll(()=>app.main(()=>globalThis.__qaSnapshotGate.started),value=>value>0,'owned native capture started');await app.act({type:'tab.navigate',url:base+'/next'});await app.main(()=>globalThis.__qaSnapshotGate.release());assert.equal(await pending,0);await app.main(()=>{globalThis.__qaSnapshotGate.restore();delete globalThis.__qaSnapshotGate;});report.checks.push('Navigation during a held owned capture publishes no frames');
 report.status='passed';console.log(JSON.stringify(report,null,2));
}catch(error){console.log(JSON.stringify({status:'failed',stage,code:error.name,checks:report.checks,samples:report.samples},null,2));throw new Error('Owned popup snapshot comparison failed at '+stage);}
finally{await app?.close();await site.close();}
