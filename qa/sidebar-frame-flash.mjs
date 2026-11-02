import{execFileSync}from'node:child_process';
// Exercise the real native overlay, including its transition lifecycle, on an owned profile.
import {startNativeCapture,stopNativeCapture} from './native-capture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const require=createRequire(import.meta.url),stamp=Date.now(),root=path.resolve('.qa-profiles/sidebar-motion-'+stamp),out=path.resolve(process.env.SIDEBAR_MOTION_OUT||'qa/artifacts/sidebar-motion-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const fixture=await httpFixture((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Motion fixture</title><style>html,body{margin:0;height:100%;background:#00d060}</style><script>window.nonce=Math.random();window.resizes=0;onresize=()=>resizes++;</script>');});
const url='http://127.0.0.1:'+fixture.port+'/',{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,makeTab}=require('../desktop/runtime.cjs'),s=createInitialState();
s.tabs=[makeTab('motion-page','Motion fixture',url,s.activeBrowserProfileId)];s.activeTabId='motion-page';Object.assign(s.settings,{onboardingComplete:true,askBeforeClosing:false,verticalTabs:true,reducedMotion:false,animationSpeed:'premium',sidebarPeek:{full:true,compact:true,focus:true}});Object.assign(s.windowUi,{workspaceOpen:false,webWorkspaceOpen:false,view:'compact'});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',s);db.close();let app;
const report={passed:false,nativePlatform:process.platform,cases:[]};
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 await app.main(({BaseWindow,screen})=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'));w.setFocusable(false);w.blur();w.setBounds({x:-17000,y:100,width:1280,height:820});w.showInactive();w.isFocused=()=>true;screen.getCursorScreenPoint=()=>{const b=w.getContentBounds();return{x:b.x+700,y:b.y+400};};});
 const page=await app.waitWeb(url),probe=()=>page.evaluate(()=>({width:innerWidth,height:innerHeight,nonce,resizes}));
 await sleep(700);
 await app.ui.evaluate(()=>{const original=document.startViewTransition.bind(document);window.motionTrace=[];document.startViewTransition=update=>{const row={start:performance.now()};window.motionTrace.push(row);const t=original(update);t.ready.then(()=>row.ready=performance.now(),()=>row.skipped=true);t.finished.then(()=>row.finished=performance.now());return t;};});
 for(const speed of ['fast'])for(const view of ['compact']){
  await app.act({type:'settings.update',patch:{animationSpeed:speed}});await app.act({type:'ui.update',patch:{view,workspaceOpen:false,webWorkspaceOpen:false}});await sleep(700);
  const before=await probe();
  await app.ui.evaluate(()=>{window.motionFrames=[];window.motionRecording=true;const frame=()=>{if(!window.motionRecording)return;const root=document.documentElement,rail=document.querySelector('.ed-rail.is-peek'),surface=rail&&getComputedStyle(rail,'::after');window.motionFrames.push({at:performance.now(),overlay:root.dataset.sidebarOverlay||null,mode:root.dataset.modeSwitch||null,sidebar:!!rail,backing:surface?.backgroundColor||null,desktopMaterial:root.dataset.desktopMaterial||null,travel:root.style.getPropertyValue('--sf-sidebar-travel'),animations:document.getAnimations().map(a=>({name:a.animationName,pseudo:a.effect?.pseudoElement,time:a.currentTime,progress:a.effect?.getComputedTiming().progress,state:a.playState}))});requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  console.log(await app.main(({BaseWindow})=>BaseWindow.getAllWindows().map(w=>({bounds:w.getBounds(),focused:BaseWindow.prototype.isFocused.call(w),ui:w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html')}))));
  await Promise.race([startNativeCapture(app.app,app.ui,{everyFrame:true,maxFrames:180,allowOnscreen:true}),sleep(8000).then(()=>{throw Error('Native capture startup timed out');})]);console.log('Capture started');
  await app.cmd({type:'edge',tabId:'motion-page',keys:{top:false,side:true}});
  await poll(()=>app.ui.locator('.ed-rail.is-peek').count(),n=>n===1,'Revealed sidebar');await sleep(650);
  await app.cmd({type:'edge',tabId:'motion-page',keys:{top:false,side:false},dismiss:'side'});await sleep(650);
  const pixels=await stopNativeCapture(app.ui);for(const [i,f] of pixels.entries())await fs.writeFile(path.join(out,'native-'+String(i).padStart(3,'0')+'.png'),Buffer.from(f.image,'base64'));await fs.writeFile(path.join(out,'native-times.json'),JSON.stringify(pixels.map(({time})=>time)));
  const analysis=JSON.parse(execFileSync('python3',['-c',`from PIL import Image
from pathlib import Path
import sys,json
bad=[];files=sorted(Path(sys.argv[1]).glob('native-*.png'));assert len(files)>12
for i,f in enumerate(files):
 im=Image.open(f);w,h=im.size
 for yf in [.4,.6,.8]:
  y=int(h*yf);sample=int(w*.035);r,g,b,*_=im.getpixel((sample,y))
  edge=next((x for x in range(int(w*.4)) if (lambda p:p[1]>190 and p[0]<20)(im.getpixel((x,y)))),0)
  if edge>sample+5 and g-r>25 and 45<g<175:bad.append({'frame':i,'pixel':[r,g,b],'y':y})
print(json.dumps({'frames':len(files),'bleedFrames':bad}))`,out],{encoding:'utf8'}));assert.deepEqual(analysis.bleedFrames,[],'No page-tinted flash inside the sidebar');report.pixelAnalysis=analysis;
  const detail=await app.ui.evaluate(()=>{window.motionRecording=false;return{frames:window.motionFrames,transitions:window.motionTrace.splice(0)};});
  report.cases.push({view,speed,...detail});
  assert.deepEqual(await probe(),before,'Hover must not resize or reload the native website');
  const moving=detail.frames.filter(f=>f.mode==='edge'&&f.sidebar);
  assert(moving.length>=8,'Reveal must present intermediate animation frames');
  assert(moving.every(f=>f.desktopMaterial==='ready'?f.backing==='rgba(0, 0, 0, 0)':f.backing&&!f.backing.startsWith('rgba(')),'One desktop material or its opaque fallback stays behind the moving sidebar');
  for(const suffix of ['in','out']){
   const aligned=detail.frames.flatMap(f=>{const panel=f.animations.find(a=>a.name==='sb-slide-'+suffix),corners=f.animations.find(a=>a.name==='sidebar-corners-'+suffix);return panel&&corners?[{panel,corners,travel:f.travel}]:[];});
   assert(aligned.length>2,'Rounded corners must travel throughout the '+suffix+' animation');
   assert(aligned.every(f=>Math.abs(f.panel.progress-f.corners.progress)<.02&&parseFloat(f.travel)>100),'The page curve and sidebar must move together');
  }
  for(let i=1;i<detail.frames.length;i++){
   const old=detail.frames[i-1],now=detail.frames[i];
   if(old.mode==='edge'&&now.mode==='edge')assert(now.at-old.at<100,'No long animation-frame stall');
  }
  assert.equal(detail.frames.at(-1).overlay,null,'Native stacking must return to rest after the exit finishes');
 }
 await app.ui.evaluate(()=>{const original=document.startViewTransition.bind(document);document.startViewTransition=update=>original(async()=>{await new Promise(resolve=>setTimeout(resolve,450));return update();});});
 const before=await probe();
 await app.cmd({type:'edge',tabId:'motion-page',keys:{top:false,side:true}});await sleep(1100);
 await app.cmd({type:'edge',tabId:'motion-page',keys:{top:false,side:false},dismiss:'side'});await sleep(420);
 assert(['native','dom'].includes(await app.ui.evaluate(()=>document.documentElement.dataset.sidebarOverlay)),'Slow capture must not lower the overlay before the exit animation');
 const order=await app.main(({BaseWindow},url)=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html')),kids=w.contentView.children;return{chrome:kids.findIndex(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'),page:kids.findIndex(v=>v.webContents?.getURL()===url)};},url);
 assert(order.chrome>order.page,'Native chrome stays above the page until exit completion');
 await app.cmd({type:'edge',tabId:'motion-page',keys:{top:false,side:true}});await sleep(1600);
 assert.equal(await app.ui.locator('.ed-rail.is-peek').count(),1,'A rapid re-entry must retain the most recent pointer request');
  assert(['native','dom'].includes(await app.ui.evaluate(()=>document.documentElement.dataset.sidebarOverlay)),'A previous exit must not remove a newer reveal');
 assert.deepEqual(await probe(),before);
 report.cases.push({delayedCapture:true,nativeStacking:order,latestRequestRetained:true,viewportUnchanged:true});
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;}finally{await app?.close();await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,error:report.error,out}));}
