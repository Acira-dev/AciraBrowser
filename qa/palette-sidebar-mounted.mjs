import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const bundle=path.resolve('docs/design/color-research/production-qa'),out=path.join(bundle,'sidebar-mounted-'+(process.argv.includes('--before')?'before-':'current-')+Date.now());await fs.mkdir(out,{recursive:true});
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const source=await Promise.all(['src/frost-preview.css','src/features/FrostWorkspace.tsx','src/ui/newTabPreferences.ts'].map(async file=>({path:file,sha256:await hash(file)})));
const checks=[],cases=[],errors=[],record=(name,pass,detail={})=>checks.push({name,pass,...detail});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 for(const [width,height]of [[1400,900],[900,900],[600,450]])for(const sidebarOnly of [false,true])for(const finish of ['Porcelain','Burgundy'])for(const count of [0,1,2,3,12]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https?:/,route=>route.abort());
  await page.addInitScript(count=>localStorage.setItem('acira-new-tab:profile-personal',JSON.stringify({version:'palette-fixture',shortcuts:Array.from({length:count},(_,i)=>({id:'palette-'+i,title:'Fixture favorite '+(i+1),url:'https://favorite-'+i+'.test/',start:false,sidebar:true}))})),count);
  await page.goto(pathToFileURL(path.join(bundle,'renderer.html')).href+'?qa=1');await page.waitForFunction(()=>window.__acira);
  await page.evaluate(finish=>{window.__acira.dispatch({type:'settings.update',patch:{colorPreset:finish,browserTint:finish==='Porcelain'?'#edf0f4':'#4d1821',accentColor:finish==='Porcelain'?'#3d67d0':'#4d1821',appearance:finish==='Porcelain'?'light':'dark',reducedMotion:true,verticalTabs:true}});window.__acira.dispatch({type:'tab.new',url:'acira://settings'});},finish);
  await page.getByRole('textbox',{name:'Search settings'}).waitFor();await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Tabs',exact:true}).click();await page.getByRole('heading',{name:'Tabs',exact:true}).waitFor();
  const layoutSwitch=page.getByRole('switch',{name:'Sidebar-only tabs',exact:true});if(await layoutSwitch.getAttribute('aria-checked')!==String(sidebarOnly))await layoutSwitch.click();
  await page.waitForFunction(sidebarOnly=>document.querySelector('[role=switch][aria-label="Sidebar-only tabs"]')?.getAttribute('aria-checked')===String(sidebarOnly),sidebarOnly);
  await page.waitForFunction(count=>document.querySelectorAll('.ed-rail-apps>.ed-rail-app').length===count,count);
  const geometry=await page.locator('.ed-rail').evaluate(rail=>{const grid=rail.querySelector('.ed-rail-apps'),box=node=>node.getBoundingClientRect().toJSON(),buttons=[...rail.querySelectorAll('.ed-rail-apps>.ed-rail-app')];return{rail:box(rail),footer:box(rail.querySelector('footer')),horizontalRows:document.querySelectorAll('.acira-tab-row').length,grid:grid?{...box(grid),display:getComputedStyle(grid).display,scrollWidth:grid.scrollWidth,clientWidth:grid.clientWidth}:null,buttons:buttons.map(button=>({...box(button),name:button.getAttribute('aria-label'),font:getComputedStyle(button).fontSize})),main:box(document.querySelector('.browser-settings'))};});
  const key={width,height,sidebarOnly,finish,count};cases.push({...key,...geometry});record('actual tab presentation matches the chosen Settings switch',geometry.horizontalRows===(sidebarOnly?0:1),key);record('mounted favorites match actual per-profile preferences',geometry.buttons.length===count,key);
  record('favorite grid preserves reachable profile and Settings footer',geometry.footer.bottom<=geometry.rail.bottom+.5,key);
  if(count){
   record('mounted favorite targets stay compact44px squares',geometry.buttons.every(button=>button.width>=43.9&&button.width<=44.5&&button.height>=43.9&&button.height<=44.5),key);
   record('mounted nav grid stays wholly inside actual rail',geometry.grid.left>=geometry.rail.left-.5&&geometry.grid.right<=geometry.rail.right+.5&&geometry.grid.display==='grid',key);
   record('mounted tiles never overflow horizontally or paint behind Settings',geometry.grid.scrollWidth<=geometry.grid.clientWidth+1&&geometry.buttons.every(button=>button.left>=geometry.grid.left-.5&&button.right<=geometry.grid.right+.5&&button.right<=geometry.main.left+.5),key);
   if(count>1)record('small favorite counts fill rows in document order',geometry.buttons[1].top===geometry.buttons[0].top&&geometry.buttons[1].left>geometry.buttons[0].left,key);
   await page.keyboard.press('Tab');await page.locator('.ed-rail-app').last().focus();await page.locator('.ed-rail-app').last().scrollIntoViewIfNeeded();
   const focus=await page.locator('.ed-rail-app').last().evaluate(button=>{const s=getComputedStyle(button),b=button.getBoundingClientRect(),g=button.closest('.ed-rail-apps').getBoundingClientRect();return{outline:s.outlineWidth,offset:s.outlineOffset,visible:b.top>=g.top-.5&&b.bottom<=g.bottom+.5};});record('mounted keyboard focus remains visible inside the grid clip',focus.outline==='2px'&&focus.offset==='-3px'&&focus.visible,{...key,focus});
  }else record('actual zero-favorite profile reserves no app grid',geometry.grid===null,key);
  if(width===1400&&[1,2,3].includes(count)||width<=900&&count===12)await page.screenshot({path:path.join(out,finish.toLowerCase()+'-'+width+'-'+(sidebarOnly?'sidebar':'top')+'-'+count+'.png')});
  await context.close();
 }
}finally{await browser.close();}
const sourceStable=(await Promise.all(source.map(async item=>item.sha256===await hash(item.path)))).every(Boolean);record('monitored source stays stable',sourceStable);
const report={checkedAt:new Date().toISOString(),qualification:'Actual mounted ExperimentRail/nav/buttons inside full App CSS/Settings, controlled favorites0/1/2/3/12, real sidebar-only switch/top tabs, light/dark at1400x900/900x900/600x450. Short viewport models limited CSS room, not native DPI. External requests blocked. Paint/geometry/focus only; no native runtime/favorite persistence/action/profile acceptance.',source,bundle:{renderer:await hash(path.join(bundle,'renderer.js')),css:await hash(path.join(bundle,'renderer.css'))},sourceStable,cases,checks,failures:checks.filter(check=>!check.pass),errors};
await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,cases:cases.length,checks:checks.length,failures:report.failures.length,examples:report.failures.slice(0,4),errors,sourceStable}));if(report.failures.length||errors.length||!sourceStable)process.exitCode=1;
