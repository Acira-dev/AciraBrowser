'use strict';

// Revealed chrome uses a page picture while the live view waits off-window.
// Keep the latest layout without changing the website's viewport or visibility.
// 13.10 (laptop, 15 Nov, Windows: after an unfocused reveal the page could stay at {0,72,1280x608} under an empty dark band until a resize): a page parked for a reveal records the rectangles it is asked for and the release
// applies the last of them. `settled(entry)` says the layout's own rectangle may stand in for it (the page is not in HTML fullscreen); then, when no glide of the page is running (`boundsTimer`), the release
// lands on the rectangle of the last layout (`targetBounds`) rather than on whatever swallowed call came last. In every ordinary case the two are the same.
function createPageParking({settled=()=>true,log=null}={}){
 const parked=new Map(),same=(a,b)=>!!a&&!!b&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
 const live=entry=>{const wc=entry?.view?.webContents;return !!wc&&!wc.isDestroyed();};
 function restore(entry){
  const record=parked.get(entry);if(!record)return false;parked.delete(entry);
  const {view,place,setOwn,getOwn}=record;
  // A closed WebContentsView can lose webContents entirely. Restore its method
  // ownership regardless, and keep releasing the other live panes afterward.
  if(setOwn)Object.defineProperty(view,'setBounds',setOwn);else delete view.setBounds;
  if(getOwn)Object.defineProperty(view,'getBounds',getOwn);else delete view.getBounds;
  if(!live(entry))return false;
  const wanted=entry.targetBounds&&!entry.boundsTimer&&settled(entry)?entry.targetBounds:entry.parkedBounds;
  if(log&&!same(wanted,entry.parkedBounds))try{log('[park] release: parked at',JSON.stringify(entry.parkedBounds),'but the last layout says',JSON.stringify(wanted));}catch{/* a log that throws */}
  place.call(view,{...wanted});return true;
 }
 return {
  park(entry){
   if(parked.has(entry))return true;if(!live(entry))return false;
   const view=entry.view,place=view.setBounds,bounds=view.getBounds();
   const record={view,place,setOwn:Object.getOwnPropertyDescriptor(view,'setBounds'),getOwn:Object.getOwnPropertyDescriptor(view,'getBounds')};
   entry.parkedBounds=bounds;parked.set(entry,record);
   view.setBounds=next=>{entry.parkedBounds=next;};view.getBounds=()=>({...entry.parkedBounds});
   try{place.call(view,{...bounds,x:-bounds.width-64});return true;}
   catch(error){restore(entry);throw error;}
  },
  // A detached/closed page cannot leave an obsolete override in a later release.
  forget:restore,
  release(){for(const entry of [...parked.keys()])restore(entry);},
 };
}
module.exports={createPageParking};
