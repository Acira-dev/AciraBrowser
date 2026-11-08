'use strict';
// The usage message sent 0.1.0-beta.6 from a build that is 0.1.0-beta.6.local.4: the bundled main.cjs carries the repository's package.json, the
// packaged app's own version has the build suffix. The full build version is sent now, so builds can be told apart.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {appVersion,version}=require('../desktop/browser-services/app-version.cjs');
const source=require('../package.json').version;
test('a packaged app reports the version the packager stamped into it, suffix included',()=>{
 assert.equal(appVersion({app:{isPackaged:true,getVersion:()=>'0.1.0-beta.6.local.4'},source:'0.1.0-beta.6'}),'0.1.0-beta.6.local.4');
});
test('from source it is package.json, never Electron\'s version',()=>{
 assert.equal(appVersion({app:{isPackaged:false,getVersion:()=>process.versions.electron||'44.9.3'},source:'0.1.0-beta.6'}),'0.1.0-beta.6');
 assert.equal(version,source,'plain node (tests) has no Electron app');
});
test('a version the usage server would refuse falls back to package.json\'s, so the counts still arrive',()=>{
 for(const bad of ['0.1.0-beta.6.local.4.extra.too.long.for.the.column','v1.0.0','1.0.0 (build 7)',''])
  assert.equal(appVersion({app:{isPackaged:true,getVersion:()=>bad},source:'0.1.0-beta.6'}),'0.1.0-beta.6',bad);
 assert.equal(appVersion({app:{isPackaged:true,getVersion:()=>{throw new Error('no app');}},source:'0.1.0-beta.6'}),'0.1.0-beta.6');
});
test('the full build versions people run are accepted by the server\'s own rule, which the client copies',()=>{
 const VERSION=/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-.][0-9A-Za-z.]{1,16}){0,2}$/;
 const server=require('node:fs').readFileSync(require('node:path').join(__dirname,'../supabase/functions/usage/handler.mjs'),'utf8');
 const client=require('node:fs').readFileSync(require('node:path').join(__dirname,'../desktop/browser-services/app-version.cjs'),'utf8');
 assert.ok(server.includes(String(VERSION))&&client.includes(String(VERSION)),'the same pattern on both sides');
 for(const full of ['0.1.0-beta.6.local.4','0.1.0-beta.7','0.1.0-beta.12.local.15','0.1.0','0.1.0-beta.13.1','0.1.0-beta.13.12','0.1.0-beta.13.1.local.2'])assert.ok(full.length<=24&&VERSION.test(full),full);
});
