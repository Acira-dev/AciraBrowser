import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

// Actual App/PopupSurface interaction in isolated Chrome. Native readiness,
// capture, host geometry and patched-runtime acceptance remain separate.
const bundle=path.resolve('docs/design/color-research/production-qa'),out=path.join(bundle,'popup-transitions-'+Date.now());await fs.mkdir(out,{recursive:true});
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const source=await Promise.all(['src/App.tsx','src/components/SheetPopupSurface.tsx','src/ui/sheetFormation.ts','src/styles/popup-sheet.css','src/styles/popup-material.css'].map(async file=>({path:file,sha256:await hash(file)})));
const checks=[],events=[],errors=[],record=(name,pass,detail={})=>checks.push({name,pass,...detail});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage({viewport:{width:1400,height:1000},reducedMotion:'no-preference'});page.on('pageerror',error=>errors.push(error.message));
const state=()=>page.evaluate(()=>window.__acira.getState());
const current=()=>page.locator('.sheet-popup').evaluate(el=>{const plane=el.querySelector('.popup-sheet-plane'),foreground=el.querySelector('.popup-contents'),p=getComputedStyle(plane),f=getComputedStyle(foreground);return{origin:el.dataset.sheetOrigin,scene:el.querySelector('[data-popup-scene]')?.dataset.popupScene,ready:el.dataset.formationReady,inert:el.inert,progress:Number(p.getPropertyValue('--sheet-progress')),filter:f.filter,opacity:f.opacity,transform:f.transform,planeMask:p.maskImage,foregroundMask:f.maskImage,running:plane.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length};});
const waitRest=()=>page.waitForFunction(()=>document.querySelector('.sheet-popup')?.getAttribute('data-formation-ready')==='true');
async function open(kind){events.push({event:'open-'+kind,at:Date.now()});if(kind==='menu')await page.getByRole('button',{name:'Acira menu',exact:true}).filter({visible:true}).first().click();else if(kind==='profile')await page.getByRole('button',{name:'Switch profile',exact:true}).filter({visible:true}).first().click();else await page.locator('.tab-strip-tools button').filter({visible:true}).first().click();await page.locator('.sheet-popup:not([inert])').waitFor();}
async function close(){await page.keyboard.press('Escape');await page.locator('.sheet-popup').waitFor({state:'detached'});}
let trace=[];
try{
 await page.goto(pathToFileURL(path.join(bundle,'renderer.html')).href+'?qa=1');await page.waitForFunction(()=>window.__acira);await page.locator('.ed-start-composition').waitFor();
 await page.evaluate(()=>window.__acira.dispatch({type:'settings.update',patch:{reducedMotion:false,glassOpacity:64,reducedTransparency:false}}));
 await open('menu');await waitRest();
 await page.evaluate(()=>{window.__paletteSceneTrace=[];window.__paletteSceneTraceOn=true;const tags=new WeakMap();let serial=0;const tick=()=>{if(!window.__paletteSceneTraceOn)return;const roots=[...document.querySelectorAll('.sheet-popup')],root=roots[0],plane=root?.querySelector('.popup-sheet-plane'),foreground=root?.querySelector('.popup-contents');if(root&&!tags.has(root))tags.set(root,++serial);const p=plane&&getComputedStyle(plane),f=foreground&&getComputedStyle(foreground);window.__paletteSceneTrace.push({at:Date.now(),count:roots.length,tag:root?tags.get(root):null,scene:root?.querySelector('[data-popup-scene]')?.dataset.popupScene,visibility:root&&getComputedStyle(root).visibility,progress:p?Number(p.getPropertyValue('--sheet-progress')):null,filter:f?.filter,opacity:f?.opacity,planeMask:p?.maskImage,foregroundMask:f?.maskImage});requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 for(const kind of ['profile','tabs','menu']){await open(kind);await waitRest();const settled=await current();record('scene change settles crisp at the correct origin',settled.filter==='none'&&settled.opacity==='1'&&settled.transform==='none'&&settled.origin===(kind==='tabs'?'center':kind==='menu'?'top-right':'bottom-left'),{kind,settled});}
 trace=await page.evaluate(()=>{window.__paletteSceneTraceOn=false;return window.__paletteSceneTrace;});
 record('scene changes retain one mounted material/foreground root',trace.length>10&&trace.every(frame=>frame.count===1)&&new Set(trace.map(frame=>frame.tag)).size===1);
 record('formed material never resets its aperture or becomes hidden on scene changes',trace.every(frame=>frame.progress===1&&frame.visibility==='visible'));
 record('scene-change foreground resolves without any spatial mask',trace.every(frame=>frame.planeMask==='none'&&frame.foregroundMask==='none'));
 record('new scene has genuine temporal foreground blur',trace.some(frame=>frame.filter?.startsWith('blur(')&&frame.filter!=='blur(0px)'));
 await page.screenshot({path:path.join(out,'normal-menu-rest.png')});await close();

 // A real Settings action during formation must survive the settling click.
 await open('menu');await page.waitForTimeout(70);await page.locator('.sheet-popup .menu-row').filter({hasText:/^Settings/}).click();
 await page.waitForFunction(()=>{const state=window.__acira.getState();return state.tabs.find(tab=>tab.id===state.activeTabId)?.url==='acira://settings';});
 record('first Settings click during formation performs the actual action',true);
 await page.locator('.sheet-popup').waitFor({state:'detached'});
 const selected=await state();await page.evaluate(id=>window.__acira.dispatch({type:'tab.navigate',tabId:id,url:'acira://new'}),selected.activeTabId);await page.locator('.ed-start-composition').waitFor();
 await page.evaluate(()=>window.__acira.dispatch({type:'settings.update',patch:{reducedMotion:true}}));
 for(const kind of ['tabs','menu','profile']){
  await open(kind);const firstReady=await current();record('reduced-motion first interactive frame is already crisp',firstReady.ready==='true'&&firstReady.progress===1&&firstReady.filter==='none'&&firstReady.opacity==='1'&&firstReady.transform==='none',{kind,firstReady});
  record('reduced motion starts no foreground WAAPI animations',firstReady.running===0,{kind,running:firstReady.running});
  record('reduced-motion foreground keeps no spatial mask',firstReady.planeMask==='none'&&firstReady.foregroundMask==='none',{kind});
  await close();
 }
}catch(error){errors.push(error.message);throw error;}finally{
 await browser.close();
 const sourceStable=(await Promise.all(source.map(async item=>item.sha256===await hash(item.path)))).every(Boolean);record('monitored source stayed stable',sourceStable);
 const report={checkedAt:new Date().toISOString(),qualification:'Actual App/local SheetPopupSurface in isolated Chrome, normal scene changes/early action and reduced-motion first interactive frames. Native host/capture/readiness and patched Electron qualification are not simulated or accepted.',source,bundle:{renderer:await hash(path.join(bundle,'renderer.js')),css:await hash(path.join(bundle,'renderer.css'))},events,trace,checks,sourceStable,failures:checks.filter(check=>!check.pass),errors};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:checks.length,failures:report.failures,errors,sourceStable}));if(report.failures.length||errors.length||!sourceStable)process.exitCode=1;
}
