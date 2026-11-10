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
 // Memory (13.5): the committed-source build writes the interface chunks and the cookie-banner preload as Latin-1 text too (scripts/one-byte-chunks.mjs, bundleAnswerPreload).
 const wide=/[^\u0000-\u00ff]/;
 for(const file of await fs.readdir(path.join(output,'dist/assets')))if(/^(?:App|index|BrowserSettings|Onboarding|client|fr|de|es|it|pt-BR|tr)-[\w-]+\.js$/.test(file))assert.equal(wide.test(await fs.readFile(path.join(output,'dist/assets',file),'utf8')),false,file+' is Latin-1 text');
 assert.equal(wide.test(await fs.readFile(path.join(output,'desktop/browser-services/autoconsent-preload.cjs'),'utf8')),false,'the cookie-banner preload is Latin-1 text');
});
