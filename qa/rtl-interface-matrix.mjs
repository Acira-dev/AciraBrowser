// Coordinator native lease required except for --plan. Each case owns one fresh
// disposable process/profile. This gate covers script assertions, not pixel,
// caption/anchor or native-speaker acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const entrypoint='qa/rtl-interface-native.mjs';
const matrix=[
  {tone:'light',scale:100}, {tone:'light',scale:150},
  {tone:'dark',scale:100}, {tone:'dark',scale:150},
].map(value=>({...value,key:`${value.tone}-${value.scale}`,args:[entrypoint,`--tone=${value.tone}`,`--scale=${value.scale}`]}));
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flags=process.argv.slice(2);
  if(flags.some(flag=>flag!=='--plan')||flags.length>1)throw Error('Use no arguments for the leased matrix, or --plan for a read-only plan.');
  if(flags.includes('--plan')){
    // Do not import the single-case module: its entrypoint launches Electron.
    console.log(JSON.stringify({status:'PLAN_ONLY_NO_NATIVE_LAUNCH',scope:'SCRIPT_ASSERTION_MATRIX_ONLY',serial:true,stopOnFirstFailure:true,target:'Inherited environment, including D_APP_EXE, is passed unchanged to each case.',matrix},null,2));
  }else{
    await runMatrix();
  }
}

async function runMatrix(){
  const stamp=`${Date.now()}-${randomUUID().slice(0,8)}`;
  const artifacts=path.resolve('qa/artifacts'),out=path.join(artifacts,`rtl-interface-matrix-${stamp}`);
  await fs.mkdir(out,{recursive:true});
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const dependencies=[entrypoint,'qa/rtl-target.mjs','qa/prepared-native.mjs','qa/prepare-native-profile.cjs','qa/rtl-interface-matrix.mjs'];
  const files=await Promise.all(dependencies.map(async file=>({file,sha256:sha(await fs.readFile(file))})));
  const report={status:'RUNNING',scope:'SCRIPT_ASSERTION_MATRIX_ONLY',startedAt:new Date().toISOString(),requiredCases:4,serial:true,stopOnFirstFailure:true,files,cases:[],openReviews:['Pixel and glass contrast review','Native caption and anchor acceptance','Native-speaker review']};
  const save=()=>fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
  let targetFingerprint;
  await save();
  try{
    for(const item of matrix){
      const started=Date.now(),execution=await execute(item.args);
      await fs.writeFile(path.join(out,`${item.key}.stdout.log`),execution.stdout);
      await fs.writeFile(path.join(out,`${item.key}.stderr.log`),execution.stderr);
      const result={key:item.key,tone:item.tone,scale:item.scale,command:[process.execPath,...item.args],exitCode:execution.code,signal:execution.signal,seconds:Math.round((Date.now()-started)/1000),passed:false};
      report.cases.push(result);
      try{
        const last=execution.stdout.split(/\r?\n/).filter(line=>line.trim()).at(-1);
        const emitted=JSON.parse(last||'null');
        if(!emitted?.reportPath||!emitted.out||!/^[a-f0-9]{64}$/.test(emitted.reportSha256||''))throw Error('Single-case result is missing its exact report binding.');
        const expected=path.resolve(emitted.out,'report.json'),requested=path.resolve(emitted.reportPath);
        if(requested!==expected||!requested.startsWith(artifacts+path.sep))throw Error('Single-case report is outside its expected artifact directory.');
        const actual=await fs.realpath(requested),actualArtifacts=await fs.realpath(artifacts);
        if(!actual.startsWith(actualArtifacts+path.sep))throw Error('Single-case report resolves outside artifact storage.');
        const bytes=await fs.readFile(actual);
        if(sha(bytes)!==emitted.reportSha256)throw Error('Single-case report hash changed.');
        const saved=JSON.parse(bytes.toString('utf8'));
        const {signature,fingerprint,assertions}=validateRtlCaseResult({item,emitted,saved,execution,expectedFingerprint:targetFingerprint});
        targetFingerprint=fingerprint;
        Object.assign(result,{reportPath:path.relative(process.cwd(),actual),reportSha256:emitted.reportSha256,targetFingerprint:fingerprint,target:signature,assertions});
        result.passed=true;
      }catch(error){
        result.error=String(error?.stack||error);
        await save();
        throw Error(`RTL ${item.key} failed; subsequent cases were not launched. ${result.error}`);
      }
      await save();
      console.log(`PASS RTL script assertions ${item.key}`);
    }
    // Tie the aggregate to the exact adapter/helper bytes used for this run.
    for(const file of files)if(sha(await fs.readFile(file.file))!==file.sha256)throw Error(`QA source changed during the matrix: ${file.file}`);
    report.status='PASS_SCRIPT_ASSERTION_MATRIX';
  }catch(error){
    report.status='FAIL';report.error=String(error?.stack||error);process.exitCode=1;
  }finally{
    report.finishedAt=new Date().toISOString();
    await save();
  }
  const reportPath=path.join(out,'result.json');
  console.log(JSON.stringify({out,reportPath,reportSha256:sha(await fs.readFile(reportPath)),status:report.status,scope:report.scope,completed:report.cases.length,requiredCases:report.requiredCases,targetFingerprint,error:report.error}));
}

/** Pure evidence validation; importing this module never launches a case. */
export function validateRtlCaseResult({item,emitted,saved,execution,expectedFingerprint}){
  if(saved.tone!==item.tone||saved.scale!==item.scale)throw Error('Single-case report does not match the requested matrix case.');
  const signature=targetSignature(saved.target);
  if(JSON.stringify(signature)!==JSON.stringify(targetSignature(emitted.target)))throw Error('Saved and emitted native target identities differ.');
  const fingerprint=createHash('sha256').update(JSON.stringify(signature)).digest('hex');
  if(expectedFingerprint&&fingerprint!==expectedFingerprint)throw Error('Native target changed between matrix cases.');
  if(execution.code!==0||execution.signal||execution.error||emitted.passed!==true||saved.passed!==true||!saved.checks?.length||saved.checks.some(check=>check.passed!==true))throw Error(saved.error||execution.error||'Single-case native assertions failed.');
  return {signature,fingerprint,assertions:saved.checks.length};
}

function targetSignature(target){
  if(!['source','packaged'].includes(target?.kind))throw Error('Unknown native target kind.');
  const file=value=>{
    if(!value||!/^[a-f0-9]{64}$/.test(value.sha256||'')||!Number.isSafeInteger(value.bytes)||value.bytes<=0)throw Error('Incomplete native target identity.');
    return {bytes:value.bytes,sha256:value.sha256};
  };
  return {kind:target.kind,executable:file(target.executable),appArchive:target.kind==='packaged'?file(target.appArchive):null,entrypoint:target.kind==='source'?file(target.entrypoint):null};
}

function execute(args){
  return new Promise(resolve=>{
    const child=spawn(process.execPath,args,{env:{...process.env},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',error;
    child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
    child.on('error',reason=>{error=String(reason);});
    child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr,error}));
  });
}
