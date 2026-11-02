import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {nativePage,poll} from './native-helpers.mjs';
import {startNativeCapture,stopNativeCapture} from './native-capture.mjs';
import {paletteNativeIdentity,paletteNativeSourceStable} from './palette-native-identity.mjs';

const out=path.resolve('qa/artifacts/palette-native-settings-'+Date.now()),profile=path.resolve('.qa-profiles/palette-native-settings-'+Date.now());
await fs.mkdir(out,{recursive:true});
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const source=await Promise.all(['src/App.tsx','src/features/BrowserSettings.tsx','src/features/browser-settings.css','src/frost-preview.css'].map(async file=>({path:file,sha256:await hash(file)})));
const report={checkedAt:new Date().toISOString(),qualification:'Qualified patched runtime and verified immutable snapshot only. Requested native window900x700 with actual Windows/view bounds recorded, at supported interface sizes100/125/150 and open/closed workspace rail. Settings paint/fit only in an offscreen/unfocusable disposable app, no desktop input or profile mutation. Actual Import mount may automatically discover source-profile labels; no import or file chooser is invoked and captures remain local. Does not validate native service mutations, later source, arbitrary DPI/platforms or unsupported480px native windows.',workspaceSource:source,cases:[],checks:[],errors:[]};
const record=(name,pass,detail={})=>report.checks.push({name,pass,...detail});
let app,ui,capturing=false;
try{
 const identity=await paletteNativeIdentity();Object.assign(report,{runtime:identity.runtime,runtimeGate:identity.runtimeGate,snapshot:identity.snapshot,source:identity.source});
 if(identity.checkOnly){report.status='RUNTIME_ACCEPTED_TEST_NOT_RUN';}
 else{
 app=await _electron.launch({args:[identity.entry],executablePath:identity.executable,env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_DEV:'0',ACIRA_PREVIEW_RECORD:'1'},timeout:30000});
 report.loadedRuntime=await app.evaluate(()=>({electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node}));assert.equal(report.loadedRuntime.electron,identity.runtime.version);
 ui=await nativePage(app,'acira-browser-ui://ui/index.html');await ui.locator('.browser-shell').waitFor();
 await ui.waitForFunction(()=>!document.querySelector('.setup-dialog')||[...document.querySelectorAll('.setup-dialog button')].some(button=>button.textContent?.trim()==='Skip setup'));
 const skip=ui.getByRole('button',{name:'Skip setup',exact:true});if(await skip.count()){await skip.evaluate(button=>button.click());await ui.locator('.setup-dialog').waitFor({state:'detached'});}
 ui.on('pageerror',error=>report.errors.push(error.message));
 const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action);
 await act({type:'settings.update',patch:{onboardingComplete:true,interfaceScale:100,reducedMotion:true,colorPreset:'Burgundy',browserTint:'#4d1821',accentColor:'#4d1821',appearance:'light'}});
 report.window=await app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.setFocusable(false);win.setIgnoreMouseEvents(true);win.setSkipTaskbar(true);win.setPosition(-20000,-20000);win.setSize(900,700);win.showInactive();return{bounds:win.getBounds(),focused:win.isFocused(),focusable:win.isFocusable()};});
 assert.equal(report.window.focused,false);assert.equal(report.window.focusable,false);
 await act({type:'tab.new',url:'acira://settings'});await ui.getByRole('textbox',{name:'Search settings'}).waitFor();
 for(const scale of [100,125,150])for(const sidebar of [true,false]){
  await act({type:'settings.update',patch:{interfaceScale:scale}});await act({type:'ui.update',patch:{workspaceOpen:sidebar,webWorkspaceOpen:sidebar}});
  const nativeSize=await poll(()=>app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0],view=win.contentView.children.find(view=>view.webContents?.getURL()==='acira-browser-ui://ui/index.html');return{zoom:view.webContents.getZoomFactor(),bounds:win.getBounds(),contentSize:win.getContentSize(),viewBounds:view.getBounds()};}),value=>Math.abs(value.zoom-scale/100)<.001,'Native interface zoom applied');
  for(const section of ['Appearance','Profiles','Import & export']){
   await ui.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:section,exact:true}).evaluate(button=>button.click());await ui.getByRole('heading',{name:section,exact:true}).waitFor();
   await ui.locator('.bs-main').evaluate(el=>{el.scrollTop=0;});await ui.evaluate(()=>document.fonts.ready);
   const paint=await ui.locator('.browser-settings').evaluate(el=>{const main=el.querySelector('.bs-main'),page=el.querySelector('.bs-page'),box=node=>node.getBoundingClientRect().toJSON();return{innerWidth,innerHeight,width:el.clientWidth,mainWidth:main.clientWidth,scrollWidth:main.scrollWidth,page:box(page),rows:[...el.querySelectorAll('.bs-row')].map(row=>({title:row.querySelector('.bs-row-copy>span')?.textContent,box:box(row),copy:row.querySelector('.bs-row-copy')?box(row.querySelector('.bs-row-copy')):null,children:[...row.children].filter(child=>!child.classList.contains('bs-row-copy')).map(child=>box(child))})),alerts:[...el.querySelectorAll('[role=alert]')].map(node=>node.textContent)};});
   const key={scale,sidebar,section};record('Settings main has no horizontal overflow',paint.scrollWidth<=paint.mainWidth+2,key);
   record('Settings labels retain at least160px copy width',paint.rows.every(row=>!row.copy||row.copy.width>=159),{...key,smallest:Math.min(...paint.rows.filter(row=>row.copy).map(row=>row.copy.width))});
   record('Settings row controls remain inside their row bounds',paint.rows.every(row=>row.children.every(child=>child.left>=row.box.left-1&&child.right<=row.box.right+1)),key);
   await startNativeCapture(app,ui);capturing=true;await ui.waitForTimeout(150);
   // A static app need not emit another callback after video.play(). Read the
   // actual current source frame instead of inventing a repaint or frame time.
   const still=await app.evaluate(async()=>globalThis.__qaRecorder.webContents.executeJavaScript(`(()=>{const cap=window.__nativeCapture;if(!cap?.video.videoWidth)throw Error('Native source has no frame');const canvas=document.createElement('canvas');canvas.width=cap.video.videoWidth;canvas.height=cap.video.videoHeight;canvas.getContext('2d').drawImage(cap.video,0,0);return{time:Date.now(),mediaTime:cap.video.currentTime,image:canvas.toDataURL('image/png').split(',')[1]};})()`));
   const frames=await stopNativeCapture(ui);capturing=false;
   const file=scale+'-'+(sidebar?'rail':'closed')+'-'+section.toLowerCase().replaceAll(/[^a-z]+/g,'-')+'.png';await fs.writeFile(path.join(out,file),Buffer.from(still.image,'base64'));
   report.cases.push({...key,nativeSize,file,frameTime:still.time,mediaTime:still.mediaTime,callbackFrames:frames.length,...paint});
   assert.equal(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isFocused()),false);
  }
 }
 report.build=JSON.parse(await fs.readFile(path.join(profile,'preview-build.json'),'utf8'));
 report.sourceStable=await paletteNativeSourceStable(identity);
 record('monitored source remains stable',report.sourceStable);
 report.status='EXECUTED';
 }
}catch(error){report.errors.push(error.message);throw error;}finally{
 try{if(capturing)await stopNativeCapture(ui);}finally{try{report.failures=report.checks.filter(check=>!check.pass);await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));}finally{await app?.close();}}
}
console.log(JSON.stringify({out,cases:report.cases.length,checks:report.checks.length,failures:report.failures,sourceStable:report.sourceStable,errors:report.errors}));
if(report.failures.length||report.errors.length)process.exitCode=1;
