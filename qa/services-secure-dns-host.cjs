'use strict';
const {app,BrowserWindow,session,netLog}=require('electron'),fs=require('node:fs'),path=require('node:path'),{configureSecureDNS}=require('../desktop/browser-services/secure-dns.cjs');
app.setPath('userData',process.env.ACIRA_SERVICES_DATA);app.setName('Acira isolated Secure DNS qualification');if(process.env.ACIRA_DOH_FIXTURE_SPKI)app.commandLine.appendSwitch('ignore-certificate-errors-spki-list',process.env.ACIRA_DOH_FIXTURE_SPKI);
app.whenReady().then(async()=>{
 const report={runtime:{electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node},observations:[],hidden:true};let logging=false;
 try{
  const mode=process.env.ACIRA_DOH_MODE,endpoint=`https://127.0.0.1:${process.env.ACIRA_DOH_PORT}/${mode==='failure'?'fail':'dns-query'}`+(mode==='get'?'{?dns}':'');report.config=configureSecureDNS({app,choice:{mode:'secure',servers:[endpoint]}});await netLog.startLogging(path.join(app.getPath('userData'),'native-netlog.json'),{captureMode:'default'});logging=true;
  for(const [label,partition]of [['A','persist:secure-dns-A'],['B','persist:secure-dns-B'],['private','secure-dns-private']]){
   const native=session.fromPartition(partition);await native.setProxy({mode:'direct'});const name=`${mode}-${label.toLowerCase()}-${process.env.ACIRA_DOH_NONCE}.services-doh.test`,start=Date.now();let resolution;try{resolution={ok:true,...await native.resolveHost(name,{queryType:'A',cacheUsage:'disallowed'})};}catch(error){resolution={ok:false,error:error.message};}
   let page=null;if(resolution.ok){const window=new BrowserWindow({show:false,webPreferences:{session:native,sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadURL(`http://${name}:${process.env.ACIRA_DOH_WEB_PORT}/`);page=await window.webContents.executeJavaScript('document.title');report.hidden=report.hidden&&!window.isVisible();window.destroy();}report.observations.push({label,name,resolution,page,elapsedMs:Date.now()-start});
  }
 }catch(error){report.error=error.stack;}finally{if(logging)await netLog.stopLogging();fs.writeFileSync(path.join(app.getPath('userData'),'secure-dns-native.json'),JSON.stringify(report));app.quit();}
}).catch(error=>{fs.writeFileSync(path.join(app.getPath('userData'),'secure-dns-startup-error.json'),JSON.stringify({error:error.stack}));app.exit(1);});app.on('window-all-closed',()=>{});
