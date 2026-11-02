'use strict';
const {app,BrowserWindow,session}=require('electron'),{createReader}=require('../desktop/browser-services/reader.cjs');
app.setPath('userData',process.env.ACIRA_SERVICES_DATA);app.setName('Acira isolated local Reader qualification');
app.whenReady().then(async()=>{const owners=new Map(),windows=[];const reader=createReader({getContext:wc=>owners.get(wc.id)});
 function make(profileId='A',privateMode=false){const window=new BrowserWindow({show:false,webPreferences:{session:session.fromPartition(privateMode?'reader-private':'persist:reader-'+profileId),sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.push(window);const wc=window.webContents;owners.set(wc.id,{profileId,tabId:String(wc.id),privateMode});wc.once('destroyed',()=>owners.delete(wc.id));return wc;}
 global.readerFixture={reader,make,wc:make()};await global.readerFixture.wc.loadURL('about:blank');
});app.on('window-all-closed',()=>app.quit());
