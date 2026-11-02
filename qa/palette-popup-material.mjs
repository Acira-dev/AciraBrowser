import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const dir=path.resolve('docs/design/color-research/production-qa'),require=createRequire(import.meta.url),candidate=process.argv.includes('--proposed'),current=!candidate,suffix=candidate?'candidate':'current';
const {createInitialState}=require(path.join(dir,'layout-core.cjs'));
const state=createInitialState();state.settings={...state.settings,colorPreset:'Burgundy',browserTint:'#4c1a22',accentColor:'#e5a6b1',appearance:'light',reducedMotion:true};
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),records=[],checks=[];
await context.addInitScript(s=>localStorage.setItem('acira-browser-v1',JSON.stringify(s)),state);
const inspect=()=>page.locator('.popup-surface').evaluate(root=>{
 const sample=(el,pseudo)=>{if(!el)return;const s=getComputedStyle(el,pseudo);return{className:el.className,bounds:el.getBoundingClientRect().toJSON(),radius:s.borderRadius,borderWidth:s.borderWidth,borderColor:s.borderColor,background:s.background,shadow:s.boxShadow,clip:s.clipPath,mask:s.maskImage,filter:s.filter,backdrop:s.backdropFilter,opacity:s.opacity,padding:s.padding,boxSizing:s.boxSizing,content:s.content};};
 const m=root.querySelector('.popup-material');return{origin:root.dataset.sheetOrigin,provider:root.dataset.materialProvider,root:sample(root),material:sample(m),materialAfter:sample(m,'::after'),contents:sample(root.querySelector('.popup-contents')),paintedChildren:[...root.querySelectorAll('*')].map(el=>sample(el)).filter(x=>x.background!=='rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box'&&(x.borderWidth!=='0px'||x.shadow!=='none')).slice(0,24)};
});
try{
 await page.goto(pathToFileURL(path.join(dir,candidate?'popup-candidate.html':'renderer.html')).href+'?qa=1');await page.locator('.ed-start-composition').waitFor();
 for(const [kind,opener]of [['tabs','.tab-strip-tools button'],['menu','[aria-label="Acira menu"]'],['profile','.ed-rail footer [aria-label="Switch profile"]']]){
  const trigger=page.locator(opener).filter({visible:true}).first(),anchor=await trigger.boundingBox();await trigger.click();await page.locator('.popup-material').waitFor();
  const actual=await inspect();records.push({kind,path:'real local renderer',layers:actual});
  if(current){const expected={tabs:'center',menu:'top-right',profile:'bottom-left'}[kind];checks.push({kind,name:'presentation selects center or attached corner',pass:actual.origin===expected,actual:actual.origin,expected});if(kind!=='tabs')checks.push({kind,name:'origin agrees with actual above/below placement',pass:kind==='menu'?actual.root.bounds.y>=anchor.y+anchor.height:actual.root.bounds.bottom<=anchor.y,anchor,popup:actual.root.bounds});}
  await page.locator('.popup-surface').screenshot({path:path.join(dir,`popup-${kind}-${suffix}.png`)});
  await page.locator('.popup-surface').evaluate(el=>{el.classList.remove('local-popup');el.classList.add('native-popup-surface');if(el.dataset.materialProvider)el.dataset.materialProvider='native';});
  records.push({kind,path:'native CSS class only; native compositor NOT present',layers:await inspect()});
  await page.keyboard.press('Escape');await page.locator('.popup-surface').waitFor({state:'detached'});
 }
}finally{
 await browser.close();
 if(candidate||current)for(const record of records){const{root,material,materialAfter}=record.layers;checks.push({kind:record.kind,path:record.path,name:'one rim, no border or pseudo cuff, shared radius/bounds',pass:root.radius==='12px'&&material.radius===root.radius&&material.borderWidth==='0px'&&materialAfter.content==='none'&&(material.shadow.match(/inset/g)||[]).length===1&&Math.abs(root.bounds.width-material.bounds.width)<.01&&Math.abs(root.bounds.height-material.bounds.height)<.01});if(record.path.startsWith('native'))checks.push({kind:record.kind,path:record.path,name:'native DOM stays transparent',pass:material.background.startsWith('rgba(0, 0, 0, 0)')});}
 fs.writeFileSync(path.join(dir,`popup-layer-${suffix}.json`),JSON.stringify({checkedAt:new Date().toISOString(),qualification:'Actual compiled renderer settled layer inventory, not a native reproduction or temporal acceptance. Native class is toggled only in disposable QA to resolve its CSS cascade. Radius conflict in source is not assumed to be the cause if computed Acira styles already agree.',candidateUnapplied:candidate,source:['src/frost-preview.css','src/styles/popup-material.css',...(candidate?['docs/design/color-research/popup-paint-proposed.patch']:[])].map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),records,checks,failures:checks.filter(x=>!x.pass)},null,2));
}
console.log(JSON.stringify({records:records.length,checks:checks.length,failures:checks.filter(x=>!x.pass)}));if(checks.some(x=>!x.pass))process.exitCode=1;
