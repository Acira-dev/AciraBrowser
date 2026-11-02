import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {nativePage,poll} from './native-helpers.mjs';
import {startNativeCapture,stopNativeCapture} from './native-capture.mjs';
import {paletteNativeIdentity,paletteNativeSourceStable} from './palette-native-identity.mjs';

// Native app-window paint review only; no desktop input, real profile or preview.
const out=path.resolve('qa/artifacts/palette-native-brand-'+Date.now());
const profile=path.resolve('.qa-profiles/palette-native-brand-'+Date.now());
await fs.mkdir(out,{recursive:true});
const require=createRequire(import.meta.url);
const {appearancePalettes}=require(path.resolve('docs/design/color-research/production-qa/palettes.cjs'));
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const files=['src/components/BrandLogo.tsx','src/components/AciraSymbol.tsx','src/frost-preview.css','public/acira-logo.svg','public/acira-logo-light.svg','public/acira-symbol.svg'];
const source=await Promise.all(files.map(async file=>({path:file,sha256:await hash(file)})));
const report={checkedAt:new Date().toISOString(),qualification:'Actual isolated native app-window captures across twelve finishes/light-dark, only on qualified patched runtime and verified immutable code snapshot. Canonical assets and gradient paint only; no package/taskbar icon, arbitrary desktop acrylic, visual acceptance, later-source or user-preview restart claim.',workspaceSource:source,cases:[],errors:[]};
let app,ui,capturing=false;
try{
 const identity=await paletteNativeIdentity();Object.assign(report,{runtime:identity.runtime,runtimeGate:identity.runtimeGate,snapshot:identity.snapshot,source:identity.source});
 if(identity.checkOnly){report.status='RUNTIME_ACCEPTED_TEST_NOT_RUN';}
 else{
 report.distIndex=await fs.readFile(path.join(identity.codeRoot,'dist/index.html'),'utf8');
 app=await _electron.launch({args:[identity.entry],executablePath:identity.executable,env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_DEV:'0',ACIRA_PREVIEW_RECORD:'1'},timeout:30000});
 report.loadedRuntime=await app.evaluate(()=>({electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node}));assert.equal(report.loadedRuntime.electron,identity.runtime.version);
 ui=await nativePage(app,'acira-browser-ui://ui/index.html');await ui.locator('.browser-shell').waitFor();
 await ui.waitForFunction(()=>!document.querySelector('.setup-dialog')||[...document.querySelectorAll('.setup-dialog button')].some(button=>button.textContent?.trim()==='Skip setup'));
 const skip=ui.getByRole('button',{name:'Skip setup',exact:true});if(await skip.count()){await skip.evaluate(button=>button.click());await ui.locator('.setup-dialog').waitFor({state:'detached'});}
 ui.on('pageerror',error=>report.errors.push(error.message));
 await ui.evaluate(()=>window.acira.dispatch({type:'settings.update',patch:{onboardingComplete:true,interfaceScale:100,reducedMotion:true,glassOpacity:64}}));
 report.window=await app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.setFocusable(false);win.setIgnoreMouseEvents(true);win.setSkipTaskbar(true);win.setPosition(-20000,-20000);win.setSize(1400,1000);win.showInactive();return{bounds:win.getBounds(),focused:win.isFocused(),focusable:win.isFocusable()};});
 assert.equal(report.window.focused,false);assert.equal(report.window.focusable,false);
 for(const [index,palette]of appearancePalettes.entries())for(const appearance of ['light','dark']){
  await ui.evaluate(({palette,appearance})=>window.acira.dispatch({type:'settings.update',patch:{colorPreset:palette.name,browserTint:palette.tint,accentColor:palette.accent,appearance}}),{palette,appearance});
  await ui.waitForFunction(({name,appearance})=>document.querySelector('.app')?.getAttribute('data-finish')===name&&window.acira.getSnapshot().then(state=>state.settings.appearance===appearance),{name:palette.name,appearance});
  await poll(()=>ui.locator('.ed-rail-brand [data-acira-brand=lockup] img').evaluateAll(images=>images.filter(img=>getComputedStyle(img).display!=='none').every(img=>img.complete&&img.naturalWidth===373)),Boolean,'Canonical lockup asset loaded');
  await startNativeCapture(app,ui);capturing=true;await ui.waitForTimeout(180);
  const still=await app.evaluate(async()=>globalThis.__qaRecorder.webContents.executeJavaScript(`(()=>{const cap=window.__nativeCapture;if(!cap?.video.videoWidth)throw Error('Native source has no frame');const canvas=document.createElement('canvas');canvas.width=cap.video.videoWidth;canvas.height=cap.video.videoHeight;canvas.getContext('2d').drawImage(cap.video,0,0);return{time:Date.now(),mediaTime:cap.video.currentTime,image:canvas.toDataURL('image/png').split(',')[1]};})()`));
  const frames=await stopNativeCapture(ui);capturing=false;
  const file=String(index).padStart(2,'0')+'-'+appearance+'.png';await fs.writeFile(path.join(out,file),Buffer.from(still.image,'base64'));
  const paint=await ui.locator('.ed-rail-brand').evaluate(el=>{const visible=[...el.querySelectorAll('[data-acira-brand=lockup] img')].filter(img=>getComputedStyle(img).display!=='none');return{chrome:el.closest('.app').getAttribute('data-chrome'),images:visible.map(img=>({src:img.getAttribute('src'),filter:getComputedStyle(img).filter,box:img.getBoundingClientRect().toJSON()})),symbols:[...document.querySelectorAll('img[data-acira-brand=symbol]')].map(img=>({filter:getComputedStyle(img).filter,box:img.getBoundingClientRect().toJSON()}))};});
  assert.equal(paint.images.length,1);assert.ok(paint.images.every(img=>img.filter==='none'));assert.ok(paint.symbols.every(img=>img.filter==='none'));
  assert.equal(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isFocused()),false);
  report.cases.push({finish:palette.name,appearance,file,frameTime:still.time,mediaTime:still.mediaTime,nativeFrames:frames.length,paint});
 }
 report.build=JSON.parse(await fs.readFile(path.join(profile,'preview-build.json'),'utf8'));
 report.assetHashes=await Promise.all(['acira-logo.svg','acira-logo-light.svg','acira-symbol.svg'].map(async file=>({file,source:await hash('public/'+file),loadedDist:await hash(path.join(identity.codeRoot,'dist',file))})));
 assert.ok(report.assetHashes.every(asset=>asset.source===asset.loadedDist));
 report.sourceStable=await paletteNativeSourceStable(identity);
 assert.equal(report.sourceStable,true);
 report.status='EXECUTED';
 }
}catch(error){report.errors.push(error.message);throw error;}finally{
 try{if(capturing)await stopNativeCapture(ui);}finally{try{await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));}finally{await app?.close();}}
}
console.log(JSON.stringify({out,cases:report.cases.length,sourceStable:report.sourceStable,errors:report.errors}));
