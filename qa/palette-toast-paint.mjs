import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Actual ArtworkToast and preference actions, with the complete shared CSS
// import order. This controlled host qualifies paint, not the App hide journey.
const candidate=process.argv.includes('--candidate');
const out=path.resolve('docs/design/color-research/production-qa/toast-paint-'+(candidate?'candidate-':'current-')+Date.now());await fs.mkdir(out,{recursive:true});
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const monitored=['src/components/ArtworkToast.tsx','src/components/DotMatrix.tsx','src/ui/newTabPreferences.ts','src/ui/theme.ts','src/frost-preview.css','src/styles.css','src/styles/artwork-toast.css'];
const source=await Promise.all(monitored.map(async file=>({path:file,sha256:await hash(file)})));
const candidateCSS=candidate?await fs.readFile('src/styles/artwork-toast.css','utf8'):null;
const compiled=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ArtworkToast}from'./src/components/ArtworkToast';import{hideWorkspaceArtwork,readNewTabPreferences,updateNewTabPreferences}from'./src/ui/newTabPreferences';import{themeTokens}from'./src/ui/theme';import{appearancePalettes}from'./src/runtime/appearancePalettes';import{installDesignVariables}from'./src/ui/designSystem';import'./src/fonts.css';import'./src/styles.css';import'./src/shell-references.css';import'./src/styles/platform.css';import'./src/styles/selection.css';import'./src/styles/ux-controls.css';import'./src/frost-preview.css';installDesignVariables();const profile='palette-toast-paint';function Harness(){return <div className="app style-acira"><button style={{position:"fixed",top:20,left:20,width:150,height:40,zIndex:40}} aria-label="Fixture hide artwork" onClick={()=>hideWorkspaceArtwork(profile)}>Hide artwork</button><ArtworkToast profileId={profile}/></div>}createRoot(document.getElementById('root')).render(<Harness/>);window.__toastPaint={palettes:appearancePalettes.map(p=>p.name),show:(name,dark)=>{const preset=appearancePalettes.find(p=>p.name===name),app=document.querySelector('.app');for(const[k,v]of Object.entries(themeTokens({colorPreset:preset.name,browserTint:preset.tint,accentColor:preset.accent},dark)))app.style.setProperty(k,v);app.dataset.appearance=dark?'dark':'light';const p=readNewTabPreferences(profile);updateNewTabPreferences(profile,{modules:{...p.modules,artwork:true}});}};`},bundle:true,write:false,outdir:out,entryNames:'toast',format:'iife',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'candidate-and-public-assets',setup(build){build.onResolve({filter:/^\//},args=>({path:args.path,external:true}));if(candidate)build.onLoad({filter:/frost-preview\.css$/},async args=>({contents:await fs.readFile(args.path,'utf8')+'\n'+candidateCSS,loader:'css'}));}}]});
for(const output of compiled.outputFiles)await fs.writeFile(output.path,output.contents);
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="toast.css"><div id="root"></div><script src="toast.js"></script>');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),checks=[],cases=[],errors=[],record=(name,pass,detail={})=>checks.push({name,pass,...detail});
try{
 for(const width of [320,480,1100]){
  const page=await browser.newPage({viewport:{width,height:800},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));await page.route(/^https?:/,route=>route.abort());await page.goto(pathToFileURL(path.join(out,'index.html')).href);await page.waitForFunction(()=>window.__toastPaint&&document.querySelector('.app'));
  for(const finish of await page.evaluate(()=>window.__toastPaint.palettes))for(const dark of [false,true]){
   await page.evaluate(({finish,dark})=>window.__toastPaint.show(finish,dark),{finish,dark});await page.getByRole('button',{name:'Fixture hide artwork',exact:true}).click();const toast=page.locator('[data-artwork-toast]');await toast.waitFor();
   const geometry=await toast.evaluate(root=>{const box=node=>node.getBoundingClientRect().toJSON(),message=root.querySelector('.toast-message');return{rect:box(root),message:box(message),text:message.textContent,status:root.querySelectorAll('[role=status]').length,transform:getComputedStyle(root).transform,buttons:[...root.querySelectorAll('button')].map(button=>box(button))};});const key={width,finish,dark};cases.push({...key,...geometry});
   record('actual artwork confirmation stays inside viewport',geometry.rect.left>=0&&geometry.rect.right<=width&&geometry.rect.bottom<=800,key);
   record('message and32px actions remain inside the confirmation',geometry.message.left>=geometry.rect.left&&geometry.message.right<=geometry.rect.right&&geometry.message.height>=18&&geometry.buttons.every(button=>button.width>=32&&button.height>=32&&button.left>=geometry.rect.left&&button.right<=geometry.rect.right),key);
   record('one concise status accompanies accessible real actions',geometry.status===1&&await toast.getByRole('button',{name:'Undo',exact:true}).count()===1&&await toast.getByRole('button',{name:'Dismiss notification',exact:true}).count()===1,key);
   await page.keyboard.press('Tab');record('Undo retains independent keyboard focus paint',await toast.getByRole('button',{name:'Undo',exact:true}).evaluate(button=>document.activeElement===button&&getComputedStyle(button).outlineWidth==='2px'),key);
   if(finish==='Porcelain'&&!dark||finish==='Burgundy'&&dark)await page.screenshot({path:path.join(out,finish.toLowerCase()+'-'+width+(dark?'-dark':'-light')+'.png')});
   await toast.getByRole('button',{name:'Dismiss notification',exact:true}).click();await toast.waitFor({state:'detached'});
  }
  await page.close();
 }
}catch(error){errors.push(error.message);}finally{await browser.close();}
const sourceStable=(await Promise.all(source.map(async item=>item.sha256===await hash(item.path)))).every(Boolean);record('monitored component and shared paint source stay stable',sourceStable);
const report={checkedAt:new Date().toISOString(),qualification:'Actual ArtworkToast/newTabPreferences in controlled host and complete shared stylesheet order,12finishes/light-dark/320-480-1100px. Paint/fit/status/focus only. Candidate appends only the disclosed scoped transform reset in memory; original files stay frozen. Full App journey/native/current-preview delivery remain separate.',candidate,candidateCSS:candidate?candidateCSS:null,source,sourceStable,bundle:{js:await hash(path.join(out,'toast.js')),css:await hash(path.join(out,'toast.css'))},cases,checks,failures:checks.filter(check=>!check.pass),errors};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,candidate,cases:cases.length,checks:checks.length,failures:report.failures.length,errors,sourceStable}));if(report.failures.length||errors.length)process.exitCode=1;
