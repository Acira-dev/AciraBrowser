'use strict';

/** HTML video fullscreen is a temporary native presentation, not a saved browser layout.
 *  It hides the interface, so it must never be able to strand it (reported 14 Nov: macOS fullscreen + a video's fullscreen button left a video and nothing else):
 *    - the window is only put back as the page found it: a window that was fullscreen before the page asked is left as it is, and one the page took there is taken out of it only
 *      if it still is. Leaving never turns fullscreen ON (it used to: Esc after the person had left macOS fullscreen pulled the window back into it);
 *    - the person taking the window out of fullscreen (the green button, the menu) ends the page's fullscreen too, as in Chrome (`windowLeftFullScreen`);
 *    - a watchdog asks the page, once a second while it shows, whether it still has a fullscreen element, and lets go after two "no" in a row;
 *    - a quit or a window close lets go first (`release`), so the question the close guard asks is never behind a hidden interface. */
const WATCH_MS=1000,WATCH_MISSES=2;
function createPageFullscreen({getWindow,getChrome,getState,pages,render,hideFloating,placeBounds,focus,screenSize,every=setInterval,stopEvery=clearInterval}){
 let owner=null,watch=null,misses=0;
 const unwatch=()=>{if(watch){stopEvery(watch);watch=null;}misses=0;};
 /* A destroyed view has no webContents at all: asking it throws out of the page's 'destroyed' listeners and strands the tab's close. */
 const live=entry=>Boolean(entry&&entry.view&&entry.view.webContents&&!entry.view.webContents.isDestroyed());
 const valid=record=>record&&pages.get(record.id)===record.entry&&live(record.entry)&&getState().activeTabId===record.id&&getState().tabs.some(tab=>tab.id===record.id&&tab.contentKind==='web');
 /* The watchdog: the presentation hides the interface, so it asks the page (cheaply, once a second) whether a fullscreen element is still there. */
 const startWatch=()=>{
  unwatch();
  watch=every(()=>{
   const record=owner;if(!record||record.entering)return;
   if(!valid(record)){api.leave(record.entry,true);return;}
   Promise.resolve().then(()=>record.entry.view.webContents.executeJavaScript('Boolean(document.fullscreenElement)',true)).then(has=>{
    if(owner!==record)return;
    if(has){misses=0;return;}
    if(++misses>=WATCH_MISSES)api.leave(record.entry,false);
   },()=>{});
  },WATCH_MS);
  if(watch&&watch.unref)watch.unref();
 };
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
   const was=window.isFullScreen();   // fullscreen before the page asked: what leaving puts back
   owner={id,entry,windowFullscreen:was,entering:!was};
   // The window grows to the screen over macOS's transition and reports its new size only as it ends: until then the page takes the
   // screen's size at once, so the video fills the screen from the first frame instead of standing small in its corner on black
   // (reported 30 Oct). Once full screen, it takes the window's exact size.
   if(owner.entering)window.once('enter-full-screen',()=>{if(owner?.entry===entry){owner.entering=false;render();}});
   hideFloating();if(!was)window.setFullScreen(true);render();startWatch();return true;
  },
  leave(entry,exitDocument=false){
   if(!owner||entry&&owner.entry!==entry)return false;
   const previous=owner;owner=null;unwatch();
   if(exitDocument&&live(previous.entry))void previous.entry.view.webContents.executeJavaScript('document.fullscreenElement ? document.exitFullscreen() : undefined').catch(()=>{});
   // Put the window back as the page found it: out of fullscreen if the page took it there and it is still there; never INTO fullscreen (a person who left macOS fullscreen while the
   // video showed does not want Esc to pull the window back).
   const window=getWindow();if(window&&!window.isDestroyed()&&!previous.windowFullscreen&&window.isFullScreen())window.setFullScreen(false);
   const chrome=getChrome();if(chrome&&!chrome.webContents.isDestroyed())chrome.setVisible(true);
   // Force the saved normal bounds/radius through their existing presentation path.
   previous.entry.targetBounds=null;previous.entry.radius=null;if(live(previous.entry))render();else queueMicrotask(render);return true;
  },
  /** The window left fullscreen (the green button, the menu, the window command) while the page shows: the page's fullscreen ends with it, as in Chrome, and the window is not asked to
   *  do anything (the person just did it). */
  windowLeftFullScreen(){
   if(!owner||owner.entering)return false;
   owner={...owner,windowFullscreen:false};api.leave(owner.entry,true);return true;
  },
  /** A quit or a window close is starting: let go of whatever is showing so the interface (and the question the close guard asks) is there, without touching the window. */
  release(){
   if(!owner)return false;
   const previous=owner;owner=null;unwatch();
   const chrome=getChrome();if(chrome&&!chrome.webContents.isDestroyed())chrome.setVisible(true);
   previous.entry.targetBounds=null;previous.entry.radius=null;if(live(previous.entry))render();return true;
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
