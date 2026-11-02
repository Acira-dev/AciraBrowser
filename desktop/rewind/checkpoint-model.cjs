'use strict';
// Rewind checkpoint model: an explicit metadata serializer (REWIND_SPEC §1, §7, §8). Only tab/group arrangement is kept —
// URL, title, group name/colour/order, pinned flag, workspace. Never page state, history arrays, forms, favicons or cookies.
const crypto=require('node:crypto');
const SCHEMA=1,MAX_URL=4096,MAX_TITLE=300,SESSION=/^[a-z0-9]{1,16}$/;
const REASONS=['group-close','tabs-close','window-close','periodic','manual'];
const LAYOUTS=['columns','rows','three-columns','three-rows','top-two-bottom-one','top-one-bottom-two','left-one-right-two','left-two-right-one','grid','four-columns','four-rows','left-one-right-three','left-three-right-one','top-one-bottom-three','top-three-bottom-one','three-columns-split-left','three-columns-split-middle','three-columns-split-right','three-rows-split-top','three-rows-split-middle','three-rows-split-bottom','left-two-right-one-over-one','left-one-right-two-over-one','one-over-left-two-right-one','one-over-left-one-right-two','left-one-right-two-one','left-one-right-one-two','right-one-left-two-one','right-one-left-one-two'];
// Conservative: obvious sign-in callbacks and token-bearing URLs are left out (no promise this catches every secret).
const SECRET=/[?&#](access_token|id_token|refresh_token|code|token|password|passwd|session_state|oauth_token|auth|sig|signature)=/i;
function eligibleUrl(value){
 if(typeof value!=='string'||!value||value.length>MAX_URL)return false;
 let url;try{url=new URL(value);}catch{return false;}
 if(url.protocol!=='https:'&&url.protocol!=='http:')return false;
 if(url.username||url.password)return false;
 if(SECRET.test(url.search)||SECRET.test(url.hash))return false;
 return true;
}
const clean=(text,max)=>String(text||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
/** The structural projection of one profile's tabs in one window state. Returns null when nothing is eligible. */
function project(state,profileId){
 const profile=(state?.browserProfiles||[]).find(item=>item.id===profileId);if(!profile||profile.private)return null;
 const own=(state.tabs||[]).filter(tab=>tab.browserProfileId===profileId&&!tab.privacy);
 const groups=[],groupRefs=new Map();let skipped=0;
 const tabs=[],refOf=new Map();
 // R3-57: a tab names the workspace it was in (a tab with no stamp is in the profile's first), and a group is one per workspace.
 const workspaces=(state.workspaces||[]).filter(item=>item.browserProfileId===profileId),first=workspaces[0]?.id||null;
 const workspaceOf=item=>item.workspaceId&&workspaces.some(w=>w.id===item.workspaceId)?item.workspaceId:first;
 for(const tab of own){
  if(tab.contentKind!=='web'||!eligibleUrl(tab.url)){skipped++;continue;}
  let groupRef=null;
  if(tab.group&&!tab.pinned){
   const key=`${workspaceOf(tab)||''}\u0000${tab.group}`;
   if(!groupRefs.has(key)){const source=(state.tabGroups||[]).find(group=>group.name===tab.group&&group.browserProfileId===profileId&&workspaceOf(group)===workspaceOf(tab));groupRef=`g${groups.length}`;groupRefs.set(key,groupRef);groups.push({ref:groupRef,name:clean(tab.group,64),color:source?.color||'none',order:groups.length,collapsed:source?.collapsed===true,workspace:workspaceOf(tab)});}
   groupRef=groupRefs.get(key);
  }
  refOf.set(tab.id,`t${tabs.length}`);
  tabs.push({ref:`t${tabs.length}`,groupRef,order:tabs.length,title:clean(tab.title,MAX_TITLE)||new URL(tab.url).hostname,url:tab.url,pinned:tab.pinned===true,active:tab.id===state.activeTabId,workspace:workspaceOf(tab)});
 }
 if(!tabs.length)return null;
 return {groups,tabs,skipped,splits:splitsOf(state,refOf),workspaceRef:state.activeWorkspaceId||null};
}
/** The window's splits as groups of tab refs. A split with a member that is not saved (private, Tor, an Acira page) is left out whole,
 *  so nothing about it is kept; a tab belongs to one split. */
function splitsOf(state,refOf){
 const ui=state?.windowUi||{},lists=[...(ui.splitGroups||[]),...(ui.split?[ui.split]:[])],used=new Set(),out=[];
 for(const item of lists){
  if(!Array.isArray(item?.tabIds)||item.tabIds.length<2||item.tabIds.length>4)continue;
  const refs=item.tabIds.map(id=>refOf.get(id));
  if(refs.some(ref=>!ref||used.has(ref))||new Set(refs).size!==refs.length)continue;
  refs.forEach(ref=>used.add(ref));out.push({tabRefs:refs,layout:LAYOUTS.includes(item.layout)?item.layout:'columns'});
 }
 return out;
}
/** Order-sensitive hash of the structure only (titles excluded: they change while pages load). */
function payloadHash(payload){
 const shape=JSON.stringify({g:payload.groups.map(g=>[g.ref,g.name,g.color]),t:payload.tabs.map(t=>[t.url,t.groupRef,t.pinned,t.workspace||null]),s:(payload.splits||[]).map(s=>[s.tabRefs.join(','),s.layout])});
 return crypto.createHash('sha256').update(shape).digest('hex').slice(0,32);
}
function makeCheckpoint({payload,profileId,windowId,sessionId='',reason,label,epoch,now}){
 if(!REASONS.includes(reason))throw new Error('Unknown checkpoint reason.');
 const createdAt=now();
 return {schemaVersion:SCHEMA,id:`cp-${createdAt.toString(36)}-${crypto.randomBytes(4).toString('hex')}`,ownerProfileId:profileId,sourceWindowId:String(windowId||''),sessionId:SESSION.test(sessionId)?sessionId:'',workspaceRef:payload.workspaceRef,createdAt,reason,label:clean(label,120),payloadHash:payloadHash(payload),privacyEpoch:epoch,skipped:payload.skipped,groups:payload.groups,tabs:payload.tabs,splits:payload.splits||[]};
}
/** Stored splits kept only when every member is a tab of the checkpoint and no tab is in two. */
function readSplits(value,tabs){
 const refs=new Set(tabs.map(t=>t.ref)),taken=new Set(),out=[];
 for(const item of Array.isArray(value)?value:[]){
  const members=Array.isArray(item?.tabRefs)?item.tabRefs:[];
  if(members.length<2||members.length>4||new Set(members).size!==members.length||members.some(ref=>typeof ref!=='string'||!refs.has(ref)||taken.has(ref)))continue;
  members.forEach(ref=>taken.add(ref));out.push({tabRefs:[...members],layout:LAYOUTS.includes(item.layout)?item.layout:'columns'});
 }
 return out;
}
/** Strict re-read of a stored file: anything off makes the whole record unreadable (isolated, never half-trusted). */
function readCheckpoint(value,profileId){
 if(!value||typeof value!=='object'||value.schemaVersion!==SCHEMA||value.ownerProfileId!==profileId||typeof value.id!=='string'||!/^cp-[a-z0-9]+-[0-9a-f]{8}$/.test(value.id))return null;
 if(!Number.isFinite(value.createdAt)||!REASONS.includes(value.reason)||!Array.isArray(value.tabs)||!Array.isArray(value.groups))return null;
 const space=item=>typeof item.workspace==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(item.workspace)?item.workspace:null;
 const groups=value.groups.filter(g=>g&&typeof g.ref==='string'&&typeof g.name==='string').map(g=>({ref:g.ref,name:clean(g.name,64),color:typeof g.color==='string'?g.color:'none',order:Number(g.order)||0,collapsed:g.collapsed===true,workspace:space(g)}));
 const refs=new Set(groups.map(g=>g.ref));
 const tabs=value.tabs.filter(t=>t&&typeof t.ref==='string'&&eligibleUrl(t.url)).map(t=>({ref:t.ref,groupRef:refs.has(t.groupRef)?t.groupRef:null,order:Number(t.order)||0,title:clean(t.title,MAX_TITLE),url:t.url,pinned:t.pinned===true,active:t.active===true,workspace:space(t)}));
 const splits=readSplits(value.splits,tabs);
 return {...value,workspaceRef:space({workspace:value.workspaceRef}),kept:value.kept===true,sessionId:typeof value.sessionId==='string'&&SESSION.test(value.sessionId)?value.sessionId:'',label:clean(value.label,120),groups,tabs,splits,skipped:Number(value.skipped)||0};
}
/** Exact canonical URL match in the same profile (REWIND_SPEC §5 dedupe): no parameter stripping, no cross-profile match. */
function openUrls(state,profileId){
 const counts=new Map();
 for(const tab of state?.tabs||[])if(tab.browserProfileId===profileId&&typeof tab.url==='string'){let key=tab.url;try{key=new URL(tab.url).href;}catch{}counts.set(key,(counts.get(key)||0)+1);}
 return counts;
}
const canonical=url=>{try{return new URL(url).href;}catch{return url;}};
/** Marks each checkpoint tab already open in the current window (copies are consumed, so two saved copies need two open). */
function markOpen(checkpoint,state,profileId){
 const counts=openUrls(state,profileId);
 return checkpoint.tabs.map(tab=>{const key=canonical(tab.url),n=counts.get(key)||0;if(n>0){counts.set(key,n-1);return {...tab,open:true};}return {...tab,open:false};});
}
const hostOf=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}};
/** What a list row needs: what's in the moment (sites, groups), why it was saved, and, given the live state, how much of it isn't open now. */
function summary(checkpoint,{days,now,state=null,profileId=checkpoint.ownerProfileId}){
 const expiresAt=checkpoint.createdAt+days*86400000,hosts=[...new Set(checkpoint.tabs.map(t=>hostOf(t.url)).filter(Boolean))];
 const closed=state?markOpen(checkpoint,state,profileId).filter(t=>!t.open).length:checkpoint.tabs.length;
 return {id:checkpoint.id,createdAt:checkpoint.createdAt,reason:checkpoint.reason,label:checkpoint.label,tabCount:checkpoint.tabs.length,groupCount:checkpoint.groups.length,skipped:checkpoint.skipped,expiresAt,windowId:checkpoint.sourceWindowId,sessionId:checkpoint.sessionId||'',
  hosts:hosts.slice(0,6),siteCount:hosts.length,sites:siteNames(checkpoint).slice(0,3),groups:checkpoint.groups.map(g=>({name:g.name,color:g.color,count:checkpoint.tabs.filter(t=>t.groupRef===g.ref).length})).slice(0,4),splitCount:(checkpoint.splits||[]).length,closed,kept:checkpoint.kept===true,expired:checkpoint.kept!==true&&expiresAt<=now()};
}
/** Plain site names for a title, most-used first ("Mail", "Figma"): the first label of the host, capitalised, never a TLD. */
function siteNames(checkpoint){
 const counts=new Map();
 for(const tab of checkpoint.tabs){const host=hostOf(tab.url);if(!host)continue;const parts=host.split('.'),name=parts.length>2&&/^(m|app|mail|docs|web)$/.test(parts[0])?parts[1]:parts[0];counts.set(name,(counts.get(name)||0)+1);}
 return [...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([name])=>name.charAt(0).toUpperCase()+name.slice(1));
}
/** How many tabs (and whether a group or label) match a search: titles, addresses, site names, group names. Case-insensitive, plain text. */
function matches(checkpoint,query){
 const q=String(query||'').trim().toLowerCase();if(!q)return {hits:0,any:true};
 const tabHits=checkpoint.tabs.filter(t=>t.title.toLowerCase().includes(q)||t.url.toLowerCase().includes(q)).length;
 const other=checkpoint.groups.some(g=>g.name.toLowerCase().includes(q))||String(checkpoint.label||'').toLowerCase().includes(q);
 return {hits:tabHits,any:tabHits>0||other};
}
/** Tabs added and removed between two moments of the same window (exact canonical URLs, copies counted). */
function diff(before,after){
 const count=list=>{const map=new Map();for(const t of list){const key=canonical(t.url);map.set(key,(map.get(key)||0)+1);}return map;};
 const a=count(before.tabs),b=count(after.tabs);let added=0,removed=0;
 for(const [key,n] of b)added+=Math.max(0,n-(a.get(key)||0));
 for(const [key,n] of a)removed+=Math.max(0,n-(b.get(key)||0));
 return {added,removed};
}
function sameOrigin(url,origin){try{return new URL(url).origin===new URL(origin).origin;}catch{return false;}}
module.exports={SCHEMA,REASONS,LAYOUTS,eligibleUrl,project,payloadHash,makeCheckpoint,readCheckpoint,markOpen,canonical,summary,siteNames,matches,diff,sameOrigin};
