'use strict';
// hunt-stability #7: any uncaught exception in the main process froze the browser behind Electron's modal "A JavaScript error occurred in the main
// process". Now it is written to main.log and Acira keeps running; a start that fails before any window is explained and Acira quits.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createProcessErrors,startupFailed,scrub}=require('../desktop/process-errors.cjs');
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-process-errors-'));

test('installing adds listeners for both events, which is what keeps Electron from showing its modal; removing takes them away',()=>{
 const target=new EventEmitter(),errors=createProcessErrors({file:path.join(folder(),'main.log'),echo:()=>{}});
 const remove=errors.install(target);
 assert.equal(target.listenerCount('uncaughtException'),1);assert.equal(target.listenerCount('unhandledRejection'),1);
 remove();assert.equal(target.listenerCount('uncaughtException'),0);
});

test('an uncaught exception and an unhandled rejection are written to main.log with their stacks',()=>{
 const dir=folder(),file=path.join(dir,'main.log'),target=new EventEmitter();let at=1.8e12;
 createProcessErrors({file,echo:()=>{},now:()=>at}).install(target);
 target.emit('uncaughtException',new TypeError('Cannot read properties of undefined (reading \'webContents\')'));
 at+=1000;target.emit('unhandledRejection',new Error('Unknown toolbar target'));
 at+=1000;target.emit('unhandledRejection','a plain string');
 const text=fs.readFileSync(file,'utf8');
 assert.match(text,/Uncaught exception: TypeError: Cannot read properties of undefined/);
 assert.match(text,/\n {4,}at /,'the stack is kept, indented under its line');
 assert.match(text,/Unhandled rejection: Error: Unknown toolbar target/);
 assert.match(text,/Unhandled rejection: a plain string/);
 // NTFS uses inherited ACLs; POSIX mode bits do not describe Windows permissions.
 if(process.platform!=='win32') assert.equal((fs.statSync(file).mode&0o777).toString(8),'600');
 else assert.doesNotThrow(()=>fs.accessSync(file,fs.constants.R_OK|fs.constants.W_OK));
});

test('the same error in a burst is written once, then counted; a burst of different errors stops at 20 lines a minute',()=>{
 const file=path.join(folder(),'main.log');let at=1.8e12,echoes=0;
 const errors=createProcessErrors({file,echo:()=>{echoes++;},now:()=>at});
 for(let i=0;i<500;i++)errors.record('Uncaught exception',new Error('same'));
 assert.equal(echoes,1,'a repeat is not even echoed: an echo to a broken stderr raises the same error again');
 for(let i=0;i<100;i++)errors.record('Uncaught exception',new Error('different '+i));
 at+=61*1000;errors.record('Uncaught exception',new Error('later'));
 const lines=fs.readFileSync(file,'utf8').split('\n').filter(line=>/^\d{4}-/.test(line));
 assert.equal(lines.filter(line=>/Error: same/.test(line)).length,1);
 assert.equal(lines.filter(line=>/different/.test(line)).length,19,'20 lines a minute in all');
 assert.ok(lines.some(line=>/Error: later/.test(line)),'a new minute writes again');
});

test('main.log is capped: past the limit it moves to main.log.1 and starts again',()=>{
 const dir=folder(),file=path.join(dir,'main.log');let at=1.8e12;
 const errors=createProcessErrors({file,echo:()=>{},now:()=>at,maxBytes:2000});
 for(let i=0;i<40;i++){at+=61*1000;errors.record('Uncaught exception',new Error('entry '+i+' '+'x'.repeat(100)));}
 assert.ok(fs.statSync(file).size<=2000);assert.ok(fs.existsSync(file+'.1'));assert.ok(fs.statSync(file+'.1').size<=2000);
});

test('a log that cannot be written (full disk) and an echo that throws never throw out of the handler',()=>{
 const target=new EventEmitter(),full={mkdirSync(){},statSync(){throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});},renameSync(){},appendFileSync(){throw Object.assign(new Error('ENOSPC: no space left on device, write'),{code:'ENOSPC'});}};
 const errors=createProcessErrors({file:'/nowhere/main.log',fileSystem:full,echo:()=>{throw new Error('EPIPE');}});
 errors.install(target);
 assert.doesNotThrow(()=>target.emit('uncaughtException',new Error('ENOSPC while writing')));
 assert.equal(errors.record('Uncaught exception',new Error('another')),false);
});

test('a start-up failure with no window is explained and Acira quits; with a window it is only logged',()=>{
 const calls=[];const options=hasWindow=>({record:(kind,error)=>calls.push(['record',kind,error.message]),hasWindow:()=>hasWindow,showError:(title,text)=>calls.push(['show',title,text]),quit:()=>calls.push(['quit']),closeSplash:()=>calls.push(['splash'])});
 assert.equal(startupFailed(new Error('Filter engine could not be read'),options(false)),true);
 assert.deepEqual(calls.map(c=>c[0]),['record','splash','show','quit']);
 assert.equal(calls[2][1],'Acira could not start');assert.match(calls[2][2],/Filter engine could not be read[\s\S]*Nothing was changed or deleted[\s\S]*main\.log/);
 calls.length=0;
 assert.equal(startupFailed(new Error('late'),options(true)),false);assert.deepEqual(calls.map(c=>c[0]),['record']);
});

test('main installs the handlers on its first line, points main.log at the profile folder as soon as it is known, and catches the start-up chain',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main.split('\n')[0],/^\/\*[^\n]*\*\/const processErrors=require\('\.\/process-errors\.cjs'\)\.installEarly\(\);$/,'the very first statement, before any other require can fail');
 const setPath=main.indexOf("app.setPath('userData',process.env.ACIRA_BROWSER_TEST_DATA"),install=main.indexOf("processErrors.setFile(path.join(app.getPath('userData'),'main.log'),{profile:app.getPath('userData')});");
 assert.ok(setPath>=0&&install>setPath&&install-setPath<400,'main.log moves to the profile folder straight after it is set');
 assert.equal((main.match(/createProcessErrors\(/g)||[]).length,0,'one set of handlers only');
 assert.match(main,/\}\)\.catch\(error=>\{[^\n]*require\('\.\/process-errors\.cjs'\)\.startupFailed\(error,\{record:processErrors\.record,hasWindow:\(\)=>controllers\.size>0\|\|quitting,/);
});

test('in a real Electron main process an exception thrown later is logged and the process keeps running, with no modal',async t=>{
 const electron=require('electron');
 if(typeof electron!=='string'||!fs.existsSync(electron)){t.skip('no Electron binary');return;}
 const dir=folder(),script=path.join(dir,'main.cjs'),log=path.join(dir,'main.log'),alive=path.join(dir,'alive');
 fs.writeFileSync(script,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(dir)});
require(${JSON.stringify(path.join(__dirname,'../desktop/process-errors.cjs'))}).createProcessErrors({file:${JSON.stringify(log)}}).install();
app.whenReady().then(()=>{setTimeout(()=>{throw new Error('boom from a timer');},50);setTimeout(()=>{Promise.reject(new Error('nobody waited for this'));},100);
setTimeout(()=>{require('fs').writeFileSync(${JSON.stringify(alive)},'yes');app.quit();},600);});`);
 const {spawnSync}=require('node:child_process');
 const env={...process.env,HOME:dir};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(electron,['--use-mock-keychain',script],{env,timeout:30000,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 assert.equal(fs.readFileSync(alive,'utf8'),'yes','still running after both, so no modal was waiting for a click');
 const text=fs.readFileSync(log,'utf8');
 assert.match(text,/Uncaught exception: Error: boom from a timer/);assert.match(text,/Unhandled rejection: Error: nobody waited for this/);
 fs.rmSync(dir,{recursive:true,force:true});
});

test('main.log holds no web address, file path, e-mail or IP address: Acira\'s own folders become names, the rest placeholders',()=>{
 const app='/Applications/Acira Browser.app/Contents/Resources/app.asar',profile='/Users/jo/Library/Application Support/AciraBrowser',home='/Users/jo',temp='/var/folders/xy/T';
 const text=[
  'TypeError: Cannot read properties of undefined (reading \'webContents\')',
  '    at Object.persist ('+app+'/desktop/main.cjs:992:120)',
  '    at node:internal/process/task_queues:95:5',
  "Error: ENOENT: no such file or directory, open '/Users/jo/Downloads/Taxes 2025 final.pdf'",
  'EACCES writing '+profile+'/window-state.json',
  'net::ERR_FAILED https://mail.example.com/inbox?user=jo@example.com and www.bank.example/login',
  'saving C:\\Users\\Jo Smith\\AppData\\Roaming\\AciraBrowser\\window-state.json and \\\\server\\share\\file.txt',
  'opened /Volumes/Backup/photos/me.jpg and /home/jo smith/notes.txt and '+temp+'/upload-1/cv.pdf',
  'connect ECONNREFUSED 192.168.1.20:8080 from jo.smith@example.org data:text/html,<b>secret</b> token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'Widevine 4.10.3112.0 failed: Invalid data: field',
 ].join('\n');
 const out=scrub(text,{app,profile,home,temp});
 for(const secret of ['jo','Jo','Smith','Taxes','mail.example','bank.example','192.168','me.jpg','Backup','cv.pdf','secret','eyJhbGci','server','share'])assert.ok(!out.includes(secret),secret+' is gone: '+out);
 assert.match(out,/at Object\.persist \(<app>\/desktop\/main\.cjs:992:120\)/,'Acira\'s own stack frames stay readable');
 assert.match(out,/node:internal\/process\/task_queues:95:5/);
 assert.match(out,/EACCES writing <profile>\/window-state\.json/,'Acira\'s own file names in the profile stay');
 assert.match(out,/open '<home>\/…'/);assert.match(out,/<url>/);assert.match(out,/<email>/);assert.match(out,/<ip>:8080/);assert.match(out,/<token>/);
 assert.match(out,/Widevine 4\.10\.3112\.0 failed: Invalid data: field/,'versions and Acira\'s own words are kept');
 // and what reaches the file is the scrubbed text
 const dir=folder(),file=path.join(dir,'main.log');
 createProcessErrors({file,echo:()=>{},folders:{profile:dir}}).record('Uncaught exception',new Error('could not load https://private.example/page for '+os.homedir()+'/Desktop/diary.txt in '+dir+'/browser.sqlite'));
 const written=fs.readFileSync(file,'utf8');
 assert.doesNotMatch(written,/private\.example|diary/);assert.match(written,/<url> for <home>\/…\n/,'a path under home runs to the end of its part of the message');
});

test('before the profile folder is known, entries wait in memory and are written once it is; at most 20 wait',()=>{
 const dir=folder(),file=path.join(dir,'main.log');let at=1.8e12;
 const errors=createProcessErrors({echo:()=>{},now:()=>at});
 assert.equal(errors.file,null);
 for(let i=0;i<30;i++){at+=61*1000;errors.record('Uncaught exception',new Error('early '+i));}
 assert.equal(fs.existsSync(file),false);
 errors.setFile(file,{profile:dir});
 const lines=fs.readFileSync(file,'utf8').split('\n').filter(line=>/^\d{4}-/.test(line));
 assert.equal(lines.length,20);assert.match(lines[0],/early 0/);
 errors.record('Uncaught exception',new Error('later'));assert.match(fs.readFileSync(file,'utf8'),/later/);
});

test('an exception before the next turn of the event loop stopped main.cjs from loading: explained once; one after that is only logged',()=>{
 const target=new EventEmitter(),failures=[];let tick=null;
 const errors=createProcessErrors({file:path.join(folder(),'main.log'),echo:()=>{},onLoadFailure:error=>failures.push(error.message)});
 errors.install(target,{later:fn=>{tick=fn;}});
 target.emit('uncaughtException',new Error("Cannot find module './vendor/missing.cjs'"));
 assert.deepEqual(failures,["Cannot find module './vendor/missing.cjs'"]);
 target.emit('uncaughtException',new Error('second'));assert.equal(failures.length,1,'explained once');
 assert.match(fs.readFileSync(errors.file,'utf8'),/Load failed: Error: Cannot find module/);
 const loaded=new EventEmitter(),none=[];const after=createProcessErrors({file:path.join(folder(),'main.log'),echo:()=>{},onLoadFailure:()=>none.push(1)});
 after.install(loaded,{later:fn=>fn()});loaded.emit('uncaughtException',new Error('at run time'));
 assert.equal(none.length,0,'an error once main.cjs has loaded never quits Acira');assert.match(fs.readFileSync(after.file,'utf8'),/Uncaught exception: Error: at run time/);
 void tick;
});

test('in a real Electron main process a file that fails while it loads is explained and Acira quits, instead of Electron\'s raw error box',async t=>{
 const electron=require('electron');
 if(typeof electron!=='string'||!fs.existsSync(electron)){t.skip('no Electron binary');return;}
 const dir=folder(),profile=path.join(dir,'profile'),script=path.join(dir,'main.cjs'),shown=path.join(dir,'shown.json');
 // the dialog is recorded instead of shown; the code under test is process-errors.cjs as main.cjs uses it, on its first line
 fs.writeFileSync(script,`const {dialog}=require('electron');dialog.showErrorBox=(title,text)=>require('fs').appendFileSync(${JSON.stringify(shown)},JSON.stringify({title,text})+'\\n');
require(${JSON.stringify(path.join(__dirname,'../desktop/process-errors.cjs'))}).installEarly();
require('./a-vendored-file-the-package-forgot.cjs');`);
 const {spawnSync}=require('node:child_process');
 const env={...process.env,HOME:dir,ACIRA_BROWSER_TEST_DATA:profile,LANG:'en_US.UTF-8',LC_ALL:'',LC_MESSAGES:''};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_BROWSER_TEST_HIDDEN;
 const started=Date.now(),run=spawnSync(electron,['--use-mock-keychain',script],{env,timeout:30000,encoding:'utf8'});
 assert.equal(run.status,1,'Acira quits by itself: '+run.stderr.slice(-400));assert.ok(Date.now()-started<30000);
 const boxes=fs.readFileSync(shown,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(boxes.length,1,'one message, and not Electron\'s own');assert.equal(boxes[0].title,'Acira could not start');
 assert.match(boxes[0].text,/Cannot find module[\s\S]*Nothing was changed or deleted/);
 const log=fs.readFileSync(path.join(profile,'main.log'),'utf8');
 assert.match(log,/Load failed: Error: Cannot find module '\.\/a-vendored-file-the-package-forgot\.cjs'/);
 assert.ok(!log.includes(dir),'the folder names are scrubbed from main.log');
 // a German system (LANG, as a start from a terminal sets it) gets the message in German, though no translator is set up yet
 fs.rmSync(shown,{force:true});
 const german=spawnSync(electron,['--use-mock-keychain',script],{env:{...env,LANG:'de_DE.UTF-8',LC_ALL:'',LC_MESSAGES:''},timeout:30000,encoding:'utf8'});
 assert.equal(german.status,1,german.stderr.slice(-400));
 assert.equal(JSON.parse(fs.readFileSync(shown,'utf8').trim()).title,'Acira konnte nicht starten');
 fs.rmSync(dir,{recursive:true,force:true});
});
