'use strict';
// Visibility, bounded fixture certificate trust and observation only. The actual
// candidate main owns startup, profiles, website navigation and cookie recovery.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {app,webContents,BaseWindow,session,safeStorage}=require('electron');
const data=path.resolve(process.env.ACIRA_BROWSER_TEST_DATA||''),candidate=path.resolve(process.env.ACIRA_RELEASE_CANDIDATE||''),nonce=process.env.ACIRA_FRESH_NONCE;
if(process.env.ACIRA_BROWSER_TEST_HIDDEN!=='1'||!nonce||!data.startsWith(path.resolve('.qa-profiles')+path.sep)||!fs.existsSync(path.join(candidate,'build-identity.json')))throw Error('Owned fresh-profile fixture identity required');
app.on('web-contents-created',(_event,wc)=>wc.session.setCertificateVerifyProc((details,callback)=>callback(details.hostname==='fresh.release.test'?0:-3)));
require(path.join(candidate,'desktop/main.cjs'));
let last;
setInterval(async()=>{
 let request;try{request=JSON.parse(fs.readFileSync(path.join(data,'release-observe-request.json'),'utf8'));}catch{return;}
 if(request.nonce!==nonce||request.id===last||!app.isReady())return;last=request.id;
 try{
  const profiles=[];
  for(const profile of request.profiles||[]){
   if(typeof profile.partition!=='string'||!profile.partition.startsWith('persist:'))throw Error('Only fixture persistent profiles can be observed');
   const file=path.join(app.getPath('userData'),'session-cookies',crypto.createHash('sha256').update(profile.partition).digest('hex')+'.bin');
   let saved,error;try{const parsed=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));saved=parsed.cookies.map(cookie=>({name:cookie.name,value:cookie.value,partitioned:!!cookie.partitionKey}));}catch(failure){error=failure.code||failure.message;}
   profiles.push({id:profile.id,partition:profile.partition,saved,error,native:(await session.fromPartition(profile.partition).cookies.get({})).map(cookie=>({name:cookie.name,value:cookie.value,session:cookie.session}))});
  }
  let keyHash;try{const value=JSON.parse(fs.readFileSync(path.join(app.getPath('sessionData'),'Local State'),'utf8')).os_crypt.encrypted_key;keyHash=crypto.createHash('sha256').update(value).digest('hex');}catch{}
  const result={id:request.id,nonce,pid:process.pid,profiles,keyHash,sessionData:app.getPath('sessionData'),userData:app.getPath('userData'),windowsHidden:BaseWindow.getAllWindows().every(win=>!win.isVisible()),runtime:process.versions,disabledFeatures:app.commandLine.getSwitchValue('disable-features'),websites:webContents.getAllWebContents().filter(wc=>/^https?:/.test(wc.getURL())).map(wc=>wc.getURL())};
  fs.writeFileSync(path.join(data,'release-observe-response.json'),JSON.stringify(result));
 }catch(error){fs.writeFileSync(path.join(data,'release-observe-response.json'),JSON.stringify({id:request.id,nonce,error:error.message}));}
},25).unref();
