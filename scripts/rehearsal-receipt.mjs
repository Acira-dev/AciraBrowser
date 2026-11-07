#!/usr/bin/env node
// The receipt of one private test (one machine, one hop): what scripts/release-publish.mjs go asks for before it writes anything live. Half of it is automatic (the feed
// server saw the app read the document and fetch the file; the Mac rig's own result; the file's SHA-512), half is what you saw, answered here one question at a time.
// The receipt names the exact SHA-512 of the file tested, so it stops counting the moment the file is rebuilt.
//   Windows / Linux:  node scripts/rehearsal-receipt.mjs --platform windows --hop 1 --from 0.1.0-beta.10 --to 0.1.0-beta.11 --file <setup or AppImage> --served served.json --installed 0.1.0-beta.11 [--out <folder>]
//   Mac:              node scripts/rehearsal-receipt.mjs --platform mac --hop 1 --rig-result <result.json of qa/mac-update-delivery.mjs> [--out <folder>]
// --answers key=yes,key=no answers the by-eye questions without asking (for tests); anything not answered "yes" fails the test.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),P=require('../packaging/release-publish.cjs'),U=require('../packaging/update-publish.cjs');

export const QUESTIONS={
 updatePopupAndNotesRead:'Did the update popup (Install now / Later / Read more) and the "what\'s new" notes read well?',
 tabsWorkspaceSettingsBack:'After the restart, are your tabs, workspace and settings all back?',
 noSetupWindow:'Did the update install with NO setup window, progress card or "Update to ... / Open / Cancel" question?',
 reopenedWithinTwoMinutes:'Did Acira open again by itself within two minutes?',
 tabsBack:'Are your windows and tabs back after the update?',
 noSecurityOrAntivirusPrompt:'Did Windows, SmartScreen or your antivirus say nothing unexpected (no warning, nothing removed)?',
 relaunched:'Did the new Acira start after the update?',
};
export async function buildReceipt({platform,hop,from,to,file,served,rigResult,answers,installed,feed,machine=os.hostname(),now=new Date()}){
 let fromInfo={version:from},toInfo={version:to},automatic={documentFetched:false,fileBytesServed:0,installedVersion:installed||null},passedAuto=true;
 if(rigResult){
  const r=rigResult.rehearsal||{};
  fromInfo={version:r.from?.version,...(r.from?.sha512?{sha512:r.from.sha512}:{})};toInfo={version:r.to?.version,sha512:r.to?.sha512};
  automatic={documentFetched:(r.feedRequests||0)>0,fileBytesServed:r.fileBytes||0,installedVersion:rigResult.after?.version||null,primary:r.primary,primaryRequests:r.primaryRequests};
  passedAuto=rigResult.passed===true;
  answers={tabsWorkspaceSettingsBack:rigResult.passed===true&&(rigResult.checks||[]).some(name=>/tabs, workspace, settings/.test(name)),...answers};
 }else{
  const described=await U.describeFile(file);
  toInfo={version:to,sha512:described.sha512};
  if(served){automatic.documentFetched=served.summary?.documentFetched===true;automatic.fileBytesServed=served.summary?.fileBytesServed||0;}
 }
 const byEye=Object.fromEntries(P.BY_EYE[platform].map(key=>[key,answers?.[key]===true]));
 const passed=passedAuto&&automatic.documentFetched&&automatic.fileBytesServed>0&&automatic.installedVersion===toInfo.version&&Object.values(byEye).every(Boolean);
 return {schema:1,platform,hop,passed,from:fromInfo,to:toInfo,automatic,byEye,feed:feed||null,machine,at:now.toISOString()};
}
async function ask(platform,preset){
 const answers={...preset},rl=preset&&Object.keys(preset).length===P.BY_EYE[platform].length?null:readline.createInterface({input:process.stdin,output:process.stdout});
 try{for(const key of P.BY_EYE[platform])if(answers[key]===undefined)answers[key]=/^y/i.test((await rl.question(QUESTIONS[key]+' (yes/no) ')).trim());}finally{rl?.close();}
 return answers;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=name=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:undefined;};
 const platform=value('platform'),hop=Number(value('hop'));
 if(!P.PLATFORMS.includes(platform)||![1,2].includes(hop)){console.error('Usage: see the top of scripts/rehearsal-receipt.mjs (--platform mac|windows|linux --hop 1|2 ...).');process.exit(2);}
 const preset=value('answers')?Object.fromEntries(value('answers').split(',').map(pair=>pair.split('=')).map(([key,answer])=>[key,/^y/i.test(answer)])):{};
 const answers=await ask(platform,preset);
 const receipt=await buildReceipt({platform,hop,from:value('from'),to:value('to'),file:value('file'),served:value('served')&&JSON.parse(await fs.readFile(value('served'),'utf8')),rigResult:value('rig-result')&&JSON.parse(await fs.readFile(value('rig-result'),'utf8')),answers,installed:value('installed'),feed:value('feed')});
 const out=path.resolve(value('out')||'.'),name=`rehearsal-${platform}-hop${hop}.json`;
 await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,name),JSON.stringify(receipt,null,2)+'\n');
 console.log((receipt.passed?'PASSED':'NOT PASSED')+': wrote '+path.join(out,name)+(receipt.passed?'':'\n'+JSON.stringify({automatic:receipt.automatic,byEye:receipt.byEye},null,2)));
 process.exitCode=receipt.passed?0:1;
}
