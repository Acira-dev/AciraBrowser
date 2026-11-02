'use strict';

// Revealed chrome uses a page picture while the live view waits off-window.
// Keep the latest layout without changing the website's viewport or visibility.
function createPageParking(){
 const parked=new Map();
 const live=entry=>{const wc=entry?.view?.webContents;return !!wc&&!wc.isDestroyed();};
 function restore(entry){
  const record=parked.get(entry);if(!record)return false;parked.delete(entry);
  const {view,place,setOwn,getOwn}=record;
  // A closed WebContentsView can lose webContents entirely. Restore its method
  // ownership regardless, and keep releasing the other live panes afterward.
  if(setOwn)Object.defineProperty(view,'setBounds',setOwn);else delete view.setBounds;
  if(getOwn)Object.defineProperty(view,'getBounds',getOwn);else delete view.getBounds;
  if(!live(entry))return false;
  place.call(view,entry.parkedBounds);return true;
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
