// npm run version:next: one version for both platforms, edited in place without disturbing the files' layout.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {nextVersion,releaseProblems,bumpVersion} from '../scripts/version-next.mjs';
const root=path.resolve(import.meta.dirname,'..');

test('the next version counts the beta up, and refuses to guess from anything else',()=>{
 assert.equal(nextVersion('0.1.0-beta.6'),'0.1.0-beta.7');assert.equal(nextVersion('0.1.0-beta.9'),'0.1.0-beta.10');
 assert.throws(()=>nextVersion('0.1.0'),/--set/);assert.throws(()=>nextVersion('0.1.0-beta.6.local.4'),/--set/);
});
test('a version can ship only if the Windows build, the release rules and the shipped builds all accept it',()=>{
 assert.deepEqual(releaseProblems('0.1.0-beta.7'),[]);
 assert.match(releaseProblems('0.1.0-beta.6').join(' '),/not newer than/);
 assert.match(releaseProblems('0.1.0-beta.6.local.5').join(' '),/not a release version/);
 assert.match(releaseProblems('0.2.0-beta.1').join(' '),/Windows build/,'scripts/build-windows.mjs only accepts 0.1.N-beta.N');
 assert.match(releaseProblems('0.1.0').join(' '),/stable/);
});
async function copyOf(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-version-next-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 for(const file of ['package.json','package-lock.json'])await fs.copyFile(path.join(root,file),path.join(dir,file));
 return dir;
}
test('bumping changes the version lines in package.json and package-lock.json and nothing else',async t=>{
 const dir=await copyOf(t),before={package:await fs.readFile(path.join(dir,'package.json'),'utf8'),lock:await fs.readFile(path.join(dir,'package-lock.json'),'utf8')};
 const current=JSON.parse(before.package).version;
 assert.equal((await bumpVersion({root:dir,check:true})).changed,false);
 const result=await bumpVersion({root:dir,set:'0.1.99-beta.1'});assert.deepEqual([result.current,result.target,result.changed],[current,'0.1.99-beta.1',true]);
 const after={package:await fs.readFile(path.join(dir,'package.json'),'utf8'),lock:await fs.readFile(path.join(dir,'package-lock.json'),'utf8')};
 assert.equal(after.package,before.package.replace('"version": "'+current+'"','"version": "0.1.99-beta.1"'));
 assert.equal(after.lock,before.lock.replace('"version": "'+current+'"','"version": "0.1.99-beta.1"').replace('"version": "'+current+'"','"version": "0.1.99-beta.1"'));
 assert.equal(JSON.parse(after.lock).packages[''].version,'0.1.99-beta.1');
 await assert.rejects(bumpVersion({root:dir,set:'0.1.99-beta.1'}),/not (newer|higher)/,'it never goes sideways or backwards');
 await assert.rejects(bumpVersion({root:dir,set:'0.1.0-beta.6'}),/not newer|not higher/);
 assert.deepEqual(await bumpVersion({root:dir,check:true}),{current:'0.1.99-beta.1',target:'0.1.99-beta.1',problems:[],changed:false});
});
