'use strict';
// hunt-stability #7: any uncaught exception in the main process froze the browser behind Electron's modal "A JavaScript error occurred in the main
// process". Now it is written to main.log and Acira keeps running; a start that fails before any window is explained and Acira quits.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createProcessErrors,startupFailed}=require('../desktop/process-errors.cjs');
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

test('main installs the handlers right after the profile folder is known, and catches the start-up chain',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 const setPath=main.indexOf("app.setPath('userData',process.env.ACIRA_BROWSER_TEST_DATA"),install=main.indexOf("const processErrors=require('./process-errors.cjs').createProcessErrors({file:path.join(app.getPath('userData'),'main.log')});processErrors.install();");
 assert.ok(setPath>=0&&install>setPath&&install-setPath<400,'installed straight after the profile folder is set');
 assert.match(main,/\}\)\.catch\(error=>\{[^\n]*require\('\.\/process-errors\.cjs'\)\.startupFailed\(error,\{record:processErrors\.record,hasWindow:\(\)=>controllers\.size>0,/);
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
