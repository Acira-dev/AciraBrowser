// npm run version:next: one version for both platforms, edited in place without disturbing the files' layout.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {nextVersion,releaseProblems,bumpVersion} from '../scripts/version-next.mjs';
import {windowsFileVersion} from '../scripts/release-windows-resources.mjs';
import {createRequire} from 'node:module';
const semver=createRequire(import.meta.url)('semver');
const root=path.resolve(import.meta.dirname,'..');

test('the next version counts the beta up, and refuses to guess from anything else',()=>{
 assert.equal(nextVersion('0.1.0-beta.6'),'0.1.0-beta.7');assert.equal(nextVersion('0.1.0-beta.9'),'0.1.0-beta.10');
 assert.throws(()=>nextVersion('0.1.0'),/--set/);assert.throws(()=>nextVersion('0.1.0-beta.6.local.4'),/--set/);
});
test('a fix release counts the fix number: 13 -> 13.1 -> 13.2, and the next big release is beta.14 from any of them',()=>{
 assert.equal(nextVersion('0.1.0-beta.13',{fix:true}),'0.1.0-beta.13.1');
 assert.equal(nextVersion('0.1.0-beta.13.1',{fix:true}),'0.1.0-beta.13.2');
 assert.equal(nextVersion('0.1.0-beta.13.9',{fix:true}),'0.1.0-beta.13.10');
 assert.equal(nextVersion('0.1.0-beta.13'),'0.1.0-beta.14');assert.equal(nextVersion('0.1.0-beta.13.2'),'0.1.0-beta.14','a big release counts the beta up and drops the fix number');
 assert.throws(()=>nextVersion('0.1.0-beta.13.local.1',{fix:true}),/--set/);assert.throws(()=>nextVersion('0.1.0',{fix:true}),/--set/);
 let version='0.1.0-beta.13';const seen=[version];
 for(const fix of [true,true,false]){version=nextVersion(version,{fix});seen.push(version);}
 assert.deepEqual(seen,['0.1.0-beta.13','0.1.0-beta.13.1','0.1.0-beta.13.2','0.1.0-beta.14']);
 for(let i=1;i<seen.length;i++)assert(semver.gt(seen[i],seen[i-1]),seen[i-1]+' < '+seen[i]);
});
test('a fix release can ship: the Windows build rule, the release rules and the file version all accept 0.1.0-beta.13.1',async()=>{
 assert.deepEqual(releaseProblems('0.1.0-beta.13.1'),[]);assert.deepEqual(releaseProblems('0.1.0-beta.13.2'),[]);
 assert.match(releaseProblems('0.1.0-beta.13.local.1').join(' '),/not a release version/);
 // scripts/build-windows.mjs and scripts/release.mjs hold their patterns inline (they run only on Windows / a release machine): read them from the source
 const windows=await fs.readFile(path.join(root,'scripts/build-windows.mjs'),'utf8'),rule=/if\(!(\/\^0\\\.1[^\n]*?\/)\.test\(pkg\.version\)\)/.exec(windows);
 assert.ok(rule,'the build-windows version check is found');const buildRule=eval(rule[1]);
 for(const ok of ['0.1.0-beta.13','0.1.0-beta.13.1','0.1.5-beta.2.3'])assert.equal(buildRule.test(ok),true,ok);
 for(const bad of ['0.1.0-beta.13.local.1','0.2.0-beta.1','0.1.0','0.1.0-beta.13.1.2'])assert.equal(buildRule.test(bad),false,bad);
 const release=await fs.readFile(path.join(root,'scripts/release.mjs'),'utf8'),title=/version\.replace\((\/[^,]*\/), ' Beta'\)/.exec(release);
 assert.ok(title,'the release title rule is found');const titleRule=eval(title[1]);
 assert.equal('0.1.0-beta.13'.replace(titleRule,' Beta'),'0.1.0 Beta');assert.equal('0.1.0-beta.13.1'.replace(titleRule,' Beta'),'0.1.0 Beta','a fix release is titled like its beta');
 assert.equal(windowsFileVersion('0.1.0-beta.13'),'0.1.0.13');assert.equal(windowsFileVersion('0.1.0-beta.13.1'),'0.1.0.13','Windows shows the beta number; the whole version is in ProductVersion');
 assert.equal(windowsFileVersion('0.1.0-beta.6'),'0.1.0.6');assert.equal(windowsFileVersion('1.2.3'),'1.2.3.0');
 assert.throws(()=>windowsFileVersion('0.1.0-beta.13.local.1'),/Unsupported/);
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
test('--fix goes from the version in package.json to its next fix, in both files, and a fix is never a step back',async t=>{
 const dir=await copyOf(t),current=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8')).version;
 const first=await bumpVersion({root:dir,fix:true});assert.deepEqual([first.current,first.target,first.changed],[current,nextVersion(current,{fix:true}),true]);
 const second=await bumpVersion({root:dir,fix:true});assert.equal(second.target,nextVersion(first.target,{fix:true}));
 const lock=JSON.parse(await fs.readFile(path.join(dir,'package-lock.json'),'utf8'));assert.equal(lock.version,second.target);assert.equal(lock.packages[''].version,second.target);
 assert.equal((await bumpVersion({root:dir})).target,nextVersion(second.target),'the next big release counts the beta up from a fix');
 assert.equal((await bumpVersion({root:dir,check:true})).problems.length,0,'--check accepts the result');
});
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
