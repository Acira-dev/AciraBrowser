import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRuntimePolicy} from '../scripts/release-runtime-policy.mjs';
const digest='a'.repeat(64),policy={supportedMajor:44,minimumVersion:'44.9.1',selectedRuntime:{version:'44.9.2',executableSha256:digest,qualified:true},advisories:[{id:'GHSA-jr5w-w6x2-84p9'}]},verify=(version,extra={})=>verifyRuntimePolicy({policy,version,executableSha256:digest,...extra});
test('known vulnerable runtimes cannot be promoted by the packager',()=>{for(const version of ['44.7.0','44.9.0','44.0.9'])assert.throws(()=>verify(version),/security patch/);});
test('a patched version alone does not replace frontend qualification',()=>{assert.throws(()=>verify('44.9.1'),/qualified patched runtime/);assert.throws(()=>verify('44.9.2',{policy:{...policy,selectedRuntime:null}}),/qualified patched runtime/);});
test('the exact qualified executable and stable runtime are bound together',()=>{assert.equal(verify('44.9.2').status,'PASS');assert.throws(()=>verify('44.9.2',{executableSha256:'b'.repeat(64)}),/qualified frontend hash/);assert.throws(()=>verify('44.9.2-beta.1'),/exact stable/);assert.throws(()=>verify('45.0.0'),/family/);});
