'use strict';
const adapted=new WeakMap();   // store -> what the engine's window observers added: [window, event, listener]
/** electron-chrome-extensions 4.9.0: the store forgets a window when its last website tab leaves (removeTab) but the windows API never stops
 * observing it, so the next tab announces the same window again ('window-added') and it is observed again: three more listeners on it (focus,
 * resized, closed) each time a window goes from no website tab to one (MaxListenersExceededWarning after 11), and one more windows.onCreated.
 * The same holds for a tab detached and attached again (a close cancelled by the page's "Leave site?" prompt, an extension moving a tab): the
 * engine's tabs and webNavigation APIs observe it again, two more 'did-start-navigation' listeners on the page each time.
 * Call right after the engine is made, before any package listens: the store's 'window-added' and 'tab-added' listeners are then only the
 * engine's own observers, and each now observes a window or tab once in its life. Its first observers still report its end, and the event
 * itself still reaches every later listener (Acira's tabs, runtime and windows packages follow tabs coming back). No public option exists.
 * What the engine adds to a window is noted, so a removed profile's runtime can let go of the windows it shares with the others. */
const NAVIGATION='did-start-navigation',DISPOSED=/Render frame was disposed before WebFrameMain could be accessed/;
/** A page whose renderer has gone (a crash, or page-hang.cjs ending a page that stopped answering) starts its next navigation from that
 * frame: the engine's webNavigation.onBeforeNavigate reads details.frame.top, Electron throws "Render frame was disposed before WebFrameMain
 * could be accessed", and the throw leaves reload() / loadURL() as an uncaught exception in main and skips the page's later listeners
 * (soak, 11 Nov). The engine's listeners on that event skip exactly that error (no onBeforeNavigate for a navigation that starts from a
 * frame with no document); any other error still throws. They keep their order and count; the engine never removes them. */
function guardNavigation(tab,had){
 for(const listener of tab.listeners(NAVIGATION)){
  if(had.includes(listener))continue;
  const guarded=function(...args){try{return listener.apply(this,args);}catch(error){if(!DISPOSED.test(String(error?.message)))throw error;return undefined;}};
  tab.removeListener(NAVIGATION,listener);tab.on(NAVIGATION,guarded);
 }
}
function observeOnce(runtime){
 const store=runtime?.ctx?.store;if(!store||typeof store.listeners!=='function'||typeof store.on!=='function'||typeof store.removeListener!=='function')return false;
 if(adapted.has(store))return true;
 const added=[];adapted.set(store,added);
 for(const name of ['window-added','tab-added'])for(const observe of store.listeners(name)){
  const seen=new WeakSet();
  const once=function(item,...rest){
   if(item&&typeof item==='object'){if(seen.has(item))return undefined;seen.add(item);}
   if(name==='tab-added'&&typeof item?.listeners==='function'){const had=item.listeners(NAVIGATION);try{return observe.call(this,item,...rest);}finally{guardNavigation(item,had);}}
   if(name!=='window-added'||typeof item?.eventNames!=='function')return observe.call(this,item,...rest);
   const before=new Map(item.eventNames().map(event=>[event,item.listeners(event)]));
   try{return observe.call(this,item,...rest);}
   finally{for(const event of item.eventNames()){const had=before.get(event)||[];for(const listener of item.listeners(event))if(!had.includes(listener))added.push([item,event,listener]);}}
  };
  store.removeListener(name,observe);store.on(name,once);
 }
 return true;
}
/** A removed profile: its engine stops listening to the windows it observed (they stay open for the other profiles). */
function releaseWindows(runtime){
 const added=adapted.get(runtime?.ctx?.store);if(!added)return 0;let released=0;
 for(const [window,event,listener] of added.splice(0))try{if(!window.isDestroyed?.()){window.removeListener(event,listener);released++;}}catch{}
 return released;
}
const observedOnce=runtime=>!!runtime?.ctx?.store&&adapted.has(runtime.ctx.store);
module.exports={observeOnce,observedOnce,releaseWindows,guardNavigation};
