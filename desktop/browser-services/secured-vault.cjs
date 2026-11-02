'use strict';
// Secured workspaces (R3-38 / R4-48 P2-4): the sealed tab list of each secured workspace. Same approach as the Tor vault
// (tor-vault.cjs): one AES-256-GCM file per workspace, the key wrapped by Windows DPAPI (Electron safeStorage) in its own folder,
// a damaged or unreadable file is never overwritten. Page storage itself is a memory-only session (main.cjs pageProfile), so the
// only thing that ever reaches the disk is this sealed file: the tabs' addresses, titles and back/forward lists, and the workspace's tab groups and splits.
// Reading a sealed list back (unlock) is the caller's job to gate with Windows Hello; this module never decides who may read.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');

const MAX_TABS=200,URL_MAX=2048,TITLE_MAX=300,HISTORY_MAX=50,GROUP_MAX=64,MAX_GROUPS=100,MAX_SPLITS=50,SPLIT_ID=/^split-[a-zA-Z0-9-]{1,100}$/,COLORS=new Set(['none','grey','blue','red','yellow','green','pink','purple','cyan','orange']),ID=/^[A-Za-z0-9_.:-]{1,120}$/;
class SecuredVaultError extends Error{constructor(code,message){super(message||code);this.name='SecuredVaultError';this.code=code;}}
const fail=(code,message)=>{throw new SecuredVaultError(code,message);};
const web=value=>{try{const text=String(value);if(text==='acira://new')return text;const u=new URL(text);return /^https?:$/.test(u.protocol)&&text.length<=URL_MAX?u.href:'';}catch{return '';}};
const text=(value,max)=>String(value??'').replace(/[\u0000-\u001f]/g,' ').slice(0,max);

/** Only what a tab needs to come back: no favicons (they are fetched again), no page content, no form data. */
function cleanTabs(list){
 const out=[];
 for(const tab of Array.isArray(list)?list:[]){
  if(!tab||typeof tab!=='object'||typeof tab.id!=='string'||!ID.test(tab.id))continue;
  const url=web(tab.url);if(!url)continue;
  const history=(Array.isArray(tab.history)?tab.history:[]).map(web).filter(Boolean).slice(-HISTORY_MAX);
  const historyIndex=Math.max(0,Math.min(history.length-1,Number.isInteger(tab.historyIndex)?tab.historyIndex:history.length-1));
  out.push({id:tab.id,url,title:text(tab.title,TITLE_MAX),...(tab.group?{group:text(tab.group,GROUP_MAX)}:{}),...(tab.customTitle?{customTitle:text(tab.customTitle,TITLE_MAX)}:{}),history:history.length?history:[url],historyIndex:history.length?historyIndex:0,zoom:Number.isFinite(tab.zoom)?tab.zoom:100});
  if(out.length>=MAX_TABS)break;
 }
 return out;
}

/** The workspace's tab groups (name, colour, folded) and saved splits (which tabs, layout, sizes), so a lock gives back exactly what it took. The reducer checks them again on unlock. */
function cleanGroups(list,tabIds){
 const out=[],seen=new Set();
 for(const group of Array.isArray(list)?list:[]){
  if(!group||typeof group!=='object'||typeof group.id!=='string'||!ID.test(group.id)||seen.has(group.id))continue;
  const name=text(group.name,GROUP_MAX).trim();if(!name)continue;seen.add(group.id);
  out.push({id:group.id,name,color:COLORS.has(group.color)?group.color:'none',collapsed:group.collapsed===true,...(typeof group.lastActiveTabId==='string'&&tabIds.has(group.lastActiveTabId)?{lastActiveTabId:group.lastActiveTabId}:{})});
  if(out.length>=MAX_GROUPS)break;
 }
 return out;
}
const sizes=value=>Array.isArray(value)?value.filter(Number.isFinite).slice(0,4):undefined;
function cleanSplits(list,tabIds){
 const out=[],seen=new Set();
 for(const split of Array.isArray(list)?list:[]){
  if(!split||typeof split!=='object'||typeof split.id!=='string'||!SPLIT_ID.test(split.id)||seen.has(split.id)||!Array.isArray(split.tabIds))continue;
  const ids=split.tabIds.filter(id=>typeof id==='string'&&tabIds.has(id)).slice(0,4);if(ids.length<2||ids.length!==split.tabIds.length)continue;seen.add(split.id);
  const kept={id:split.id,groupId:split.id,tabIds:ids,layout:typeof split.layout==='string'?split.layout.slice(0,40):'',collapsed:split.collapsed===true};
  for(const key of ['cols','rows'])if(sizes(split[key]))kept[key]=sizes(split[key]);
  if(Array.isArray(split.colRows))kept.colRows=split.colRows.slice(0,4).map(sizes).filter(Boolean);
  if(typeof split.lastActiveTabId==='string'&&ids.includes(split.lastActiveTabId))kept.lastActiveTabId=split.lastActiveTabId;
  if(typeof split.name==='string'&&split.name.trim())kept.name=text(split.name,60);
  out.push(kept);if(out.length>=MAX_SPLITS)break;
 }
 return out;
}

function createSecuredVault({dir,keys,randomBytes=crypto.randomBytes,now=Date.now}){
 const keyFile=path.join(dir,'master.key'),fileOf=id=>{if(!ID.test(String(id)))fail('invalid','Not a workspace.');return path.join(dir,`${String(id).replace(/[^A-Za-z0-9_-]/g,'_')}.vault`);};
 let master=null;const broken=new Set();
 const exists=file=>{try{return fs.statSync(file).isFile();}catch{return false;}};
 const writeAtomic=(file,content)=>{fs.mkdirSync(dir,{recursive:true});const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,content,{mode:0o600});fs.renameSync(tmp,file);};
 function loadKey(create){
  if(master)return master;
  if(!keys.available())fail('unavailable','Secure storage isn’t available on this PC.');
  if(exists(keyFile)){
   try{const key=keys.unwrap(Buffer.from(String(JSON.parse(fs.readFileSync(keyFile,'utf8')).wrapped),'base64'));if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('bad');master=key;return master;}
   catch{fail('key-unreadable','The secured workspaces can’t be opened on this account.');}
  }
  if(!create)return null;
  const fresh=randomBytes(32);writeAtomic(keyFile,JSON.stringify({v:1,wrapped:keys.wrap(fresh).toString('base64')}));master=fresh;return master;
 }
 const aadOf=id=>Buffer.from(`acira-secured-workspace|v1|${id}`);
 function seal(id,payload){
  const iv=randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',loadKey(true),iv,{authTagLength:16});cipher.setAAD(aadOf(id));
  const ct=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ct:ct.toString('base64')});
 }
 const api={
  available:()=>{try{return keys.available();}catch{return false;}},
  has:id=>exists(fileOf(id)),
  /** Seals a workspace's tabs (replacing what was there). Never writes over a file that failed to open. */
  write(id,{tabs,activeId,groups,splits}={}){
   const file=fileOf(id);if(broken.has(id))fail('corrupt','This secured workspace can’t be read, so nothing was changed.');
   const clean=cleanTabs(tabs),ids=new Set(clean.map(tab=>tab.id));writeAtomic(file,seal(id,{v:1,savedAt:now(),activeId:clean.some(tab=>tab.id===activeId)?activeId:clean[0]?.id||'',tabs:clean,groups:cleanGroups(groups,ids),splits:cleanSplits(splits,ids)}));return clean.length;
  },
  /** Opens a sealed list (the caller has already verified the person). An absent file is an empty workspace. */
  read(id){
   const file=fileOf(id);if(!exists(file))return {tabs:[],activeId:'',groups:[],splits:[]};
   const key=loadKey(false);if(!key){broken.add(id);fail('key-missing','The key for this secured workspace is missing.');}
   try{
    const raw=JSON.parse(fs.readFileSync(file,'utf8')),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(raw.iv,'base64'),{authTagLength:16});d.setAAD(aadOf(id));d.setAuthTag(Buffer.from(raw.tag,'base64'));
    const data=JSON.parse(Buffer.concat([d.update(Buffer.from(raw.ct,'base64')),d.final()]).toString('utf8'));
    broken.delete(id);const tabs=cleanTabs(data.tabs),ids=new Set(tabs.map(tab=>tab.id));return {tabs,activeId:typeof data.activeId==='string'?data.activeId:'',groups:cleanGroups(data.groups,ids),splits:cleanSplits(data.splits,ids)};
   }catch{broken.add(id);fail('corrupt','This secured workspace can’t be read. Nothing was changed.');}
  },
  /** The workspace was deleted or stopped being secured: its sealed file goes (the key stays for the others). */
  remove(id){const file=fileOf(id);broken.delete(id);for(const item of [file,`${file}.${process.pid}.tmp`])try{fs.rmSync(item,{force:true});}catch{}},
  isBroken:id=>broken.has(id),
  lock(){master=null;},
 };
 return api;
}
module.exports={createSecuredVault,cleanTabs,cleanGroups,cleanSplits,SecuredVaultError,MAX_TABS};
