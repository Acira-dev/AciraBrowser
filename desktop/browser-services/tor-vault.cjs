'use strict';
// Tor vault (stream N; decision in docs/launch/TOR_KEEP_WORK_PROPOSAL.md). OFF by default: while off nothing is written, not even a folder.
// When the person turns it on, two things from Tor tabs and windows can be kept, and only these:
//   - bookmarks they chose to save from a Tor tab (a Tor-only list; never in the normal bookmarks), and
//   - the Tor tabs that were open when their window closed (URLs and titles), to reopen later.
// No history, no cookies, no logins, no page content. Everything is one AES-256-GCM file whose key is wrapped by Windows DPAPI
// (the same safeStorage the password manager uses, but its own key and folder); READING it (list, reopen) needs the same Windows Hello
// check as the password vault. Writing needs no prompt. A failed or unreadable file is never overwritten.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {t}=require('./tx.cjs');

const MAX_BOOKMARKS=2000,MAX_TABS=40,URL_MAX=2048,TITLE_MAX=300;
class TorVaultError extends Error{constructor(code,message){super(message);this.name='TorVaultError';this.code=code;}}
const fail=(code,message)=>{throw new TorVaultError(code,code==='denied'&&message?message:t(`tor.vault.${code}`));};
const web=value=>{try{const u=new URL(String(value));return /^https?:$/.test(u.protocol)&&String(value).length<=URL_MAX?u.href:'';}catch{return '';}};
const text=(value,max)=>String(value??'').replace(/[\u0000-\u001f]/g,' ').slice(0,max);

function createTorVault({dir,keys,gate,now=Date.now,randomBytes=crypto.randomBytes}){
 const settingsFile=path.join(dir,'settings.json'),dataFile=path.join(dir,'items.vault'),keyFile=path.join(dir,'master.key');
 let master=null;
 const readSettings=()=>{try{return {enabled:JSON.parse(fs.readFileSync(settingsFile,'utf8')).enabled===true};}catch{return {enabled:false};}};
 const writeAtomic=(file,content)=>{fs.mkdirSync(dir,{recursive:true});const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,content,{mode:0o600});fs.renameSync(tmp,file);};
 const exists=file=>{try{return fs.statSync(file).isFile();}catch{return false;}};

 function loadKey(create){
  if(master)return master;
  if(!keys.available())fail('unavailable','Secure storage isn’t available on this PC, so Tor items can’t be kept.');
  if(exists(keyFile)){
   try{const key=keys.unwrap(Buffer.from(String(JSON.parse(fs.readFileSync(keyFile,'utf8')).wrapped),'base64'));if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('bad');master=key;return master;}
   catch{fail('key-unreadable','The Tor vault can’t be opened on this account.');}
  }
  if(!create)return null;
  if(exists(dataFile))fail('key-missing','The Tor vault’s key is missing. Saved Tor items can’t be opened.');
  const fresh=randomBytes(32);writeAtomic(keyFile,JSON.stringify({v:1,wrapped:keys.wrap(fresh).toString('base64')}));master=fresh;return master;
 }
 const aad=Buffer.from('acira-tor-vault|v1');
 function seal(payload){
  const iv=randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',loadKey(true),iv,{authTagLength:16});cipher.setAAD(aad);
  const ct=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ct:ct.toString('base64')});
 }
 function unseal(){
  if(!exists(dataFile))return {bookmarks:[],tabs:null};
  const key=loadKey(false);if(!key)fail('key-missing','The Tor vault’s key is missing. Saved Tor items can’t be opened.');
  try{
   const raw=JSON.parse(fs.readFileSync(dataFile,'utf8')),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(raw.iv,'base64'),{authTagLength:16});d.setAAD(aad);d.setAuthTag(Buffer.from(raw.tag,'base64'));
   const data=JSON.parse(Buffer.concat([d.update(Buffer.from(raw.ct,'base64')),d.final()]).toString('utf8'));
   return {bookmarks:Array.isArray(data.bookmarks)?data.bookmarks:[],tabs:data.tabs&&Array.isArray(data.tabs.items)?data.tabs:null};
  }catch{fail('corrupt','The Tor vault can’t be read. Nothing was changed.');}
 }
 const save=data=>writeAtomic(dataFile,seal(data));
 const requireEnabled=()=>{if(!readSettings().enabled)fail('off','Keeping Tor items is off.');};
 async function unlocked(){const result=await gate.ensure('tor');if(!result.ok)fail('denied',result.message||'Couldn’t verify it’s you.');}

 const api={
  /** Safe to show anywhere: no content, only whether the feature is on and whether anything exists. */
  status(){return {enabled:readSettings().enabled,available:keys.available(),hasItems:exists(dataFile)};},
  /** Turning it on needs the Windows check (it is a privacy trade-off). Turning it off only stops saving; "clear" removes what exists. */
  async setEnabled(value){
   if(typeof value!=='boolean')fail('choice','Choose on or off.');
   if(value){if(!keys.available())fail('unavailable','Secure storage isn’t available on this PC, so Tor items can’t be kept.');await unlocked();loadKey(true);}
   writeAtomic(settingsFile,JSON.stringify({enabled:value}));return api.status();
  },
  /** Saves one bookmark (no prompt: writing is not reading). Returns {id,created}. */
  addBookmark({url,title}){
   requireEnabled();const href=web(url);if(!href)fail('invalid','Only web pages can be saved.');
   const data=unseal(),existing=data.bookmarks.find(b=>b.url===href);if(existing)return {id:existing.id,created:false};
   if(data.bookmarks.length>=MAX_BOOKMARKS)fail('full','The Tor bookmarks are full.');
   const id=randomBytes(8).toString('hex');data.bookmarks.push({id,url:href,title:text(title,TITLE_MAX)||new URL(href).hostname,addedAt:now()});save(data);return {id,created:true};
  },
  async listBookmarks(){requireEnabled();await unlocked();return unseal().bookmarks.map(({id,url,title,addedAt})=>({id,url,title,addedAt})).sort((a,b)=>b.addedAt-a.addedAt);},
  async removeBookmark(id){requireEnabled();await unlocked();const data=unseal(),next=data.bookmarks.filter(b=>b.id!==String(id));if(next.length===data.bookmarks.length)fail('missing','That bookmark no longer exists.');data.bookmarks=next;save(data);return true;},
  /** The Tor tabs of a window that just closed replace the saved set (only when there is at least one web page). */
  saveTabs(items){
   if(!readSettings().enabled)return false;
   const clean=[];for(const item of Array.isArray(items)?items:[]){const href=web(item?.url);if(href&&!clean.some(c=>c.url===href))clean.push({url:href,title:text(item.title,TITLE_MAX)});if(clean.length>=MAX_TABS)break;}
   if(!clean.length)return false;
   const data=unseal();data.tabs={savedAt:now(),items:clean};save(data);return true;
  },
  async lastTabs(){requireEnabled();await unlocked();const tabs=unseal().tabs;return tabs?tabs.items.map(({url,title})=>({url,title})):[];},
  /** Deletes the saved items and the key; the on/off choice is kept. */
  clearAll(){for(const file of [dataFile,keyFile,`${dataFile}.tmp`])try{fs.rmSync(file,{force:true});}catch{}master=null;return api.status();},
  lock(){master=null;},
 };
 return api;
}
let shared=null;
const sharedTorVault=options=>shared??=createTorVault(options);
module.exports={createTorVault,sharedTorVault,TorVaultError,MAX_BOOKMARKS,MAX_TABS};
