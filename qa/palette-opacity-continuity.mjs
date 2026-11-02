import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';import {build} from 'esbuild';import {chromium} from 'playwright';
const dir=path.resolve('docs/design/color-research/production-qa'),require=createRequire(import.meta.url),checks=[],samples=[],record=(name,pass,detail={})=>checks.push({name,pass,...detail});
await build({entryPoints:['src/ui/theme.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'opacity-continuity-theme.cjs')});
await build({entryPoints:['src/runtime/appearancePalettes.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'opacity-continuity-palettes.cjs')});
const {themeTokens}=require(path.join(dir,'opacity-continuity-theme.cjs')),{appearancePalettes}=require(path.join(dir,'opacity-continuity-palettes.cjs'));
for(const p of appearancePalettes)for(const dark of [false,true]){
 const base={colorPreset:p.name,browserTint:p.tint,accentColor:p.accent};let previous;
 for(let amount=88;amount<=100;amount++){
  const t=themeTokens({...base,glassOpacity:amount},dark),values=['--material-opacity','--chrome-veil-top','--chrome-veil-bottom','--overlay-opacity'].map(k=>Number(t[k]));
  if(previous)record('each upper slider step increases paint continuously',values.every((v,i)=>v>=previous[i]-1e-9&&v-previous[i]<=.02),{finish:p.name,dark,amount,previous,values});
  if(amount===88)record('established 88 percent chrome veil preserved',Math.abs(values[1]-.90)<1e-9&&Math.abs(values[2]-.78)<1e-9,{finish:p.name,dark});
  if(amount===100)record('100 percent is fully opaque in each paint role',values.every(v=>v===1),{finish:p.name,dark});previous=values;
 }
}
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage({viewport:{width:160,height:160},deviceScaleFactor:1});
const css=fs.readFileSync('src/frost-preview.css','utf8');
try{
 await page.setContent('<!doctype html><html data-material="acrylic"><head></head><body><div class="app style-acira"></div></body></html>');await page.addStyleTag({content:css});await page.addStyleTag({content:'html,body{margin:0;width:160px;height:160px}.app.style-acira{position:absolute;inset:0;width:160px;height:160px;min-width:0;min-height:0;border:0;box-shadow:none}'});
 for(const finish of ['Burgundy','Porcelain']){
  const p=appearancePalettes.find(p=>p.name===finish);if(!p)throw Error('Missing finish '+finish);
  for(const dark of [false,true])for(const backing of ['#000000','#ffffff']){
   let previous;
   for(const amount of [88,98,99,100]){
    const t=themeTokens({colorPreset:p.name,browserTint:p.tint,accentColor:p.accent,glassOpacity:amount},dark);
    const paint=await page.evaluate(({t,backing})=>{document.body.style.background=backing;const el=document.querySelector('.app');for(const [k,v]of Object.entries(t))el.style.setProperty(k,v);return getComputedStyle(el).backgroundImage;},{t,backing});
    const pixels=await page.evaluate(async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return [0,159].map(y=>Array.from(context.getImageData(80,y,1,1).data).slice(0,3));},(await page.screenshot()).toString('base64'));
    record('actual acrylic selector consumes the semantic veil',paint.startsWith('linear-gradient('),{finish,dark,amount,backing,paint});
    if(amount===100)record('rendered opaque veil equals tint at both ends',pixels.every(pixel=>pixel.every((v,i)=>Math.abs(v-Number(t['--chrome-rgb'].split(' ')[i]))<=1)),{finish,dark,backing,pixels});
    if(previous&&amount===100){const max=Math.max(...pixels.flatMap((pixel,j)=>pixel.map((v,i)=>Math.abs(v-previous.pixels[j][i]))));record('rendered 99 to 100 step has no large paint discontinuity',max<=6,{finish,dark,backing,max,pixels99:previous.pixels,pixels100:pixels});}
    samples.push({finish,dark,backing,amount,paint,pixels});previous={amount,pixels};
   }
  }
 }
}finally{await browser.close();}
const failures=checks.filter(x=>!x.pass);fs.writeFileSync(path.join(dir,'opacity-continuity.json'),JSON.stringify({checkedAt:new Date().toISOString(),qualification:'Semantic upper-range monotonicity plus actual frost-preview acrylic CSS over controlled black/white bounds in temporary headless Chrome. Pixel/step guards are regression bounds, not perceptual thresholds. Does not certify native acrylic, canonical settings or capture teardown.',source:['src/ui/semanticColors.ts','src/frost-preview.css'].map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),checks,failures,samples},null,2));console.log(JSON.stringify({checks:checks.length,failures:failures.length,examples:failures.slice(0,3)}));if(failures.length)process.exitCode=1;
