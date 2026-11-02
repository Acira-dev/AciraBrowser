'use strict';
// ECS installs/updates Google's CDM itself. Credentials are build-time only;
// neither a signing account nor a bundled CDM is shipped to browser users.
let state={status:'unavailable',version:null};
function componentState(components){
 const values=Object.values(components.status());
 const cdm=values.find(item=>item.title==='Widevine Content Decryption Module');
 return cdm?.version?{status:'ready',version:cdm.version}:{status:'unavailable',version:null};
}
async function prepareWidevine({components,platform=process.platform,timeoutMs=20000,log=()=>{}}={}){
 // The qualified Mac runtime is independent of the existing Windows runtime.
 if(platform!=='darwin'||!components?.whenReady)return {status:'unavailable',version:null};
 state={status:'installing',version:null};
 let timer;
 const installation=Promise.resolve().then(()=>components.whenReady()).then(()=>{
  state=componentState(components);return {...state};
 },error=>{state={status:'unavailable',version:null};log('Protected playback component unavailable:',error?.message||'Download failed');return {...state};});
 try{return await Promise.race([installation,new Promise(resolve=>{timer=setTimeout(()=>resolve({...state}),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
function widevineStatus(){return {...state};}
module.exports={prepareWidevine,widevineStatus};
