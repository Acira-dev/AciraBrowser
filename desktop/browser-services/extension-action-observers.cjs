'use strict';
// electron-chrome-extensions' browser-action bridge keeps the interface windows that watch the toolbar in a set, `observers`. Its main-side handlers (dist/cjs/index.js, class
// BrowserActionAPI):
//   browserAction.addObserver:    this.observers.add(observer); observer.once("destroyed", () => this.observers.delete(observer));
//   browserAction.removeObserver: this.observers.delete(observer);
// The first adds a "destroyed" listener to the window's WebContents on EVERY call, and the second never takes it off. The interface asks for an observer whenever the list of buttons
// of a partition goes from none to one, and the toolbar and the sidebar's extension row are rebuilt together at every tab switch (and at every change of the pinned extensions), so the
// count goes through none each time: one more listener on the interface's WebContents for every tab switch, for as long as the window lives. At 11 Node printed, in the main
// process, "MaxListenersExceededWarning: 11 destroyed listeners added to [WebContents]"; the listeners (and what they hold) never went away.
//
// Acira replaces the two handlers on the session's router (the router's own `handle`, the same call the library makes) when the toolbar is attached to a session: the listener is
// added once for each observer and taken off when the observer is removed, and everything else is the library's (the same set, the same options, the same updates). If the library
// is not shaped as this expects (a version that renamed them or fixed the leak itself) nothing is replaced, and the local trace says so; tests/extension-action-observers.test.cjs
// reads the installed library and fails when its handlers are not the ones this replaces.
const {trace}=require('./ext-trace.cjs');
const ADD='browserAction.addObserver',REMOVE='browserAction.removeObserver';
const patched=new WeakSet();

/** Replaces the observer handlers of this runtime's browser action engine. Returns true when they are (or were already) replaced. */
function installObserverFix(runtime){
  const engine=runtime&&runtime.api&&runtime.api.browserAction;
  if(engine&&patched.has(engine))return true;
  const router=engine&&engine.ctx&&engine.ctx.router,handlers=router&&router.handlers;
  const add=handlers&&typeof handlers.get==='function'?handlers.get(ADD):undefined,remove=handlers&&typeof handlers.get==='function'?handlers.get(REMOVE):undefined;
  if(!(engine&&engine.observers instanceof Set)||typeof router.handle!=='function'||!add||!remove||typeof add.callback!=='function'||typeof remove.callback!=='function'){
    try{trace('toolbar observers: the library is not as expected, its observer handlers are kept');}catch{/* a log that cannot be written */}
    return false;
  }
  const held=new WeakMap();   // observer -> the one "destroyed" listener it has
  const release=observer=>{
    const listener=held.get(observer);
    if(!listener)return;
    held.delete(observer);
    try{if(typeof observer.removeListener==='function')observer.removeListener('destroyed',listener);}catch{/* a window that is gone */}
  };
  const options=entry=>({extensionContext:entry.extensionContext,allowRemote:entry.allowRemote,permission:entry.permission});
  router.handle(ADD,event=>{
    if(!event||event.type!=='frame')return;
    const observer=event.sender;
    if(!observer)return;
    engine.observers.add(observer);
    if(held.has(observer)||typeof observer.once!=='function')return;
    const listener=()=>{held.delete(observer);engine.observers.delete(observer);};
    held.set(observer,listener);
    observer.once('destroyed',listener);
  },options(add));
  router.handle(REMOVE,event=>{
    if(!event||event.type!=='frame')return;
    const observer=event.sender;
    engine.observers.delete(observer);
    release(observer);
  },options(remove));
  patched.add(engine);
  return true;
}

module.exports={installObserverFix,ADD,REMOVE};
