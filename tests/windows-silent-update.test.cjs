'use strict';
// "Install now" on Windows: the downloaded setup runs silently and opens Acira again. Before, Acira called quitAndInstall(false,true): the setup
// ran with its window, and because an Acira was already installed it asked "Update to X / Open / Cancel" (AcAskExisting) first.
// This file follows the whole chain without Windows: Acira's call -> the setup arguments electron-updater's real NsisUpdater builds -> what the
// setup script and electron-builder's one-click template do with them -> what the reopened Acira does with the argument the setup passes.
// Not proven here: a real silent update on a Windows PC (docs/launch/PUBLIC_UPDATES.md lists the checks for the Windows laptop).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createAppUpdater}=require('../desktop/browser-services/app-updater.cjs');
const {parseExternalURLs}=require('../desktop/accounts/external-links.cjs');
const root=path.join(__dirname,'..'),read=(...parts)=>fs.readFileSync(path.join(root,...parts),'utf8');
const SETUP='C:\\Users\\person\\AppData\\Local\\acira-browser-updater\\pending\\AciraBrowserSetup.exe';

test('Install now asks electron-updater for a silent install that opens Acira again',async()=>{
 const calls=[],fake=new EventEmitter();
 fake.checkForUpdates=async()=>{fake.emit('update-available',{version:'0.1.0-beta.8'});fake.emit('update-downloaded',{version:'0.1.0-beta.8'});};
 fake.quitAndInstall=(...args)=>calls.push(args);fake.setFeedURL=()=>{};
 const updater=createAppUpdater({app:{isPackaged:true,getVersion:()=>'0.1.0-beta.7',getPath:()=>os.tmpdir()},dir:fs.mkdtempSync(path.join(os.tmpdir(),'acira-silent-')),platform:'win32',env:{},autoUpdater:fake,uninstallerPresent:()=>true,qaBuild:false,schedule:()=>null,every:()=>null});
 await updater.check();await updater.install();
 assert.deepEqual(calls,[[true,true]],'isSilent, isForceRunAfter');
});

test('the real NsisUpdater starts the setup with /S, --force-run and --updated, and Acira quits for it',async t=>{
 // electron-updater's quitAndInstall finishes by emitting before-quit-for-update on Electron's autoUpdater and quitting the app; both stand-ins here.
 const electronId=require.resolve('electron'),saved=require.cache[electronId],autoUpdater=new EventEmitter();
 require.cache[electronId]={id:electronId,filename:electronId,loaded:true,exports:{autoUpdater}};
 t.after(()=>{if(saved)require.cache[electronId]=saved;else delete require.cache[electronId];});
 const {NsisUpdater}=require('electron-updater/out/NsisUpdater');
 const spawned=[],quit=new Promise(resolve=>{autoUpdater.once('before-quit-for-update',resolve);});
 const nsis=Object.create(NsisUpdater.prototype);
 Object.assign(nsis,{quitAndInstallCalled:false,autoRunAppAfterInstall:true,_logger:{info(){},warn(){},error(){}},downloadedUpdateHelper:{file:SETUP,packageFile:null,downloadedFileInfo:{isAdminRightsRequired:false}},spawnLog:async(file,args)=>{spawned.push({file,args});return true;},app:{quit(){spawned.push('app quit');}}});
 nsis.quitAndInstall(true,true);
 await quit;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(spawned[0].file,SETUP);
 assert.deepEqual(spawned[0].args,['--updated','/S','--force-run']);
 assert.equal(spawned[1],'app quit');
 // and the old arguments, for contrast: no /S, so the setup shows its window and its question
 const before=Object.assign(Object.create(NsisUpdater.prototype),{...nsis,quitAndInstallCalled:false,spawnLog:async(file,args)=>{spawned.push({file,args});return true;}});
 before.install(false,true);assert.deepEqual(spawned.at(-1).args,['--updated','--force-run']);
});

test('a silent setup asks nothing and shows no window of its own',()=>{
 const nsh=read('packaging','acira-installer.nsh');
 const body=name=>{const start=nsh.indexOf('Function '+name);assert(start>=0,name);return nsh.slice(start,nsh.indexOf('FunctionEnd',start));};
 assert.match(body('AcAskExisting'),/^Function AcAskExisting\s+IfSilent acAskDone/,'"Update to X / Open / Cancel" is skipped first thing when silent');
 const check=nsh.slice(nsh.indexOf('!macro customCheckAppRunning'),nsh.indexOf('!macroend',nsh.indexOf('!macro customCheckAppRunning')));
 assert.match(check,/IfSilent acNoBanner\s+Call AcStyleBanner\s+acNoBanner:/,'the branded progress window is not shown');
 assert.match(body('AcHideStockWindow'),/IfSilent acHideDone/);
 assert.match(nsh,/IfSilent acOldWindowsQuit/,'an unsupported Windows exits with a code, no message box');
 const stage=body('AcStage2');assert.match(stage,/\$\{If\} \$acWnd <> 0\s+Sleep 2400/,'the finishing scene waits only when its window exists');
});

test('electron-builder\'s one-click template opens the app after a silent install with --force-run, passing --updated',()=>{
 const config=JSON.parse(read('packaging','electron-builder.json'));
 assert.equal(config.nsis.oneClick,true);assert.equal(config.nsis.runAfterFinish,true);
 const template=read('node_modules','app-builder-lib','templates','nsis','installSection.nsh');
 assert.match(template,/!ifdef ONE_CLICK[\s\S]*?!ifdef RUN_AFTER_FINISH\s+\$\{ifNot\} \$\{Silent\}\s+\$\{orIf\} \$\{isForceRun\}\s+!insertmacro doStartApp/);
 const common=read('node_modules','app-builder-lib','templates','nsis','common.nsh');
 assert.match(common,/\$\{if\} \$\{isUpdated\}\s+StrCpy \$startAppArgs "--updated"/);
 assert.match(read('node_modules','app-builder-lib','out','targets','nsis','NsisTarget.js'),/flags\(\[[^\]]*"updated", "force-run"/,'the setup understands --updated and --force-run');
 // the running Acira is closed by Acira itself; the template waits for it when --updated is passed instead of asking "close Acira?"
 const running=read('node_modules','app-builder-lib','templates','nsis','include','allowOnlyOneInstallerInstance.nsh');
 assert.match(running,/\$\{if\} \$\{isUpdated\}\s+# allow app to exit without explicit kill\s+Sleep 1000\s+Goto doStopProcess/);
});

test('the reopened Acira ignores the --updated argument (no tab, no error)',()=>{
 assert.deepEqual(parseExternalURLs(['C:\\Users\\person\\AppData\\Local\\Programs\\Acira Browser\\AciraBrowser.exe','--updated']),[]);
});
