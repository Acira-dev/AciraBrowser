import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {validateRtlCaseResult} from '../qa/rtl-interface-matrix.mjs';

const file=character=>({path:'synthetic-target',bytes:10,sha256:character.repeat(64)});
function fixture(){
 const target={kind:'packaged',executable:file('a'),appArchive:file('b'),entrypoint:null};
 return {item:{tone:'light',scale:100},emitted:{target:structuredClone(target),passed:true},saved:{tone:'light',scale:100,target,passed:true,checks:[{name:'synthetic assertion',passed:true}]},execution:{code:0,signal:null}};
}

test('RTL evidence accepts equal target values and rejects changed native identities',()=>{
 const value=fixture(),accepted=validateRtlCaseResult(value);
 assert.equal(accepted.assertions,1);assert.match(accepted.fingerprint,/^[a-f0-9]{64}$/);
 assert.equal(validateRtlCaseResult({...value,expectedFingerprint:accepted.fingerprint}).fingerprint,accepted.fingerprint);
 const mismatch=fixture();mismatch.emitted.target.appArchive=file('c');
 assert.throws(()=>validateRtlCaseResult(mismatch),/identities differ/);
 const changed=fixture();changed.saved.target.executable=file('d');changed.emitted.target=structuredClone(changed.saved.target);
 assert.throws(()=>validateRtlCaseResult({...changed,expectedFingerprint:accepted.fingerprint}),/changed between/);
});

test('RTL evidence refuses wrong matrix cases, failed assertions and abnormal child completion',()=>{
 for(const mutate of [
  value=>{value.saved.tone='dark';},value=>{value.saved.scale=150;},
  value=>{value.saved.checks[0].passed=false;},value=>{value.saved.checks=[];},
  value=>{value.saved.passed=false;},value=>{value.emitted.passed=false;},
  value=>{value.execution.code=1;},value=>{value.execution.signal='SIGTERM';},
  value=>{value.execution.error='synthetic launch failure';},
 ]){const value=fixture();mutate(value);assert.throws(()=>validateRtlCaseResult(value));}
});

test('RTL plan emits all four serial cases without resolving or launching a native target',()=>{
 const run=spawnSync(process.execPath,['qa/rtl-interface-matrix.mjs','--plan'],{encoding:'utf8',env:{...process.env,D_APP_EXE:'intentionally-invalid-plan-only-target'},windowsHide:true});
 assert.equal(run.status,0,run.stderr);const plan=JSON.parse(run.stdout);
 assert.equal(plan.status,'PLAN_ONLY_NO_NATIVE_LAUNCH');assert.equal(plan.serial,true);assert.equal(plan.stopOnFirstFailure,true);
 assert.deepEqual(plan.matrix.map(item=>item.key),['light-100','light-150','dark-100','dark-150']);
 for(const item of plan.matrix)assert.deepEqual(item.args,['qa/rtl-interface-native.mjs',`--tone=${item.tone}`,`--scale=${item.scale}`]);
});
