import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Uses the real renderer bundle created by palette-product.mjs. All state and
// image-position probes live in disposable headless contexts, never a user profile.
const dir=path.resolve('docs/design/color-research/production-qa');
await build({entryPoints:['src/runtime/core.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'layout-core.cjs')});
const require=createRequire(import.meta.url),{createInitialState}=require(path.join(dir,'layout-core.cjs'));
const checks=[],cases=[],errors=[];
const check=(name,pass,detail={})=>checks.push({name,pass,...detail});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 for(const [width,height]of [[1440,1000],[900,640],[680,420],[480,360]])for(const sidebar of [true,false])for(const cover of [true,false])for(const populated of [false,true]){
  const state=createInitialState();state.settings={...state.settings,appearance:'light',colorPreset:'Burgundy',browserTint:'#4c1a22',accentColor:'#e5a6b1',reducedMotion:true};
  state.windowUi.workspaceOpen=sidebar;state.windowUi.webWorkspaceOpen=sidebar;
  if(populated)state.browsingHistory=Array.from({length:4},(_,i)=>({id:`palette-layout-${i}`,title:i===1?'اختبار عنوان طويل · Mixed title':'A real fixture page with a long title '+i,url:`https://example.org/layout-${i}`,time:new Date().toISOString(),profileId:'',browserProfileId:state.activeBrowserProfileId}));
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({state,cover})=>{if(!localStorage.getItem('acira-browser-v1')){localStorage.setItem('acira-browser-v1',JSON.stringify(state));localStorage.setItem('acira-study-cover:'+state.activeBrowserProfileId,cover?'shown':'hidden');}},{state,cover});
  await page.goto(pathToFileURL(path.join(dir,'renderer.html')).href+'?qa=1');await page.locator('.ed-start-composition').waitFor();await page.evaluate(()=>document.fonts.ready);
  const result=await page.locator('.ed-workspace').evaluate(el=>{
   const root=el.querySelector('.ed-start-composition'),cover=el.querySelector('.ed-workspace-identity.has-cover'),image=cover?.querySelector('img'),search=el.querySelector('.ed-search-glass');
   const box=node=>node?.getBoundingClientRect().toJSON(),s=getComputedStyle(el),c=cover&&getComputedStyle(cover);
   const lists=root.querySelector('.ed-start-lists'),sections=lists.querySelectorAll('.ed-page-section');
   return{workspace:box(el),composition:box(root),cover:box(cover),search:box(search),clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,paddingTop:parseFloat(s.paddingTop),paddingBottom:parseFloat(s.paddingBottom),imageLoaded:!!image?.complete&&image.naturalWidth>0,aspectRatio:c?.aspectRatio,headingCount:root.querySelectorAll('h1').length,emptySections:root.querySelectorAll('.ed-empty').length,listCount:sections.length,listDisplay:getComputedStyle(lists).display,singleListWidth:sections.length===1?sections[0].getBoundingClientRect().width:undefined,listWidth:lists.getBoundingClientRect().width};
  });
  const key={width,height,sidebar,cover,populated};cases.push({...key,...result});
  check('no horizontal content overflow',result.scrollWidth<=result.clientWidth+2,key);
  const fits=result.composition.height<=result.clientHeight-result.paddingTop-result.paddingBottom+1;
  if(fits)check('fitting composition centers in available page',Math.abs(result.composition.y+result.composition.height/2-(result.workspace.y+result.workspace.height/2))<=2,{...key,centerDelta:result.composition.y+result.composition.height/2-(result.workspace.y+result.workspace.height/2)});
  else check('short window starts at reachable content',result.composition.y>=result.workspace.y-1&&result.scrollHeight>result.clientHeight,key);
  check('legacy explicit artwork choice remains represented',Boolean(result.cover)===cover,key);
  check('home omits redundant heading and empty section copy',result.headingCount===0&&result.emptySections===0,key);
  if(!populated)check('empty lists reserve no margin or space',result.listCount===0&&result.listDisplay==='none',key);
  else check('sole history list uses available width',result.listCount===1&&Math.abs(result.singleListWidth-result.listWidth)<2,key);
  if(result.cover){check('artwork remains meaningful and loaded',result.cover.height>=143&&result.imageLoaded,{...key,artHeight:result.cover.height});if(result.cover.width>=590)check('wide artwork keeps original proportions',Math.abs(result.cover.width/result.cover.height-45/11)<.02,key);}
  if(width===1440&&sidebar&&cover&&!populated||width===680&&sidebar&&cover&&populated||width===480&&!sidebar&&!cover&&populated)await page.screenshot({path:path.join(dir,`centered-${width}-${cover?'art':'hidden'}-${populated?'history':'empty'}.png`)});
  await page.locator('.ed-workspace').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const end=await page.locator('.ed-start-composition').evaluate(el=>el.getBoundingClientRect().bottom);
  check('last content is reachable by natural scrolling',end<=result.workspace.bottom-result.paddingBottom+2,key);
  if(width===1440&&sidebar&&cover&&!populated){
   const crop=await page.locator('.ed-workspace-identity').evaluate(el=>{el.style.setProperty('--workspace-cover-position','20% 70%');const img=el.querySelector('img'),cover=el.querySelector('.ed-workspace-cover'),after=getComputedStyle(cover,'::after');return{position:getComputedStyle(img).objectPosition,duplicateImage:after.backgroundImage,blur:after.backdropFilter,parentRadius:getComputedStyle(el).borderRadius,coverRadius:getComputedStyle(cover).borderRadius,blurRadius:after.borderRadius};});
   check('single image supplies focal crop and restrained unlabelled blur',crop.position==='20% 70%'&&crop.duplicateImage==='none'&&crop.blur.includes('blur(14px)'),crop);
   check('artwork and progressive blur share the clipped radius',crop.parentRadius==='14px'&&crop.coverRadius===crop.parentRadius&&crop.blurRadius===crop.parentRadius,crop);
   if(process.argv.includes('--artwork-actions')){
   const eye=page.getByRole('button',{name:'Hide artwork',exact:true});await eye.focus();await page.keyboard.press('Enter');await page.locator('.ed-workspace-identity').waitFor({state:'detached'});
   check('hide removes artwork and all restore reminders from home',await page.getByRole('button',{name:/Show (artwork|.*cover)/i}).count()===0);
   const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')}));
   check('keyboard hide returns focus to an available control',!['BODY','HTML'].includes(focus.tag),focus);
   check('hide emits one confirmation',await page.locator('.toast').count()===1);
   await page.reload();await page.locator('.ed-start-composition').waitFor();check('reload preserves hidden choice without repeating confirmation',await page.locator('.ed-workspace-identity').count()===0&&await page.locator('.toast').count()===0);
   await page.evaluate(()=>window.__acira.dispatch({type:'tab.new',url:'acira://settings'}));const toggle=page.getByRole('switch',{name:'Show artwork',exact:true});await toggle.waitFor();check('Settings reflects hidden artwork',await toggle.getAttribute('aria-checked')==='false');await toggle.click();await page.waitForFunction(()=>document.querySelector('[role=switch][aria-label="Show artwork"]')?.getAttribute('aria-checked')==='true');
   await page.evaluate(()=>window.__acira.dispatch({type:'tab.select',id:'tab-home'}));await page.locator('.ed-workspace-identity.has-cover').waitFor();check('Settings restore shows artwork on the existing home tab',true);
   }
  }
  await context.close();
 }
}catch(error){errors.push(`Harness exception: ${error.message}`);throw error;}finally{
 await browser.close();
 const source=['src/frost-preview.css','src/features/FrostWorkspace.tsx'];
 fs.writeFileSync(path.join(dir,'centered-layout.json'),JSON.stringify({checkedAt:new Date().toISOString(),qualification:'Actual product CSS/React renderer, disposable web-fallback state. Geometry-only palette verification; builder-owned content/hide/daily-art/native journeys are not accepted by these assertions. Source may advance during concurrent integration; bundle and source hashes are recorded.',browser:browser.version(),source:source.map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),bundle:['renderer.js','renderer.css'].map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,p))).digest('hex')})),checks,failures:checks.filter(c=>!c.pass),cases,errors},null,2));
}
console.log(JSON.stringify({cases:cases.length,checks:checks.length,failures:checks.filter(c=>!c.pass).length,errors}));
if(checks.some(c=>!c.pass)||errors.length)process.exitCode=1;
