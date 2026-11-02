import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Independent analysis of an existing native packet. No new app, replay timing,
// product mutation, inferred frame rate or final perceptual verdict.
if(!process.argv[2])throw Error('Pass the existing native comparison packet directory');
const directory=path.resolve(process.argv[2]),allowed=path.resolve('qa/artifacts')+path.sep;
if(!directory.startsWith(allowed))throw Error('Choose an existing local QA artifact packet');
const out=path.resolve('docs/design/color-research/production-qa/comparison-review-'+Date.now());await fs.mkdir(out,{recursive:true});
const read=file=>fs.readFile(file,'utf8'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const comparison=JSON.parse(await read(path.join(directory,'comparison.json'))),checks=[],cases=[];
const record=(name,pass,detail={})=>checks.push({name,pass,...detail});
const reference=await read('qa/fixtures/formation-reference/src/components/Formation.tsx'),css=await read('qa/fixtures/formation-reference/original-vapor.css');
record('packet uses the exact preserved Formation source',hash(reference)==='5c51c44dc3ac70360b9f00d13b28e296c488b2eeae3989329aea94681e9124c7'&&comparison.referenceSource===hash(reference));
const originalHTML=await read(path.join(directory,'original/index.html'));
const loadedCSS=originalHTML.includes('href="./original-vapor.css"')?await read(path.join(directory,'original/original-vapor.css')):originalHTML;
record('original packet actually loads preserved vapor registration and mask',loadedCSS.includes(css.trim())&&css.includes('@property --vapor')&&css.includes('[data-vapor]'));
record('packet includes all nine required mode/origin cases',comparison.cases.length===9&&['original','regression','candidate'].every(mode=>['tabs','menu','profile'].every(kind=>comparison.cases.some(c=>c.mode===mode&&c.kind===kind))));
for(const item of comparison.cases){
 const key={mode:item.mode,kind:item.kind},folder=path.join(directory,item.mode,item.kind),frames=JSON.parse(await read(path.join(folder,'frames.json'))),trace=JSON.parse(await read(path.join(folder,'trace.json')));
 record('native frames have monotonic real wall timestamps',frames.length>10&&frames.every((f,i)=>Number.isFinite(f.time)&&/^\d+\.png$/.test(f.file)&&(!i||f.time>=frames[i-1].time)),key);
 record('trace contains actual temporal group blur',trace.some(f=>f.filter.startsWith('blur(')&&f.filter!=='blur(0px)'),key);
 record('trace contains crisp settled foreground',trace.some(f=>f.filter==='none'&&f.opacity==='1'&&f.transform==='none'),key);
 const scales=trace.filter(f=>f.inert&&/^matrix\(/.test(f.transform)).map(f=>Number(f.transform.match(/^matrix\(([^,]+)/)[1]));
 const summary={...key,frames:frames.length,spanMs:frames.at(-1).time-frames[0].time,maxSampleGapMs:Math.max(...frames.slice(1).map((frame,index)=>frame.time-frames[index].time)),minCloseScale:Math.min(...scales)};
 if(item.mode==='original'){
  record('original native trace has interpolating registered vapor and radial mask',trace.some(f=>Number(f.vapor)>0&&Number(f.vapor)<1.4&&f.mask?.includes('radial-gradient')),key);
  record('original close reaches preserved .992 scale',Math.abs(summary.minCloseScale-.992)<.00001,key);
 }
 if(item.mode==='regression')record('prior close does not have the preserved shrink',summary.minCloseScale>=1,key);
 if(item.mode==='candidate'){
  record('candidate plane and foreground remain unmasked',trace.every(f=>f.planeMask==='none'&&f.mask==='none'),key);
  record('candidate close reaches preserved .992 scale',Math.abs(summary.minCloseScale-.992)<.00001,key);
  record('candidate traces contain the fully faded 10px close endpoint',trace.some(f=>f.filter==='blur(10px)'&&f.opacity==='0'),key);
 }
 cases.push(summary);
}
const report={checkedAt:new Date().toISOString(),qualification:'Independent read-only analysis of nine actual native traces and recorded frame times. Exact original JS plus restored original CSS confirmed in packet. Not full old-app material reconstruction, normal-speed smoothness, scene switch/reduced-motion or human visual acceptance.',packet:directory,packetManifestSha256:hash(await read(path.join(directory,'comparison.json'))),referenceCSSSha256:hash(css),checks,cases,failures:checks.filter(c=>!c.pass)};
await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:checks.length,failures:report.failures,cases}));if(report.failures.length)process.exitCode=1;
