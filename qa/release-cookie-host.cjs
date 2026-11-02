'use strict';
const {app,BrowserWindow,session,safeStorage}=require('electron'),path=require('node:path'),fs=require('node:fs');
const {createSessionCookieRestore}=require('../desktop/browser-services/session-cookie-restore.cjs'),{createSessionShutdown}=require('../desktop/session-durability.cjs');
if(!process.env.ACIRA_RELEASE_COOKIE_DATA)throw new Error('Disposable profile required');app.setPath('userData',process.env.ACIRA_RELEASE_COOKIE_DATA);app.setName('Acira isolated session restore');let restorer,ses;
app.whenReady().then(async()=>{
 const profileId=process.env.ACIRA_RELEASE_COOKIE_PROFILE||'A',partition='persist:restore-'+profileId;ses=session.fromPartition(partition);
 ses.setCertificateVerifyProc((request,callback)=>callback(/^(?:[a-z]+\.)+restore-[abc]\.test$/.test(request.hostname)?0:-3));
 const faults={mode:null},protectedStorage={isEncryptionAvailable:()=>faults.mode!=='unavailable'&&safeStorage.isEncryptionAvailable(),encryptString(text){if(faults.mode==='encryption')throw new Error('Controlled native encryption failure');return safeStorage.encryptString(text);},decryptString:bytes=>safeStorage.decryptString(bytes)},io={...fs,openSync(file,...args){if(faults.mode==='write'&&String(file).endsWith('.tmp'))throw Object.assign(new Error('Controlled native write failure'),{code:'EACCES'});return fs.openSync(file,...args);},renameSync(...args){if(faults.mode==='rename')throw Object.assign(new Error('Controlled native rename failure'),{code:'EPERM'});return fs.renameSync(...args);}};
 restorer=createSessionCookieRestore({directory:path.join(app.getPath('userData'),'session-cookies'),safeStorage:protectedStorage,fileSystem:io,onError:message=>console.warn(message)});const supported=await restorer.attach({session:ses,profileId,partition});
 const window=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});globalThis.sessionRestoreFixture={restorer,ses,window,supported,profileId,faults};await window.loadURL('about:blank');
});
app.on('window-all-closed',()=>app.quit());app.on('will-quit',createSessionShutdown({getSessions:()=>ses?[ses]:[],beforeFlush:()=>restorer?.flush(),quit:()=>app.quit()}));
