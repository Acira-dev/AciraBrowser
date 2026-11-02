import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {REAL_SITES, cpuInterval, validatePages, pageFailure} from '../qa/lightweight-policy.mjs';
test('CPU uses counter acquisition timestamps, not a later GPU sampling completion', () => {
  const before={pids:4,cpuSeconds:10,cpuSnapshotEpochMs:1000};
  const after={pids:4,cpuSeconds:16,cpuSnapshotEpochMs:31000,gpuSamplingEndedEpochMs:41000};
  assert.deepEqual(cpuInterval(before,after),{seconds:30,percentOfOneCore:20});
  assert.throws(()=>cpuInterval(before,{...after,pids:0}),/Invalid/);
  assert.throws(()=>cpuInterval(before,{...after,cpuSeconds:9}),/Invalid/);
});
test('owned-process fixture rejects unrelated browsers, argument prefixes and duplicate roots without touching processes',{skip:process.platform!=='win32'},async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'acira-perf-policy-')),file=path.join(directory,'processes.json');
 const executable='C:\\Acira Performance Fixture\\chrome.exe',profile='C:\\Acira Performance Fixture\\owned-profile',nonce='b00c0000-0000-4000-8000-000000000000',port='49001';
 const command=`"${executable}" "--user-data-dir=${profile}" --acira-perf-run=${nonce} --remote-debugging-port=${port}`;
 const base={ProcessId:900001,ParentProcessId:0,ExecutablePath:executable,CreationDate:'2026-10-26T00:00:00Z',CommandLine:command};
 // Reviewed development fixture only. Every invocation supplies this generated JSON file;
 // the helper rejects non-inspect fixture modes before any CIM/Get-Process/mutation branch.
 // No execution-policy override belongs in the benchmark driver or persistent OS settings.
 const run=async(action='inspect')=>{
  assert.ok(action==='inspect'||action==='stop','only inspect or the deliberate fixture-mutation rejection case');
  assert.equal(path.dirname(file),directory);assert.equal(path.basename(file),'processes.json');assert.ok((await fs.stat(file)).isFile());
  const {stdout}=await promisify(execFile)('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('qa/lightweight-owned.ps1'),'-Action',action,'-Executable',executable,'-Nonce',nonce,'-Profile',profile,'-Port',port,'-FixtureFile',file],{windowsHide:true,timeout:15000});return JSON.parse(stdout.trim());
 };
 try{
  await fs.writeFile(file,JSON.stringify([base,{...base,ProcessId:900002,CommandLine:command.replace(nonce,'unrelated')},{...base,ProcessId:900003,CommandLine:command.replace(profile,profile+'-other')},{...base,ProcessId:900004,CommandLine:command+' --type=renderer'},{...base,ProcessId:900005,ExecutablePath:'C:\\Other Browser\\chrome.exe'},{...base,ProcessId:900006,CommandLine:command.replace(port,port+'0')} ]));
  const value=await run();assert.equal(value.fixtureOnly,true);assert.deepEqual(value.roots.map(root=>root.pid),[900001]);
  await assert.rejects(run('stop'),/Fixture mode is read-only/);
  await fs.writeFile(file,JSON.stringify([base,{...base,ProcessId:900007}]));await assert.rejects(run(),/Multiple owned browser roots/);
  await fs.writeFile(file,'[]');assert.deepEqual((await run()).roots,[]);
 }finally{await fs.rm(file,{force:true});await fs.rmdir(directory);}
});
test('ten requested sites require distinct, loaded, successful documents', () => {
  assert.equal(REAL_SITES.length,10);
  const pages=REAL_SITES.map((requested,i)=>({requested,targetId:String(i),url:requested,status:200,readyState:'complete'}));
  validatePages(pages);
  assert.throws(()=>validatePages(pages.slice(1)),/distinct/);
  assert.throws(()=>validatePages(pages.map((p,i)=>i===9?{...p,targetId:'0'}:p)),/distinct/);
  for(const change of [{status:403},{status:undefined},{failedRequest:'net::ERR_NAME_NOT_RESOLVED'},{url:'chrome-error://chromewebdata/'},{readyState:'loading'},{interstitial:true},{nativeError:'blocked'}]){
    assert.ok(pageFailure({...pages[0],...change}));
    assert.throws(()=>validatePages([{...pages[0],...change},...pages.slice(1)]),/Invalid website/);
  }
  assert.equal(pageFailure({...pages[0],status:200,consentBanner:true}),null,'normal cookie notice is recorded, not conflated with navigation failure');
});
