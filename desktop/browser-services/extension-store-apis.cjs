'use strict';
// chrome.bookmarks, chrome.history, chrome.sessions and chrome.search for extensions, answered from Acira's own stores of the extension's profile
// (never another profile's, never private windows, never a page saved from a Tor tab).
//  - bookmarks: read, and changed the way Chrome allows (create, update, move, remove, removeTree) for an extension that holds the "bookmarks"
//    permission, which the install review lists as "Read and change your bookmarks". Chrome's tree and rules over Acira's nodes are in
//    extension-bookmarks.cjs; a change goes through main.cjs into Acira's own store, so the sidebar, bar and bookmarks page follow at once.
//  - history and sessions stay read-only; chrome.search opens a search in a new tab with the person's search engine. A refused write says so
//    in plain words, so nothing an extension does changes the person's history behind their back.
const model = require('./extension-bookmarks.cjs');
const READ_ONLY_HISTORY='Acira lets extensions read history but not change it.';
const NO_RESTORE='Acira does not let extensions reopen tabs. Use Reopen closed tab (Ctrl+Shift+T).';
const NO_BOOKMARK_STORE='Acira cannot change bookmarks right now.';
const ROOT=model.ROOT,BAR=model.BAR;
const failure=message=>({__acira_error:message});
const time=value=>{const n=typeof value==='number'?value:Date.parse(value);return Number.isFinite(n)?n:0;};

/** Chrome's BookmarkTreeNode tree from Acira's flat nodes (extension-bookmarks.cjs explains how the two trees line up). */
const bookmarkTree=nodes=>model.createView(nodes).tree();

/**
 * getNodes(): this profile's bookmark nodes. host.update(compute): runs compute(nodes, {owned}) on the profile's current nodes and, when it answers
 * {nodes}, makes them the profile's bookmarks (extension-bookmark-buffer.cjs, then main.cjs `bookmark.replace`); it answers what compute answered.
 * Without a host the writes fail.
 */
function bookmarksApi(getNodes,host={}){
 const view=()=>model.createView(getNodes());
 const words=query=>String(query).toLowerCase().split(/\s+/).filter(Boolean);
 const has=(node,list)=>list.every(word=>(node.title+' '+(node.url||'')).toLowerCase().includes(word));
 const changing=run=>{
  if(typeof host.update!=='function')return failure(NO_BOOKMARK_STORE);
  let done;try{done=host.update(run);}catch(error){return failure(String(error?.message||error).slice(0,300));}
  return done&&done.error?failure(done.error):done?.result;
 };
 return {
  getTree:()=>[view().tree()],
  getSubTree:(_event,id)=>{const v=view();return typeof id==='string'&&v.exists(id)?[v.subTree(id)]:failure(model.ERRORS.noNode);},
  get:(_event,ids)=>{const v=view(),list=(Array.isArray(ids)?ids:[ids]).map(id=>typeof id==='string'&&v.exists(id)?v.record(id):null);return list.every(Boolean)?list:failure(model.ERRORS.noNode);},
  getChildren:(_event,id)=>{const v=view();return typeof id==='string'&&v.exists(id)&&v.listOf(id)?v.idsUnder(id).map(child=>v.record(child)):failure(model.ERRORS.noNode);},
  getRecent:(_event,count)=>{const v=view();return v.all().map(id=>v.record(id)).filter(node=>node&&node.url).sort((a,b)=>b.dateAdded-a.dateAdded).slice(0,Math.max(1,Math.min(Number(count)||1,1000)));},
  search:(_event,query)=>{
   const v=view(),all=v.all().filter(id=>id!==ROOT&&id!==BAR&&id!==model.OTHER).map(id=>v.record(id));
   if(typeof query==='string')return all.filter(node=>has(node,words(query))).slice(0,1000);
   const q=query||{};return all.filter(node=>(q.url===undefined||node.url===q.url)&&(q.title===undefined||node.title===q.title)&&(q.query===undefined||has(node,words(q.query)))).slice(0,1000);
  },
  create:(_event,info)=>changing((nodes,ctx)=>model.create(nodes,info,{profileId:host.profileId,owned:!!ctx?.owned})),
  update:(_event,id,changes)=>changing((nodes,ctx)=>model.update(nodes,id,changes,{owned:!!ctx?.owned})),
  move:(_event,id,destination)=>changing((nodes,ctx)=>model.move(nodes,id,destination,{profileId:host.profileId,owned:!!ctx?.owned})),
  remove:(_event,id)=>changing((nodes,ctx)=>model.remove(nodes,id,{recursive:false,owned:!!ctx?.owned})),
  removeTree:(_event,id)=>changing((nodes,ctx)=>model.remove(nodes,id,{recursive:true,owned:!!ctx?.owned}))
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

module.exports={bookmarkTree,bookmarksApi,historyApi,sessionsApi,READ_ONLY_HISTORY,NO_RESTORE,NO_BOOKMARK_STORE};
