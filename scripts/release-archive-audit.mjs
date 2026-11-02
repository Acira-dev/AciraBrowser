import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {scanSecrets} from './release-source-audit.mjs';
const require=createRequire(import.meta.url),Zip=require('adm-zip');
const report={schema:1,createdAt:new Date().toISOString(),archive:'docs/reference/browser-research-complete.zip',members:[],secretFindings:[],limitations:['The archive is reference research, including public quotations and observations. Its third-party source rights remain separate from the application license. Pattern scanning does not establish permission to redistribute quoted material. Nested XLSX XML is scanned, with no extracted values printed.']};
function scanArchive(bytes,prefix,depth=0){
  if(depth>2)throw new Error('Archive nesting exceeds review limit');
  for(const entry of new Zip(bytes).getEntries()){
    if(entry.isDirectory)continue;
    if(entry.header.size>5*1024*1024)throw new Error('Unexpectedly large archive member');
    const data=entry.getData(),name=prefix+entry.entryName;
    if(depth===0)report.members.push({file:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
    report.secretFindings.push(...scanSecrets(data).map(finding=>({file:name,...finding})));
    if(/\.(xlsx|zip)$/i.test(entry.entryName))scanArchive(data,name+'/',depth+1);
  }
}
scanArchive(fs.readFileSync(report.archive),'');report.automatedGate=report.secretFindings.length?'FAIL':'PASS';
fs.writeFileSync('docs/release/archive-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({members:report.members.length,secrets:report.secretFindings.length,automatedGate:report.automatedGate}));
if(report.secretFindings.length)process.exitCode=1;
