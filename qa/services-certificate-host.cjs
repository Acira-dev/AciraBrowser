'use strict';
const {app,BrowserWindow}=require('electron'),{createCertificatePolicy}=require('../desktop/browser-services/certificate-policy.cjs');
app.setPath('userData',process.env.ACIRA_SERVICES_DATA);app.setName('Acira isolated certificate qualification');
const contexts=new WeakMap(),events=[];let policy;
app.on('certificate-error',(...args)=>{events.push({url:args[2],error:args[3],main:args[6]});policy.handle(...args);});
app.whenReady().then(async()=>{policy=createCertificatePolicy({getContext:wc=>contexts.get(wc),ttlMs:1500});function make(profileId='A',partition='persist:certificate-A'){const window=new BrowserWindow({show:false,webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false}}),wc=window.webContents;if(!wc.session.__certificatePipeline)wc.session.__certificatePipeline=new (require('../desktop/request-pipeline.cjs').RequestPipeline)(wc.session);policy.attach(wc.session,wc.session.__certificatePipeline);contexts.set(wc,{tabId:'tab-'+window.id,profileId,isActive:true});return wc;}
 global.certificateFixture={policy,contexts,events,make,wc:make()};await global.certificateFixture.wc.loadURL('about:blank');});
app.on('window-all-closed',()=>app.quit());
