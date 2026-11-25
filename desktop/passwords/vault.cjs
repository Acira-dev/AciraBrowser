'use strict';
// Encrypted per-profile password vault. See docs/launch/PASSWORDS_SECURITY.md.
//  - One AES-256-GCM record per item (fresh 96-bit IV per write, 128-bit tag, AAD binds profile and record id).
//  - A 32-byte master key is wrapped by the OS (Electron safeStorage / Windows DPAPI, injected as `keys`); per-profile keys come
//    from HKDF-SHA256. Nothing is ever stored in plaintext, there is no plaintext fallback, and a missing or unreadable key never
//    leads to a new key being created over existing records.
//  - Errors carry a code and fixed text. They never include a site, username, password or file content.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeOrigin,classify,displayHost,RANK}=require('./origin-match.cjs');
const {tr}=require('./text.cjs');
const {writeFileAtomic}=require('../atomic-file.cjs');

const VERSION=1,MAX_RECORDS=10000,MAX_MASKS=500,LIMITS={origin:2048,username:512,password:1024,note:4096,address:254,remoteId:64,key:512};
const SAFE_PROFILE=/^[A-Za-z0-9_.:-]{1,120}$/,SAFE_RECORD=/^[0-9a-f]{32}$/;
class VaultError extends Error{constructor(code,message){super(message);this.name='VaultError';this.code=code;}}
const fail=(code,message)=>{throw new VaultError(code,message);};

function createVault({dir,keys,now=Date.now,randomBytes=crypto.randomBytes}){
 let master=null;
 const profiles=new Map();// profileId -> {records:Map(id -> sealed), index:Map(id -> meta) | null, broken:number}
 const fileOf=profileId=>path.join(dir,`${profileId}.vault.json`);
 const profileCheck=profileId=>{if(typeof profileId!=='string'||!SAFE_PROFILE.test(profileId))fail('invalid','Unknown profile.');return profileId;};
 const vaultFiles=()=>{try{return fs.readdirSync(dir).filter(name=>name.endsWith('.vault.json'));}catch{return [];}};

 // --- keys ---------------------------------------------------------------------------------------------------------
 function loadMaster(create){
  if(master)return master;
  if(!keys.available())fail('unavailable',tr('pw.vault.unavailable','Secure storage isn’t available on this PC, so passwords can’t be kept.'));
  const file=path.join(dir,'master.key');let blob=null;
  try{blob=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error?.code!=='ENOENT')fail('key-unreadable',tr('pw.vault.keyUnreadable','The password vault can’t be opened on this account.'));}
  if(blob){
   try{const key=keys.unwrap(Buffer.from(String(blob.wrapped),'base64'));if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('bad key');master=key;return master;}
   catch{fail('key-unreadable',tr('pw.vault.keyUnreadable','The password vault can’t be opened on this account.'));}
  }
  if(!create)return null;
  if(vaultFiles().length)fail('key-missing',tr('pw.vault.keyMissing','The password vault’s key is missing. Your saved passwords can’t be opened.'));
  const fresh=randomBytes(32);
  fs.mkdirSync(dir,{recursive:true});
  writeFileAtomic(file,JSON.stringify({v:VERSION,wrapped:keys.wrap(fresh).toString('base64')}),{mode:0o600}); // Windows: a scanner can refuse the rename for a moment (atomic-file.cjs retries)
  master=fresh;return master;
 }
 const profileKey=profileId=>Buffer.from(crypto.hkdfSync('sha256',loadMaster(true),Buffer.from(profileId,'utf8'),Buffer.from('acira-passwords/v1'),32));
 const aad=(profileId,id)=>Buffer.from(`acira-pw|v${VERSION}|${profileId}|${id}`,'utf8');
 function seal(profileId,id,payload){
  const iv=randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',profileKey(profileId),iv,{authTagLength:16});cipher.setAAD(aad(profileId,id));
  const ct=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return {id,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ct:ct.toString('base64')};
 }
 function open(profileId,sealed){
  const iv=Buffer.from(String(sealed.iv),'base64'),tag=Buffer.from(String(sealed.tag),'base64');
  if(iv.length!==12||tag.length!==16)throw new Error('bad record');
  const decipher=crypto.createDecipheriv('aes-256-gcm',profileKey(profileId),iv,{authTagLength:16});decipher.setAAD(aad(profileId,sealed.id));decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(String(sealed.ct),'base64')),decipher.final()]).toString('utf8'));
 }

 // --- files --------------------------------------------------------------------------------------------------------
 const readFile=file=>{const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw?.v!==VERSION||!Array.isArray(raw.records))throw new Error('bad vault');return raw;};
 function load(profileId){
  profileCheck(profileId);
  let state=profiles.get(profileId);if(state)return state;
  const file=fileOf(profileId);let raw=null;
  if(fs.existsSync(file)||fs.existsSync(`${file}.bak`)){
   for(const candidate of [file,`${file}.bak`]){try{raw=readFile(candidate);if(raw.profileId===profileId)break;raw=null;}catch{raw=null;}}
   if(!raw)fail('corrupt',tr('pw.vault.corrupt','This password vault can’t be read. Nothing was changed.'));
  }
  if(raw)loadMaster(false)||fail('key-missing',tr('pw.vault.keyMissing','The password vault’s key is missing. Your saved passwords can’t be opened.'));
  state={records:new Map(),index:null,broken:0};
  for(const sealed of raw?.records||[]){if(sealed&&typeof sealed.id==='string'&&SAFE_RECORD.test(sealed.id)&&!state.records.has(sealed.id))state.records.set(sealed.id,sealed);else state.broken++;}
  profiles.set(profileId,state);return state;
 }
 function persist(profileId,state){
  fs.mkdirSync(dir,{recursive:true});
  const file=fileOf(profileId);
  try{if(fs.existsSync(file))fs.copyFileSync(file,`${file}.bak`);}catch{}
  // Written beside the file, flushed and renamed over it; on Windows a virus scanner or the indexer can refuse the rename for a moment (EPERM/EBUSY), which atomic-file.cjs tries again.
  writeFileAtomic(file,JSON.stringify({v:VERSION,profileId,records:[...state.records.values()]}),{mode:0o600});
 }
 /** Decrypts every record once per change (metadata only is kept); a record that fails authentication is counted, not removed. */
 function indexOf(profileId){
  const state=load(profileId);if(state.index)return state.index;
  const index=new Map();state.broken=state.broken||0;
  for(const [id,sealed] of state.records){
   try{const payload=open(profileId,sealed);if(payload.kind==='login')index.set(id,{id,kind:'login',origin:payload.origin,username:payload.username,createdAt:payload.createdAt,updatedAt:payload.updatedAt});else if(payload.kind==='never')index.set(id,{id,kind:'never',origin:payload.origin,createdAt:payload.createdAt});else if(payload.kind==='mask')index.set(id,{id,kind:'mask',origin:payload.origin,address:payload.address,provider:payload.provider,remoteId:payload.remoteId,enabled:payload.enabled!==false,createdAt:payload.createdAt});else if(payload.kind==='connection')index.set(id,{id,kind:'connection',provider:payload.provider,offer:payload.offer!==false,note:payload.note!==false});else state.broken++;}
   catch(error){if(error instanceof VaultError)throw error;state.broken++;}
  }
  state.index=index;return index;
 }
 const clean=(value,max,label,{required=false,trim=false}={})=>{
  if(value===undefined||value===null)value='';if(typeof value!=='string')fail('invalid',`${label} must be text.`);
  if(trim)value=value.trim();if(required&&!value)fail('invalid',`${label} is required.`);if(value.length>max)fail('invalid',`${label} is too long.`);
  if(/\u0000/.test(value))fail('invalid',`${label} has invalid characters.`);return value;
 };
 const fields=input=>{
  const origin=normalizeOrigin(input.origin);if(!origin||origin.length>LIMITS.origin)fail('invalid',tr('pw.vault.invalidOrigin','Enter a website address that starts with http:// or https://.'));
  return {origin,username:clean(input.username,LIMITS.username,'Username',{trim:true}),password:clean(input.password,LIMITS.password,'Password',{required:true}),note:clean(input.note,LIMITS.note,'Note')};
 };
 const meta=entry=>({id:entry.id,origin:entry.origin,username:entry.username,createdAt:entry.createdAt,updatedAt:entry.updatedAt});
 const byHostThenUser=(a,b)=>displayHost(a.origin).localeCompare(displayHost(b.origin))||a.username.localeCompare(b.username);

 // --- operations ---------------------------------------------------------------------------------------------------
 const api={
  /** Status for the UI without touching secrets. */
  status(profileId){
   try{const state=load(profileId);const count=[...indexOf(profileId).values()].filter(e=>e.kind==='login').length;return {ok:true,available:keys.available(),count,unreadable:state.broken};}
   catch(error){return {ok:false,available:keys.available(),code:error.code||'error',message:error.code?error.message:tr('pw.vault.keyUnreadable','The password vault can’t be opened on this account.')};}
  },
  list(profileId){return [...indexOf(profileId).values()].filter(e=>e.kind==='login').map(meta).sort(byHostThenUser);},
  never(profileId){return [...indexOf(profileId).values()].filter(e=>e.kind==='never').map(e=>({id:e.id,origin:e.origin})).sort((a,b)=>a.origin.localeCompare(b.origin));},
  get(profileId,id){
   const state=load(profileId);const sealed=state.records.get(String(id));if(!sealed)fail('missing',tr('pw.vault.missing','That item no longer exists.'));
   try{const payload=open(profileId,sealed);if(payload.kind!=='login')fail('missing',tr('pw.vault.missing','That item no longer exists.'));return {id:sealed.id,origin:payload.origin,username:payload.username,password:payload.password,note:payload.note||'',createdAt:payload.createdAt,updatedAt:payload.updatedAt};}
   catch(error){if(error instanceof VaultError)throw error;fail('corrupt',tr('pw.vault.unreadableItem','That item can’t be read.'));}
  },
  /** Adds a login, or updates the password/note of the same site + username. -> {id, created, changed} */
  save(profileId,input){
   const next=fields(input),state=load(profileId),index=indexOf(profileId);
   for(const entry of index.values())if(entry.kind==='login'&&entry.origin===next.origin&&entry.username===next.username){
    const current=api.get(profileId,entry.id);
    if(current.password===next.password&&(current.note===next.note||!input.note))return {id:entry.id,created:false,changed:false};
    const payload={kind:'login',...next,note:input.note===undefined?current.note:next.note,createdAt:current.createdAt,updatedAt:now()};
    state.records.set(entry.id,seal(profileId,entry.id,payload));state.index=null;persist(profileId,state);return {id:entry.id,created:false,changed:true};
   }
   if(state.records.size>=MAX_RECORDS)fail('full',tr('pw.vault.full','This vault is full.'));
   const id=randomBytes(16).toString('hex');
   state.records.set(id,seal(profileId,id,{kind:'login',...next,createdAt:now(),updatedAt:now()}));state.index=null;persist(profileId,state);
   return {id,created:true,changed:true};
  },
  /** Edits one item (site, username, password, note). Refuses to collide with another item of the same site + username. */
  update(profileId,id,patch){
   const current=api.get(profileId,id),state=load(profileId);
   const next=fields({origin:patch.origin??current.origin,username:patch.username??current.username,password:patch.password??current.password,note:patch.note??current.note});
   for(const entry of indexOf(profileId).values())if(entry.kind==='login'&&entry.id!==current.id&&entry.origin===next.origin&&entry.username===next.username)fail('duplicate',tr('pw.vault.duplicate','You already have a password saved for that username on that site.'));
   state.records.set(current.id,seal(profileId,current.id,{kind:'login',...next,createdAt:current.createdAt,updatedAt:now()}));state.index=null;persist(profileId,state);
   return {id:current.id};
  },
  remove(profileId,id){const state=load(profileId);const kind=indexOf(profileId).get(String(id))?.kind;if(kind==='mask'||kind==='connection')fail('missing',tr('pw.vault.missing','That item no longer exists.'));/* masks go through maskRemove, the key through connectionRemove */if(!state.records.delete(String(id)))fail('missing',tr('pw.vault.missing','That item no longer exists.'));state.index=null;persist(profileId,state);return true;},
  addNever(profileId,origin){
   const normalized=normalizeOrigin(origin);if(!normalized)fail('invalid',tr('pw.vault.invalidOrigin','Enter a website address that starts with http:// or https://.'));
   const state=load(profileId);
   for(const entry of indexOf(profileId).values())if(entry.kind==='never'&&entry.origin===normalized)return {id:entry.id,created:false};
   const id=randomBytes(16).toString('hex');state.records.set(id,seal(profileId,id,{kind:'never',origin:normalized,createdAt:now()}));state.index=null;persist(profileId,state);return {id,created:true};
  },
  removeNever(profileId,id){return api.remove(profileId,id);},
  isNever(profileId,origin){const normalized=normalizeOrigin(origin);if(!normalized)return true;return [...indexOf(profileId).values()].some(e=>e.kind==='never'&&e.origin===normalized);},
  /** Logins to offer on a page: exact, then https-upgrade, then same-site; no secrets. */
  match(profileId,pageUrl){
   const found=[];
   for(const entry of indexOf(profileId).values()){if(entry.kind!=='login')continue;const kind=classify(entry.origin,pageUrl);if(kind)found.push({...meta(entry),match:kind});}
   return found.sort((a,b)=>RANK[a.match]-RANK[b.match]||byHostThenUser(a,b));
  },
  /** What a fill needs, nothing else. */
  secret(profileId,id){const item=api.get(profileId,id);return {origin:item.origin,username:item.username,password:item.password};},
  /** Every login with secrets: export and the weak/reused check only (callers are gated). */
  all(profileId){return [...indexOf(profileId).values()].filter(e=>e.kind==='login').map(e=>api.get(profileId,e.id)).sort(byHostThenUser);},
  // --- email masks (desktop/passwords/masks.cjs) ---------------------------------------------------------------------
  // Two more sealed record kinds in the same per-profile file: one `connection` (which mask service, its API key, two switches) and a
  // `mask` per address made through it (site, address, the service's own id, last known on/off). The key never leaves this module except
  // through connection(), which only the main-process mask service calls.
  masks(profileId){return [...indexOf(profileId).values()].filter(e=>e.kind==='mask').map(e=>({id:e.id,origin:e.origin,address:e.address,provider:e.provider,remoteId:e.remoteId,enabled:e.enabled,createdAt:e.createdAt})).sort((a,b)=>b.createdAt-a.createdAt||a.address.localeCompare(b.address));},
  maskAdd(profileId,input){
   const origin=normalizeOrigin(input.origin);if(!origin||origin.length>LIMITS.origin)fail('invalid',tr('pw.vault.invalidOrigin','Enter a website address that starts with http:// or https://.'));
   const address=clean(input.address,LIMITS.address,'Address',{required:true,trim:true}),provider=clean(input.provider,32,'Service',{required:true}),remoteId=clean(input.remoteId,LIMITS.remoteId,'Mask id',{required:true});
   const state=load(profileId);
   if([...indexOf(profileId).values()].filter(e=>e.kind==='mask').length>=MAX_MASKS)fail('full',tr('pw.vault.maskFull','This list is full. Delete masks you no longer use.'));
   if(state.records.size>=MAX_RECORDS)fail('full',tr('pw.vault.full','This vault is full.'));
   const id=randomBytes(16).toString('hex');
   state.records.set(id,seal(profileId,id,{kind:'mask',origin,address,provider,remoteId,enabled:input.enabled!==false,createdAt:now()}));state.index=null;persist(profileId,state);return {id};
  },
  maskSet(profileId,id,patch){
   const state=load(profileId),sealed=state.records.get(String(id));if(!sealed)fail('missing',tr('pw.vault.missing','That item no longer exists.'));
   let payload;try{payload=open(profileId,sealed);}catch{fail('corrupt',tr('pw.vault.unreadableItem','That item can’t be read.'));}
   if(payload.kind!=='mask')fail('missing',tr('pw.vault.missing','That item no longer exists.'));
   if(typeof patch.enabled==='boolean')payload.enabled=patch.enabled;
   state.records.set(sealed.id,seal(profileId,sealed.id,payload));state.index=null;persist(profileId,state);return true;
  },
  maskRemove(profileId,id){
   const state=load(profileId),entry=indexOf(profileId).get(String(id));if(!entry||entry.kind!=='mask')fail('missing',tr('pw.vault.missing','That item no longer exists.'));
   state.records.delete(entry.id);state.index=null;persist(profileId,state);return true;
  },
  /** The mask service's connection without the key: {provider, offer, note} or null. */
  connectionMeta(profileId){const entry=[...indexOf(profileId).values()].find(e=>e.kind==='connection');return entry?{id:entry.id,provider:entry.provider,offer:entry.offer,note:entry.note}:null;},
  /** The connection WITH its key. Main-process mask service only. */
  connection(profileId){
   const entry=[...indexOf(profileId).values()].find(e=>e.kind==='connection');if(!entry)return null;
   try{const payload=open(profileId,load(profileId).records.get(entry.id));return {id:entry.id,provider:payload.provider,key:payload.key,offer:payload.offer!==false,note:payload.note!==false};}
   catch{fail('corrupt',tr('pw.vault.unreadableItem','That item can’t be read.'));}
  },
  connectionSet(profileId,input){
   const provider=clean(input.provider,32,'Service',{required:true}),key=clean(input.key,LIMITS.key,'Key',{required:true,trim:true});
   const state=load(profileId),existing=[...indexOf(profileId).values()].find(e=>e.kind==='connection');
   const id=existing?existing.id:randomBytes(16).toString('hex');
   if(!existing&&state.records.size>=MAX_RECORDS)fail('full',tr('pw.vault.full','This vault is full.'));
   state.records.set(id,seal(profileId,id,{kind:'connection',provider,key,offer:input.offer!==false,note:input.note!==false,createdAt:now()}));state.index=null;persist(profileId,state);return {id};
  },
  /** Drops the connection and every mask record of this profile (the masks at the service are not touched). */
  connectionRemove(profileId){
   const state=load(profileId);let any=false;
   for(const entry of indexOf(profileId).values())if(entry.kind==='connection'||entry.kind==='mask'){state.records.delete(entry.id);any=true;}
   if(any){state.index=null;persist(profileId,state);}return any;
  },
  removeProfile(profileId){profileCheck(profileId);profiles.delete(profileId);for(const name of [fileOf(profileId),`${fileOf(profileId)}.bak`])try{fs.rmSync(name,{force:true});}catch{}return true;},
  removeAll(profileId){return api.removeProfile(profileId);},
  lock(){profiles.clear();},
  available:()=>keys.available(),
 };
 return api;
}
/** Production key wrapper over Electron's safeStorage (DPAPI on Windows). */
function safeStorageKeys(safeStorage){
 return {
  available:()=>{try{return Boolean(safeStorage?.isEncryptionAvailable());}catch{return false;}},
  wrap:buffer=>safeStorage.encryptString(buffer.toString('base64')),
  unwrap:blob=>Buffer.from(safeStorage.decryptString(blob),'base64'),
 };
}
module.exports={createVault,safeStorageKeys,VaultError,LIMITS,MAX_RECORDS,MAX_MASKS};
