'use strict';

/** HTML video fullscreen is a temporary native presentation, not a saved browser layout.
 *  Two presentations (Beta 14, "Fullscreen videos fill the window"): the window one, as always (the window goes fullscreen, the page takes the whole screen, Acira's own
 *  interface is hidden), and the fill one (Chromium's "fullscreen within a tab"): the window, the sidebar and the layout stay exactly as they are and the page's fullscreen
 *  element fills the page view where the layout put it. `fillsWindow()` is the setting; holding Alt (Option on a Mac) while pressing the site's fullscreen button or key gives
 *  the other one. Electron's mouse input events carry no modifiers, so the Alt KEY is followed instead (`noteInput`: down until its key-up, at most 8 s). The fill one works in
 *  a window that is already fullscreen too (macOS fullscreen), so the interface is never hidden unless the person asked for the window one.
 *
 *  The window one hides the interface, so it must never be able to strand it (reported 14 Nov: macOS fullscreen + Option + the site's button left a video and nothing else):
 *    - the window is only put back as the page found it: a window that was fullscreen before the page asked is left as it is, and one we made fullscreen is taken out of it only
 *      if it still is. Leaving never turns fullscreen ON (it used to: Esc after the person had left macOS fullscreen pulled the window back into it);
 *    - the person taking the window out of fullscreen (the green button, the menu) ends the page's fullscreen too, as in Chrome (`windowLeftFullScreen`);
 *    - a watchdog asks the page, once a second while the window one shows, whether it still has a fullscreen element, and lets go after two "no" in a row;
 *    - a quit or a window close lets go first (`release`), so the question the close guard asks is never behind a hidden interface. */
const HOLD_MS=8000;   // Alt counts as held for this long after its key went down (a lost key-up must not flip every request for good)
const WATCH_MS=1000,WATCH_MISSES=2;
function createPageFullscreen({getWindow,getChrome,getState,pages,render,hideFloating,placeBounds,focus,screenSize,fillsWindow=()=>false,onFill=()=>{},now=Date.now,every=setInterval,stopEvery=clearInterval}){
 let owner=null,altAt=0,announced=null,watch=null,misses=0;
 const unwatch=()=>{if(watch){stopEvery(watch);watch=null;}misses=0;};
 /* The interface is told which tab fills its page view (Beta 14: the light round the frame takes the video's colours while one does), and again when none does. Only a change is sent. */
 const announce=()=>{const id=owner&&owner.fill?owner.id:null;if(id===announced)return;announced=id;try{onFill(id);}catch{/* a listener must not break fullscreen */}};
 /* A destroyed view has no webContents at all: asking it throws out of the page's 'destroyed' listeners and strands the tab's close. */
 const live=entry=>Boolean(entry&&entry.view&&entry.view.webContents&&!entry.view.webContents.isDestroyed());
 const valid=record=>record&&pages.get(record.id)===record.entry&&live(record.entry)&&getState().activeTabId===record.id&&getState().tabs.some(tab=>tab.id===record.id&&tab.contentKind==='web');
 /* The watchdog: the window presentation hides the interface, so it asks the page (cheaply, once a second) whether a fullscreen element is still there. */
 const startWatch=()=>{
  unwatch();
  watch=every(()=>{
   const record=owner;if(!record||record.fill||record.entering)return;
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
  /** The page is shown in the window presentation: the layout does not place it, `present()` does. A page that fills its page view is placed by the layout as always. */
  isActive:entry=>owner?.entry===entry&&!owner.fill,
  /** A page of this window is in the window presentation (Acira's interface is hidden, the window is fullscreen). */
  any:()=>owner!==null&&!owner.fill,
  /** Any page of this window is in HTML fullscreen, in either presentation. */
  inPage:()=>owner!==null,
  /** This page fills its page view (the fill presentation). */
  fills:entry=>owner?.entry===entry&&owner.fill===true,
  /** An input event of a page, as Electron gives it. Key events say whether Alt is down (`alt`, also the Alt key's own down and up); mouse events say nothing about modifiers. */
  noteInput(input){
   if(!input||!['rawKeyDown','keyDown','keyUp','char'].includes(input.type))return;
   const held=Boolean(input.alt)||(Array.isArray(input.modifiers)&&input.modifiers.includes('alt'));
   altAt=held?(input.isAutoRepeat&&altAt?altAt:now()):0;
  },
  canRequest(contents){
   const state=getState(),entry=pages.get(state.activeTabId);
   return Boolean(entry&&entry.view.webContents===contents&&live(entry)&&entry.view.getVisible()&&state.tabs.some(tab=>tab.id===state.activeTabId&&tab.contentKind==='web')&&/^https?:\/\//i.test(contents.getURL()));
  },
  enter(id,entry){
   const window=getWindow();if(!window||window.isDestroyed()||!api.canRequest(entry.view.webContents))return false;
   if(owner?.entry===entry)return true;
   if(owner)api.leave(owner.entry,true);
   const flipped=altAt>0&&now()-altAt<=HOLD_MS;
   const fill=Boolean(fillsWindow())!==flipped;
   // Fill: nothing about the window or the layout changes. The page's fullscreen element fills the page view the layout placed (Chromium's fullscreen within a tab; Electron's
   // disableHtmlFullscreenWindowResize, set on every page view, keeps the window as it is).
   if(fill){owner={id,entry,fill:true,windowFullscreen:false,entering:false};announce();return true;}
   const was=window.isFullScreen();   // fullscreen before the page asked: what leaving puts back
   owner={id,entry,fill:false,windowFullscreen:was,entering:!was};announce();
   // The window grows to the screen over macOS's transition and reports its new size only as it ends: until then the page takes the
   // screen's size at once, so the video fills the screen from the first frame instead of standing small in its corner on black
   // (reported 30 Oct). Once full screen, it takes the window's exact size.
   if(owner.entering)window.once('enter-full-screen',()=>{if(owner?.entry===entry){owner.entering=false;render();}});
   hideFloating();if(!was)window.setFullScreen(true);render();startWatch();return true;
  },
  leave(entry,exitDocument=false){
   if(!owner||entry&&owner.entry!==entry)return false;
   const previous=owner;owner=null;announce();unwatch();
   if(exitDocument&&live(previous.entry))void previous.entry.view.webContents.executeJavaScript('document.fullscreenElement ? document.exitFullscreen() : undefined').catch(()=>{});
   if(previous.fill)return true;   // nothing was changed for it: nothing to put back
   // Put the window back as the page found it: out of fullscreen if the page took it there and it is still there; never INTO fullscreen (a person who left macOS fullscreen while the
   // video showed does not want Esc to pull the window back).
   const window=getWindow();if(window&&!window.isDestroyed()&&!previous.windowFullscreen&&window.isFullScreen())window.setFullScreen(false);
   const chrome=getChrome();if(chrome&&!chrome.webContents.isDestroyed())chrome.setVisible(true);
   // Force the saved normal bounds/radius through their existing presentation path.
   previous.entry.targetBounds=null;previous.entry.radius=null;if(live(previous.entry))render();else queueMicrotask(render);return true;
  },
  /** The window's own fullscreen command (F11, Ctrl+Cmd+F) while a page fills its page view: the same page goes on to the whole screen, still playing (the quick way to the real
   *  screen). Returns false when no page fills its view; the command then does what it always did. */
  promote(){
   if(!owner||!owner.fill)return false;
   const window=getWindow();if(!window||window.isDestroyed()||!valid(owner))return false;
   if(window.isFullScreen())return false;   // the window is already fullscreen: the command is the way OUT of it, as always
   const entry=owner.entry;owner={...owner,fill:false,windowFullscreen:false,entering:true};announce();
   window.once('enter-full-screen',()=>{if(owner?.entry===entry){owner.entering=false;render();}});
   hideFloating();window.setFullScreen(true);render();startWatch();return true;
  },
  /** The window left fullscreen (the green button, the menu, the window command) while the window presentation shows: the page's fullscreen ends with it, as in Chrome, and the window is
   *  not asked to do anything (the person just did it). A filling page is not affected: it fills the page view in a window of either size. */
  windowLeftFullScreen(){
   if(!owner||owner.fill||owner.entering)return false;
   owner={...owner,windowFullscreen:false};api.leave(owner.entry,true);return true;
  },
  /** A quit or a window close is starting: let go of whatever is showing so the interface (and the question the close guard asks) is there, without touching the window. */
  release(){
   if(!owner)return false;
   const previous=owner;owner=null;announce();unwatch();
   if(previous.fill)return true;
   const chrome=getChrome();if(chrome&&!chrome.webContents.isDestroyed())chrome.setVisible(true);
   previous.entry.targetBounds=null;previous.entry.radius=null;if(live(previous.entry))render();return true;
  },
  reconcile(){if(owner&&!valid(owner))api.leave(owner.entry,true);},
  windowPreference(current){return owner&&!owner.fill?owner.windowFullscreen:current;},
  present(){
   if(!valid(owner)||owner.fill)return;
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
