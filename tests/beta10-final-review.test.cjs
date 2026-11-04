'use strict';
// Last review before the beta.10 build (Windows only): a helper that ran but wrote too much is not "could not start" (which skips the update
// signature check), a check failing beside a waiting update does not end Install now, and an ask about the newer download behind a waiting
// update is not taken as the answer about the waiting one.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {runHelper,updateSignatureCheck}=require('../desktop/windows-helper.cjs');
const {createAppUpdater}=require('../desktop/browser-services/app-updater.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-final-review-'));
const quiet=async body=>{const warn=console.warn;console.warn=()=>{};try{return await body();}finally{console.warn=warn;}};
const execWith=error=>(file,args,options,callback)=>{setImmediate(()=>callback(error,'invalid\n'+'x'.repeat(70000)));return {stdin:{on(){},end(){}}};};

test('the helper: an error from spawn itself is "could not start"; one after it ran (too much output) is not',async()=>{
 const missing=Object.assign(new Error('spawn C:\\acira-verify.exe ENOENT'),{code:'ENOENT',syscall:'spawn C:\\acira-verify.exe'});
 assert.equal((await runHelper(['signature'],'x',{helper:'C:\\acira-verify.exe',exec:execWith(missing)})).code,'failed');
 const flooded=Object.assign(new RangeError('stdout maxBuffer length exceeded'),{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'});
 assert.equal((await runHelper(['signature'],'x',{helper:'C:\\acira-verify.exe',exec:execWith(flooded)})).code,'timeout');
});

test('the update signature check: a helper that ran and wrote too much refuses the update; a helper that could not start skips the check',async()=>{
 const flooded=Object.assign(new RangeError('stdout maxBuffer length exceeded'),{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'});
 const refused=await quiet(()=>updateSignatureCheck({helper:'C:\\acira-verify.exe',exec:execWith(flooded),log:()=>{}})(['Acira'],'C:\\setup.exe'));
 assert.notEqual(refused,null,'not accepted');
 const missing=Object.assign(new Error('spawn C:\\acira-verify.exe EACCES'),{code:'EACCES',syscall:'spawn C:\\acira-verify.exe'});
 assert.equal(await updateSignatureCheck({helper:'C:\\acira-verify.exe',exec:execWith(missing),log:()=>{}})(['Acira'],'C:\\setup.exe'),null);
});

test('Windows: a background check failing while Install now asks the feed leaves the update waiting, and Install now still installs it',async()=>{
 // electron-updater hands every caller the check already under way; here a look started beside the waiting update fails during Install now's ask.
 const fake=new EventEmitter(),root=tmp();let installs=0,calls=0,pending=null;
 fake.checkForUpdates=()=>{if(pending)return pending;calls++;fake.emit('checking-for-update');
  if(calls===1){fake.emit('update-available',{version:'1.1.0'});fake.emit('update-downloaded',{version:'1.1.0'});return Promise.resolve(null);}
  pending=new Promise((resolve,reject)=>setTimeout(()=>{pending=null;const error=new Error('net::ERR_CONNECTION_RESET');fake.emit('error',error);reject(error);},80));
  return pending;};
 fake.quitAndInstall=()=>{installs++;};fake.setFeedURL=()=>{};
 try{
  const updater=createAppUpdater({app:{getVersion:()=>'1.0.0',isPackaged:true,getPath:()=>root},dir:root,platform:'win32',env:{},autoUpdater:fake,uninstallerPresent:()=>true,qaBuild:false,macAvailability:()=>null,schedule:()=>null,every:()=>null,askWithin:400});
  await updater.check();assert.equal(updater.status().status,'ready');
  const look=quiet(()=>updater.check()).catch(()=>{}); // a look beside the waiting update, still under way
  const result=await quiet(()=>updater.install());await look;
  assert.equal(updater.status().status,'ready','the update still waits');
  assert.equal(installs,1,'Install now installed it');assert.equal(result.installing,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('the shared ask: a question about the waiting version is not answered with the newer download\'s answer',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','app-updater.cjs'),'utf8');
 assert.match(source,/if\(asking\)return asking\.version===version\?asking\.promise:Promise\.resolve\(null\);/);
});
