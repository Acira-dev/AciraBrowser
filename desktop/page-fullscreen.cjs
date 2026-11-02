'use strict';

/** HTML video fullscreen is a temporary native presentation, not a saved browser layout. */
function createPageFullscreen({getWindow,getChrome,getState,pages,render,hideFloating,placeBounds,focus,screenSize}){
 let owner=null;
 /* A destroyed view has no webContents at all: asking it throws out of the page's 'destroyed' listeners and strands the tab's close. */
 const live=entry=>Boolean(entry&&entry.view&&entry.view.webContents&&!entry.view.webContents.isDestroyed());
 const valid=record=>record&&pages.get(record.id)===record.entry&&live(record.entry)&&getState().activeTabId===record.id&&getState().tabs.some(tab=>tab.id===record.id&&tab.contentKind==='web');
 const api={
  isActive:entry=>owner?.entry===entry,
  /** Any page of this window is in HTML fullscreen. */
  any:()=>owner!==null,
  canRequest(contents){
   const state=getState(),entry=pages.get(state.activeTabId);
   return Boolean(entry&&entry.view.webContents===contents&&live(entry)&&entry.view.getVisible()&&state.tabs.some(tab=>tab.id===state.activeTabId&&tab.contentKind==='web')&&/^https?:\/\//i.test(contents.getURL()));
  },
  enter(id,entry){
   const window=getWindow();if(!window||window.isDestroyed()||!api.canRequest(entry.view.webContents))return false;
   if(owner?.entry===entry)return true;
   if(owner)api.leave(owner.entry,true);
   owner={id,entry,windowFullscreen:window.isFullScreen(),entering:!window.isFullScreen()};
   // The window grows to the screen over macOS's transition and reports its new size only as it ends: until then the page takes the
   // screen's size at once, so the video fills the screen from the first frame instead of standing small in its corner on black
   // (founder, 30 Oct). Once full screen, it takes the window's exact size.
   if(owner.entering)window.once('enter-full-screen',()=>{if(owner?.entry===entry){owner.entering=false;render();}});
   hideFloating();window.setFullScreen(true);render();return true;
  },
  leave(entry,exitDocument=false){
   if(!owner||entry&&owner.entry!==entry)return false;
   const previous=owner;owner=null;
   if(exitDocument&&live(previous.entry))void previous.entry.view.webContents.executeJavaScript('document.fullscreenElement ? document.exitFullscreen() : undefined').catch(()=>{});
   const window=getWindow();if(window&&!window.isDestroyed())window.setFullScreen(previous.windowFullscreen);
   const chrome=getChrome();if(chrome&&!chrome.webContents.isDestroyed())chrome.setVisible(true);
   // Force the saved normal bounds/radius through their existing presentation path.
   previous.entry.targetBounds=null;previous.entry.radius=null;if(live(previous.entry))render();else queueMicrotask(render);return true;
  },
  reconcile(){if(owner&&!valid(owner))api.leave(owner.entry,true);},
  windowPreference(current){return owner?owner.windowFullscreen:current;},
  present(){
   if(!valid(owner))return;
   const window=getWindow();if(!window||window.isDestroyed())return;
   let [width,height]=window.getContentSize();const chrome=getChrome();if(chrome)chrome.setVisible(false);
   if(owner.entering&&screenSize){const size=screenSize();if(size){width=Math.max(width,size.width);height=Math.max(height,size.height);}}
   hideFloating();
   for(const entry of pages.values())if(entry!==owner.entry)entry.view.setVisible(false);
   const entry=owner.entry;placeBounds(entry,{x:0,y:0,width,height},false);entry.view.setBorderRadius(0);entry.view.setVisible(true);
   // Raise above the shell and previously painted native material siblings.
   window.contentView.addChildView(entry.view);focus(entry.view.webContents);
  }
 };
 return api;
}
module.exports={createPageFullscreen};
