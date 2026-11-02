import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {commitSnapshots} from '../scripts/release-commit.mjs';

test('captured commit preserves unrelated staged work and later owner edits',()=>{
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'acira-release-commit-test-'));
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();git('init','-b','main');git('config','user.name','Isolated release test');git('config','user.email','fixture@invalid.example');
  fs.writeFileSync(path.join(cwd,'approved.txt'),'base');fs.writeFileSync(path.join(cwd,'other.txt'),'base');git('add','approved.txt','other.txt');git('commit','-m','fixture baseline');
  fs.writeFileSync(path.join(cwd,'other.txt'),'staged owner work');git('add','other.txt');
  fs.writeFileSync(path.join(cwd,'approved.txt'),'approved snapshot');const blob=git('hash-object','-w','approved.txt');fs.writeFileSync(path.join(cwd,'approved.txt'),'new work after freeze');
  const result=commitSnapshots({cwd,snapshots:[{role:'fixture',entries:[{file:'approved.txt',mode:'100644',blob}]}],message:'Publish captured fixture only'});
  assert.equal(git('show','HEAD:approved.txt'),'approved snapshot');assert.equal(git('show','HEAD:other.txt'),'base');assert.equal(git('show',':other.txt'),'staged owner work');assert.equal(fs.readFileSync(path.join(cwd,'approved.txt'),'utf8'),'new work after freeze');assert.equal(git('diff','--cached','--name-only'),'other.txt');assert.equal(result.unrelatedStagedContentPreserved,true);
});
