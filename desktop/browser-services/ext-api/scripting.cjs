'use strict';
// activeTab for chrome.scripting (work package P8, with the toolbar button / command / menu grants in surfaces/active-tab.cjs).
// Chromium decides who may script a page from the extension's host permissions and its own activeTab grant, which only Chromium's UI creates; in
// Acira a click on the extension's button, its keyboard command or one of its menu items never reaches that, so executeScript and insertCSS on the
// tab the person just used the extension on answered "Cannot access contents of the page" (and Chromium's own tab ids are not Acira's, so its answer
// can be an endless wait). The renderer side (scripting-renderer.cjs) asks here first for an extension that holds activeTab: with a live grant for that
// tab and origin the code runs in the tab (the extension's isolated world for the main frame; subframes of allFrames run in the page's world); without
// one the answer is {unavailable: true} and Chromium's own executeScript / insertCSS go on as before.
const fs=require('node:fs'),path=require('node:path');
const activeTab=require('./surfaces/active-tab.cjs');

const UNAVAILABLE={unavailable:true};
const MAX_SOURCE=2*1024*1024;
const worldOf=id=>1_100_000+[...id].reduce((hash,c)=>(hash*31+c.charCodeAt(0))>>>0,7)%900_000;

module.exports={
 namespaces:['scripting'],
 install(api){
  const hasActiveTab=extension=>api.permissions?api.permissions.has(extension,'activeTab'):(extension.manifest?.permissions||[]).includes('activeTab');
  function tabOf(event,target){
   const tabId=target&&Number.isInteger(target.tabId)?target.tabId:null;
   if(tabId===null)throw new Error('Invalid target.');
   const wc=api.store()?.getTabById?.(tabId);
   if(!wc||wc.isDestroyed?.()||!hasActiveTab(event.extension)||!activeTab.has(api.session,event.extension.id,wc.id,wc.getURL()))return null;
   return wc;
  }
  function read(extension,files){
   const root=path.resolve(extension.path||'');
   return files.map(file=>{
    const full=path.resolve(root,String(file).replace(/^[\\/]+/,''));
    if(!extension.path||!full.startsWith(root+path.sep))throw new Error(`Could not load file: '${file}'.`);
    let text;try{text=fs.readFileSync(full,'utf8');}catch{throw new Error(`Could not load file: '${file}'.`);}
    if(text.length>MAX_SOURCE)throw new Error(`Could not load file: '${file}'.`);
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

  api.handle('scripting.activeTab.executeScript',async(event,details)=>{
   const wc=tabOf(event,details?.target);
   if(!wc)return UNAVAILABLE;
   const code=typeof details.source==='string'?details.source:Array.isArray(details.files)?read(event.extension,details.files).join('\n;\n'):null;
   if(code===null||code.length>MAX_SOURCE)throw new Error('Exactly one of \'func\' and \'files\' must be specified.');
   const out=[];
   for(const frame of framesOf(event.extension,wc,details.target)){
    const isMain=frame===wc.mainFrame;
    const result=isMain&&details.world!=='MAIN'
     ?(await wc.executeJavaScriptInIsolatedWorld(worldOf(event.extension.id),[{code}]))
     :(await frame.executeJavaScript(code));
    out.push({frameId:isMain?0:frame.frameTreeNodeId,documentId:frame.processId!==undefined?`${frame.processId}:${frame.routingId}`:undefined,result:result===undefined?undefined:result});
   }
   return out.map(entry=>(entry.documentId===undefined?{frameId:entry.frameId,result:entry.result}:entry));
  });
  api.handle('scripting.activeTab.insertCSS',async(event,details)=>{
   const wc=tabOf(event,details?.target);
   if(!wc)return UNAVAILABLE;
   const css=typeof details.css==='string'?details.css:Array.isArray(details.files)?read(event.extension,details.files).join('\n'):null;
   if(css===null||css.length>MAX_SOURCE)throw new Error('Exactly one of \'css\' and \'files\' must be specified.');
   for(const frame of framesOf(event.extension,wc,details.target)){
    if(frame===wc.mainFrame)await wc.insertCSS(css,{cssOrigin:details.origin==='USER'?'user':'author'});
    else await frame.executeJavaScript(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).append(s);})()`);
   }
   return undefined;
  });
  return {forget:id=>activeTab.clear(api.session,id)};
 }
};
