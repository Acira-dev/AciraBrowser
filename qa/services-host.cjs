'use strict';
const {app,BrowserWindow,clipboard}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {createContextCommands}=require('../desktop/browser-services/context-commands.cjs'),{createDownloads}=require('../desktop/downloads.cjs');
const root=process.env.ACIRA_SERVICES_DATA;app.setPath('userData',root);app.setName('Acira isolated services qualification');
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,webPreferences:{partition:'persist:services-fixture',sandbox:true,contextIsolation:true,nodeIntegration:false}}),wc=window.webContents,records=[];try{records.push(...JSON.parse(fs.readFileSync(path.join(root,'records.json'),'utf8')));}catch{}
 const calls=[],toasts=[],owner={profileId:'profile-fixture',tabId:'tab-fixture',window,record:value=>{const old=records.find(r=>r.id===value.id);if(old)Object.assign(old,value);else records.push(value);fs.writeFileSync(path.join(root,'records.json'),JSON.stringify(records));},toast:value=>toasts.push(value)};
 const downloads=createDownloads({app,shell:{showItemInFolder:p=>calls.push(['show',p]),openPath:async p=>{calls.push(['open',p]);return '';}},getOwner:contents=>contents===wc?owner:null,dialog:{showSaveDialog:async()=>({filePath:path.join(root,'payload.bin')}),showMessageBox:async()=>({response:1})}});downloads.attach(wc.session);
 const context=createContextCommands({getContext:contents=>contents===wc?{...owner,searchEngine:'duckduckgo'}:null,clipboard,openTab:details=>calls.push(['tab',details]),openWindow:details=>calls.push(['window',details]),command:details=>calls.push(['command',details]),notify:message=>toasts.push(message)});
 wc.on('context-menu',(_event,params)=>{global.servicesFixture.params=params;global.servicesFixture.items=context.build(wc,params);});
 global.servicesFixture={wc,window,downloads,records,calls,toasts,owner,items:[],params:null,downloadEvents:[]};
 wc.session.on('will-download',(_e,item,source)=>{global.servicesFixture.item=item;global.servicesFixture.downloadEvents.push({event:'will-download',source:!!source,state:item.getState()});item.on('updated',(_e,state)=>global.servicesFixture.downloadEvents.push({event:'updated',state,paused:item.isPaused(),resumable:item.canResume()}));item.on('done',(_e,state)=>global.servicesFixture.downloadEvents.push({event:'done',state}));});
 await wc.loadURL(process.env.ACIRA_SERVICES_URL);
});
app.on('window-all-closed',()=>app.quit());
