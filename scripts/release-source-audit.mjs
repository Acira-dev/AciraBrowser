import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const secretRules = [
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ['openai-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['supabase-secret', /\bsb_secret_[A-Za-z0-9_-]{24,}\b/g],
  ['credential-url', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]{3,}@/gi],
];
export function scanSecrets(bytes) {
  if (bytes.includes(0)) return [];
  const value=bytes.toString('utf8');
  return secretRules.flatMap(([kind,pattern])=>{
    pattern.lastIndex=0;
    return [...value.matchAll(pattern)].map(match=>({kind,line:value.slice(0,match.index).split('\n').length}));
  });
}
export function prohibitedPath(file) {
  return /(?:^|\/)(?:node_modules|dist|\.bootstrap|\.qa-profiles|\.profile|\.preview-profile|session-cookies|Session Storage|Local Storage|IndexedDB|Cache|Code Cache|GPUCache)(?:\/|$)/i.test(file)
    || /^release(?:\/|$)/i.test(file)
    || /(?:^|\/)(?:Cookies|Login Data|Web Data|History|Preferences|Local State|browser-state\.json|browser\.sqlite(?:-wal|-shm)?|extensions\.json|\.env(?:\.[^/]*)?)(?:$|\/)/i.test(file) && !/(?:^|\/)\.env\.example$/.test(file)
    || /(?:^|\/)(?:qa\/artifacts|outputs?)(?:\/|$)/i.test(file)
    || /\.(?:exe|msi|dmg|appimage|deb|sqlite|db|log|dmp|mp4|webm)$/i.test(file);
}
export function git(...args) {return execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024});}
export function auditHistory(ref='HEAD') {
  const objects=new Map();
  for (const line of git('rev-list','--objects',ref).trim().split('\n')) {
    const space=line.indexOf(' ');objects.set(space<0?line:line.slice(0,space),space<0?'':line.slice(space+1));
  }
  const report={schema:1,createdAt:new Date().toISOString(),ref,head:git('rev-parse',ref).trim(),commits:git('rev-list',ref).trim().split('\n'),blobCount:0,totalBlobBytes:0,secretFindings:[],prohibitedPaths:[],binaryInventory:[],largeBlobs:[],limitations:['Pattern scan cannot prove absence of every secret. Binary artwork/screenshot privacy and rights need human/contextual review. Archive members are audited separately. No credential values are printed. Local capture/checkpoint refs are not part of HEAD history and must never be pushed with --mirror or --all.']};
  for (const [oid,file] of objects) {
    const type=git('cat-file','-t',oid).trim();if(type!=='blob')continue;
    const bytes=execFileSync('git',['cat-file','blob',oid],{maxBuffer:64*1024*1024});report.blobCount++;report.totalBlobBytes+=bytes.length;
    if(prohibitedPath(file))report.prohibitedPaths.push({file,oid});
    report.secretFindings.push(...scanSecrets(bytes).map(finding=>({file,oid,...finding})));
    if(bytes.length>10*1024*1024)report.largeBlobs.push({file,oid,bytes:bytes.length});
    if(bytes.includes(0))report.binaryInventory.push({file,oid,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  report.automatedGate=report.secretFindings.length||report.prohibitedPaths.length||report.largeBlobs.length?'FAIL':'PASS';
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=auditHistory();const output=process.argv[2]||'docs/release/history-audit.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({head:report.head,blobs:report.blobCount,bytes:report.totalBlobBytes,automatedGate:report.automatedGate,secrets:report.secretFindings.length,prohibited:report.prohibitedPaths.length,binaries:report.binaryInventory.length,output},null,2));
  if(report.automatedGate!=='PASS')process.exitCode=1;
}
