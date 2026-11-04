'use strict';
// The real check behind desktop/test-hooks.cjs: removing --remote-debugging-port before 'ready' must keep Chromium's DevTools server
// closed, in the real Electron runtime. A packaged run on the person's own profile gets no port; on an isolated test profile (how the
// release rigs drive the packaged app) the port opens as before.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http');
const {spawn}=require('node:child_process');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});});
const knock=port=>new Promise(resolve=>{const request=http.get({host:'127.0.0.1',port,path:'/json/version',timeout:2000},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({open:true,body}));});request.on('timeout',()=>request.destroy(new Error('timeout')));request.on('error',error=>resolve({open:false,error:error.code||error.message}));});
async function run({testProfile}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-debug-port-')),port=await freePort();
 const env={...process.env,HOOK_FIXTURE_DATA:path.join(root,'user-data'),ACIRA_BROWSER_TEST_HIDDEN:'1',ELECTRON_ENABLE_LOGGING:'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_BROWSER_TEST_DATA;
 if(testProfile)env.ACIRA_BROWSER_TEST_DATA=path.join(root,'test-profile');
 const child=spawn(electron,['--use-mock-keychain','--remote-debugging-port='+port,path.join(__dirname,'fixtures','test-hooks','debug-port-main.cjs')],{env,stdio:['ignore','pipe','pipe']});
 try{
  const ready=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('fixture never got ready: '+out)),30000);child.stdout.on('data',chunk=>{out+=chunk;const line=/READY (.*)\n/.exec(out);if(line){clearTimeout(timer);resolve(JSON.parse(line[1]));}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('fixture exited '+code+': '+out));});});
  return {ready,answer:await knock(port)};
 }finally{child.kill();await new Promise(resolve=>child.exitCode!==null||child.signalCode?resolve():child.once('exit',resolve));fs.rmSync(root,{recursive:true,force:true});}
}
test('a packaged run on the person\'s own profile opens no debugging port, even when asked on the command line',{skip:!electron&&'no Electron runtime'},async()=>{
 const {ready,answer}=await run({testProfile:false});
 assert.deepEqual(ready.removed.switches,['remote-debugging-port','use-mock-keychain'],'the debugging port and the hand-passed mock keychain');assert.equal(ready.switch,false);assert.equal(ready.hidden,null,'no hidden run either');
 assert.equal(answer.open,false,'DevTools answered on the port: '+(answer.body||''));
});
test('the same packaged run on an isolated test profile keeps the port, so the release rigs can drive it',{skip:!electron&&'no Electron runtime'},async()=>{
 const {ready,answer}=await run({testProfile:true});
 assert.deepEqual(ready.removed,{env:[],switches:[],added:[]},'nothing removed; the run asked for the mock keychain itself');assert.equal(ready.switch,true);assert.equal(ready.hidden,'1');
 assert.equal(answer.open,true,'no DevTools on the port: '+answer.error);assert.match(answer.body,/"Browser"/);
});
