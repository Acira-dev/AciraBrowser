'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const{createEncryptionBootstrap}=require('./browser-services/encryption-bootstrap.cjs');
const{parseExternalURLs}=require('./accounts/external-links.cjs');
const MAX_LINKS=64,MAX_BYTES=1024*1024,MAX_AGE=15*60*1000,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Runs before sessions/controllers. Uses the existing intake as the only live
 * URL queue; its temporary sink serializes an encrypted one-time restart handoff.
 * Large valid queues never pass through Windows' bounded command line. */
function createStartupGate({app,safeStorage,links,argv=process.argv,fileSystem=fs,bootstrapFactory=createEncryptionBootstrap,now=Date.now}){
 const root=path.resolve(app.getPath('userData')),file=path.join(root,'startup-links.bin');let restarting=false,failure=null,saved=null,operation=null;const consumed=new Set();
 const valid=url=>typeof url==='string'&&url.length<=8192&&parseExternalURLs([url])[0]===url;
 function read(){
  if(!fileSystem.existsSync(file))return null;
  const stat=fileSystem.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||!stat.size||stat.size>MAX_BYTES)throw Error('Startup links could not be verified.');
  let parsed;try{parsed=JSON.parse(safeStorage.decryptString(fileSystem.readFileSync(file)));}catch{throw Error('Startup links could not be recovered securely.');}
  if(parsed?.version!==2||!UUID.test(parsed.id)||Object.keys(parsed).some(key=>!['version','id','createdAt','expiresAt','urls'].includes(key))||!Number.isSafeInteger(parsed.createdAt)||!Number.isSafeInteger(parsed.expiresAt)||parsed.expiresAt!==parsed.createdAt+MAX_AGE||!Array.isArray(parsed.urls)||parsed.urls.length>MAX_LINKS||parsed.urls.some(url=>!valid(url)))throw Error('Startup links could not be verified.');return parsed;
 }
 function write(record){
  const urls=record.urls;if(urls.length>MAX_LINKS||urls.some(url=>!valid(url)))throw Error('Too many startup links are waiting to be reopened.');
  fileSystem.mkdirSync(root,{recursive:true});const encrypted=safeStorage.encryptString(JSON.stringify(record));if(!Buffer.isBuffer(encrypted)||encrypted.length>MAX_BYTES)throw Error('Startup links could not be saved securely.');
  const temporary=path.join(root,'startup-links-'+randomUUID()+'.tmp');let handle;
  try{handle=fileSystem.openSync(temporary,'wx',0o600);fileSystem.writeFileSync(handle,encrypted);fileSystem.fsyncSync(handle);fileSystem.closeSync(handle);handle=undefined;fileSystem.renameSync(temporary,file);}finally{if(handle!==undefined)fileSystem.closeSync(handle);if(fileSystem.existsSync(temporary))fileSystem.unlinkSync(temporary);}
 }
 async function doPrepare(){
  // Original HTTP arguments move through the encrypted handoff, preserving their
  // canonical order/count once. Executable/app/engine flags stay in native argv.
  const relayArgs=argv.filter((arg,index)=>index===0||!parseExternalURLs([arg]).length);
  const bootstrap=bootstrapFactory({app,safeStorage,argv:relayArgs});
  let result;try{result=bootstrap.prepare();}catch{return{ready:false,error:'Secure website-session storage could not be initialized.'};}
  if(result.ready){
   try{const record=read();if(record){if(consumed.has(record.id)||record.expiresAt<now()||record.createdAt>now()+30000){fileSystem.unlinkSync(file);return{ready:true,discardedStartupLinks:true};}if(typeof links.restorePending!=='function')throw Error('Startup links could not be restored securely.');const count=links.restorePending(record.urls,()=>fileSystem.unlinkSync(file));if(count!==record.urls.length)throw Error('Startup links could not be restored completely.');consumed.add(record.id);}return{ready:true};}catch(error){return{ready:false,error:/^Startup links |^Too many startup links /.test(error.message)?error.message:'Startup links could not be recovered securely.'};}
  }
  if(!result.relaunchRequired)return{ready:false,error:result.error||'Secure website-session storage is unavailable.'};
  try{
   saved=read();if(saved&&(saved.expiresAt<now()||saved.createdAt>now()+30000)){fileSystem.unlinkSync(file);saved=null;}if(!saved){const createdAt=now();saved={version:2,id:randomUUID(),createdAt,expiresAt:createdAt+MAX_AGE,urls:[]};}
   await links.bind(url=>{try{const next={...saved,urls:[...saved.urls,url]};write(next);saved=next;}catch{failure='Startup links could not be preserved securely. Reopen them after restarting Acira.';throw Error(failure);}});
   if(failure)throw Error(failure);
   restarting=true;bootstrap.restart();return{ready:false,restarting:true};
  }catch(error){return{ready:false,error:failure||error.message||'Secure startup could not be completed.'};}
 }
 async function flush(){if(!restarting)return;await links.flush();if(failure)throw Error(failure);}
 function prepare(){if(!operation)operation=doPrepare().finally(()=>{operation=null;});return operation;}
 return{prepare,flush,get restarting(){return restarting;}};
}
module.exports={createStartupGate};
