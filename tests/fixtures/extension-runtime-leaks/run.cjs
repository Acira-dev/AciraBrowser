'use strict';
// Real Electron: Acira's extension manager with profiles that come and go, and website tabs that come and go in one window.
//  - 15 profiles get an extension runtime (as the toolbar gives every ready profile) and are then removed (disposeProfileRuntime): the app's
//    web-contents-created, powerMonitor lock/unlock and screen display listeners return to where they started.
//  - A website tab opens in a window that has none and closes, 30 times: the window keeps the same focus/resized/closed listener counts and
//    the engine announces it once (windows.onCreated).
//  - One page is detached and attached again 30 times (a close cancelled by "Leave site?"): its 'did-start-navigation' count stays put and the
//    store still sees it come back.
//  - A page whose renderer has gone is reloaded, then sent to a new address: neither throws, nothing is uncaught, and the page loads.
// Prints one line: RESULT <json>. Run by tests/extension-runtime-leaks.test.cjs (also: electron --use-mock-keychain tests/fixtures/extension-runtime-leaks/run.cjs).
const {app,BrowserWindow,WebContentsView,session,powerMonitor,screen}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..','..','..');
const data=fs.mkdtempSync(path.join(process.env.ACIRA_BROWSER_TEST_DATA||os.tmpdir(),'ext-runtime-leaks-'));
app.setPath('userData',data);app.setName('Acira extension runtime leaks qualification');
const {createExtensionManager,disposeProfileRuntime}=require(path.join(root,'desktop','extensions.cjs'));
const warnings=[];process.on('warning',warning=>warnings.push(String(warning.name)+': '+String(warning.message)));
const counts=()=>({created:app.listenerCount('web-contents-created'),lock:powerMonitor.listenerCount('lock-screen'),unlock:powerMonitor.listenerCount('unlock-screen'),
 displayAdded:screen.listenerCount('display-added'),displayRemoved:screen.listenerCount('display-removed'),displayChanged:screen.listenerCount('display-metrics-changed')});
const out={data};
const timer=setTimeout(()=>{console.log('RESULT '+JSON.stringify({...out,error:'timed out'}));app.exit(3);},90000);
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
app.whenReady().then(async()=>{
 let window=null;
 try{
  const profiles=[{id:'base',name:'Base',partition:'persist:ext-leaks-base'}];
  // an MV3 extension with a service worker, loaded into the first profile that comes and goes
  let folder=path.join(data,'unpacked');fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({name:'Acira leak fixture',version:'1.0.0',manifest_version:3,background:{service_worker:'worker.js'}}));
  fs.writeFileSync(path.join(folder,'worker.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
  window=new BrowserWindow({show:false});
  const manager=createExtensionManager({getSession:p=>session.fromPartition(p),getProfiles:()=>profiles,getWindow:()=>window,registryPath:path.join(data,'extensions.json'),
   dialog:{showOpenDialog:async()=>folder?{canceled:false,filePaths:[folder]}:{canceled:true,filePaths:[]},showMessageBox:async()=>({response:folder?1:0})},
   browser:{createTab:async()=>{throw new Error('not in this fixture');},selectTab:()=>{},removeTab:()=>{}}});
  manager.list('base');
  const shared=()=>({focus:window.listenerCount('focus'),resized:window.listenerCount('resized'),closed:window.listenerCount('closed'),blur:window.listenerCount('blur')});
  out.start=counts();out.sharedWindowStart=shared();
  out.disposed=0;
  for(let i=0;i<15;i++){
   const profile={id:'p'+i,name:'P'+i,partition:'persist:ext-leaks-'+i};profiles.push(profile);manager.list(profile.id);
   // the profile's page shows in the window every profile shares, then the profile is removed (its pages close first)
   const view=new WebContentsView({webPreferences:{partition:profile.partition}});window.contentView.addChildView(view);manager.attachTab(view.webContents,window);
   if(i===0){
    out.withOneMore=counts();out.sharedWindowWithOne=shared();
    const loaded=await manager.command({type:'load',profileId:profile.id});folder=null;if(loaded.error)throw new Error('load: '+loaded.error);
    const ses=session.fromPartition(profile.partition),id=loaded.extensions[0].id,running=()=>Object.values(ses.serviceWorkers.getAllRunning()).some(info=>String(info.scope).startsWith(`chrome-extension://${id}/`));
    for(let n=0;n<100&&!running();n++)await new Promise(resolve=>setTimeout(resolve,50));
    out.extension={loaded:ses.extensions.getAllExtensions().length,workerRan:running()};
    out.extensionSession=profile.partition;out.extensionRunning=running;
   }
   manager.removeTab(view.webContents);window.contentView.removeChildView(view);view.webContents.close();await tick();
   profiles.splice(profiles.indexOf(profile),1);
   if(disposeProfileRuntime(session.fromPartition(profile.partition)))out.disposed++;
  }
  out.afterProfiles=counts();out.sharedWindowAfter=shared();
  {const running=out.extensionRunning;delete out.extensionRunning;for(let n=0;n<100&&running();n++)await new Promise(resolve=>setTimeout(resolve,50));
   out.extension.afterRemoval={loaded:session.fromPartition(out.extensionSession).extensions.getAllExtensions().length,workerRunning:running()};}
  out.disposedTwice=disposeProfileRuntime(session.fromPartition('persist:ext-leaks-0'));
  out.baseStillListed=manager.list('base').supported;

  const ses=session.fromPartition(profiles[0].partition),runtime=require('electron-chrome-extensions').ElectronChromeExtensions.fromSession(ses),store=runtime.ctx.store;
  const windowsApi=runtime.api.windows,onCreated=windowsApi.onCreated;let created=0;windowsApi.onCreated=function(...args){created++;return onCreated.apply(this,args);};
  const listeners=()=>({focus:window.listenerCount('focus'),resized:window.listenerCount('resized'),closed:window.listenerCount('closed')});
  const open=()=>{const view=new WebContentsView({webPreferences:{partition:profiles[0].partition}});window.contentView.addChildView(view);manager.attachTab(view.webContents,window);return view;};
  const close=async view=>{manager.removeTab(view.webContents);window.contentView.removeChildView(view);view.webContents.close();await tick();};
  out.windowBefore=listeners();
  await close(open());
  out.windowAfterOne=listeners();
  out.windowKnown=0;
  for(let i=0;i<30;i++){const view=open();if(store.windows.has(window))out.windowKnown++;await close(view);}
  out.windowAfter30=listeners();out.windowCreated=created;

  const kept=open(),wc=kept.webContents;let added=0;store.on('tab-added',()=>added++);
  out.pageBefore=wc.listenerCount('did-start-navigation');
  for(let i=0;i<30;i++){manager.removeTab(wc);manager.attachTab(wc,window);}
  out.pageAfter30=wc.listenerCount('did-start-navigation');out.tabAddedEvents=added;out.tabBack=store.tabs.has(wc);
  await close(kept);

  // A page whose renderer has gone (a crash, or page-hang.cjs ending a page that stopped answering), then Reload or a new address: the
  // engine's webNavigation listener read the disposed frame and threw out of reload() / loadURL() (13.7 soak, 11 Nov).
  const uncaught=[],onUncaught=error=>uncaught.push(String(error&&error.message||error));process.on('uncaughtException',onUncaught);
  const sad=open(),swc=sad.webContents,page=title=>'data:text/html,<title>'+title+'</title>'+title;
  const finished=()=>new Promise(resolve=>{const t=setTimeout(()=>resolve(false),15000);swc.once('did-finish-load',()=>{clearTimeout(t);resolve(true);});});
  const crash=()=>new Promise(resolve=>{const frame=swc.mainFrame;void frame.executeJavaScript('0').catch(()=>{});/* page-hang.cjs holds the frame like this before it ends the page */swc.once('render-process-gone',()=>setTimeout(resolve,0));swc.forcefullyCrashRenderer();});
  const attempt=async run=>{await crash();const crashed=swc.isCrashed(),loaded=finished();let threw=null;try{const value=run();if(value&&typeof value.catch==='function')value.catch(()=>{});}catch(error){threw=String(error&&error.message||error);}
   return {crashed,threw,loaded:await loaded,title:swc.getTitle(),crashedAfter:swc.isCrashed()};};
  await swc.loadURL(page('first'));
  out.crashedTab={reload:await attempt(()=>swc.reload()),address:await attempt(()=>swc.loadURL(page('second')))};
  await new Promise(resolve=>setTimeout(resolve,200));process.removeListener('uncaughtException',onUncaught);out.crashedTab.uncaught=uncaught;
  await close(sad);
 }catch(error){out.error=String(error&&error.stack||error);}
 finally{clearTimeout(timer);out.warnings=warnings.filter(text=>/MaxListeners/.test(text));console.log('RESULT '+JSON.stringify(out));try{window?.destroy();}catch{}app.exit(0);}
});
