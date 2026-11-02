'use strict';
const {app,BrowserWindow,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),{createEncryptionBootstrap}=require('../desktop/browser-services/encryption-bootstrap.cjs');
app.setPath('userData',process.env.ACIRA_SERVICES_DATA);if(process.env.ACIRA_SESSION_DATA)app.setPath('sessionData',process.env.ACIRA_SESSION_DATA);app.setName('Acira isolated native key bootstrap');
const nonce=process.env.ACIRA_KEY_NONCE,marker='Acira nonsecret native crash key probe';
app.whenReady().then(async()=>{
 const bootstrap=createEncryptionBootstrap({app,safeStorage}),state=bootstrap.prepare(),record={pid:process.pid,nonce,...state,splitDataPaths:app.getPath('sessionData')!==app.getPath('userData'),preservedArgument:process.argv.includes('--probe-url=http://fixture.invalid/after-start')};
 fs.appendFileSync(path.join(app.getPath('userData'),'key-phases.jsonl'),JSON.stringify(record)+'\n');
 if(!state.ready){if(state.relaunchRequired){bootstrap.restart();return;}fs.writeFileSync(path.join(app.getPath('userData'),'key-failed.json'),JSON.stringify(record));app.exit(1);return;}
 if(process.argv.includes('--verify-key-probe')){const verified=safeStorage.decryptString(fs.readFileSync(path.join(app.getPath('userData'),'key-probe.bin')))===marker;fs.writeFileSync(path.join(app.getPath('userData'),'key-verified.json'),JSON.stringify({...record,verified}));app.quit();return;}
 fs.writeFileSync(path.join(app.getPath('userData'),'key-probe.bin'),safeStorage.encryptString(marker));const descriptor=fs.openSync(path.join(app.getPath('userData'),'key-probe.bin'),'r+');fs.fsyncSync(descriptor);fs.closeSync(descriptor);
 const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});await window.loadURL('about:blank');fs.writeFileSync(path.join(app.getPath('userData'),'key-ready.json'),JSON.stringify({...record,allWindowsHidden:BrowserWindow.getAllWindows().every(window=>!window.isVisible())}));
}).catch(error=>{fs.writeFileSync(path.join(app.getPath('userData'),'key-failed.json'),JSON.stringify({nonce,error:error.message}));app.exit(1);});app.on('window-all-closed',()=>app.quit());
