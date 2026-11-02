import {captureFixtureDatabase} from '../qa/release-fixture-database.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {requiresReleaseProfileInitialization} from '../qa/release-initialize-profile.mjs';
import {buildCommitted} from '../scripts/release-build-head.mjs';

test('immutable Windows candidate captures and bundles the shared release target from Git', {timeout:120000}, async()=>{
 const output=path.resolve('qa/artifacts/release-target-capture-'+Date.now());
 const identity=await buildCommitted(output);
 assert.equal(identity.stable,true);assert.deepEqual(identity.warnings,[]);
 assert.equal(await requiresReleaseProfileInitialization(output),true,'bundled startup gate must retain genuine secure-profile initialization before initialized-profile journeys');
 for(const file of ['packaging/release-target.cjs','packaging/release-target.json']){
  const expected=createHash('sha256').update(execFileSync('git',['show','HEAD:'+file])).digest('hex');
  assert.equal(identity.source.find(entry=>entry.file===file)?.sha256,expected,file+' must use its committed bytes');
 }
 const databaseFixture=await captureFixtureDatabase(identity);
 assert.equal(databaseFixture.sha256,createHash('sha256').update(execFileSync('git',['show','HEAD:desktop/database.cjs'])).digest('hex'),'fixture seed source stays pinned to the actual product commit');
 const bundle=await fs.readFile(path.join(output,'desktop/main.cjs'),'utf8');
 assert.equal(/require\(\s*['"]\.\.\/\.\.\/packaging\//.test(bundle),false,'installed startup cannot depend on a source packaging folder');
});
