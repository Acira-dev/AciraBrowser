'use strict';
const {app,BrowserWindow}=require('electron'),path=require('node:path');
const data=path.resolve(process.env.ACIRA_RELEASE_POLICY_DATA||'');
if(!data.startsWith(path.resolve('.qa-profiles')+path.sep)||!path.basename(data).startsWith('release-cookie-policy-'))throw new Error('Disposable release cookie-policy profile required');
app.setPath('userData',data);app.setName('Acira isolated cookie-policy qualification');
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,focusable:false,webPreferences:{partition:'persist:release-policy',sandbox:true,contextIsolation:true,nodeIntegration:false}}),wc=window.webContents;
 wc.session.setCertificateVerifyProc((details,callback)=>callback(['first.policy-a.test','third.policy-b.test'].includes(details.hostname)?0:-3));
 globalThis.releaseCookiePolicy={window,wc,detachEvents:[]};wc.debugger.on('detach',(_event,reason)=>globalThis.releaseCookiePolicy.detachEvents.push(reason));await wc.loadURL('about:blank');
});
app.on('window-all-closed',()=>app.quit());
