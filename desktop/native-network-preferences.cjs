const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {secureDNSChoice,configureSecureDNS}=require('./browser-services/secure-dns.cjs');
const {configureGlobalPrivacyControl}=require('./browser-services/gpc-policy.cjs');
const {configureEngineFeatures,engineFeatureStatus}=require('./browser-services/engine-features.cjs');
const defaults=()=>({gpc:false,dns:{mode:'system',servers:[]},cookies:'block'});
// `cookies` is the application-wide third-party cookie mode; files saved before it existed keep reading as the default (block).
function choice(value){const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort().join(','):'';if(!['cookies,dns,gpc','dns,gpc'].includes(keys)||typeof value.gpc!=='boolean'||value.cookies!==undefined&&!['block','allow'].includes(value.cookies))throw Error('Choose valid application network preferences.');return{gpc:value.gpc,dns:secureDNSChoice(value.dns),cookies:value.cookies??'block'};}
function createNativeNetworkPreferences({directory,app,fileSystem=fs}){
 const file=path.join(directory,'native-network-preferences.json');let saved=defaults(),error=null,early=false,ready=false;
 try{if(fileSystem.statSync(file).size>16384)throw Error();const document=JSON.parse(fileSystem.readFileSync(file,'utf8'));if(document.version!==1||Object.keys(document).sort().join(',')!=='choice,version')throw Error();saved=choice(document.choice);}catch(reason){if(reason.code!=='ENOENT')error='Saved network preferences could not be read. Save a reviewed choice below and restart Acira before browsing.';}
 const current=structuredClone(saved),initialError=error;
 function status(){return{saved:structuredClone(saved),current:structuredClone(current),restartRequired:!!initialError||JSON.stringify(saved)!==JSON.stringify(current),ready:early&&ready&&!error,error,scope:'application',engine:early?engineFeatureStatus(app):null};}
 return{
  early(){if(early)return status();try{configureGlobalPrivacyControl({app,enabled:current.gpc});configureEngineFeatures({app,thirdPartyCookies:current.cookies});early=true;}catch{error='The current runtime could not apply startup privacy features. Review the settings and restart Acira.';}return status();},
  ready(){if(ready)return status();try{configureSecureDNS({app,choice:current.dns});ready=true;}catch{error='Secure DNS could not be applied. Review the setting and restart Acira before browsing.';}return status();},
  assertReady(){if(!early||!ready||error)throw Error(error||'Native network settings are not ready.');},
  status,
  isReady:()=>early&&ready&&!error,
  save(value){const checked=choice(value);if(value.cookies===undefined)checked.cookies=saved.cookies;const temp=file+'.'+randomUUID()+'.tmp';try{fileSystem.mkdirSync(directory,{recursive:true});fileSystem.writeFileSync(temp,JSON.stringify({version:1,choice:checked}),{encoding:'utf8',flag:'wx',mode:0o600});fileSystem.renameSync(temp,file);}catch{throw Error('Network preferences could not be saved. Check that Acira can write to its profile and try again.');}finally{try{fileSystem.unlinkSync(temp);}catch{}}saved=checked;return status();}
 };
}
module.exports={createNativeNetworkPreferences,choice};
