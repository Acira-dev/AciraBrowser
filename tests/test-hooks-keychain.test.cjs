'use strict';
// The real check behind lockDown's mock keychain (desktop/test-hooks.cjs): on a packaged Mac build, a test profile must not get the app's Keychain
// key, or a copy of the person's profile run as a "test profile" with a debugging port shows their cookies and vault decrypted. The switch is added
// by lockDown at the top of main, so this checks in real Electron that Chromium still takes it: what Safe Storage writes must open with Chromium's
// mock keychain key (PBKDF2 of "mock_password"), which the app's real Keychain key would not.
// It starts the real Electron binary itself, not the mock-keychain wrapper some runs set up (ELECTRON_OVERRIDE_DIST_PATH), since that wrapper adds
// the switch on its own; the fixture never touches Safe Storage without the switch.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const electron=(()=>{try{const dir=path.dirname(require.resolve('electron')),binary=path.join(dir,'dist',fs.readFileSync(path.join(dir,'path.txt'),'utf8').trim());return fs.existsSync(binary)?binary:null;}catch{return null;}})();
const mockOpen=blob=>{const key=crypto.pbkdf2Sync('mock_password','saltysalt',1003,16,'sha1'),decipher=crypto.createDecipheriv('aes-128-cbc',key,Buffer.alloc(16,' '));return Buffer.concat([decipher.update(blob.subarray(3)),decipher.final()]).toString();};
test('a test profile on a packaged Mac build writes Safe Storage with the mock keychain, never the app\'s Keychain key',{skip:(process.platform!=='darwin'&&'Mac only')||(!electron&&'no Electron runtime')},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-keychain-')),env={...process.env,ACIRA_BROWSER_TEST_DATA:path.join(root,'copied-profile'),ELECTRON_ENABLE_LOGGING:'0'};
 for(const name of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','ELECTRON_OVERRIDE_DIST_PATH'])delete env[name];
 const child=spawn(electron,[path.join(__dirname,'fixtures','test-hooks','keychain-main.cjs')],{env,stdio:['ignore','pipe','pipe']});
 try{
  const out=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('fixture never answered: '+text)),30000);child.stdout.on('data',chunk=>{text+=chunk;const line=/RESULT (.*)\n/.exec(text);if(line){clearTimeout(timer);resolve(JSON.parse(line[1]));}});child.once('exit',code=>{if(!/RESULT /.test(text)){clearTimeout(timer);reject(new Error('fixture exited '+code+': '+text));}});});
  assert.deepEqual(out.result.added,['use-mock-keychain'],'lockDown added the switch');assert.equal(out.mock,true);
  const blob=Buffer.from(out.blob,'base64');assert.equal(blob.subarray(0,3).toString(),'v10');
  assert.equal(mockOpen(blob),'acira-keychain-check','Safe Storage used the mock keychain key');
 }finally{child.kill();await new Promise(resolve=>child.exitCode!==null||child.signalCode?resolve():child.once('exit',resolve));fs.rmSync(root,{recursive:true,force:true});}
});
