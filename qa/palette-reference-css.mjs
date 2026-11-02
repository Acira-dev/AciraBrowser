import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';

// QA reference only. The preserved Formation component is unchanged. Its original
// vapor CSS is confined to the reference class and never loaded by the product.
const out=path.resolve('docs/design/color-research/production-qa/reference-css-'+Date.now());await fs.mkdir(out,{recursive:true});
const referenceCSS=`@property --vapor { syntax:'<number>'; inherits:false; initial-value:1.4; }
.app.style-acira .comparison-original-foreground[data-vapor]{ -webkit-mask-image:radial-gradient(farthest-corner at var(--vx,50%) var(--vy,0%),#000 calc(var(--vapor) * 100% - 40%),transparent calc(var(--vapor) * 100% + 8%)); mask-image:radial-gradient(farthest-corner at var(--vx,50%) var(--vy,0%),#000 calc(var(--vapor) * 100% - 40%),transparent calc(var(--vapor) * 100% + 8%)); }`;
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{Formation}from'./qa/fixtures/formation-reference/src/components/Formation';createRoot(document.getElementById('root')).render(<div className="app style-acira"><Formation variant="menu" visible scene="probe" origin={{x:1,y:0}} className="comparison-original-foreground">{Array.from({length:4},(_,i)=><div data-form-item key={i}>Preserved reference row {i+1}</div>)}</Formation></div>);`;
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:path.join(out,'probe.js'),platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const geometry='body{margin:0;background:#18191c;color:white;font:16px system-ui}.comparison-original-foreground{position:absolute;inset:60px;width:420px;height:220px;background:#5b4548;transform-origin:var(--vx,50%) var(--vy,50%)}[data-form-item]{padding:14px}';
for(const mode of ['missing','restored'])await fs.writeFile(path.join(out,mode+'.html'),`<!doctype html><style>${geometry}${mode==='restored'?referenceCSS:''}</style><div id="root"></div><script src="./probe.js"></script>`);
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),checks=[],cases=[],errors=[];
const record=(name,pass,detail={})=>checks.push({name,pass,...detail});
try{
 for(const mode of ['missing','restored']){
  const page=await browser.newPage({viewport:{width:600,height:360},reducedMotion:'no-preference'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(out,mode+'.html')).href);await page.locator('[data-vapor]').waitFor();
  for(const time of [0,60,180,520]){
   const paint=await page.locator('.comparison-original-foreground').evaluate((node,time)=>{for(const animation of node.getAnimations({subtree:true})){animation.pause();animation.currentTime=time;}const s=getComputedStyle(node);return{time,vapor:s.getPropertyValue('--vapor').trim(),mask:s.maskImage,filter:s.filter,opacity:s.opacity,transform:s.transform};},time);
   cases.push({mode,...paint});if(time===60)await page.screenshot({path:path.join(out,mode+'-60ms.png')});
  }
  await page.close();
 }
 const missing=cases.filter(c=>c.mode==='missing'),restored=cases.filter(c=>c.mode==='restored');
 record('missing copied CSS leaves the reference foreground unmasked',missing.every(c=>c.mask==='none'));
 record('QA restoration supplies the preserved radial foreground mask',restored.every(c=>c.mask.includes('radial-gradient')));
 record('original vapor variable interpolates continuously at60ms',Number(restored[1].vapor)>0&&Number(restored[1].vapor)<1.4,{vapor:restored[1].vapor});
 // Unregistered strings switch at the eased midpoint, which can precede the
 // wall-time midpoint. They remain endpoints rather than numeric interpolation.
 record('unregistered missing variable stays at discrete endpoints while active',missing.slice(0,-1).every(c=>[0,1.4].includes(Number(c.vapor))),{values:missing.map(c=>c.vapor)});
 record('unregistered resting variable has no CSS fallback',missing.at(-1).vapor==='');
 for(let index=0;index<missing.length;index++)record('reference CSS keeps the same group blur/opacity/scale',missing[index].filter===restored[index].filter&&missing[index].opacity===restored[index].opacity&&missing[index].transform===restored[index].transform,{time:missing[index].time});
 record('reference foreground settles to fully expanded vapor',Number(restored.at(-1).vapor)===1.4);
}finally{await browser.close();}
const referenceSource=await fs.readFile('qa/fixtures/formation-reference/src/components/Formation.tsx');
const report={checkedAt:new Date().toISOString(),qualification:'Prospective QA-reference CSS restoration on exact preserved Formation in isolated headless Chrome. Frozen animation times prove interpolation/mask mechanics, not native playback or reference/human acceptance. No product or frontend-owned source file changed.',referenceSourceSha256:createHash('sha256').update(referenceSource).digest('hex'),referenceCSS,cases,checks,failures:checks.filter(c=>!c.pass),errors};
await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:checks.length,failures:report.failures,errors}));if(report.failures.length||errors.length)process.exitCode=1;
