'use strict';
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),{SOURCES}=require('../desktop/browser-services/filter-updates.cjs'),{createContentBlocking}=require('../desktop/content-blocking.cjs'),{downloadList}=require('../desktop/browser-services/public-list-download.cjs');
app.setPath('userData',process.env.ACIRA_SERVICES_DATA);app.setName('Acira isolated filter refresh qualification');
app.whenReady().then(async()=>{const directory=path.join(app.getPath('userData'),'baseline');fs.mkdirSync(directory,{recursive:true});const text=(s,rule)=>'! Title: '+s.title+'\n'+'! native filter-update fixture padding\n'.repeat(40)+rule+'\n';for(const s of SOURCES)fs.writeFileSync(path.join(directory,s.id),text(s,'/old-blocked.js$script'));
 let mode='next';const options={filtersPath:directory,cachePath:path.join(app.getPath('userData'),'filter-cache')};if(process.env.ACIRA_FILTER_PUBLIC!=='1')options.download=async url=>{if(mode==='offline')throw new Error('Fixture offline');return text(SOURCES.find(s=>s.url===url),'/new-blocked.js$script');};
 const window=new BrowserWindow({show:false,webPreferences:{partition:'persist:filter-update-fixture',sandbox:true,contextIsolation:true,nodeIntegration:false}}),wc=window.webContents,blocker=createContentBlocking({ipcMain,database:{policy:()=>null,policies:()=>[],setPolicy(){}},getOwner:contents=>contents===wc?{profileId:'A'}:null,filtersPath:directory,cachePath:options.cachePath,filterListOptions:options});blocker.attach(wc.session,'A',false);const updater=blocker.filterLists;
 // Only the disposable transport server's literal loopback certificate is trusted.
 wc.session.setCertificateVerifyProc((details,callback)=>callback(details.hostname==='127.0.0.1'?0:-3));
 global.filterUpdateFixture={updater,wc,window,downloadList,setMode:value=>mode=value};await wc.loadURL('about:blank');
});app.on('window-all-closed',()=>app.quit());
