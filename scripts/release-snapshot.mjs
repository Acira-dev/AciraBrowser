import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prohibitedPath,scanSecrets} from './release-source-audit.mjs';
const manifestPath=process.argv[2];if(!manifestPath)throw new Error('Exact owner manifest required');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));if(!manifest.ready&&!['ready_frozen','review-ready'].includes(manifest.status)&&manifest.state!=='ready')throw new Error('Owner manifest is not ready/frozen');
const role=manifest.role||path.basename(manifestPath).replace('-ready.json','');
const git=(args,input)=>execFileSync('git',args,{input,encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const entries=[],seen=new Set();
const ownerFiles=Array.isArray(manifest.files)?manifest.files:Object.entries(manifest.files||{}).map(([path,sha256])=>{if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('Owner file map must contain exact SHA-256 values: '+path);return {path,sha256};});
if(!ownerFiles.length)throw new Error('Owner manifest contains no approved files');
for(const raw of ownerFiles){
  const file=typeof raw==='string'?raw:raw.path;
  if(typeof file!=='string'||file.includes('\\')||file.startsWith('/')||file.split('/').some(part=>['','..','.git'].includes(part))||seen.has(file)||prohibitedPath(file))throw new Error('Unsafe, duplicate or prohibited path: '+file);
  const suppliedLogo=file==='docs/reference/acira-logo-updated-2026-10-24.svg';
  if(!suppliedLogo&&/^(docs\/reference\/|docs\/orchestration\/(?:OVERNIGHT_TEAM|BUILD_OVERSIGHT|COLOR_RESEARCH|REWIND_ROUTINES))/.test(file))throw new Error('Private/unreviewed operational/reference file: '+file);
  seen.add(file);const expected=typeof raw==='object'?raw.sha256:manifest.hashes?.[file]||manifest.sha256?.[file];
  let bytes;try{bytes=fs.readFileSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bytes){if(![...(manifest.deletions||[]),...(manifest.deleted||[])].includes(file)&&raw.status!=='deleted')throw new Error('Missing file is not an approved deletion: '+file);entries.push({file,deleted:true});continue;}
  const sha256=createHash('sha256').update(bytes).digest('hex');if(expected&&expected!==sha256)throw new Error('Owner hash mismatch: '+file);
  if(suppliedLogo&&sha256!=='4cc129976a90ed879502c24e11c64b2063c0af990d3a49167d4725f1d25920df')throw new Error('Authorized product-logo reference hash changed');
  const findings=scanSecrets(bytes);if(findings.length)throw new Error('Secret-pattern finding in '+file+': '+findings.map(f=>f.kind+' line '+f.line).join(', '));
  if(bytes.length>10*1024*1024)throw new Error('Oversized unreviewed file: '+file);
  const blob=git(['hash-object','-w','--stdin'],bytes),tracked=git(['ls-files','--stage','--',file]);const mode=tracked.split(' ')[0]||'100644';
  entries.push({file,sha256,blob,mode,bytes:bytes.length});
}
for(const file of [...(manifest.deletions||[]),...(manifest.deleted||[]),...(manifest.removed||[]),...(manifest.deletedFiles||[])]){if(seen.has(file))continue;if(fs.existsSync(file))throw new Error('Approved deletion exists: '+file);if(prohibitedPath(file)||file.includes('..'))throw new Error('Unsafe deletion');seen.add(file);entries.push({file,deleted:true});}
fs.mkdirSync('docs/release/snapshots',{recursive:true});
const output='docs/release/snapshots/'+role+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
const snapshot={schema:1,role,capturedAt:new Date().toISOString(),manifest:manifestPath,manifestSha256:createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),base:git(['rev-parse','HEAD']),scope:manifest.scope,commitMessage:manifest.commitMessage||manifest.proposedCommitMessage,tests:manifest.tests,limitations:manifest.limitations,entries};
fs.writeFileSync(output,JSON.stringify(snapshot,null,2)+'\n');console.log(JSON.stringify({output,role,files:entries.length,bytes:entries.reduce((sum,e)=>sum+(e.bytes||0),0),scope:snapshot.scope},null,2));
