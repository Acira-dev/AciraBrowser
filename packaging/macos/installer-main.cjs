'use strict';
const {app,BrowserWindow,ipcMain,Menu}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const {APP,installApplication}=require('./install-engine.cjs');const {assertApplicationStopped}=require('./running-app.cjs');const run=promisify(execFile);
const {selectLocale,text,failureKey}=require('./strings.cjs');let locale='en';const t=key=>text(locale,key);
const testRoot=process.env.ACIRA_INSTALLER_TEST_MODE==='1'&&process.env.ACIRA_INSTALLER_TEST_ROOT;
if(testRoot&&(!path.isAbsolute(testRoot)||!path.resolve(testRoot).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(testRoot).startsWith('acira-install-')))throw Error('Use an owned temporary installer test directory.');
if(testRoot)app.setPath('userData',path.join(testRoot,'installer-data'));
if(!app.requestSingleInstanceLock())app.exit(0);
const destination=path.join(testRoot||os.homedir(),'Applications',APP),page=path.join(__dirname,'installer.html');let window,controller,installing,result,closeAfter=false,firstPaint=false,artReady=false;
let state={phase:'idle',progress:0,message:t('intro'),locale,attempt:0};
function publish(next){state={...state,...next};if(window&&!window.isDestroyed())window.webContents.send('acira-installer:state',state);}
const busy=()=>!!installing;
const trusted=event=>window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame;
async function install(){if(busy())return state;controller=new AbortController();publish({phase:'checking',progress:0,message:t('checking'),attempt:state.attempt+1});
 installing=(async()=>{try{const manifest=JSON.parse(await fs.readFile(path.join(process.resourcesPath,'payload.json'),'utf8'));result=await installApplication({archive:path.join(process.resourcesPath,'payload.zip'),manifest,destination,signal:controller.signal,ensureNotRunning:assertApplicationStopped,onProgress:update=>{if(update.phase!=='done')publish({...update,message:t(({checking:'checking',installing:'copying',verifying:'verifying',committing:'finishing'})[update.phase]||'preparing')});},verifySignature:file=>run('/usr/bin/codesign',['--verify','--deep','--strict',file])});if(!testRoot)await run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',result.appPath]).catch(()=>{});publish({phase:'done',progress:1,message:t('done')});await fs.writeFile(path.join(app.getPath('userData'),'last-install.json'),JSON.stringify({...result,commit:manifest.commit,installedAt:new Date().toISOString()},null,2)).catch(()=>{});}
 catch(e){publish({phase:e.name==='AbortError'?'cancelled':'error',message:t(e.name==='AbortError'?'cancelled':failureKey(e))});}finally{installing=null;if(closeAfter)app.quit();}})();return state;}
function close(){if(busy()){closeAfter=true;if(state.phase!=='committing')controller.abort();}else app.quit();}
ipcMain.on('acira-installer:ready',event=>{if(trusted(event)){artReady=true;if(firstPaint)window.show();}});
ipcMain.handle('acira-installer:state',event=>{if(!trusted(event))throw Error('Untrusted installer request.');return state;});
ipcMain.handle('acira-installer:action',async(event,command)=>{if(!trusted(event)||!['install','cancel','open','close'].includes(command))throw Error('Invalid installer action.');if(command==='install')return install();if(command==='cancel'){if(state.phase!=='committing')controller?.abort();return state;}if(command==='close'){close();return state;}if(!result||state.phase!=='done')throw Error('Finish installing Acira first.');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_INSTALLER_TEST_MODE;delete env.ACIRA_INSTALLER_TEST_ROOT;const child=spawn(path.join(result.appPath,'Contents','MacOS','AciraBrowser'),[],{env,detached:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();app.quit();return state;});
app.whenReady().then(async()=>{
 locale=selectLocale(app.getPreferredSystemLanguages());state={...state,locale,message:t('intro')};
 await fs.mkdir(app.getPath('userData'),{recursive:true});Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Acira Installer',submenu:[{role:'about'},{type:'separator'},{label:'Quit Acira Installer',accelerator:'Cmd+Q',click:close}]},{role:'editMenu'}]));
 window=new BrowserWindow({width:560,height:340,useContentSize:true,show:false,resizable:false,maximizable:false,fullscreenable:false,title:t('install'),titleBarStyle:'hidden',trafficLightPosition:{x:12,y:12},backgroundColor:'#101012',webPreferences:{preload:path.join(__dirname,'installer-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(url!==require('node:url').pathToFileURL(page).href)event.preventDefault();});window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 window.on('close',event=>{if(busy()){event.preventDefault();close();}});window.once('ready-to-show',()=>{firstPaint=true;if(artReady)window.show();});await window.loadFile(page,{query:{theme:'dark'}});
});
app.on('before-quit',event=>{if(busy()){event.preventDefault();close();}});app.on('window-all-closed',()=>app.quit());
