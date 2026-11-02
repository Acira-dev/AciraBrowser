import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const out=path.resolve('docs/design/color-research/production-qa/tab-selection-'+Date.now());await fs.mkdir(out,{recursive:true});
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const monitored=['src/App.tsx','src/components/TabResults.tsx','src/components/ScrollRegion.tsx','src/ui/scrollReveal.ts','src/styles/scroll-region.css','src/styles/selection.css','src/styles.css','src/frost-preview.css','src/ui/sheetFormation.ts'];
const source=await Promise.all(monitored.map(async file=>({path:file,sha256:await hash(file)})));
const compiled=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outdir:out,entryNames:'renderer',minify:true,format:'iife',platform:'browser',define:{'import.meta.env.DEV':'true','process.env.NODE_ENV':'"production"'},plugins:[{name:'public-assets',setup(build){build.onResolve({filter:/^\//},args=>({path:args.path,external:true}));}}]});
const asset=value=>pathToFileURL(path.resolve('public',value.replace(/^\//,''))).href;
for(const output of compiled.outputFiles){let value=output.text;if(output.path.endsWith('.css'))value=value.replace(/url\((['"]?)(\/[^)'"\s]+)\1\)/g,(_m,_q,p)=>`url("${asset(p)}")`);else value=value.replace(/(["'])((?:\/|\.\/)(?:workspace-coast\.png|acira-[a-z.-]+|fonts\/[a-zA-Z0-9.-]+|frost-grain\.svg))\1/g,(_m,q,p)=>q+asset(p)+q);await fs.writeFile(output.path,value);}
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><div id="root"></div><script src="renderer.js"></script>');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),checks=[],cases=[],errors=[],record=(name,pass,detail={})=>checks.push({name,pass,...detail});
try{
 for(const width of [1100,480])for(const count of [1,20])for(const reduced of [false,true]){
  const context=await browser.newContext({viewport:{width,height:800},reducedMotion:reduced?'reduce':'no-preference'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.route(/^https?:/,route=>route.abort());await page.goto(pathToFileURL(path.join(out,'index.html')).href+'?qa=1');await page.waitForFunction(()=>window.__acira);await page.locator('.ed-start-composition').waitFor();
  await page.evaluate(({count,reduced})=>{window.__acira.dispatch({type:'settings.update',patch:{reducedMotion:reduced}});for(let i=1;i<count;i++)window.__acira.dispatch({type:'tab.new',url:'acira://new'});},{count,reduced});
  await page.getByRole('button',{name:/^Search tabs/}).filter({visible:true}).first().click();await page.waitForFunction(()=>document.querySelector('.sheet-popup')?.dataset.formationReady==='true'&&document.querySelector('.sheet-popup [data-popup-scene]')?.getAttribute('data-popup-scene')==='tabs');
  const geometry=()=>page.locator('.sheet-popup').evaluate(popup=>{const selection=popup.querySelector('.tab-switcher-selection'),row=popup.querySelector('.tab-result[data-cursor=true]'),list=popup.querySelector('.tab-result-list'),viewport=popup.querySelector('.popup-scroll'),box=node=>node?.getBoundingClientRect().toJSON();return{selection:box(selection),row:box(row),list:box(list),viewport:box(viewport),local:{width:row?.offsetWidth,height:row?.offsetHeight,selectionWidth:selection?.style.width,selectionHeight:selection?.style.height},foregroundTransform:getComputedStyle(popup.querySelector('.popup-contents')).transform,scroll:viewport?{top:viewport.scrollTop,width:viewport.scrollWidth,clientWidth:viewport.clientWidth,height:viewport.scrollHeight,clientHeight:viewport.clientHeight}:null,selected:row?.dataset.tabId};});
  const key={width,count,reduced},initial=await geometry();cases.push({...key,phase:'initial',...initial});
  const fits=value=>value.selection&&value.row&&value.selection.left>=value.viewport.left-.5&&value.selection.right<=value.viewport.right+.5&&Math.abs(value.selection.width-value.row.width)<.6&&Math.abs(value.selection.height-value.row.height)<.6;
  record('settled selection perimeter matches its unscaled row and viewport',fits(initial),{...key,geometry:initial});
  await page.screenshot({path:path.join(out,`${width}-${count}-${reduced?'reduced':'normal'}-initial.png`)});
  if(count>1){
   for(let index=0;index<count;index++)await page.keyboard.press('ArrowDown');await page.waitForTimeout(reduced?30:250);const moved=await geometry();cases.push({...key,phase:'keyboard',...moved});record('keyboard cursor retains a complete perimeter after overflow reveal',fits(moved)&&moved.row.top>=moved.viewport.top-.5&&moved.row.bottom<=moved.viewport.bottom+.5,{...key,geometry:moved});
   await page.locator('.sheet-popup .tab-result-row[data-cursor=true]>.tab-result-close').click();await page.waitForFunction(count=>document.querySelectorAll('.sheet-popup .tab-result').length===count-1,count);await page.waitForTimeout(reduced?30:250);const closed=await geometry();cases.push({...key,phase:'after-close',...closed});record('closing selected result preserves a complete remaining selection',fits(closed),{...key,geometry:closed});
  }
  const selected=await page.locator('.sheet-popup .tab-result[data-cursor=true]').getAttribute('data-tab-id');await page.locator('.sheet-popup .popup-fixed-search input').focus();await page.keyboard.press('Enter');await page.locator('.sheet-popup').waitFor({state:'detached'});record('keyboard Enter activates the selected actual tab',await page.evaluate(id=>window.__acira.getState().activeTabId===id,selected),key);
  await context.close();
 }
}catch(error){errors.push(error.message);}finally{await browser.close();}
const sourceStable=(await Promise.all(source.map(async item=>item.sha256===await hash(item.path)))).every(Boolean);record('monitored source stays stable',sourceStable);const report={checkedAt:new Date().toISOString(),qualification:'Fresh full App/CSS in disposable Chrome fallback. Actual normal/reduced tabs popup,1/20results,1100/480px, keyboard overflow/cursor/close/Enter. No native delivery, frame smoothness or original-reference verdict. Geometry is sampled after natural foreground rest.',source,sourceStable,bundle:{js:await hash(path.join(out,'renderer.js')),css:await hash(path.join(out,'renderer.css'))},cases,checks,failures:checks.filter(check=>!check.pass),errors};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,cases:cases.length,checks:checks.length,failures:report.failures.map(({name,width,count,reduced})=>({name,width,count,reduced})),sourceStable,errors}));if(report.failures.length||errors.length)process.exitCode=1;
