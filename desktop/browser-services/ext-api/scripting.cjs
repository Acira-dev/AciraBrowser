'use strict';
// activeTab for chrome.scripting (work package P8, with the toolbar button / command / menu grants in surfaces/active-tab.cjs).
// Chromium decides who may script a page from the extension's host permissions and its own activeTab grant, which only Chromium's UI creates; in
// Acira a click on the extension's button, its keyboard command or one of its menu items never reaches that, so executeScript and insertCSS on the
// tab the person just used the extension on answered "Cannot access contents of the page" (and Chromium's own tab ids are not Acira's, so its answer
// can be an endless wait). The renderer side (scripting-renderer.cjs) asks here first for an extension that holds activeTab: with a live grant for that
// tab and origin the code runs in the tab (the extension's isolated world for the main frame; subframes of allFrames run in the page's world); without
// one the answer is {unavailable: true} and Chromium's own executeScript / insertCSS go on as before. The same answer when the extension's host permissions
// already cover the tab's page: Chromium's own call runs `files` in the extension's content-script world, which has chrome.runtime (this file's world has
// no chrome object at all, so a password manager's autofill bundle injected after the person clicked its toolbar button failed on its first chrome.runtime
// use: no inline menu, no page details).
const fs=require('node:fs'),path=require('node:path');
const activeTab=require('./surfaces/active-tab.cjs');
const ownPage=require('./surfaces/own-page.cjs');
const {createRelays}=require('./content/relay.cjs'),{createContentWorld}=require('./content/world.cjs');

const UNAVAILABLE={unavailable:true};
const MAX_SOURCE=2*1024*1024;// the text of a func / css
const MAX_FILES=16*1024*1024;// files of the extension: a bundled content script is often several MB (Inspecta's is 3.4 MB); Chrome sets no such limit
// A file's result is its last evaluated value. Electron answers a value it cannot clone (a function: `globalThis.x = x;` ends a script with one)
// with a rejection, after the code has run; Chrome drops a non-serializable result silently. Anything else (a real error) still rejects.
const cloneable=async run=>{try{return await run();}catch(error){if(/could not be cloned/i.test(String(error&&error.message)))return undefined;throw error;}};
const worldOf=id=>1_100_000+[...id].reduce((hash,c)=>(hash*31+c.charCodeAt(0))>>>0,7)%900_000;

module.exports={
 namespaces:['scripting'],
 install(api){
  /* The chrome.* a click-injected script can use (content/world.cjs): the hidden relay pages and the shim that talks to them. */
  const relays=createRelays({});
  const hasPermission=(extension,name)=>{try{return api.permissions?!!api.permissions.has(extension,name):(extension.manifest?.permissions||[]).includes(name);}catch{return false;}};
  const content=createContentWorld({session:api.session,userData:api.userData,relays,activeTab,hasPermission});
  try{api.session?.extensions?.on?.('extension-unloaded',(_event,extension)=>{if(extension&&extension.id)relays.forget(api.session,extension.id);});}catch{/* an engine without extension events: the relay page closes when idle */}
  /* Scripts registered with chrome.scripting.registerContentScripts and persistAcrossSessions (the default) survive a restart, as in Chromium: ext-api/scripting/persist.cjs. */
  const persistent=require('./scripting/persist.cjs').install(api);
  const hasActiveTab=extension=>api.permissions?api.permissions.has(extension,'activeTab'):(extension.manifest?.permissions||[]).includes('activeTab');
  function tabOf(event,target){
   const tabId=target&&Number.isInteger(target.tabId)?target.tabId:null;
   if(tabId===null)throw new Error('Invalid target.');
   const wc=api.store()?.getTabById?.(tabId);
   if(!wc||wc.isDestroyed?.()||!hasActiveTab(event.extension)||!activeTab.has(api.session,event.extension.id,wc.id,wc.getURL()))return null;
   return wc;
  }
  /** Chromium would let this extension script the page on its own host permissions: its own executeScript is the right one (real content-script world). */
  function hostAccess(extension,wc){
   try{return !!api.permissions&&typeof api.permissions.hasOrigin==='function'&&!!api.permissions.hasOrigin(extension,wc.getURL());}catch{return false;}
  }
  function read(extension,files){
   const root=path.resolve(extension.path||'');
   return files.map(file=>{
    const full=path.resolve(root,String(file).replace(/^[\\/]+/,''));
    if(!extension.path||!full.startsWith(root+path.sep))throw new Error(`Could not load file: '${file}'.`);
    let text;try{text=fs.readFileSync(full,'utf8');}catch{throw new Error(`Could not load file: '${file}'.`);}
    if(text.length>MAX_FILES)throw new Error(`Could not load file: '${file}'.`);
    return text;
   });
  }
  // activeTab covers the ORIGIN the person used the extension on, not the frames of the page: a cross-origin iframe (a payment form, a sign-in
  // widget, an ad) is another origin, so code is injected there only when the extension's host permissions cover that frame (Chrome:
  // "Cannot access contents of the frame"). An about:blank / srcdoc frame has the origin of the frame that made it.
  const originOfFrame=frame=>{
   for(let at=frame;at;at=at.parent){
    const url=String(at.url||'');
    if(!/^about:(?:blank|srcdoc)$/i.test(url))return {url,origin:activeTab.originOf(url)};
   }
   return {url:'',origin:''};
  };
  const frameAllowed=(extension,wc,frame)=>{
   const {url,origin}=originOfFrame(frame);
   if(origin&&origin===activeTab.originOf(wc.getURL()))return true;
   try{return !!url&&!!api.permissions&&api.permissions.hasOrigin(extension,url);}catch{return false;}
  };
  const framesOf=(extension,wc,target)=>{
   const all=wc.mainFrame?.framesInSubtree||[wc.mainFrame];
   const asked=Array.isArray(target.frameIds)?all.filter(frame=>frame===wc.mainFrame?target.frameIds.includes(0):target.frameIds.includes(frame.frameTreeNodeId)):target.allFrames===true?all:[wc.mainFrame];
   const allowed=asked.filter(frame=>frameAllowed(extension,wc,frame));
   // allFrames skips the frames it may not touch; a frame named by id that it may not touch is an error.
   if(Array.isArray(target.frameIds)){const denied=asked.find(frame=>!allowed.includes(frame));if(denied)throw new Error(`Cannot access contents of url "${originOfFrame(denied).url||denied.url}". Extension manifest must request permission to access this host.`);}
   return allowed;
  };

  /** Chrome's toolbar never takes the keyboard from the page; Acira's is a web view of its own. Give the page back its focus, only when it is the tab on screen and does not have it,
   *  and never for an extension with a popup: its popup is open and takes the focus itself, and moving the focus would close it. */
  function returnFocus(extension,wc){
   try{
    if(typeof wc.focus!=='function'||wc.isFocused?.())return;
    if(api.runtime?.api?.browserAction?.getPopupUrl?.(extension.id,wc.id))return;
    if(ownPage.pageInFront(api,extension,wc)===false)return;
    wc.focus();
   }catch{/* the view went away: the script still runs */}
  }

  api.handle('scripting.activeTab.executeScript',async(event,details)=>{
   const wc=tabOf(event,details?.target);
   if(!wc||hostAccess(event.extension,wc))return UNAVAILABLE;
   const code=typeof details.source==='string'?details.source:Array.isArray(details.files)?read(event.extension,details.files).join('\n;\n'):null;
   if(code===null||code.length>(typeof details.source==='string'?MAX_SOURCE:MAX_FILES))throw new Error('Exactly one of \'func\' and \'files\' must be specified.');
   const out=[];
   const world=worldOf(event.extension.id);
   // The click / command / menu item that made the grant is a user gesture: Chromium runs the script it injects from there with user activation, so the page's own
   // EyeDropper.open() is allowed (Colorway's magnifier). Chromium's ShowEyeDropper on Windows and Linux also wants the page's view focused, which a click on Acira's separate toolbar view took away.
   const clicked=activeTab.gestureLive(api.session,event.extension.id,wc.id,wc.getURL());
   const gesture=clicked||details.gesture===true;   // details.gesture: the calling extension frame (a popup) has user activation of its own
   if(clicked)returnFocus(event.extension,wc);
   for(const frame of framesOf(event.extension,wc,details.target)){
    const isMain=frame===wc.mainFrame;
    // The isolated world has no chrome object: a package Acira unpacked gets chrome.runtime / storage / i18n first (content/world.cjs), the way a content script has them.
    const shim=isMain&&details.world!=='MAIN'?content.prepare(event.extension,wc,world):null;
    const result=isMain&&details.world!=='MAIN'
     ?(await cloneable(()=>wc.executeJavaScriptInIsolatedWorld(world,[{code:shim?shim+';\n'+code:code}],gesture)))
     :(await cloneable(()=>frame.executeJavaScript(code,gesture)));
    out.push({frameId:isMain?0:frame.frameTreeNodeId,documentId:frame.processId!==undefined?`${frame.processId}:${frame.routingId}`:undefined,result:result===undefined?undefined:result});
   }
   return out.map(entry=>(entry.documentId===undefined?{frameId:entry.frameId,result:entry.result}:entry));
  });
  // A one-time message from the extension (chrome.tabs.sendMessage, tabs-renderer.cjs asks first for an extension that holds activeTab) to the chrome.runtime.onMessage listeners of
  // the world it injected after a click: one more receiver of the channel Chromium's own call opens (content/world.cjs deliver). {delivered:false}: this world is not a receiver
  // (no grant, no world, a host-covered page, another frame, no listener) and the engine's own tabs.sendMessage is the whole answer.
  api.handle('scripting.activeTab.deliver',async(event,details)=>{
   try{
    const wc=tabOf(event,{tabId:details&&details.tabId});
    if(!wc||hostAccess(event.extension,wc))return {delivered:false};
    return await content.deliver(event.extension,wc,details);
   }catch{return {delivered:false};}
  });
  // Chromium keys a sheet an extension inserted by the extension and its code, or by the file (scripting_api.cc InjectionKeyForCode / InjectionKeyForFile; every file of
  // `files` is a sheet of its own), and removeCSS takes out the sheet with that key. wc.insertCSS answers a key of its own: they are kept per page, so a removeCSS
  // after an insertCSS made here (an activeTab grant: Chromium's own removeCSS knows nothing of it) can find them. A sub-frame's sheet is a <style> carrying the key.
  const inserted=new WeakMap();
  const sourceKey=(extension,origin,sig)=>`${extension.id}|${origin}|${sig}`;
  const marker=key=>require('node:crypto').createHash('sha1').update(key).digest('hex').slice(0,16);
  const fileSignature=file=>'file:'+path.posix.normalize(String(file).replace(/\\/g,'/').replace(/^\/+/,''));
  function cssRequest(event,details,{needsText}){
   const css=typeof details.css==='string'?details.css:Array.isArray(details.files)?read(event.extension,details.files):null;
   const length=typeof css==='string'?css.length:Array.isArray(css)?css.join('\n').length:0;
   if(css===null||length>(typeof details.css==='string'?MAX_SOURCE:MAX_FILES))throw new Error('Exactly one of \'css\' and \'files\' must be specified.');
   const origin=details.origin==='USER'?'USER':'AUTHOR';
   const sources=typeof css==='string'?[{sig:'code:'+css,css}]:css.map((text,at)=>({sig:fileSignature(details.files[at]),css:needsText?text:''}));
   return {origin,sources};
  }
  api.handle('scripting.activeTab.insertCSS',async(event,details)=>{
   const wc=tabOf(event,details?.target);
   if(!wc||hostAccess(event.extension,wc))return UNAVAILABLE;
   const {origin,sources}=cssRequest(event,details,{needsText:true});
   const kept=inserted.get(wc)||inserted.set(wc,new Map()).get(wc);
   for(const frame of framesOf(event.extension,wc,details.target)){
    for(const source of sources){
     const key=sourceKey(event.extension,origin,source.sig);
     if(frame===wc.mainFrame){const list=kept.get(key)||[];list.push(await wc.insertCSS(source.css,{cssOrigin:origin==='USER'?'user':'author'}));kept.set(key,list.slice(-50));}
     else await frame.executeJavaScript(`(()=>{const s=document.createElement('style');s.setAttribute('data-acira-css',${JSON.stringify(marker(key))});s.textContent=${JSON.stringify(source.css)};(document.head||document.documentElement).append(s);})()`);
    }
   }
   return undefined;
  });
  api.handle('scripting.activeTab.removeCSS',async(event,details)=>{
   const wc=tabOf(event,details?.target);
   if(!wc||hostAccess(event.extension,wc))return UNAVAILABLE;
   const {origin,sources}=cssRequest(event,details,{needsText:false});
   const kept=inserted.get(wc)||new Map();
   for(const frame of framesOf(event.extension,wc,details.target)){
    for(const source of sources){
     const key=sourceKey(event.extension,origin,source.sig);
     if(frame===wc.mainFrame){for(const id of kept.get(key)||[])try{await wc.removeInsertedCSS(id);}catch{/* the page it was inserted into is gone */}kept.delete(key);}
     else await frame.executeJavaScript(`document.querySelectorAll('style[data-acira-css="${marker(key)}"]').forEach(style=>style.remove())`);
    }
   }
   return undefined;
  });
  return {forget:id=>{activeTab.clear(api.session,id);relays.forget(api.session,id);persistent.forget(id);},dispose:()=>{relays.closeAll();persistent.dispose();}};
 }
};
