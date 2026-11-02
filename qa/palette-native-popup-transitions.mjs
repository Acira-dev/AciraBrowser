import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {verifyRuntimePolicy} from '../scripts/release-runtime-policy.mjs';
import {nativePage,poll} from './native-helpers.mjs';
import {startNativeCapture,stopNativeCapture} from './native-capture.mjs';

const out=path.resolve('qa/artifacts/palette-native-popup-transitions-'+Date.now()),profile=path.resolve('.qa-profiles/palette-native-popup-transitions');await fs.mkdir(out,{recursive:true});
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const report={checkedAt:new Date().toISOString(),qualification:'Native scene-change/reduced-motion checks only after the release runtime policy accepts the exact installed patched executable. Isolated own app window/profile/local site, no audio or desktop input/preview restart. Native samples do not prove smoothness or human likeness.',status:'NOT_RUN',checks:[],cases:[],events:[],errors:[]};
const record=(name,pass,detail={})=>report.checks.push({name,pass,...detail});
let app,ui,overlay,server,capturing=false;
try{
 const require=createRequire(import.meta.url),executable=require('electron'),installed=JSON.parse(await fs.readFile('node_modules/electron/package.json','utf8'));
 report.runtime={version:installed.version,executable,executableSha256:await hash(executable)};
 try{report.runtimeGate=verifyRuntimePolicy({policy:JSON.parse(await fs.readFile('packaging/runtime-security.json','utf8')),version:installed.version,executableSha256:report.runtime.executableSha256});}catch(error){report.guardReason=error.message;report.status='WAITING_RUNTIME';process.exitCode=2;}
 if(!report.runtimeGate||process.argv.includes('--check-runtime')){
  if(report.runtimeGate)report.status='RUNTIME_ACCEPTED_TEST_NOT_RUN';
 }else{
  let codeRoot=process.cwd();const snapshotArgument=process.argv.indexOf('--snapshot');
  if(snapshotArgument>=0){
   codeRoot=path.resolve(process.argv[snapshotArgument+1]||'');const allowed=path.resolve('.preview-profile/builds')+path.sep;
   if(!codeRoot.startsWith(allowed))throw Error('Choose the explicitly identified code-only preview snapshot');
   const manifest=JSON.parse(await fs.readFile(path.join(codeRoot,'preview-manifest.json'),'utf8')),identity=createHash('sha256');
   for(const file of manifest.files){const target=path.resolve(codeRoot,file.path);if(!target.startsWith(codeRoot+path.sep))throw Error('Snapshot path escapes code root');const bytes=await fs.readFile(target);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Snapshot file changed: '+file.path);identity.update(file.path.replaceAll('\\','/')).update('\0').update(bytes);}
   if(identity.digest('hex')!==manifest.id||path.resolve(manifest.entry)!==path.join(codeRoot,'desktop/main.cjs'))throw Error('Snapshot identity/entry does not match its manifest');
   report.snapshot={id:manifest.id,entry:manifest.entry,manifestSha256:await hash(path.join(codeRoot,'preview-manifest.json'))};report.source=manifest.files;
  }
  const files=['src/components/SheetPopupSurface.tsx','src/ui/sheetFormation.ts','src/ui/usePopupBackdrop.ts','src/styles/popup-sheet.css','src/styles/popup-material.css','desktop/main.cjs','desktop/composition.cjs'];
  if(!report.source)report.source=await Promise.all(files.map(async file=>({path:file,sha256:await hash(file)})));
  report.distIndex=await fs.readFile(path.join(codeRoot,'dist/index.html'),'utf8');
  server=http.createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Palette popup transitions</title><style>body{margin:0;background:repeating-linear-gradient(45deg,#174967 0 40px,#eeb652 40px 80px);font:32px sans-serif;color:white}h1{margin:40px}</style><h1>Controlled app-only backdrop</h1>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/`;
  app=await _electron.launch({args:[path.join(codeRoot,'desktop/main.cjs')],executablePath:executable,env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_DEV:'0',ACIRA_PREVIEW_RECORD:'1'},timeout:30000});
  report.loadedRuntime=await app.evaluate(()=>({electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node}));
  if(report.loadedRuntime.electron!==report.runtime.version)throw Error('Loaded runtime differs from the accepted pin');
  ui=await nativePage(app,'acira-browser-ui://ui/index.html');await ui.locator('.browser-shell').waitFor();
  await ui.waitForFunction(()=>!document.querySelector('.setup-dialog')||[...document.querySelectorAll('.setup-dialog button')].some(button=>button.textContent?.trim()==='Skip setup'));
  const skip=ui.getByRole('button',{name:'Skip setup',exact:true});if(await skip.count()){await skip.evaluate(button=>button.click());await ui.locator('.setup-dialog').waitFor({state:'detached'});}
  const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action);
  await act({type:'settings.update',patch:{onboardingComplete:true,interfaceScale:100,reducedMotion:false,glassOpacity:64,appearance:'light',colorPreset:'Burgundy',accentColor:'#4d1821',browserTint:'#4d1821'}});
  await act({type:'tab.navigate',url});const controlledPage=await nativePage(app,url);await controlledPage.waitForFunction(()=>document.readyState==='complete');
  await poll(()=>ui.evaluate(()=>window.acira.getSnapshot()),state=>{const tab=state.tabs.find(tab=>tab.id===state.activeTabId);return tab?.url===url&&!tab.loading&&!tab.error;},'Controlled document settled');
  report.window=await app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];globalThis.__paletteWindowEvents=[];globalThis.__paletteLastResize=Date.now();for(const event of ['resize','blur','focus','show','hide'])win.on(event,()=>{if(event==='resize')globalThis.__paletteLastResize=Date.now();globalThis.__paletteWindowEvents.push({event,at:Date.now(),bounds:win.getBounds()});});win.setFocusable(false);win.setIgnoreMouseEvents(true);win.setSkipTaskbar(true);win.setPosition(-20000,-20000);win.setSize(1400,1000);win.showInactive();return{bounds:win.getBounds(),focused:win.isFocused(),focusable:win.isFocusable()};});
  if(report.window.focused||report.window.focusable)throw Error('Own native window must remain unfocused/unfocusable');
  report.geometrySettled=await poll(()=>app.evaluate(({BaseWindow})=>({stableForMs:Date.now()-globalThis.__paletteLastResize,contentSize:BaseWindow.getAllWindows()[0].getContentSize()})),value=>value.stableForMs>=250,'Native geometry settled');
  overlay=await nativePage(app,'acira-browser-ui://ui/index.html?view=overlay');await overlay.locator('.app.native-layer').waitFor({state:'attached'});await overlay.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  report.preconditions={controlledDocument:'complete',activeNavigation:'settled',overlayReactMounted:true};for(const page of [ui,overlay])page.on('pageerror',error=>report.errors.push(error.message));
  await overlay.evaluate(()=>{window.__paletteMediaFailures=[];const original=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getDisplayMedia=async constraints=>{try{return await original(constraints);}catch(error){window.__paletteMediaFailures.push({at:Date.now(),name:error.name,message:error.message,focused:document.hasFocus(),active:navigator.userActivation.isActive});throw error;}};});
  const snapshot=()=>ui.evaluate(()=>window.acira.getSnapshot());
  const current=()=>overlay.evaluate(()=>{const root=document.querySelector('.sheet-popup'),plane=root?.querySelector('.popup-sheet-plane'),foreground=root?.querySelector('.popup-contents');if(!root||!plane||!foreground)return null;const p=getComputedStyle(plane),f=getComputedStyle(foreground);return{at:Date.now(),origin:root.dataset.sheetOrigin,scene:root.querySelector('[data-popup-scene]')?.dataset.popupScene,provider:root.dataset.materialProvider,preparing:root.hasAttribute('data-preparing'),inert:root.inert,ready:root.dataset.formationReady,progress:Number(p.getPropertyValue('--sheet-progress')),filter:f.filter,opacity:f.opacity,transform:f.transform,planeMask:p.maskImage,foregroundMask:f.maskImage,running:plane.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length};});
  const open=async kind=>{const previous=(await current())?.scene;report.events.push({event:'open-'+kind,at:Date.now(),trigger:'actual-rendered-control'});const control=kind==='menu'?ui.getByRole('button',{name:'Acira menu',exact:true}):kind==='profile'?ui.getByRole('button',{name:'Switch profile',exact:true}):ui.getByRole('button',{name:/^Search tabs/});await control.filter({visible:true}).first().evaluate(button=>button.click());return poll(current,value=>value&&value.scene!==previous&&value.scene?.endsWith(':'+kind)&&!value.preparing&&!value.inert,'Interactive target scene '+kind);};
  const rest=(kind,scene)=>poll(current,value=>value?.scene===scene&&value.scene.endsWith(':'+kind)&&!value.preparing&&!value.inert&&value.ready==='true'&&value.filter==='none'&&value.opacity==='1'&&value.transform==='none','Crisp target foreground '+kind);
  const close=async()=>{await overlay.evaluate(async()=>{const layout=await window.acira.getBrowserLayout();window.acira.closeOverlay(layout.overlay?.id);});await poll(current,value=>value===null,'Closed foreground');};
  await overlay.evaluate(()=>{window.__paletteSeenTracks=new Set();window.__paletteTrace=[];window.__paletteTraceOn=true;const tags=new WeakMap();let serial=0;const tick=()=>{if(!window.__paletteTraceOn)return;const roots=[...document.querySelectorAll('.sheet-popup')],root=roots[0],plane=root?.querySelector('.popup-sheet-plane'),foreground=root?.querySelector('.popup-contents');if(root&&!tags.has(root))tags.set(root,++serial);for(const video of document.querySelectorAll('.popup-backdrop-video'))for(const track of video.srcObject?.getTracks()||[])window.__paletteSeenTracks.add(track);const p=plane&&getComputedStyle(plane),f=foreground&&getComputedStyle(foreground);window.__paletteTrace.push({at:Date.now(),count:roots.length,tag:root?tags.get(root):null,scene:root?.querySelector('[data-popup-scene]')?.dataset.popupScene,provider:root?.dataset.materialProvider,preparing:root?.hasAttribute('data-preparing'),inert:root?.inert,ready:root?.dataset.formationReady,visibility:root&&getComputedStyle(root).visibility,progress:p?Number(p.getPropertyValue('--sheet-progress')):null,filter:f?.filter,opacity:f?.opacity,transform:f?.transform,planeMask:p?.maskImage,foregroundMask:f?.maskImage});requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  const frames=[],phases=[];
  const drain=async()=>{const next=await app.evaluate(async()=>globalThis.__qaRecorder.webContents.executeJavaScript('(()=>{const cap=window.__nativeCapture,frames=cap.frames;cap.frames=[];return frames;})()'));frames.push(...next);return frames.length;};
  const captureStart=Date.now();await startNativeCapture(app,ui);capturing=true;
  const coldInteractive=await open('menu'),coldSettled=await rest('menu',coldInteractive.scene);await drain();phases.push({kind:'cold-menu',interactive:coldInteractive,settled:coldSettled,frameEnd:frames.length});
  record('native cold menu settles with live material and crisp foreground',coldSettled.provider==='live'&&coldSettled.origin==='top-right',{settled:coldSettled});
  await app.evaluate(({BaseWindow})=>{globalThis.__paletteVisibility=[];const find=(view,parent)=>{if(view.webContents?.getURL().includes('view=overlay'))return{view,parent};for(const child of view.children||[]){const match=find(child,view);if(match)return match;}};globalThis.__paletteVisibilityTimer=setInterval(()=>{const match=find(BaseWindow.getAllWindows()[0].contentView);globalThis.__paletteVisibility.push({at:Date.now(),hostVisible:match?.parent.getVisible(),contentVisible:match?.view.getVisible()});},16);});
  const start=Date.now();
  for(const kind of ['profile','tabs','menu']){const interactive=await open(kind),settled=await rest(kind,interactive.scene);record('native scene settles with live material and crisp foreground',settled.provider==='live'&&settled.origin===(kind==='tabs'?'center':kind==='menu'?'top-right':'bottom-left'),{kind,settled});const frameStart=frames.length;await drain();phases.push({kind,interactive,settled,frameStart,frameEnd:frames.length});}
  const end=Date.now();
  const visibility=await app.evaluate(()=>{clearInterval(globalThis.__paletteVisibilityTimer);delete globalThis.__paletteVisibilityTimer;return globalThis.__paletteVisibility;});
  const closeStart=Date.now();await close();await ui.waitForTimeout(80);await drain();frames.push(...await stopNativeCapture(ui));capturing=false;const captureEnd=Date.now();
  phases.push({kind:'normal-close',start:closeStart,end:captureEnd});
  const trace=await overlay.evaluate(()=>window.__paletteTrace.filter(frame=>frame.at<=Date.now()));
  const scenes=trace.filter(frame=>frame.at>=start&&frame.at<=end);
  record('native scene changes retain one mounted surface',scenes.length>10&&scenes.every(frame=>frame.count===1)&&new Set(scenes.map(frame=>frame.tag)).size===1);
  record('native formed material never resets or hides during scene changes',scenes.every(frame=>frame.progress===1&&frame.visibility==='visible'));
  record('native scene-change provider stays live',scenes.every(frame=>frame.provider==='live'));
  record('native host/content stay visible through scene changes',visibility.length>0&&visibility.every(frame=>frame.hostVisible&&frame.contentVisible));
  record('native foreground remains spatially unmasked',scenes.every(frame=>frame.planeMask==='none'&&frame.foregroundMask==='none'));
  const normalFolder=path.join(out,'normal-scenes');await fs.mkdir(normalFolder,{recursive:true});
  for(const [index,frame]of frames.entries())await fs.writeFile(path.join(normalFolder,String(index).padStart(3,'0')+'.png'),Buffer.from(frame.image,'base64'));
  await fs.writeFile(path.join(normalFolder,'frames.json'),JSON.stringify(frames.map((frame,index)=>({time:frame.time,file:String(index).padStart(3,'0')+'.png'})),null,2));
  await fs.writeFile(path.join(normalFolder,'trace.json'),JSON.stringify({captureStart,captureEnd,start,end,phases,trace,scenes,visibility},null,2));
  report.cases.push({kind:'normal-scene-switch',frames:frames.length,samples:scenes.length,hostSamples:visibility.length,phases,recording:'Cold opening, three naturally settled scene changes and normal close; actual native frame timestamps, no invented frame rate.'});
  await poll(()=>overlay.evaluate(()=>[...window.__paletteSeenTracks].map(track=>track.readyState)),states=>states.length>0&&states.every(state=>state==='ended'),'Scene streams stop after final close');record('all observed scene-change material tracks end after close',true);
  await act({type:'settings.update',patch:{reducedMotion:true}});
  for(const kind of ['tabs','menu','profile']){
   await startNativeCapture(app,ui);capturing=true;const firstReady=await open(kind);record('reduced native first interactive frame is already crisp',firstReady.ready==='true'&&firstReady.progress===1&&firstReady.filter==='none'&&firstReady.opacity==='1'&&firstReady.transform==='none',{kind,firstReady});record('reduced native foreground starts no WAAPI animation',firstReady.running===0,{kind});
   await ui.waitForTimeout(100);const still=await app.evaluate(async()=>globalThis.__qaRecorder.webContents.executeJavaScript(`(()=>{const cap=window.__nativeCapture,canvas=document.createElement('canvas');canvas.width=cap.video.videoWidth;canvas.height=cap.video.videoHeight;canvas.getContext('2d').drawImage(cap.video,0,0);return{time:Date.now(),image:canvas.toDataURL('image/png').split(',')[1]};})()`));
   await stopNativeCapture(ui);capturing=false;await fs.writeFile(path.join(out,'reduced-'+kind+'.png'),Buffer.from(still.image,'base64'));report.cases.push({kind:'reduced-'+kind,firstReady,frameTime:still.time});await close();
  }
  report.mediaFailures=await overlay.evaluate(()=>{window.__paletteTraceOn=false;return window.__paletteMediaFailures;});report.build=JSON.parse(await fs.readFile(path.join(profile,'preview-build.json'),'utf8'));
  report.sourceStable=(await Promise.all(report.source.map(async item=>item.sha256===await hash(path.join(codeRoot,item.path))))).every(Boolean);record('monitored source stays stable',report.sourceStable);
  record('own native window remains unfocused',await app.evaluate(({BaseWindow})=>!BaseWindow.getAllWindows()[0].isFocused()));report.status='EXECUTED';
 }
}catch(error){report.errors.push(error.message);report.status='FAILED';process.exitCode=1;try{if(ui)report.diagnostics={windowEvents:await app.evaluate(()=>globalThis.__paletteWindowEvents),layout:await ui.evaluate(()=>window.acira.getBrowserLayout()),state:await ui.evaluate(async()=>{const state=await window.acira.getSnapshot();return{activeTabId:state.activeTabId,settings:{onboardingComplete:state.settings.onboardingComplete,reducedMotion:state.settings.reducedMotion},tabs:state.tabs.map(tab=>({id:tab.id,url:tab.url,loading:tab.loading,error:tab.error}))};}),browserText:(await ui.locator('body').innerText()).slice(0,1500),overlayText:overlay?(await overlay.locator('body').innerText()).slice(0,1500):null,overlayRoots:overlay?await overlay.locator('.app,.popup-surface').evaluateAll(nodes=>nodes.map(node=>({className:node.className,visibility:getComputedStyle(node).visibility}))):null};}catch(diagnostic){report.diagnosticError=diagnostic.message;}}finally{
 try{if(capturing)await stopNativeCapture(ui);if(app)await app.evaluate(()=>clearInterval(globalThis.__paletteVisibilityTimer));}catch{}
 try{report.failures=report.checks.filter(check=>!check.pass);await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));}finally{await app?.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
console.log(JSON.stringify({out,status:report.status,guardReason:report.guardReason,checks:report.checks.length,failures:report.failures,errors:report.errors}));if(report.failures?.length)process.exitCode=1;
