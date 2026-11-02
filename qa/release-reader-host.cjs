'use strict';
const {app,BrowserWindow}=require('electron'),path=require('node:path');
if(!process.env.ACIRA_RELEASE_READER_MODULE||!process.env.ACIRA_RELEASE_READER_DATA)throw new Error('Disposable module/data required');
app.setName('Acira isolated Reader asset qualification');app.setPath('userData',process.env.ACIRA_RELEASE_READER_DATA);
app.whenReady().then(async()=>{const {createReader}=require(path.resolve(process.env.ACIRA_RELEASE_READER_MODULE));const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});globalThis.releaseReaderFixture={window,reader:createReader({getContext:wc=>wc===window.webContents?{profileId:'fixture',tabId:'fixture',privateMode:false}:null})};await window.loadURL('about:blank');});
app.on('window-all-closed',()=>app.quit());
