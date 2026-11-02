// Coordinator lease required. Captures only this fixture's own native window.
// Marker calibration is separate from popup samples; no capturePage polling.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';

const [tag='baseline',appearance='dark',scaleArg='100']=process.argv.slice(2),scale=Number(scaleArg);
if(!['dark','light'].includes(appearance)||![100,150].includes(scale))throw Error('theme dark|light, scale 100|150 required');
const output=path.resolve(`qa/artifacts/premium-screen-${tag.replace(/[^a-z0-9-]/gi,'-')}-${appearance}-${scale}-${Date.now()}`);
await fs.mkdir(output,{recursive:true});
const textured=process.env.POPUP_TEXTURED==='1';
const fixture=await httpFixture((_req,res)=>{res.setHeader('content-type','text/html');res.end(`<!doctype html><title>Motion fixture</title><body style="margin:0;min-height:100vh;background:${textured?'repeating-linear-gradient(45deg,#164b66 0 100px,#edc47c 100px 200px)':'#f4f1ea'};font:16px system-ui;padding:40px">Controlled ${textured?'textured':'light'} backdrop</body>`);});
const report={appearance,scale,textured,cases:[],qualification:'Owned-window pixel capture for explicit human/model visual review; captured status is not an automatic smoothness/material verdict.',limitations:['Screen-source arrival timestamps are upper bounds, not direct presentation timestamps. Marker calibration measures the same capture pipeline separately.']};
let app;
try{
 app=await startApp({root:`.qa-profiles/premium-screen-${Date.now()}`,env:{ACIRA_BROWSER_TEST_HIDDEN:'0'}});
 await app.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];globalThis.__motionWindow=w.id;w.setBounds({x:60,y:40,width:1280,height:900});w.showInactive();});
 await app.act({type:'settings.update',patch:{appearance,interfaceScale:scale,verticalTabs:false,reducedMotion:false,reducedTransparency:false}});
 const url=`http://127.0.0.1:${fixture.port}/`;
 await app.act({type:'tab.new',url});await app.waitWeb(url);await sleep(700);
 const overlay=await poll(()=>app.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'overlay');
 await app.main(async({BrowserWindow,BaseWindow,session},url)=>{
  const source=BaseWindow.fromId(globalThis.__motionWindow).getMediaSourceId(),ses=session.fromPartition(`qa-motion-screen-${Date.now()}`);
  ses.setPermissionCheckHandler((_wc,permission)=>permission==='media');ses.setPermissionRequestHandler((_wc,permission,done)=>done(permission==='media'));
  const cap=new BrowserWindow({show:false,width:400,height:300,webPreferences:{session:ses,backgroundThrottling:false}});globalThis.__motionCapture=cap;
  await cap.loadURL(url);
  return cap.webContents.executeJavaScript(`(async()=>{
   const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:${JSON.stringify(source)},maxFrameRate:60,minFrameRate:30,maxWidth:1280,maxHeight:900}}});
   window.__motionStream=stream;window.__frames=[];window.__record=false;window.__lastFrame=null;
   const reader=new MediaStreamTrackProcessor({track:stream.getVideoTracks()[0]}).readable.getReader();
   (async()=>{while(true){const{value,done}=await reader.read();if(done)break;if(!window.__record||window.__frames.length<8){const canvas=new OffscreenCanvas(value.displayWidth,value.displayHeight);canvas.getContext('2d').drawImage(value,0,0);const frame={at:performance.timeOrigin+performance.now(),canvas};if(window.__record)window.__frames.push(frame);else window.__lastFrame=frame;}value.close();}})();
   return stream.getVideoTracks()[0].getSettings();
  })()`);
 },url);
 const close=async()=>{await app.ui.evaluate(async()=>{const o=(await window.acira.getBrowserLayout()).overlay;if(o)await window.acira.closeOverlay(o.id);});await poll(()=>overlay.locator('.sheet-popup').count(),n=>n===0,'closed');};
 const record=async(name,trigger,marker=false,setup)=>{
  await close();if(setup)await setup();const priorBounds=setup?await overlay.locator('.sheet-popup').evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}):null;
  await sleep(100);await app.main(()=>globalThis.__motionCapture.webContents.executeJavaScript('window.__baseline=window.__lastFrame;window.__frames=[];window.__record=true;1'));
  const at=await trigger();await sleep(520);
  const bounds=marker?{x:0,y:0,width:240,height:28}:priorBounds??await overlay.locator('.sheet-popup').evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
  const data=await app.main(async(_,{bounds,scale})=>globalThis.__motionCapture.webContents.executeJavaScript(`(async()=>{
   window.__record=false;const bounds=${JSON.stringify(bounds)},scale=${scale}/100,out=[];
   for(const f of [window.__baseline,...window.__frames].filter(Boolean)){const rx=f.canvas.width/1280,ry=f.canvas.height/900,x=Math.max(0,Math.floor(bounds.x*scale*rx)),y=Math.max(0,Math.floor(bounds.y*scale*ry)),w=Math.max(1,Math.min(f.canvas.width-x,Math.ceil(bounds.width*scale*rx))),h=Math.max(1,Math.min(f.canvas.height-y,Math.ceil(bounds.height*scale*ry)));
    const crop=new OffscreenCanvas(w,h),ctx=crop.getContext('2d');ctx.drawImage(f.canvas,x,y,w,h,0,0,w,h);const pixels=ctx.getImageData(0,0,w,h).data;let sum=0;for(let p=0;p<pixels.length;p+=32)sum+=pixels[p]+pixels[p+1]+pixels[p+2];
    const blob=await crop.convertToBlob({type:'image/png'}),bytes=new Uint8Array(await blob.arrayBuffer());let bin='';for(let p=0;p<bytes.length;p+=8192)bin+=String.fromCharCode(...bytes.subarray(p,p+8192));out.push({at:f.at,sum,png:btoa(bin)});
   }window.__frames=[];return out;
  })()`),{bounds,scale});
  const baseline=data.filter(f=>f.at<at).at(-1)?.sum??data[0]?.sum,final=data.at(-1)?.sum;
  const frames=data.map(f=>({ms:f.at-at,change:Math.abs(f.sum-baseline)/Math.max(1,Math.abs(final-baseline))}));
  report.cases.push({name,firstChangeMs:frames.find(f=>f.ms>=0&&f.change>.03)?.ms,bounds,frames});
  for(const [i,f]of data.filter(f=>f.at>=at).slice(0,8).entries())await fs.writeFile(path.join(output,`${name}-${i}-${Math.round(f.at-at)}ms.png`),Buffer.from(f.png,'base64'));
  if(marker)await app.ui.evaluate(()=>document.getElementById('motion-marker')?.remove());
 };
 for(let i=0;i<3;i++)await record(`marker-${i}`,()=>app.ui.evaluate(()=>{const n=document.createElement('div');n.id='motion-marker';n.style.cssText='position:fixed;left:0;top:0;width:240px;height:28px;background:#f0f;z-index:2147483647';const at=performance.timeOrigin+performance.now();document.body.append(n);return at;}),true);
 for(const kind of ['menu','tabs'])await record(kind,()=>kind==='tabs'?app.main(({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()==='acira-browser-ui://ui/index.html'),at=Date.now();wc.sendInputEvent({type:'keyDown',keyCode:'T',modifiers:['alt']});wc.sendInputEvent({type:'keyUp',keyCode:'T',modifiers:['alt']});return at;}):app.ui.evaluate(()=>{const n=document.querySelector('[aria-label="Acira menu"]');const at=performance.timeOrigin+performance.now();n.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));n.click();return at;}));
 if(!tag.startsWith('baseline'))await record('tabs-select-close',()=>overlay.locator('.tab-result:not([aria-current="page"])').first().evaluate(button=>{const at=performance.timeOrigin+performance.now();button.click();return at;}),false,async()=>{
  await app.main(({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()==='acira-browser-ui://ui/index.html');wc.sendInputEvent({type:'keyDown',keyCode:'T',modifiers:['alt']});wc.sendInputEvent({type:'keyUp',keyCode:'T',modifiers:['alt']});});
  await poll(()=>overlay.locator('.sheet-popup[data-formation-ready=true][data-material-provider=live][data-material-frame=frozen]').count(),n=>n===1,'Captured tab selection glass baseline');
 });
 await close();report.status='captured';
}catch(error){report.status='failed';report.error=String(error.stack||error);throw error;}
finally{await app?.main(()=>globalThis.__motionCapture?.destroy()).catch(()=>{});await app?.close();await fixture.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,cases:report.cases.map(({frames,...c})=>c)}));}
