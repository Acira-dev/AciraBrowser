'use strict';
// Main-process side of in-page passwords: what the page preload reports, what Acira offers, what gets filled and saved.
// Every message is validated; the page origin and the tab always come from the browser process (`ownerOf`), never from the
// message. Secrets travel main -> page preload only on an explicit choice in Acira's own list. See PASSWORDS_SECURITY.md.
const {classify,displayHost,normalizeOrigin}=require('./origin-match.cjs');
const {generate}=require('./generator.cjs');
const {tr}=require('./text.cjs');

const CHANNELS=new Set(['acira:pw-focus','acira:pw-dismiss','acira:pw-key','acira:pw-submit','acira:pw-ready','acira:pw-form-gone','acira:pw-form-stays','acira:pw-username']);
const FIELD=/^f\d{1,6}$/,KINDS=new Set(['login','signup','change']),ROLES=new Set(['username','password','new-password']);
const PENDING_MS=15000,USERNAME_MS=5*60*1000,PROMPT_MS=30000,PROBE_MS=450,MAX_ITEMS=6,RATE_PER_SECOND=40;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e6;

/** ui: {show(spec), hide(), focusPrompt()} (the native frame view); page: {send(tabId,channel,payload), url(tabId), focus(tabId)}. */
function createPageBridge({service,ownerOf,ui,page,notify=()=>{},now=Date.now,timers={setTimeout,clearTimeout}}){
 const vault=service.vault;
 let shown=null;// {tabId,docId,profileId,origin,mode:'suggest'|'save',items,index,info,pending}
 const pending=new Map();// tabId -> {docId,origin,profileId,url,kind,username,password,hadPrevious,at,timer}
 const usernames=new Map();// tabId -> {origin,username,at}: the username typed on a username-first page, in memory only, never saved by itself
 const buckets=new Map();

 function allowed(tabId){
  const t=now(),bucket=buckets.get(tabId)||{start:t,count:0};
  if(t-bucket.start>1000){bucket.start=t;bucket.count=0;}bucket.count++;buckets.set(tabId,bucket);
  if(buckets.size>200)for(const [key,value] of buckets)if(t-value.start>5000)buckets.delete(key);
  return bucket.count<=RATE_PER_SECOND;
 }
 function hide(){
  const was=shown;shown=null;if(!was)return;
  timers.clearTimeout(was.timer);
  try{ui.hide();}catch{}
  if(was.mode==='suggest')page.send(was.tabId,'acira:pw-open',{docId:was.docId,open:false});
 }
 /** The username from the previous step of this tab, only for the same exact origin and only while it is fresh. */
 function rememberedUsername(owner){
  const entry=usernames.get(owner.tabId);if(!entry)return '';
  if(now()-entry.at>USERNAME_MS||entry.origin!==normalizeOrigin(owner.url)){usernames.delete(owner.tabId);return '';}
  return entry.username;
 }
 function usernameStep(owner,payload){
  const username=typeof payload.username==='string'?payload.username.trim():'';
  const origin=normalizeOrigin(owner.url);if(!origin||!username||username.length>512)return;
  usernames.set(owner.tabId,{origin,username,at:now()});
 }
 function drop(tabId){const entry=pending.get(tabId);if(entry){timers.clearTimeout(entry.timer);timers.clearTimeout(entry.probe);pending.delete(tabId);}}

 // --- suggestions -----------------------------------------------------------------------------------------------------
 function focus(owner,payload){
  const info=validInfo(payload);if(!info)return;
  if(vault.status(owner.profileId).ok!==true)return;
  const items=[];
  if(info.role==='new-password')items.push({kind:'generate',label:tr('pw.bridge.strong','Use a strong password'),secondary:''});
  else if(info.kind!=='signup'){
   let matches=vault.match(owner.profileId,owner.url);
   const typed=info.usernameId?'':rememberedUsername(owner);// a password page without a username field: prefer the account just typed
   if(typed&&matches.some(m=>m.username===typed))matches=matches.filter(m=>m.username===typed);
   for(const match of matches.slice(0,MAX_ITEMS))items.push({kind:'login',id:match.id,label:match.username||tr('pw.frame.noUsername','No username'),secondary:match.match==='site'?displayHost(match.origin):''});
  }
  if(!items.length){if(shown?.mode==='suggest'&&shown.tabId===owner.tabId)hide();return;}
  hide();
  shown={tabId:owner.tabId,docId:payload.docId,profileId:owner.profileId,origin:normalizeOrigin(owner.url),mode:'suggest',items,index:-1,info};
  ui.show({mode:'suggest',tabId:owner.tabId,rect:info.rect,items:items.map(({kind,label,secondary})=>({kind,label,secondary})),index:-1});
  page.send(owner.tabId,'acira:pw-open',{docId:payload.docId,open:true});
 }
 function validInfo(p){
  if(!ROLES.has(p.role)||!KINDS.has(p.kind)||!FIELD.test(String(p.fieldId))||!p.rect||![p.rect.x,p.rect.y,p.rect.width,p.rect.height].every(finite))return null;
  const ids=list=>Array.isArray(list)&&list.length<=4&&list.every(id=>FIELD.test(String(id)));
  if(!ids(p.passwordIds)||!ids(p.freshIds)||(p.usernameId&&!FIELD.test(String(p.usernameId))))return null;
  return {role:p.role,kind:p.kind,fieldId:p.fieldId,usernameId:p.usernameId||'',passwordIds:p.passwordIds,freshIds:p.freshIds,rect:{x:p.rect.x,y:p.rect.y,width:Math.max(0,p.rect.width),height:Math.max(0,p.rect.height)}};
 }
 function choose(index){
  const current=shown;if(!current||current.mode!=='suggest'||!Number.isInteger(index)||index<0||index>=current.items.length)return;
  const item=current.items[index],tabId=current.tabId,url=page.url(tabId);
  hide();
  if(!url||normalizeOrigin(url)!==current.origin)return;// the tab moved on while the list was open
  if(item.kind==='generate'){
   const password=generate();
   page.send(tabId,'acira:pw-fill',{docId:current.docId,passwordIds:current.info.freshIds,password});
   page.focus(tabId);return;
  }
  let secret;try{secret=vault.secret(current.profileId,item.id);}catch{return;}
  if(!classify(secret.origin,url))return;// never fill a login the page isn't entitled to (also re-checked in main, not trusted from the list)
  page.send(tabId,'acira:pw-fill',{docId:current.docId,usernameId:current.info.usernameId,username:secret.username,passwordIds:current.info.passwordIds.slice(0,1),password:secret.password});
  page.focus(tabId);
 }
 function key(owner,name){
  if(!shown||shown.mode!=='suggest'||shown.tabId!==owner.tabId)return;
  const count=shown.items.length;
  if(name==='Escape'){hide();return;}
  if(name==='ArrowDown')shown.index=(shown.index+1)%count;
  else if(name==='ArrowUp')shown.index=shown.index<=0?count-1:shown.index-1;
  else if(name==='Enter'){if(shown.index>=0)choose(shown.index);else hide();return;}
  ui.show({mode:'suggest',tabId:shown.tabId,rect:shown.info.rect,items:shown.items.map(({kind,label,secondary})=>({kind,label,secondary})),index:shown.index});
 }

 // --- sign-in submitted -----------------------------------------------------------------------------------------------
 function submit(owner,payload){
  if(!KINDS.has(payload.kind)||typeof payload.username!=='string'||payload.username.length>512||typeof payload.password!=='string'||!payload.password||payload.password.length>1024)return;
  const origin=normalizeOrigin(owner.url);if(!origin)return;
  hide();drop(owner.tabId);
  const entry={docId:payload.docId,origin,profileId:owner.profileId,url:owner.url,kind:payload.kind,username:payload.username.trim()||rememberedUsername(owner),password:payload.password,hadPrevious:payload.hadPrevious===true,at:now()};
  entry.timer=timers.setTimeout(()=>drop(owner.tabId),PENDING_MS);entry.timer?.unref?.();
  pending.set(owner.tabId,entry);
  probe(owner.tabId,entry);
 }
 /** Ask the tab's current document whether a sign-in form is showing; repeated until the attempt settles or expires. */
 function probe(tabId,entry){
  entry.probe=timers.setTimeout(()=>{if(pending.get(tabId)!==entry)return;page.send(tabId,'acira:pw-probe',{});probe(tabId,entry);},PROBE_MS);entry.probe?.unref?.();
 }
 /** The sign-in worked (the form is gone or the next page has none): decide whether to ask. */
 function succeeded(tabId,typing){
  const entry=pending.get(tabId);if(!entry)return;drop(tabId);usernames.delete(tabId);
  if(vault.status(entry.profileId).ok!==true||vault.isNever(entry.profileId,entry.origin))return;
  const same=vault.list(entry.profileId).filter(item=>item.origin===entry.origin);
  let target=entry.username?same.find(item=>item.username===entry.username):(same.length===1?same[0]:null);
  if(target){let current;try{current=vault.get(entry.profileId,target.id);}catch{return;}if(current.password===entry.password)return;}
  const kind=target?'update':'save',username=entry.username||target?.username||'';
  shown={tabId,docId:entry.docId,profileId:entry.profileId,origin:entry.origin,mode:'save',kind,username,password:entry.password,items:[],index:-1};
  ui.show({mode:'save',tabId,kind,host:displayHost(entry.origin),username,masked:'•'.repeat(Math.min(12,entry.password.length)),focus:typing!==true});
  shown.timer=timers.setTimeout(()=>{if(shown?.mode==='save'&&shown.tabId===tabId)hide();},PROMPT_MS);shown.timer?.unref?.();
 }
 function ready(owner,payload){
  const entry=pending.get(owner.tabId);
  if(!entry||payload.docId===entry.docId||now()-entry.at>PENDING_MS)return;// same document: the form-gone/stays signals decide
  if(!Number.isInteger(payload.passwordFields)||payload.passwordFields<0)return;// -1: still loading, ask again
  if(payload.passwordFields===0)succeeded(owner.tabId,payload.typing===true);else drop(owner.tabId);
 }
 /** The frame's buttons: save/update, never for this site, or just close. */
 function action(name){
  const current=shown;if(!current||current.mode!=='save')return;
  hide();page.focus(current.tabId);
  try{
   if(name==='save'){vault.save(current.profileId,{origin:current.origin,username:current.username,password:current.password});notify(current.kind==='update'?tr('pw.bridge.updated','Password updated'):tr('pw.bridge.saved','Password saved'));}
   else if(name==='never'){vault.addNever(current.profileId,current.origin);notify(tr('pw.bridge.never','Acira won’t offer to save passwords for {host}',{host:displayHost(current.origin)}));}
  }catch{notify(tr('pw.bridge.saveFailed','Couldn’t save that password'));}
 }

 /* A password manager extension that set chrome.privacy.services.passwordSavingEnabled to false has switched this built-in offer off for the profile. */
 const offByExtension=profileId=>{try{return require('../browser-services/extension-chrome-settings.cjs').passwordSavingOffByExtension(profileId);}catch{return false;}};
 function message(channel,event,payload){
  if(!CHANNELS.has(channel))return;
  const owner=ownerOf(event);
  if(!owner||owner.private||!service.enabled||offByExtension(owner.profileId)||!payload||typeof payload!=='object'||typeof payload.docId!=='string'||payload.docId.length>64)return;
  if(!normalizeOrigin(owner.url)||!allowed(owner.tabId))return;
  switch(channel){
   case 'acira:pw-focus':return owner.active?focus(owner,payload):undefined;
   case 'acira:pw-dismiss':if(shown?.tabId===owner.tabId&&shown.mode==='suggest')hide();return;
   case 'acira:pw-key':return typeof payload.key==='string'&&owner.active?key(owner,payload.key):undefined;
   case 'acira:pw-submit':return submit(owner,payload);
   case 'acira:pw-username':return usernameStep(owner,payload);
   case 'acira:pw-ready':return ready(owner,payload);
   case 'acira:pw-form-gone':{const entry=pending.get(owner.tabId);if(entry&&entry.docId===payload.docId)succeeded(owner.tabId,false);return;}
   case 'acira:pw-form-stays':{const entry=pending.get(owner.tabId);if(entry&&entry.docId===payload.docId)drop(owner.tabId);return;}
  }
 }
 /** After every committed action of the window: a list or prompt belongs to its tab. */
 function onState(state){
  if(shown&&state.activeTabId!==shown.tabId)hide();
  for(const tabId of [...pending.keys()])if(!state.tabs.some(tab=>tab.id===tabId))drop(tabId);
  for(const tabId of [...usernames.keys()])if(!state.tabs.some(tab=>tab.id===tabId))usernames.delete(tabId);
 }
 return {message,choose,action,hide,onState,get shown(){return shown;},pendingFor:tabId=>pending.get(tabId)||null};
}
module.exports={createPageBridge,CHANNELS};
