'use strict';
// chrome.bookmarks, chrome.history, chrome.sessions and chrome.search for extensions, answered from Acira's own stores of the extension's profile
// (never another profile's, never private windows). Read-only: an extension can read and search what the person already has, and chrome.search
// opens a search in a new tab with the person's search engine. Writes are refused in plain words, so nothing an extension does changes the
// person's bookmarks or history behind their back. Each namespace still needs its permission in the manifest, which the install review lists.
const READ_ONLY_BOOKMARKS='Acira lets extensions read bookmarks but not change them.';
const READ_ONLY_HISTORY='Acira lets extensions read history but not change it.';
const NO_RESTORE='Acira does not let extensions reopen tabs. Use Reopen closed tab (Ctrl+Shift+T).';
const ROOT='0',BAR='1';
const failure=message=>({__acira_error:message});
const time=value=>{const n=typeof value==='number'?value:Date.parse(value);return Number.isFinite(n)?n:0;};

/** Chrome's BookmarkTreeNode tree from Acira's flat nodes: a root ("0") holding one "Bookmarks bar" folder ("1") with the top-level items. */
function bookmarkTree(nodes){
 const byParent=new Map();for(const node of nodes){const key=node.parentId||BAR;if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(node);}
 for(const list of byParent.values())list.sort((a,b)=>(a.position??0)-(b.position??0));
 const seen=new Set();
 const build=(node,index,parentId)=>{
  if(seen.has(node.id))return null;seen.add(node.id);
  const out={id:String(node.id),parentId,index,title:String(node.title||''),dateAdded:time(node.createdAt)};
  if(node.url)out.url=String(node.url);else out.children=(byParent.get(node.id)||[]).map((child,i)=>build(child,i,String(node.id))).filter(Boolean);
  return out;
 };
 const bar={id:BAR,parentId:ROOT,index:0,title:'Bookmarks bar',dateAdded:0,folderType:'bookmarks-bar',children:(byParent.get(BAR)||[]).map((node,i)=>build(node,i,BAR)).filter(Boolean)};
 return {id:ROOT,title:'',dateAdded:0,children:[bar]};
}
function flatten(tree){const out=[];const walk=node=>{out.push(node);for(const child of node.children||[])walk(child);};walk(tree);return out;}
const shallow=node=>{const {children,...rest}=node;return children?{...rest}:rest;};

function bookmarksApi(getNodes){
 const tree=()=>bookmarkTree(getNodes());
 const find=id=>flatten(tree()).find(node=>node.id===String(id));
 return {
  getTree:()=>[tree()],
  getSubTree:(_event,id)=>{const node=find(id);return node?[node]:failure("Can't find bookmark for id.");},
  get:(_event,ids)=>{const list=(Array.isArray(ids)?ids:[ids]).map(id=>find(id));return list.every(Boolean)?list.map(shallow):failure("Can't find bookmark for id.");},
  getChildren:(_event,id)=>{const node=find(id);return node?(node.children||[]).map(shallow):failure("Can't find parent bookmark for id.");},
  getRecent:(_event,count)=>flatten(tree()).filter(node=>node.url).sort((a,b)=>b.dateAdded-a.dateAdded).slice(0,Math.max(1,Math.min(Number(count)||1,1000))).map(shallow),
  search:(_event,query)=>{
   const all=flatten(tree()).filter(node=>node.id!==ROOT&&node.id!==BAR);
   if(typeof query==='string'){const words=query.toLowerCase().split(/\s+/).filter(Boolean);return all.filter(node=>words.every(word=>(node.title+' '+(node.url||'')).toLowerCase().includes(word))).slice(0,1000).map(shallow);}
   const q=query||{};return all.filter(node=>(q.url===undefined||node.url===q.url)&&(q.title===undefined||node.title===q.title)&&(q.query===undefined||String(q.query).toLowerCase().split(/\s+/).filter(Boolean).every(word=>(node.title+' '+(node.url||'')).toLowerCase().includes(word)))).slice(0,1000).map(shallow);
  },
  write:()=>failure(READ_ONLY_BOOKMARKS)
 };
}

function historyApi(getVisits){
 return {
  search(_event,query){
   const q=query||{},text=String(q.text||'').toLowerCase(),start=q.startTime===undefined?Date.now()-24*60*60*1000:time(q.startTime),end=q.endTime===undefined?Infinity:time(q.endTime),max=q.maxResults===undefined?100:Math.max(0,Math.min(Number(q.maxResults)||0,10000));
   const items=new Map();
   for(const visit of getVisits()){
    const at=time(visit.time);if(at<start||at>end)continue;
    if(text&&!(String(visit.title||'')+' '+String(visit.url||'')).toLowerCase().includes(text))continue;
    const item=items.get(visit.url);if(item){item.visitCount++;if(at>item.lastVisitTime){item.lastVisitTime=at;if(visit.title)item.title=visit.title;}}
    else items.set(visit.url,{id:String(visit.id),url:String(visit.url),title:String(visit.title||''),lastVisitTime:at,visitCount:1,typedCount:0});
   }
   return [...items.values()].sort((a,b)=>b.lastVisitTime-a.lastVisitTime).slice(0,max||undefined);
  },
  getVisits(_event,details){const url=details?.url;return getVisits().filter(visit=>visit.url===url).map(visit=>({id:String(visit.id),visitId:String(visit.id),visitTime:time(visit.time),referringVisitId:'0',transition:'link',isLocal:true})).sort((a,b)=>a.visitTime-b.visitTime);},
  write:()=>failure(READ_ONLY_HISTORY)
 };
}

function sessionsApi(getClosed){
 return {
  getRecentlyClosed(_event,filter){
   const max=Math.max(1,Math.min(Number(filter?.maxResults)||25,25));
   return getClosed().filter(tab=>tab&&/^https?:/i.test(String(tab.url||''))).slice(0,max).map((tab,index)=>({lastModified:Math.floor(time(tab.closedAt||tab.lastActive||Date.now())/1000),tab:{sessionId:String(tab.id),index:tab.closedIndex??index,windowId:-1,url:String(tab.url),title:String(tab.title||''),active:false,pinned:!!tab.pinned,highlighted:false,incognito:false,selected:false,discarded:false,autoDiscardable:true,groupId:-1}}));
  },
  getDevices:()=>[],
  restore:()=>failure(NO_RESTORE)
 };
}

module.exports={bookmarkTree,bookmarksApi,historyApi,sessionsApi,READ_ONLY_BOOKMARKS,READ_ONLY_HISTORY,NO_RESTORE};
