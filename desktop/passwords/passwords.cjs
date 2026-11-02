'use strict';
// Passwords service: the trusted-UI request handler for Settings > Passwords. Secrets stay in this process: listing carries none,
// reveal returns one password after the OS gate, copy writes the clipboard here and clears it later, import keeps parsed rows in
// memory behind a one-shot token, export and delete-all are gated and confirmed. See docs/launch/PASSWORDS_SECURITY.md.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createVault,VaultError}=require('./vault.cjs');
const {displayHost,normalizeOrigin}=require('./origin-match.cjs');
const {parseLogins,exportLogins,LIMITS:CSV_LIMITS}=require('./csv.cjs');
const {assess,reuseCounts}=require('./strength.cjs');
const {generate}=require('./generator.cjs');
const {tr}=require('./text.cjs');

const ID=/^[0-9a-f]{32}$/,TOKEN=/^[0-9a-f]{32}$/;
const CLIPBOARD_CLEAR_MS=30000,IMPORT_TTL_MS=5*60000;
class RequestError extends Error{constructor(message){super(message);this.name='RequestError';}}
const bad=message=>{throw new RequestError(message);};

function createPasswords({dir,keys,gate,clipboard,confirm,pickOpen,pickSave,trash=null,now=Date.now,timers={setTimeout,clearTimeout},fsApi=fs}){
 const vault=createVault({dir,keys,now});
 const settingsFile=path.join(dir,'settings.json');
 let settings=readSettings();
 let clearTimer=null,imports=new Map();
 function readSettings(){try{const raw=JSON.parse(fsApi.readFileSync(settingsFile,'utf8'));return {enabled:raw.enabled!==false};}catch{return {enabled:true};}}
 function writeSettings(){fsApi.mkdirSync(dir,{recursive:true});fsApi.writeFileSync(settingsFile,JSON.stringify(settings));}
 const exact=(request,allowed)=>{for(const key of Object.keys(request))if(key!=='type'&&!allowed.includes(key))bad('Unexpected request field.');};
 const idOf=value=>{if(typeof value!=='string'||!ID.test(value))bad('Unknown item.');return value;};
 const row=item=>({id:item.id,origin:item.origin,host:displayHost(item.origin),username:item.username,updatedAt:item.updatedAt});
 async function gated(reason,window){
  const result=await gate.ensure(reason);
  return result.ok?null:{denied:{code:result.code||'failed',message:result.message||tr('pw.err.cantVerify','Couldn’t verify it’s you.')}};
 }
 // The clipboard is asynchronous (Electron 44: readText and writeText return promises), so both the copy and the later clear await it.
 async function copyToClipboard(value,secret){
  if(secret&&typeof clipboard.writeSecret==='function')await clipboard.writeSecret(value);else await clipboard.writeText(value);
 }
 function scheduleClipboardClear(value){
  timers.clearTimeout(clearTimer);
  clearTimer=timers.setTimeout(async()=>{clearTimer=null;try{if(await clipboard.readText()===value)await clipboard.clear();}catch{}},CLIPBOARD_CLEAR_MS);
  clearTimer?.unref?.();
 }
 function pruneImports(){for(const [token,entry] of imports)if(entry.expires<now())imports.delete(token);}
 const check=profileId=>{
  const all=vault.all(profileId),reuse=reuseCounts(all.map(item=>({id:item.id,password:item.password})));
  const flags={};let weak=0,reused=0;
  for(const item of all){const verdict=assess({password:item.password,username:item.username,origin:item.origin}),others=reuse.get(item.id)||0;if(verdict.label==='weak')weak++;if(others)reused++;if(verdict.label!=='strong'||others)flags[item.id]={strength:verdict.label,reused:others};}
  return {total:all.length,weak,reused,flags};
 };

 async function handle(request,ctx){
  if(!request||typeof request!=='object'||Array.isArray(request)||typeof request.type!=='string'||JSON.stringify(request).length>16*1024)bad('Invalid request.');
  if(ctx.privateMode)return {passwords:{private:true}};
  const profileId=ctx.profileId;
  try{
   switch(request.type){
    case 'passwords.status':exact(request,[]);return {passwords:{...vault.status(profileId),enabled:settings.enabled}};
    case 'passwords.settings':{
     exact(request,['enabled']);if(typeof request.enabled!=='boolean')bad('Choose on or off.');
     settings={enabled:request.enabled};writeSettings();return {passwords:{enabled:settings.enabled}};
    }
    case 'passwords.list':exact(request,[]);return {passwords:{items:vault.list(profileId).map(row),never:vault.never(profileId),enabled:settings.enabled}};
    case 'passwords.detail':{exact(request,['id']);const item=vault.get(profileId,idOf(request.id));return {passwords:{item:row(item),hasNote:Boolean(item.note)}};}
    case 'passwords.check':exact(request,[]);return {passwords:check(profileId)};
    case 'passwords.generate':{exact(request,['length','symbols']);return {passwords:{password:generate({length:request.length,symbols:request.symbols!==false})}};}
    case 'passwords.save':{
     exact(request,['origin','username','password','note']);
     const saved=vault.save(profileId,{origin:request.origin,username:request.username,password:request.password,note:request.note});
     return {passwords:{...saved,items:vault.list(profileId).map(row)}};
    }
    case 'passwords.reveal':{
     exact(request,['id']);const id=idOf(request.id);vault.get(profileId,id);
     const denied=await gated('reveal',ctx.window);if(denied)return {passwords:denied};
     const item=vault.get(profileId,id);return {passwords:{password:item.password,note:item.note}};
    }
    case 'passwords.copy':{
     exact(request,['id','field']);const id=idOf(request.id);if(request.field!=='password'&&request.field!=='username')bad('Choose what to copy.');
     const item=vault.get(profileId,id);
     if(request.field==='password'){const denied=await gated('copy',ctx.window);if(denied)return {passwords:denied};}
     const value=request.field==='password'?vault.get(profileId,id).password:item.username;
     try{await copyToClipboard(value,request.field==='password');}catch{return {passwords:{error:{code:'clipboard',message:tr('pw.err.cantCopy','Couldn’t copy that. Try again.')}}};}
     if(request.field==='password')scheduleClipboardClear(value);
     return {passwords:{copied:request.field,clearsInMs:request.field==='password'?CLIPBOARD_CLEAR_MS:0}};
    }
    case 'passwords.update':{
     exact(request,['id','origin','username','password','note']);const id=idOf(request.id);vault.get(profileId,id);
     const denied=await gated('edit',ctx.window);if(denied)return {passwords:denied};
     const patch={};for(const key of ['origin','username','password','note'])if(request[key]!==undefined)patch[key]=request[key];
     vault.update(profileId,id,patch);return {passwords:{items:vault.list(profileId).map(row)}};
    }
    case 'passwords.delete':{exact(request,['id']);vault.remove(profileId,idOf(request.id));return {passwords:{items:vault.list(profileId).map(row)}};}
    case 'passwords.never.remove':{exact(request,['id']);vault.removeNever(profileId,idOf(request.id));return {passwords:{never:vault.never(profileId)}};}
    case 'passwords.deleteAll':{
     exact(request,[]);
     const denied=await gated('delete',ctx.window);if(denied)return {passwords:denied};
     const count=vault.list(profileId).length;
     const sure=await confirm(ctx.window,{message:tr('pw.dialog.deleteAllTitle',`Delete all ${count} saved ${count===1?'password':'passwords'}?`,{count}),detail:tr('pw.dialog.deleteAllDetail','This can’t be undone. Sites you chose "Never save" for stay as they are.'),confirmLabel:tr('pw.dialog.deleteAllConfirm','Delete all'),destructive:true});
     if(!sure)return {passwords:{cancelled:true}};
     for(const item of vault.list(profileId))vault.remove(profileId,item.id);
     return {passwords:{items:[],deleted:count}};
    }
    case 'passwords.import.preview':{
     exact(request,[]);pruneImports();
     const file=await pickOpen(ctx.window);if(!file)return {passwords:{cancelled:true}};
     let parsed;
     try{
      const size=fsApi.statSync(file).size;if(size>CSV_LIMITS.bytes)bad(tr('pw.err.tooLarge','This file is larger than 8 MB.'));
      parsed=parseLogins(fsApi.readFileSync(file,'utf8'));
     }catch(error){return {passwords:{unreadable:error?.code?tr('pw.err.cantRead','That file couldn’t be read.'):String(error?.message||tr('pw.err.cantRead','That file couldn’t be read.')).slice(0,200)}};}
     const existing=new Map(vault.all(profileId).map(item=>[`${item.origin}\n${item.username}`,item.password]));
     const counts={new:0,update:0,same:0};const seen=new Set();const entries=[];
     for(const entry of parsed.entries){
      const key=`${entry.origin}\n${entry.username.trim()}`;if(seen.has(key)){counts.same++;continue;}seen.add(key);
      const current=existing.get(key);if(current===undefined)counts.new++;else if(current===entry.password)counts.same++;else counts.update++;
      if(current!==entry.password)entries.push(entry);
     }
     const token=crypto.randomBytes(16).toString('hex');imports.clear();imports.set(token,{profileId,entries,file,expires:now()+IMPORT_TTL_MS});
     return {passwords:{token,total:parsed.entries.length,...counts,skipped:parsed.skipped,name:path.basename(file)}};
    }
    case 'passwords.import.apply':{
     exact(request,['token']);if(typeof request.token!=='string'||!TOKEN.test(request.token))bad(tr('pw.err.expiredChoose','That import expired. Choose the file again.'));
     pruneImports();const pending=imports.get(request.token);if(!pending||pending.profileId!==profileId||pending.applied)bad(tr('pw.err.expiredChoose','That import expired. Choose the file again.'));
     let added=0,updated=0,failed=0;
     for(const entry of pending.entries){try{const result=vault.save(profileId,entry);if(result.created)added++;else if(result.changed)updated++;}catch{failed++;}}
     pending.entries=[];pending.applied=true;// one-shot: the token now only allows deleting the source file
     return {passwords:{added,updated,failed,items:vault.list(profileId).map(row)}};
    }
    case 'passwords.import.delete-file':{
     exact(request,['token']);if(typeof request.token!=='string'||!TOKEN.test(request.token))bad(tr('pw.err.expired','That import expired.'));
     pruneImports();const pending=imports.get(request.token);if(!pending||pending.profileId!==profileId)bad(tr('pw.err.expired','That import expired.'));
     try{fsApi.rmSync(pending.file,{force:true});}catch{return {passwords:{fileDeleted:false}};}
     imports.delete(request.token);return {passwords:{fileDeleted:true}};
    }
    // The exported file holds every password in plain text. After the import it can go to the Recycle Bin (Trash) instead of
    // being erased for good, after the person says so in a native box. Only the file this import read can be moved.
    case 'passwords.import.trash-file':{
     exact(request,['token']);if(typeof request.token!=='string'||!TOKEN.test(request.token))bad(tr('pw.err.expired','That import expired.'));
     const pending=imports.get(request.token);if(!pending||!pending.applied)bad(tr('pw.err.expired','That import expired.'));
     if(typeof trash!=='function')return {passwords:{fileTrashed:false}};
     const sure=await confirm(ctx.window,{message:tr('pw.dialog.trashTitle','Move the passwords file to the Recycle Bin?'),detail:tr('pw.dialog.trashDetail','{name} holds your passwords in plain text. The Recycle Bin keeps it until you empty it.',{name:path.basename(pending.file)}),confirmLabel:tr('pw.dialog.trashConfirm','Move to Recycle Bin'),destructive:true});
     if(!sure)return {passwords:{cancelled:true}};
     try{await trash(pending.file);}catch{return {passwords:{fileTrashed:false}};}
     imports.delete(request.token);return {passwords:{fileTrashed:true}};
    }
    case 'passwords.export':{
     exact(request,[]);
     const denied=await gated('export',ctx.window);if(denied)return {passwords:denied};
     const count=vault.list(profileId).length;if(!count)return {passwords:{empty:true}};
     const sure=await confirm(ctx.window,{message:tr('pw.dialog.exportTitle','Export your passwords?'),detail:tr('pw.dialog.exportDetail','The file will hold every password in plain text. Anyone who opens it can read them. Keep it somewhere safe and delete it when you’re done.'),confirmLabel:tr('pw.dialog.exportConfirm','Export…'),destructive:false});
     if(!sure)return {passwords:{cancelled:true}};
     const target=await pickSave(ctx.window);if(!target)return {passwords:{cancelled:true}};
     try{fsApi.writeFileSync(target,exportLogins(vault.all(profileId)),{mode:0o600});}catch{return {passwords:{unreadable:tr('pw.err.cantSave','The file couldn’t be saved there.')}};}
     return {passwords:{exported:count,name:path.basename(target)}};
    }
    default:bad('Unknown request.');
   }
  }catch(error){
   if(error instanceof VaultError)return {passwords:{error:{code:error.code,message:error.message}}};
   if(error instanceof RequestError)throw error;
   throw new RequestError(tr('pw.err.vault','Something went wrong with the password vault.'));
  }
 }
 return {handle,vault,gate,get enabled(){return settings.enabled;},lock(){gate.lock();pruneImports();imports.clear();},removeProfile(id){for(const [token,entry] of imports)if(entry.profileId===id)imports.delete(token);return vault.removeProfile(id);},check};
}
module.exports={createPasswords,RequestError,CLIPBOARD_CLEAR_MS};
