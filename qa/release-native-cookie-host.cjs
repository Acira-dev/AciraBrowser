'use strict';
const {app,BrowserWindow,BaseWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const data=path.resolve(process.env.ACIRA_NATIVE_COOKIE_DATA||''),output=path.resolve(process.env.ACIRA_NATIVE_COOKIE_REPORT||''),port=Number(process.env.ACIRA_NATIVE_COOKIE_PORT),phase=process.env.ACIRA_NATIVE_COOKIE_PHASE||'initial';
if(!data.startsWith(path.resolve('.qa-profiles')+path.sep)||!/^release-native-cookie-\d+\/(baseline|force)$/.test(path.relative(path.resolve('.qa-profiles'),data).replaceAll('\\','/'))||!output.startsWith(path.resolve('qa/artifacts')+path.sep)||!Number.isInteger(port)||port<1024||port>65535||!['initial','restart'].includes(phase))throw new Error('Owned bare cookie fixture required');
app.setName('Acira bare native cookie workers');app.setPath('userData',data);app.setPath('sessionData',data);
const exceptionOnly=process.env.ACIRA_NATIVE_COOKIE_SCOPE==='storage-access';
const report={schema:1,phase,scope:exceptionOnly?'storage-access':'full',observations:[],permissionEvents:[],permissionChecks:[],limitations:['Bare hidden native engine capability fixture. No production setting, user profile, provider consent, private teardown or complete exception semantics are established.','TLS trust only for two loopback-mapped fixture hosts. No Playwright loader, remote debugging port, inspector or Network cookie-control command is used.']};
const top='https://first.native-a.test:'+port,third='https://third.native-b.test:'+port,windows=[],grants=new Set();let permitStorage=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),withTimeout=(promise,label,ms=12000)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timed out')),ms))]);
const ordinary=value=>/(?:^|;\s*)(?:ordinary|httponly|new_response|new_js)=/.test(value||'');
function make(profile,privateMode=false){
 const window=new BrowserWindow({show:false,focusable:false,autoHideMenuBar:true,webPreferences:{partition:privateMode?'native-private-'+profile:'persist:native-'+profile,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}}),wc=window.webContents;windows.push(window);
 wc.session.setCertificateVerifyProc((details,callback)=>callback(['first.native-a.test','third.native-b.test'].includes(details.hostname)?0:-3));
 wc.session.setPermissionCheckHandler((_wc,permission,origin,details)=>{let normalized;try{normalized=new URL(origin).origin;}catch{}const allowed=permission==='storage-access'&&grants.has(profile+'|'+normalized);if(permission==='storage-access')report.permissionChecks.push({profile,permission,origin,normalized,embeddingOrigin:details.embeddingOrigin,allowed});return allowed;});
 wc.session.setPermissionRequestHandler((source,permission,callback,details)=>{const origin=details.requestingUrl?new URL(details.requestingUrl).origin:third;const allowed=permitStorage&&profile==='A'&&permission==='storage-access'&&origin===third;report.permissionEvents.push({profile,permission,origin,allowed});if(allowed)grants.add(profile+'|'+origin);callback(allowed);});
 wc.setWindowOpenHandler(details=>details.url.startsWith(top+'/')?{action:'allow',overrideBrowserWindowOptions:{show:false,focusable:false,webPreferences:{session:wc.session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}}}:{action:'deny'});
 return {window,wc,profile,privateMode};
}
async function load(fixture,name){await fixture.wc.loadURL(top+'/'+name);const deadline=Date.now()+30000;let result;while(Date.now()<deadline){result=await fixture.wc.executeJavaScript('window.cookieResult');if(result)break;await pause(30);}if(!result)throw new Error('Worker result missing: '+name);
 const firstParty=await fixture.wc.executeJavaScript('document.cookie'),saved=await fixture.wc.session.cookies.get({url:third});
 const entry={phase:name,profile:fixture.profile,privateMode:fixture.privateMode,debuggerAttached:fixture.wc.debugger.isAttached(),frameHttpBlocked:!ordinary(result.frameHeader),frameDomBlocked:!ordinary(result.documentCookie),chipsInFrame:/chips=partitioned/.test(result.documentCookie),firstPartyPreserved:/login=firstparty/.test(firstParty),workers:Object.fromEntries(Object.entries(result.workers).map(([type,value])=>[type,{available:typeof value.header==='string',ordinaryBlocked:typeof value.header==='string'?!ordinary(value.header):null,chips:typeof value.header==='string'?/chips=partitioned/.test(value.header):null,error:value.error,scriptURL:value.scriptURL}])),seedCookiesStillStored:saved.filter(cookie=>['ordinary','httponly'].includes(cookie.name)).length};report.observations.push(entry);return entry;
}
async function firstParty(fixture){await fixture.wc.loadURL(third+'/firstparty');return fixture.wc.executeJavaScript('({header:window.firstPartyHeader,cookie:document.cookie})');}
app.whenReady().then(async()=>{
 try{
  report.runtime={electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node};report.features={enabled:app.commandLine.getSwitchValue('enable-features'),disabled:app.commandLine.getSwitchValue('disable-features'),phaseoutSwitch:app.commandLine.hasSwitch('test-third-party-cookie-phaseout'),remoteDebugging:app.commandLine.hasSwitch('remote-debugging-port'),inspect:process.execArgv.some(arg=>arg.startsWith('--inspect'))};report.loadedAutomation=Object.keys(require.cache).some(file=>file.includes('playwright-core'));report.paths={userData:app.getPath('userData'),sessionData:app.getPath('sessionData')};
  const a=make('A');
  if(phase==='initial'){
   await a.wc.loadURL(third+'/seed?profile=A');if(!exceptionOnly){await load(a,'initial-workers');
   await withTimeout(new Promise(resolve=>{a.wc.once('render-process-gone',(_event,details)=>resolve(details.reason));a.wc.forcefullyCrashRenderer();}),'Owned renderer crash');await load(a,'renderer-recovery-workers');
   const opened=new Promise(resolve=>a.wc.once('did-create-window',popup=>resolve(popup)));await a.wc.executeJavaScript('void window.open('+JSON.stringify(top+'/popup-workers')+')',true);const popup=await withTimeout(opened,'Native hidden popup');windows.push(popup);await load({window:popup,wc:popup.webContents,profile:'A-popup',privateMode:false},'new-popup-workers');popup.destroy();
   report.firstPartyA=await firstParty(a);
   const b=make('B');report.profileBBeforeSeed=(await b.wc.session.cookies.get({url:third})).length;await b.wc.loadURL(third+'/seed?profile=B');await load(b,'profile-b-workers');report.firstPartyB=await firstParty(b);
   const privateFixture=make('private',true);report.privateBeforeSeed=(await privateFixture.wc.session.cookies.get({url:third})).length;await privateFixture.wc.loadURL(third+'/seed?profile=private');await load(privateFixture,'private-workers');
   }await load(a,'before-storage-access');permitStorage=true;
   const frame=a.wc.mainFrame.frames.find(frame=>frame.url.startsWith(third+'/embed'));
   if(!frame)throw new Error('Actual cross-site child frame missing');
   report.storageAccessBefore=await frame.executeJavaScript('document.hasStorageAccess()');
   try{report.storageAccess=await withTimeout(frame.executeJavaScript("document.requestStorageAccess().then(async()=>({granted:true,hasAccess:await document.hasStorageAccess(),header:await fetch('/echo',{credentials:'include',cache:'no-store'}).then(r=>r.text()),cookie:document.cookie})).catch(error=>({granted:false,error:String(error)}))",true),'Native storage-access request');}catch(error){report.storageAccess={granted:false,error:error.message};}
  }else{
   report.profileAStoredBeforeRestart=(await a.wc.session.cookies.get({url:third})).filter(cookie=>['ordinary','httponly'].includes(cookie.name)).length;await load(a,'process-restart-workers');report.firstPartyA=await firstParty(a);
  }
  report.hidden=BaseWindow.getAllWindows().every(window=>!window.isVisible());report.status='OBSERVED';
 }catch(error){report.status='FIXTURE_FAILED';report.error=String(error.stack||error);}
 finally{fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');for(const window of windows)if(!window.isDestroyed())window.destroy();app.quit();}
});
