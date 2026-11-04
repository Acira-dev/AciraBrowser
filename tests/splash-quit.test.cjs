'use strict';
// intel-quit: the launch splash is a window the person cannot close (closable:false), and Electron calls off an app quit when it reaches a
// window that cannot close. A quit while the splash was up (the installer's --acira-installer-quit, Quit, Install now) closed the browser
// window and Acira kept running with no window: on a Mac for good, on Windows until the splash's own 20 s timer. Seen on the Intel build
// through Rosetta, where the first start keeps the splash up for seconds. The quit now takes the splash down first (main.cjs beginQuit).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

/** main.cjs's own code from `start` to the brace that closes its first block (closeSplash, beginQuit), so the test runs what Acira runs. */
function take(start){
 const at=main.indexOf(start);assert.ok(at>=0,'main.cjs has '+start);
 let depth=0;for(let i=main.indexOf('{',at);i<main.length;i++){if(main[i]==='{')depth++;else if(main[i]==='}'&&--depth===0)return main.slice(at,i+1);}
 throw new Error('unbalanced '+start);
}

/** Runs a real Electron main process with a splash made as main.cjs makes it and main.cjs's closeSplash and beginQuit on before-quit, quits,
 *  and reports what happened. `windows` adds Windows' window-all-closed (quit when the last window is gone); `browser` adds a browser window. */
function run(t,{browser,windows}){
 const electron=require('electron');
 if(typeof electron!=='string'||!fs.existsSync(electron)){t.skip('no Electron binary');return null;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-splash-quit-')),script=path.join(dir,'main.cjs'),out=path.join(dir,'out.json');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(script,`const {app,BrowserWindow,BaseWindow}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});
const events=[],note=name=>events.push(name);let stuck=false;
let splash=null;${take('function closeSplash(){')}
const openWindows={begin(){}},closeGuard={noteQuit(){}},controllers=new Set();let securedService=null;
${take('const beginQuit=()=>{')};
app.on('before-quit',()=>note('before-quit'));app.on('before-quit',beginQuit);
app.on('window-all-closed',()=>{note('window-all-closed');if(${!!windows})app.quit();});
/* as the session flush (session-durability.cjs): holds the first will-quit, then quits again */
let flushed=false;app.on('will-quit',event=>{note('will-quit');if(flushed)return;event.preventDefault();setTimeout(()=>{flushed=true;app.quit();},50);});
app.on('quit',()=>{note('quit');if(!stuck)fs.writeFileSync(${JSON.stringify(out)},JSON.stringify({events}));});
app.whenReady().then(()=>{
 /* as main.cjs splashWindow: a still page in a window the person cannot close */
 splash=new BrowserWindow({show:false,closable:false,webPreferences:{sandbox:true,javascript:false}});splash.loadURL('data:text/html,<body style="background:#000">').catch(()=>{});
 if(${!!browser}){const window=new BaseWindow({show:false});window.on('closed',()=>note('browser closed'));}
 setTimeout(()=>app.quit(),300);
 /* a quit that never finishes: no will-quit, and the process would run on */
 setTimeout(()=>{stuck=true;fs.writeFileSync(${JSON.stringify(out)},JSON.stringify({stuck,events,closable:BaseWindow.getAllWindows().map(w=>w.isClosable())}));app.exit(3);},8000);
});`);
 const {spawnSync}=require('node:child_process');
 const env={...process.env,HOME:dir};delete env.ELECTRON_RUN_AS_NODE;
 const result=spawnSync(electron,['--use-mock-keychain',script],{env,timeout:40000,encoding:'utf8'});
 return {status:result.status,stderr:result.stderr,...JSON.parse(fs.readFileSync(out,'utf8'))};
}

test('a quit while the splash is up ends Acira: the browser window closes and the quit is not called off by the splash',t=>{
 const result=run(t,{browser:true});if(!result)return;
 assert.equal(result.stuck,undefined,'the quit stopped at the splash: '+JSON.stringify(result));
 assert.equal(result.status,0,result.stderr);
 assert.ok(result.events.includes('browser closed'));assert.ok(result.events.includes('will-quit'));assert.equal(result.events.at(-1),'quit');
});

test('a quit while the splash is the only window ends Acira too, also with Windows\' quit-when-the-last-window-closes',t=>{
 for(const windows of [false,true]){
  const result=run(t,{browser:false,windows});if(!result)return;
  assert.equal(result.stuck,undefined,'the quit stopped at the splash: '+JSON.stringify(result));
  assert.equal(result.status,0,result.stderr);
  assert.ok(result.events.includes('will-quit'));assert.equal(result.events.at(-1),'quit');
 }
});

test('the splash goes at every quit, and a start that a quit cut short neither explains itself nor opens a splash',()=>{
 assert.match(take('const beginQuit=()=>{'),/^const beginQuit=\(\)=>\{closeSplash\(\);/,'first, before the windows are closed');
 assert.ok(main.includes("app.on('before-quit',beginQuit);"),'Quit, the installer\'s --acira-installer-quit');
 const update=main.slice(main.indexOf("autoUpdater.on('before-quit-for-update',"));assert.ok(update.slice(0,update.indexOf('\n')).includes('beginQuit();'),'Install now');
 assert.ok(main.includes("hasWindow:()=>controllers.size>0||quitting"),'createBrowserWindow throws "Acira is closing" once the quit has begun: no "Acira could not start" box');
 assert.ok(main.includes("function showSetupSplash(){const pending=setupSplash;setupSplash=null;if(!pending||splash||quitting)return;"));
});
