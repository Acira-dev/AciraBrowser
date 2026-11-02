'use strict';
// Undo close: a closing page's navigation entries, including Chromium's page state (scroll position, form values), kept
// in memory only, so "Tab closed · Undo" and Ctrl+Shift+T bring the page back as it was. Never written to disk; private
// windows never call remember(). Entries expire and are bounded by count and bytes.
function createClosedPages({limit=24,maxBytes=24*1024*1024,ttl=30*60*1000,now=Date.now}={}){
 const pages=new Map();
 const bytes=()=>[...pages.values()].reduce((sum,item)=>sum+item.bytes,0);
 function remember(id,wc){
  try{
   if(typeof id!=='string'||!wc||wc.isDestroyed())return false;
   const all=wc.navigationHistory.getAllEntries(),index=wc.navigationHistory.getActiveIndex();
   if(!all.length||index<0||index>=all.length||!all.every(item=>/^https?:\/\//i.test(item.url)))return false;
   const entries=all.map(item=>({url:item.url,title:item.title||'',...(typeof item.pageState==='string'&&item.pageState.length<=2*1024*1024?{pageState:item.pageState}:{})}));
   const size=entries.reduce((sum,item)=>sum+item.url.length+item.title.length+(item.pageState?.length||0),0);
   pages.delete(id);pages.set(id,{entries,index,at:now(),bytes:size});
   while(pages.size>limit||pages.size>1&&bytes()>maxBytes)pages.delete(pages.keys().next().value);
   return true;
  }catch{return false;}
 }
 /** The kept entries for a reopened tab, once; only when the tab comes back on the same page it closed on. */
 function take(id,url){
  const kept=pages.get(id);pages.delete(id);
  if(!kept||now()-kept.at>ttl||kept.entries[kept.index]?.url!==url)return null;
  return {entries:kept.entries,index:kept.index};
 }
 return {remember,take,forget:id=>pages.delete(id),clear:()=>pages.clear(),get size(){return pages.size;}};
}
module.exports={createClosedPages};
