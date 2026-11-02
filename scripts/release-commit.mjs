import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prohibitedPath,scanSecrets} from './release-source-audit.mjs';

export function commitSnapshots({cwd=process.cwd(),snapshots,message}){
  if(!snapshots.length||!message?.trim())throw new Error('Snapshots and a concrete commit message are required');
  const git=(args,{input,env={}}={})=>execFileSync('git',args,{cwd,input,encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,...env}}).trim();
  const branch=git(['symbolic-ref','HEAD']);if(branch!=='refs/heads/main')throw new Error('Publication requires the existing main branch; no branch switch is performed');
  const base=git(['rev-parse','HEAD']),entries=new Map();
  for(const snapshot of snapshots)for(const entry of snapshot.entries){
    const suppliedLogo=entry.file==='docs/reference/acira-logo-updated-2026-10-24.svg';
    if(prohibitedPath(entry.file)||entry.file.includes('..')||entry.file.includes('\n')||entry.file.includes('\0')||entry.file.startsWith('/')||(!suppliedLogo&&/^(?:docs\/workstreams\/|docs\/orchestration\/|docs\/reference\/)/.test(entry.file)))throw new Error('Unsafe/private coordination path: '+entry.file);
    if(entries.has(entry.file)&&JSON.stringify(entries.get(entry.file))!==JSON.stringify(entry))throw new Error('Conflicting approved snapshots: '+entry.file);
    if(!entry.deleted){if(!/^100(?:644|755)$/.test(entry.mode)||!/^[a-f0-9]{40}$/.test(entry.blob))throw new Error('Invalid Git blob metadata');const bytes=execFileSync('git',['cat-file','blob',entry.blob],{cwd,maxBuffer:16*1024*1024});if(suppliedLogo&&createHash('sha256').update(bytes).digest('hex')!=='4cc129976a90ed879502c24e11c64b2063c0af990d3a49167d4725f1d25920df')throw new Error('Authorized product-logo hash changed');if(scanSecrets(bytes).length)throw new Error('Secret pattern in captured blob: '+entry.file);}
    entries.set(entry.file,entry);
  }
  const beforeIndex=git(['ls-files','--stage','-z']);const keepUnrelated=value=>value.split('\0').filter(line=>line&&!entries.has(line.slice(line.indexOf('\t')+1))).sort();
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'acira-release-index-')),env={GIT_INDEX_FILE:path.join(temporary,'index')};
  const instructions=[...entries.values()].map(entry=>`${entry.deleted?'0':entry.mode} ${entry.deleted?'0'.repeat(40):entry.blob}\t${entry.file}\0`).join('');
  git(['read-tree',base],{env});git(['update-index','-z','--index-info'],{input:instructions,env});const tree=git(['write-tree'],{env});
  const changed=git(['diff','--cached','--name-only','-z',base],{env}).split('\0').filter(Boolean);if(!changed.length)throw new Error('No approved content changed');
  if(changed.some(file=>!entries.has(file)))throw new Error('Alternate index contains an unapproved path');
  if(git(['ls-files','--stage','-z'])!==beforeIndex)throw new Error('Shared index changed during preparation; no commit published');
  const body=path.join(temporary,'message.txt');fs.writeFileSync(body,message.trim()+'\n');const commit=git(['commit-tree',tree,'-p',base,'-F',body]);
  git(['update-ref',branch,commit,base]);
  // Refresh only the paths just committed. Unrelated staged entries are retained.
  git(['update-index','-z','--index-info'],{input:instructions});
  const afterIndex=git(['ls-files','--stage','-z']);if(JSON.stringify(keepUnrelated(beforeIndex))!==JSON.stringify(keepUnrelated(afterIndex)))throw new Error('Unrelated staged content changed: inspect index before proceeding');
  return {schema:1,committedAt:new Date().toISOString(),base,commit,tree,branch,files:changed,unrelatedStagedContentPreserved:true,message,tests:snapshots.flatMap(snapshot=>snapshot.tests||[]),snapshotRoles:snapshots.map(snapshot=>snapshot.role),temporaryIndex:temporary};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const list=process.argv.slice(2);if(!list.length)throw new Error('Pass one or more captured snapshot JSON files');
  const withdrawals=JSON.parse(fs.readFileSync('docs/release/withdrawals.json','utf8'));if(list.some(file=>withdrawals.snapshots.some(item=>item.path===file)))throw new Error('A selected owner snapshot was withdrawn; publication is forbidden');
  const snapshots=list.map(file=>JSON.parse(fs.readFileSync(file,'utf8'))),message=process.env.ACIRA_RELEASE_COMMIT_MESSAGE||snapshots.map(snapshot=>snapshot.commitMessage).filter(Boolean).join('; ');
  const result=commitSnapshots({snapshots,message});fs.mkdirSync('docs/release/publications',{recursive:true});const output='docs/release/publications/'+result.commit+'.json';fs.writeFileSync(output,JSON.stringify({...result,snapshots:list,remoteVerified:false},null,2)+'\n');console.log(JSON.stringify({commit:result.commit,files:result.files.length,unrelatedStagedContentPreserved:result.unrelatedStagedContentPreserved,output},null,2));
}
