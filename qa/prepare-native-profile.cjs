'use strict';
const{app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const{createEncryptionBootstrap}=require('../desktop/browser-services/encryption-bootstrap.cjs');
const profile=process.env.ACIRA_PREPARE_PROFILE,nonce=process.env.ACIRA_PREPARE_NONCE;
if(process.env.ACIRA_QA_MOCK_KEYCHAIN==='1')app.commandLine.appendSwitch('use-mock-keychain'); // a rig that must never reach the macOS Keychain (qa/mac-update-delivery.mjs) opts in; everything else is unchanged
app.setName('Acira Browser');app.setPath('userData',profile);const primary=app.requestSingleInstanceLock();if(!primary)app.quit();
app.whenReady().then(()=>{if(!primary)return;const bootstrap=createEncryptionBootstrap({app,safeStorage}),state=bootstrap.prepare();if(!state.ready&&state.relaunchRequired){bootstrap.restart();return;}fs.writeFileSync(path.join(profile,'native-key-'+nonce+'.json'),JSON.stringify({nonce,pid:process.pid,ready:state.ready,error:state.error,executable:process.execPath,electron:process.versions.electron}));app.quit();}).catch(()=>{fs.writeFileSync(path.join(profile,'native-key-'+nonce+'.json'),JSON.stringify({nonce,ready:false,error:'Native fixture key preparation failed.'}));app.quit();});
setTimeout(()=>app.quit(),20000).unref();
