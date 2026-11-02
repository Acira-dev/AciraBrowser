'use strict';
const {app,BrowserWindow}=require('electron'),path=require('node:path'),{BrowserDatabase}=require('../desktop/database.cjs'),{createProxySettings}=require('../desktop/browser-services/proxy-settings.cjs');
app.setPath('userData',process.env.ACIRA_SERVICES_DATA);app.setName('Acira isolated native proxy qualification');
app.whenReady().then(async()=>{
 const database=new BrowserDatabase(path.join(app.getPath('userData'),'proxy.sqlite')),owners=new Map();let response=1;
 const service=createProxySettings({database,getContext:wc=>owners.get(wc.id),getWindow:session=>[...owners.values()].find(owner=>owner.window.webContents.session===session)?.window,dialog:{showMessageBox:async()=>({response})}});
 async function make(profileId,privateMode=false){const window=new BrowserWindow({show:false,webPreferences:{partition:(privateMode?'':'persist:')+'services-proxy-'+profileId,sandbox:true,nodeIntegration:false,contextIsolation:true}}),wc=window.webContents;owners.set(wc.id,{profileId,privateMode,window});if(process.env.ACIRA_PROXY_TLS_FIXTURE==='1')wc.session.setCertificateVerifyProc((details,callback)=>callback(details.hostname==='proxy-secure.acira.test'?0:-3));await service.attach(wc.session,profileId,privateMode);await wc.loadURL('about:blank');return wc;}
 const wc=await make('A'),other=await make('B'),privateWC=await make('private-A',true);global.proxyFixture={database,owners,service,wc,other,privateWC,setResponse:value=>response=value};
});app.on('window-all-closed',()=>app.quit());
