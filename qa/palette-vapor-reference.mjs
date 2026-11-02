import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';
import {chromium} from 'playwright';

const out=path.resolve('docs/design/color-research/production-qa/vapor-reference-'+Date.now());
await fs.mkdir(out,{recursive:true});
const files=['qa/fixtures/palette-vapor/sheetFormation-before.ts','qa/fixtures/palette-vapor/sheetFormation-candidate.ts','docs/design/color-research/snapshot/src/components/PopupSurface.tsx'];
const bytes=await Promise.all(files.map(file=>fs.readFile(file,'utf8')));
files.push('src/ui/sheetFormation.ts');bytes.push(await fs.readFile(files.at(-1),'utf8'));
const source=files.map((file,i)=>({file,sha256:createHash('sha256').update(bytes[i]).digest('hex')}));
const load=async text=>import('data:text/javascript;base64,'+Buffer.from((await transform(text,{loader:'ts',format:'esm'})).code).toString('base64'));
const baseline=await load(bytes[0]),candidate=await load(bytes[1]);
const preserved=bytes[2].match(/const frames=formed\s*([\s\S]*?);\s*const animation=mist\.animate/);
if(!preserved)throw Error('Preserved original mist frames are missing.');
const originalFrames=new Function('formed','return formed '+preserved[1]);
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const checks=[],record=(name,pass,detail={})=>checks.push({name,pass,...detail});
let errors=[];
try{
 const page=await browser.newPage();
 await page.setContent('<style>@property --material-mist-opacity{syntax:"<number>";inherits:true;initial-value:0}@property --material-mist-blur{syntax:"<number>";inherits:true;initial-value:16}@property --material-mist-scale{syntax:"<number>";inherits:true;initial-value:1.045}</style>');
 const common={switching:false,reversing:false,firstDelay:30,stagger:18,count:8,blur:12,enterScale:1.012,exitScale:.992,exitBlur:10};
 const initial={'--sheet-progress':0,'--foreground-progress':0,'--formation-opacity':0,'--formation-blur':12,'--formation-scale':1.012};
 const open=candidate.formationFrames({...common,start:initial,closing:false,duration:520});
 for(const closing of [false,true]){
  const options={...common,start:closing?open.final:initial,closing,duration:closing?240:520};
  const old=baseline.formationFrames(options),next=candidate.formationFrames(options);
  const times=Array.from({length:Math.ceil(next.duration/8)+1},(_,i)=>Math.min(next.duration,i*8));
  const samples=await page.evaluate(({old,next,times,original,closing,properties})=>{
   const create=()=>{const node=document.createElement('div');document.body.append(node);return node;};
   const oldNode=create(),nextNode=create(),refNode=create();
   if(!window.__registeredFormationProperties){for(const key of properties)CSS.registerProperty({name:key,syntax:key==='--formation-blur'?'<length>':'<number>',inherits:true,initialValue:key==='--formation-blur'?'12px':'0'});window.__registeredFormationProperties=true;}
   const a=oldNode.animate(old.frames,{duration:old.duration,fill:'both',easing:'linear'}),b=nextNode.animate(next.frames,{duration:next.duration,fill:'both',easing:'linear'}),r=refNode.animate(original,{duration:closing?240:520,fill:'both',easing:closing?'cubic-bezier(.4,0,.9,.6)':'cubic-bezier(.16,1,.3,1)'});
   a.pause();b.pause();r.pause();
   const result=times.map(time=>{a.currentTime=time;b.currentTime=time;r.currentTime=time;const oldStyle=getComputedStyle(oldNode),style=getComputedStyle(nextNode),ref=getComputedStyle(refNode);const differences=properties.map(key=>Math.abs(parseFloat(oldStyle.getPropertyValue(key))-parseFloat(style.getPropertyValue(key))));return{time,maxPriorDifference:Math.max(...differences),opacity:Number(style.getPropertyValue('--material-mist-opacity')),blur:Number(style.getPropertyValue('--material-mist-blur')),scale:Number(style.getPropertyValue('--material-mist-scale')),reference:{opacity:Number(ref.opacity),blur:parseFloat(ref.filter.match(/[\d.]+/)?.[0]||0),scale:Number(ref.transform.match(/matrix\(([^,]+)/)?.[1]||1)}};});
   a.cancel();b.cancel();r.cancel();oldNode.remove();nextNode.remove();refNode.remove();return result;
  },{old:{frames:old.frames,duration:old.duration},next:{frames:next.frames,duration:next.duration},times,original:originalFrames(!closing),closing,properties:baseline.formationProperties});
  for(const s of samples){record('existing foreground and material progress interpolation stays unchanged',s.maxPriorDifference<.00002,{closing,time:s.time,difference:s.maxPriorDifference});record('candidate mist follows actual preserved browser keyframes',Math.abs(s.opacity-s.reference.opacity)<.02&&Math.abs(s.blur-s.reference.blur)<.15&&Math.abs(s.scale-s.reference.scale)<.001,{closing,...s});}
 }
 const switched=candidate.formationFrames({...common,start:open.final,closing:false,switching:true,duration:520});
 record('scene change does not replay mist',switched.frames.every(frame=>Number(frame['--material-mist-opacity'])===0));
 await page.close();
}catch(error){errors.push(error.stack||error.message);}finally{await browser.close();}
const sourceStable=(await Promise.all(files.map(async(file,i)=>createHash('sha256').update(await fs.readFile(file,'utf8')).digest('hex')===source[i].sha256))).every(Boolean);
record('monitored source remains stable',sourceStable);
const report={checkedAt:new Date().toISOString(),qualification:'QA-only proposed controller. Preserved original mist keyframes run in the browser at matched manual times; candidate halo values compared with them. Existing property interpolation compared with the unmodified product controller. This is not native playback, a full original application, smoothness or delivery acceptance.',source,sourceStable,checks,failures:checks.filter(check=>!check.pass),errors};
await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({out,checks:checks.length,failures:report.failures.length,errors,sourceStable}));
if(report.failures.length||errors.length)process.exitCode=1;
