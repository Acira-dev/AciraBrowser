'use strict';
// chrome.webNavigation (P5): Chrome 152's events and frame queries for every tab of the profile (the engine's tab store), replacing the
// engine's partial version (empty transitionType, no onErrorOccurred, onCompleted twice, documentId "not-implemented").
//
// Electron source of each event (webContents of a tab):
//   onBeforeNavigate      did-start-navigation (cross-document)          onCommitted          did-frame-navigate (not for error pages)
//   onDOMContentLoaded    dom-ready (main frame) / frame dom-ready       onCompleted          did-frame-finish-load
//   onErrorOccurred       did-fail-provisional-load / did-fail-load      onHistoryStateUpdated / onReferenceFragmentUpdated
//                                                                                            did-navigate-in-page (fragment-only change or not)
// transitionType / transitionQualifiers (Chrome's PageTransition, which Electron does not expose) are derived: a navigation the page
// started (will-frame-navigate) is 'link' (+ client_redirect while the previous document was still loading), a history move keeps the
// entry's own type + forward_back, a reload of the same entry is 'reload', anything the browser started is 'typed' + from_address_bar
// ('link' for the first load of a tab opened by a page, 'auto_toplevel' for non-web pages), redirects add server_redirect; sub-frames are
// auto_subframe, or manual_subframe when the navigation added a history entry.
// Events go to every extension listening (webNavigation needs no host permission); URL filters are applied in the extension context.
// Not done (deferred, see the P5 report): onCreatedNavigationTarget keeps the engine's version (first navigation of a tab), onTabReplaced
// never fires (Acira never swaps a tab's contents), onErrorOccurred for navigations aborted before commit (Electron reports nothing).
const {documentsFor,frameIdOf,frameFields,read}=require('./web-navigation/frames.cjs');

const PREFIX='aciraWebNavigation.';
const NAMES=['onBeforeNavigate','onCommitted','onDOMContentLoaded','onCompleted','onErrorOccurred','onHistoryStateUpdated','onReferenceFragmentUpdated'];
const QUALIFIER_ORDER=['client_redirect','server_redirect','forward_back','from_address_bar'];
const WEB=/^(?:https?|file|ftp|data|blob|about):/i;
const errorText=description=>{const text=String(description||'ERR_FAILED');return text.startsWith('net::')?text:'net::'+text;};
const stripFragment=url=>{const at=String(url).indexOf('#');return at<0?String(url):String(url).slice(0,at);};

function install(api){
 const session=api.session;if(!session)return {};
 const docs=documentsFor(session);
 const observed=new WeakSet();
 const tabs=new WeakMap();            // webContents -> tab state
 const errors=new WeakMap();          // frame -> errorOccurred
 const urls=new WeakMap();            // frame -> last committed URL (for fragment vs history-state)
 const fromId=(pid,rid)=>{try{return require('electron').webFrameMain.fromId(pid,rid)||null;}catch{return null;}};
 const store=()=>{try{return api.store();}catch{return null;}};
 const listening=name=>{try{return api.listening(PREFIX+name).length>0;}catch{return false;}};
 const send=(name,details)=>{try{api.broadcast(PREFIX+name,details);}catch{}};
 const keyOf=frame=>read(()=>frame.frameTreeNodeId,null);
 const history=wc=>{const nav=read(()=>wc.navigationHistory,null);return {index:read(()=>nav.getActiveIndex(),-1),length:read(()=>nav.length(),-1)};};

 function stateOf(wc){
  let state=tabs.get(wc);
  if(!state){state={pending:new Map(),loading:new Map(),entries:[],first:true,lastFail:''};tabs.set(wc,state);}
  return state;
 }
 function transition(wc,state,frame,url,sameDocument){
  const key=keyOf(frame),p=state.pending.get(key)||{},now=history(wc),main=!read(()=>frame.parent,null);
  const qualifiers=new Set();let type;
  const moved=p.before&&now.length===p.before.length&&now.index!==p.before.index&&now.index>=0;
  if(!main){
   type=p.before&&now.length>p.before.length?'manual_subframe':'auto_subframe';
   if(moved)qualifiers.add('forward_back');
  }else if(moved){type=state.entries[now.index]||'link';qualifiers.add('forward_back');}
  else if(sameDocument){type='link';}
  else if(p.rendererInitiated){type='link';if(p.clientRedirect)qualifiers.add('client_redirect');}
  else if(p.before&&now.length===p.before.length&&now.index===p.before.index&&p.previousUrl&&stripFragment(p.previousUrl)===stripFragment(url)){type='reload';}
  else if(!WEB.test(url)||/^about:/i.test(url)){type='auto_toplevel';}
  else if(state.first&&read(()=>wc.opener,null)){type='link';}
  else{type='typed';qualifiers.add('from_address_bar');}
  if(p.serverRedirect)qualifiers.add('server_redirect');
  if(main&&!sameDocument){if(now.index>=0&&!moved)state.entries[now.index]=type;state.first=false;}
  state.pending.delete(key);
  return {transitionType:type,transitionQualifiers:QUALIFIER_ORDER.filter(q=>qualifiers.has(q))};
 }
 function base(wc,frame,url,{document=true}={}){
  return {tabId:wc.id,url,processId:read(()=>frame.processId,-1),...frameFields(docs,frame,{document}),timeStamp:Date.now()};
 }
 function observe(wc){
  if(!wc||observed.has(wc)||read(()=>wc.isDestroyed(),true))return;
  observed.add(wc);
  const state=stateOf(wc);
  const pend=frame=>{const key=keyOf(frame);if(key===null)return null;let p=state.pending.get(key);if(!p){p={};state.pending.set(key,p);}return p;};
  wc.on('will-frame-navigate',details=>{
   const frame=read(()=>details.frame,null);if(!frame||read(()=>details.isSameDocument,false))return;
   const p=pend(frame);if(!p)return;p.will={url:read(()=>details.url,''),at:Date.now(),loading:state.loading.get(keyOf(frame))===true};
  });
  wc.on('did-start-navigation',details=>{
   const frame=read(()=>details.frame,null);if(!frame)return;
   const url=read(()=>details.url,'');
   if(read(()=>details.isSameDocument,false)){const p=pend(frame);if(p)p.before=history(wc);return;}
   const p=pend(frame);
   if(p){
    // A page-started navigation: will-frame-navigate for the same URL just before (Electron sends nothing for browser-started ones).
    const will=p.will;p.will=null;
    p.rendererInitiated=!!will&&will.url===url&&Date.now()-will.at<2000;p.clientRedirect=p.rendererInitiated&&will.loading;
    p.serverRedirect=false;p.before=history(wc);p.previousUrl=read(()=>frame.url,'');
   }
   if(listening('onBeforeNavigate')){
    const parent=read(()=>frame.parent,null);
    send('onBeforeNavigate',{tabId:wc.id,url,processId:-1,frameId:frameIdOf(frame),parentFrameId:parent?frameIdOf(parent):-1,timeStamp:Date.now(),
     ...(parent?{parentDocumentId:docs.idOf(parent)}:{}),documentLifecycle:'active',frameType:parent?'sub_frame':'outermost_frame'});
   }
  });
  wc.on('did-redirect-navigation',details=>{const frame=read(()=>details.frame,null);const p=frame&&pend(frame);if(p)p.serverRedirect=true;});
  wc.on('did-frame-navigate',(_event,url,_code,_status,_isMain,pid,rid)=>{
   const frame=fromId(pid,rid);if(!frame)return;
   docs.commit(frame);errors.set(frame,false);urls.set(frame,url);state.loading.set(keyOf(frame),true);
   const t=transition(wc,state,frame,url,false);
   if(listening('onCommitted'))send('onCommitted',{...base(wc,frame,url),...t});
  });
  wc.on('did-navigate-in-page',(_event,url,_isMain,pid,rid)=>{
   const frame=fromId(pid,rid);if(!frame)return;
   const previous=urls.get(frame)||'';urls.set(frame,url);
   const fragment=previous&&previous!==url&&stripFragment(previous)===stripFragment(url);
   const t=transition(wc,state,frame,url,true);
   const name=fragment?'onReferenceFragmentUpdated':'onHistoryStateUpdated';
   if(listening(name))send(name,{...base(wc,frame,url),...t});
  });
  const domReady=frame=>{if(listening('onDOMContentLoaded'))send('onDOMContentLoaded',base(wc,frame,read(()=>frame.url,'')));};
  wc.on('dom-ready',()=>{const frame=read(()=>wc.mainFrame,null);if(frame)domReady(frame);});
  const watchFrame=frame=>{if(!frame||!read(()=>frame.parent,null))return;try{frame.on('dom-ready',()=>domReady(frame));}catch{}};
  wc.on('frame-created',(_event,details)=>watchFrame(read(()=>details.frame,null)));
  for(const frame of read(()=>wc.mainFrame.framesInSubtree,[]))watchFrame(frame);
  wc.on('did-frame-finish-load',(_event,_isMain,pid,rid)=>{
   const frame=fromId(pid,rid);if(!frame)return;state.loading.set(keyOf(frame),false);
   if(listening('onCompleted'))send('onCompleted',base(wc,frame,read(()=>frame.url,'')));
  });
  const failed=(_event,code,description,url,_isMain,pid,rid)=>{
   const frame=fromId(pid,rid);if(!frame)return;
   const key=`${pid}:${rid}:${code}:${url}`;if(state.lastFail===key)return;state.lastFail=key;setTimeout(()=>{if(state.lastFail===key)state.lastFail='';},1000).unref?.();
   errors.set(frame,true);state.loading.set(keyOf(frame),false);state.pending.delete(keyOf(frame));
   if(listening('onErrorOccurred'))send('onErrorOccurred',{...base(wc,frame,url),processId:-1,error:errorText(description)});
  };
  wc.on('did-fail-provisional-load',failed);wc.on('did-fail-load',failed);
 }
 const engine=store();
 if(engine){for(const wc of engine.tabs||[])observe(wc);try{engine.on('tab-added',observe);}catch{}}

 function tabOf(tabId){const engine=store();const wc=engine&&typeof engine.getTabById==='function'?engine.getTabById(tabId):null;return wc&&!read(()=>wc.isDestroyed(),true)?wc:null;}
 const findFrame=(wc,frameId)=>read(()=>wc.mainFrame.framesInSubtree,[]).find(frame=>frameIdOf(frame)===frameId)||null;
 const validUrl=url=>typeof url==='string'&&url.length>0&&!/^(?:devtools|chrome-devtools):/i.test(url);
 const tabOfFrame=frame=>{const top=read(()=>frame.top,null);const engine=store();if(!top||!engine)return null;for(const wc of engine.tabs||[])if(!read(()=>wc.isDestroyed(),true)&&read(()=>wc.mainFrame,null)===top)return wc;return null;};
 const detailsOf=frame=>{const fields=frameFields(docs,frame);return {errorOccurred:errors.get(frame)===true,url:read(()=>frame.url,''),parentFrameId:fields.parentFrameId,documentId:fields.documentId,
  ...(fields.parentDocumentId?{parentDocumentId:fields.parentDocumentId}:{}),frameType:fields.frameType,documentLifecycle:fields.documentLifecycle};};

 // web_navigation_api.cc WebNavigationGetFrameFunction / WebNavigationGetAllFramesFunction
 api.handle('webNavigation.getFrame',(_event,details)=>{
  const d=details&&typeof details==='object'?details:{};
  let wc,frame;
  if(d.documentId!==undefined&&d.documentId!==null){
   if(!docs.isDocumentId(d.documentId))throw new Error('Invalid documentId.');
   frame=docs.frameOf(d.documentId);if(!frame)return null;
   wc=tabOfFrame(frame);if(!wc)return null;
   if((Number.isInteger(d.tabId)&&d.tabId!==wc.id)||(Number.isInteger(d.frameId)&&d.frameId!==frameIdOf(frame)))return null;
  }else{
   if(!Number.isInteger(d.tabId)||!Number.isInteger(d.frameId))throw new Error('Either documentId or both tabId and frameId must be specified.');
   wc=tabOf(d.tabId);if(!wc)return null;
   frame=findFrame(wc,d.frameId);if(!frame)return null;
  }
  if(!validUrl(read(()=>frame.url,'')))return null;
  return detailsOf(frame);
 });
 api.handle('webNavigation.getAllFrames',(_event,details)=>{
  const d=details&&typeof details==='object'?details:{};
  const wc=Number.isInteger(d.tabId)?tabOf(d.tabId):null;if(!wc)return null;
  return read(()=>wc.mainFrame.framesInSubtree,[]).filter(frame=>validUrl(read(()=>frame.url,''))).map(frame=>{
   const x=detailsOf(frame);return {errorOccurred:x.errorOccurred,processId:read(()=>frame.processId,-1),frameId:frameIdOf(frame),parentFrameId:x.parentFrameId,url:x.url,
    documentId:x.documentId,...(x.parentDocumentId?{parentDocumentId:x.parentDocumentId}:{}),documentLifecycle:x.documentLifecycle,frameType:x.frameType};
  });
 });
 return {dispose(){try{store()?.removeListener?.('tab-added',observe);}catch{}}};
}

module.exports={namespaces:['webNavigation'],install,PREFIX,NAMES};
