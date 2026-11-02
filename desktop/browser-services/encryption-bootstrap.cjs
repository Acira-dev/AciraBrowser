'use strict';
const fs=require('node:fs'),path=require('node:path');
const FLAG='--acira-native-key-bootstrap=1',MARKER='Acira nonsecret native encryption key initialization';
function createEncryptionBootstrap({app,safeStorage,platform=process.platform,argv=process.argv,fileSystem=fs}){
 let prepared=false,restarted=false;
 function prepare(){
  if(platform!=='win32')return {ready:true,required:false,platform,scope:'This check qualifies Windows native key durability only.'};
  if(!app.isReady())throw new Error('Native encryption bootstrap runs after app readiness and before website sessions.');
  if(!safeStorage.isEncryptionAvailable())return {ready:false,relaunchRequired:false,error:'Secure native website-session storage is unavailable.'};
  let saved=false;
  try{
   const file=path.join(app.getPath('sessionData'),'Local State');if(fileSystem.statSync(file).size>4*1024*1024)throw new Error('Native encryption preferences exceed the safe bound.');
   const key=JSON.parse(fileSystem.readFileSync(file,'utf8')).os_crypt?.encrypted_key;
   saved=typeof key==='string'&&key.length<4096&&/^[A-Za-z0-9+/]+={0,2}$/.test(key)&&Buffer.from(key,'base64').subarray(0,5).toString()==='DPAPI';
  }catch(error){if(error.code!=='ENOENT')return {ready:false,relaunchRequired:false,error:'The persisted native encryption-key metadata could not be verified.'};}
  if(saved)return {ready:true,required:true,platform,scope:'Native Windows key metadata is present on disk before website sessions.'};
  if(argv.includes(FLAG))return {ready:false,relaunchRequired:false,error:'Native encryption-key initialization did not persist after its first restart. Browsing must wait for recovery.'};
  safeStorage.encryptString(MARKER);prepared=true;
  return {ready:false,relaunchRequired:true,reason:'Commit the first native Windows encryption key through normal shutdown before accepting website sessions.'};
 }
 function restart(){
  if(!prepared||restarted)throw new Error('No pending native encryption bootstrap restart.');restarted=true;
  app.relaunch({args:[...argv.slice(1).filter(value=>value!==FLAG),FLAG]});app.quit();return {restarting:true};
 }
 return {prepare,restart};
}
module.exports={createEncryptionBootstrap,FLAG};
