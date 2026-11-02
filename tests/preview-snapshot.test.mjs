import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {preservePreviewBuild,verifyPreservedBuild} from '../scripts/preview-snapshot.mjs';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-preview-unit-'));for(const [file,text]of Object.entries({'desktop/main.cjs':'module.exports=1;','desktop/preload.cjs':'module.exports=2;','desktop/ui-preload.cjs':'module.exports=4;','desktop/runtime.cjs':'module.exports=3;','dist/index.html':'<p>Verified build</p>','resources/filters/list.txt':'fixture','design-tokens.json':'{}','page-zoom-levels.json':'[]','package.json':'{"main":"desktop/main.cjs"}'})){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}return root;}
function cleanup(root){const resolved=fs.realpathSync(root),temporary=fs.realpathSync(os.tmpdir());if(!resolved.startsWith(temporary+path.sep)||!path.basename(resolved).startsWith('acira-preview-unit-'))throw Error('Unsafe QA cleanup target');fs.rmSync(resolved,{recursive:true});}
test('later source edits cannot change an existing preview build or preload',()=>{const root=fixture();try{const directory=path.join(root,'.builds'),first=preservePreviewBuild({root,directory});fs.writeFileSync(path.join(root,'dist/index.html'),'<p>Next unfinished build</p>');fs.writeFileSync(path.join(root,'desktop/preload.cjs'),'module.exports=9;');assert.equal(fs.readFileSync(path.join(first.launchPath,'dist/index.html'),'utf8'),'<p>Verified build</p>');assert.equal(fs.readFileSync(path.join(first.launchPath,'desktop/preload.cjs'),'utf8'),'module.exports=2;');const second=preservePreviewBuild({root,directory});assert.notEqual(second.id,first.id);assert.equal(fs.readFileSync(path.join(first.launchPath,'dist/index.html'),'utf8'),'<p>Verified build</p>');}finally{cleanup(root);}});
test('incomplete native output is rejected before launch',()=>{const root=fixture();try{fs.unlinkSync(path.join(root,'desktop/runtime.cjs'));assert.throws(()=>preservePreviewBuild({root,directory:path.join(root,'.builds')}),/Missing preview build/);}finally{cleanup(root);}});
test('a changed preserved snapshot cannot silently be reused',()=>{const root=fixture();try{const directory=path.join(root,'.builds'),first=preservePreviewBuild({root,directory});assert.equal(verifyPreservedBuild(first),first);fs.writeFileSync(path.join(first.launchPath,'desktop/preload.cjs'),'module.exports=99;');assert.throws(()=>verifyPreservedBuild(first),/preserved preview build was changed/);assert.throws(()=>preservePreviewBuild({root,directory}),/preserved preview build was changed/);}finally{cleanup(root);}});

const posix={skip:process.platform==='win32'&&'POSIX executable modes; Windows launch permissions are unchanged'};
const helperPath='desktop/browser-services/tor-engine/darwin-arm64/tor';
function helper(root,mode=0o755){const file=path.join(root,helperPath);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'#!/bin/sh\nprintf "preview-helper-ready"\n');fs.chmodSync(file,mode);return file;}

test('a preserved POSIX helper keeps its execute bit and can actually start',posix,()=>{const root=fixture();try{
 const source=helper(root),build=preservePreviewBuild({root,directory:path.join(root,'.builds'),checkSyntax:false}),copy=path.join(build.launchPath,helperPath);
 assert.equal(fs.statSync(copy).mode&0o777,fs.statSync(source).mode&0o777);
 assert.equal(build.files.find(file=>file.path===helperPath).mode,0o755);
 const child=spawnSync(copy,[],{encoding:'utf8'});assert.equal(child.error,undefined);assert.equal(child.status,0);assert.equal(child.stdout,'preview-helper-ready');
 assert.equal(verifyPreservedBuild(build),build);
}finally{cleanup(root);}});

test('mode-only source changes create a new build without mutating the old snapshot',posix,()=>{const root=fixture();try{
 const source=helper(root,0o644),directory=path.join(root,'.builds'),first=preservePreviewBuild({root,directory,checkSyntax:false});
 fs.chmodSync(source,0o755);const second=preservePreviewBuild({root,directory,checkSyntax:false});
 assert.notEqual(second.id,first.id);assert.equal(fs.statSync(path.join(first.launchPath,helperPath)).mode&0o777,0o644);assert.equal(fs.statSync(path.join(second.launchPath,helperPath)).mode&0o777,0o755);
 assert.equal(verifyPreservedBuild(first),first);assert.equal(verifyPreservedBuild(second),second);
}finally{cleanup(root);}});

test('a changed preserved execute bit is rejected rather than silently repaired in place',posix,()=>{const root=fixture();try{
 helper(root);const directory=path.join(root,'.builds'),build=preservePreviewBuild({root,directory,checkSyntax:false});fs.chmodSync(path.join(build.launchPath,helperPath),0o644);
 assert.throws(()=>verifyPreservedBuild(build),/preserved preview build mode was changed/);assert.throws(()=>preservePreviewBuild({root,directory,checkSyntax:false}),/preserved preview build mode was changed/);
}finally{cleanup(root);}});

test('legacy byte-only manifests remain readable, while a fresh build gets a distinct executable-safe identity',posix,()=>{const root=fixture();try{
 helper(root);const reference=preservePreviewBuild({root,directory:path.join(root,'.reference'),checkSyntax:false}),identity=createHash('sha256');
 const files=reference.files.map(({path:file,sha256})=>{identity.update(file).update('\0').update(fs.readFileSync(path.join(root,file)));return {path:file,sha256};});
 const id=identity.digest('hex'),directory=path.join(root,'.builds'),launchPath=path.join(directory,id.slice(0,20));
 for(const file of files){const destination=path.join(launchPath,file.path);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,fs.readFileSync(path.join(root,file.path)),{mode:0o644});}
 const legacy={id,launchPath,files};assert.equal(verifyPreservedBuild(legacy),legacy);
 const next=preservePreviewBuild({root,directory,checkSyntax:false});assert.notEqual(next.id,legacy.id);assert.equal(fs.statSync(path.join(legacy.launchPath,helperPath)).mode&0o777,0o644);assert.equal(fs.statSync(path.join(next.launchPath,helperPath)).mode&0o777,0o755);assert.equal(verifyPreservedBuild(next),next);
}finally{cleanup(root);}});
