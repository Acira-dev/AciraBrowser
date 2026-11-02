import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {build} from 'esbuild';

// Actual artwork-hide journey in a disposable web-fallback profile. Missing
// requested behavior is reported as a failure, never counted as a paint pass.
const out=path.resolve('docs/design/color-research/production-qa/toast-journey-'+Date.now());
const bundle=out;
await fs.mkdir(out,{recursive:true});
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const files=async folder=>(await Promise.all((await fs.readdir(folder,{withFileTypes:true})).map(item=>item.isDirectory()?files(path.join(folder,item.name)):[path.join(folder,item.name)]))).flat();
const before=new Map(await Promise.all((await files('src')).concat('design-tokens.json').map(async file=>[file.replaceAll('\\','/'),await hash(file)])));
const compiled=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,metafile:true,outdir:bundle,entryNames:'renderer',minify:true,format:'iife',platform:'browser',define:{'import.meta.env.DEV':'true','process.env.NODE_ENV':'"production"'},plugins:[{name:'public-assets',setup(build){build.onResolve({filter:/^\//},args=>({path:args.path,external:true}));}}]});
const source=Object.keys(compiled.metafile.inputs).map(file=>file.replaceAll('\\','/')).filter(file=>before.has(file)).map(file=>({path:file,sha256:before.get(file)}));
const asset=value=>pathToFileURL(path.resolve('public',value.replace(/^\//,''))).href;
for(const output of compiled.outputFiles){let value=output.text;if(output.path.endsWith('.css'))value=value.replace(/url\((['"]?)(\/[^)'"\s]+)\1\)/g,(_m,_q,p)=>`url("${asset(p)}")`);else value=value.replace(/(["'])((?:\/|\.\/)(?:workspace-coast\.png|acira-[a-z.-]+|fonts\/[a-zA-Z0-9.-]+|frost-grain\.svg))\1/g,(_m,q,p)=>q+asset(p)+q);await fs.writeFile(output.path,value);}
await fs.writeFile(path.join(bundle,'renderer.html'),'<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><body><div id="root"></div><script src="renderer.js"></script></body></html>');
const checks=[],views=[],errors=[];
const record=(name,pass,detail={})=>checks.push({name,pass,...detail});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 for(const width of [1100,480]){
  const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https?:/,route=>route.abort());
  await page.goto(pathToFileURL(path.join(bundle,'renderer.html')).href+'?qa=1');
  await page.waitForFunction(()=>window.__acira);
  await page.evaluate(()=>window.__acira.dispatch({type:'settings.update',patch:{reducedMotion:true}}));
  const eye=page.getByRole('button',{name:'Hide artwork',exact:true});await eye.waitFor();await eye.focus();await page.keyboard.press('Enter');
  await page.locator('.ed-workspace-identity').waitFor({state:'detached'});
  const toast=page.locator('.toast[data-artwork-toast]');await toast.waitFor();
  const observed=await toast.evaluate(el=>{const r=el.getBoundingClientRect();return{text:el.textContent,status:el.querySelectorAll('[role="status"]').length,buttons:[...el.querySelectorAll('button')].map(button=>({text:button.textContent,label:button.getAttribute('aria-label'),rect:button.getBoundingClientRect().toJSON()})),matrix:el.querySelectorAll('canvas').length,rect:r.toJSON(),viewport:innerWidth,active:document.activeElement?.getAttribute('aria-label')};});
  views.push({width,...observed});
  record('hide emits one polite confirmation',await toast.count()===1&&observed.status===1,{width});
  record('artwork toast offers Undo',observed.buttons.some(button=>/undo/i.test(button.label||button.text||'')),{width});
  record('artwork toast offers labelled dismiss',observed.buttons.some(button=>/dismiss|close/i.test(button.label||'')),{width});
  record('artwork toast uses the requested dot-matrix status',observed.matrix>0,{width});
  record('toast fits the viewport',observed.rect.left>=0&&observed.rect.right<=observed.viewport,{width});
  record('toast actions retain32px targets',observed.buttons.every(button=>button.rect.width>=31.9&&button.rect.height>=31.9),{width});
  record('keyboard hide returns focus to the available search',/Search the web|URL/.test(observed.active||''),{width,active:observed.active});
  await page.screenshot({path:path.join(out,`hidden-${width}.png`)});
  const doneBefore=await toast.locator('canvas').evaluate(canvas=>canvas.toDataURL());
  await toast.hover();await page.waitForTimeout(8300);
  record('toast expiry pauses while the pointer is interacting',await toast.count()===1,{width});
  const undo=toast.getByRole('button',{name:'Undo',exact:true});await undo.focus();await page.mouse.move(0,0);await page.waitForTimeout(8300);
  record('toast expiry also pauses for keyboard interaction',await toast.count()===1,{width});
  const focus=await undo.evaluate(button=>({outline:getComputedStyle(button).outlineWidth,active:document.activeElement===button}));
  record('Undo keyboard focus has an independent visible outline',focus.active&&focus.outline==='2px',{width,focus});
  record('done matrix stays static throughout interaction',doneBefore===await toast.locator('canvas').evaluate(canvas=>canvas.toDataURL()),{width});
  await page.screenshot({path:path.join(out,`focus-${width}.png`)});
  await page.keyboard.press('Enter');await toast.waitFor({state:'detached'});await eye.waitFor();
  record('actual Undo restores the hidden artwork',await page.locator('.ed-workspace-identity').count()===1,{width});
  await eye.click();await toast.waitFor();await toast.getByRole('button',{name:'Dismiss notification',exact:true}).click();await toast.waitFor({state:'detached'});
  record('actual dismiss removes only the notification',await page.locator('.ed-workspace-identity').count()===0,{width});
  await page.reload();await page.waitForFunction(()=>window.__acira);await page.locator('.ed-start-composition').waitFor();
  record('reload preserves hidden artwork without repeating toast',await page.locator('.ed-workspace-identity').count()===0&&await page.locator('.toast').count()===0,{width});
  await context.close();
 }
}catch(error){errors.push(error.message);throw error;}finally{
 await browser.close();
 const sourceStable=(await Promise.all(source.map(async item=>item.sha256===await hash(item.path)))).every(Boolean);
 const failures=checks.filter(check=>!check.pass);
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checkedAt:new Date().toISOString(),qualification:'Fresh actual full renderer/CSS graph in own immutable QA folder, disposable web fallback at1100/480px. Real keyboard hide/Undo/dismiss/reload, pointer and focus waits8300ms each against actual8second timer, static done/status/focus/fit. External requests blocked. No native profile, stale/profile/private guard, user preview, smoothness or full feature acceptance.',source,bundle:{renderer:await hash(path.join(bundle,'renderer.js')),css:await hash(path.join(bundle,'renderer.css'))},sourceStable,views,checks,failures,errors},null,2));
 console.log(JSON.stringify({out,sourceStable,checks:checks.length,failures:failures.length,errors,missing:failures.map(({name,width})=>({name,width}))}));
 if(failures.length||errors.length||!sourceStable)process.exitCode=1;
}
