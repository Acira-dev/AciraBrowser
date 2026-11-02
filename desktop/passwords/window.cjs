'use strict';
// Per-window glue: turns the browser's own knowledge (which tab a message came from, that tab's committed URL, its bounds) into
// the plain facts the page bridge needs, owns the native prompt frame, and registers the page script on profile sessions.
// Nothing in a message from a page is trusted for identity: tab, profile and origin all come from here.
const path=require('node:path');
const {createPageBridge,CHANNELS}=require('./page-bridge.cjs');
const {createPromptFrame}=require('./prompt-frame.cjs');
const PRELOAD=path.join(__dirname,'page-preload.cjs');
const attached=new WeakSet();

/**
 * Where the address field is, in window DIPs: read from Acira's own interface (a constant script, never page content). The interface may
 * be scaled, so CSS pixels are multiplied by its factor. null when the field isn't on screen (focus mode, hidden toolbar).
 */
const ADDRESS_SCRIPT="(()=>{const e=document.querySelector('.address-field');if(!e)return null;const b=e.getBoundingClientRect();return b.width>0&&b.height>0?{x:b.left,y:b.top,width:b.width,height:b.height}:null;})()";
async function readAddressRect({contents,scale=1}){
 if(!contents||contents.isDestroyed())return null;
 const r=await contents.executeJavaScript(ADDRESS_SCRIPT);
 if(!r||![r.x,r.y,r.width,r.height].every(n=>typeof n==='number'&&Number.isFinite(n)))return null;
 const f=scale>0?scale:1;return {x:r.x*f,y:r.y*f,width:r.width*f,height:r.height*f};
}

function createWindowPasswords({service,WebContentsView,getWindow,getState,pages,pageOwner,viewBounds,dispatch,isDark,reducedMotion,privateMode,chromeContents=()=>null,uiScale=()=>1}){
 let bridge=null,frame=null;
 function ensure(){
  if(bridge)return bridge;
  frame=createPromptFrame({WebContentsView,getWindow,
   boundsOf:viewBounds,
   zoomOf:tabId=>{try{return pages.get(tabId)?.view.webContents.getZoomFactor()||1;}catch{return 1;}},
   onChoose:index=>bridge.choose(index),onAction:name=>bridge.action(name),onDismiss:()=>bridge.hide(),
   isDark,reducedMotion,anchorOf:()=>readAddressRect({contents:chromeContents(),scale:uiScale()})});
  bridge=createPageBridge({
   service:service(),
   ownerOf:event=>{
    const wc=event.sender;if(!wc||wc.isDestroyed()||event.senderFrame!==wc.mainFrame)return null;
    const id=pageOwner(pages,wc),state=getState(),tab=state.tabs.find(t=>t.id===id);
    if(!tab||tab.contentKind!=='web')return null;
    return {tabId:tab.id,profileId:tab.browserProfileId,private:privateMode||Boolean(tab.privacy),url:event.senderFrame.url,active:state.activeTabId===tab.id};
   },
   ui:frame,
   page:{
    send:(tabId,channel,payload)=>{try{const wc=pages.get(tabId)?.view.webContents;if(wc&&!wc.isDestroyed())wc.mainFrame.send(channel,payload);}catch{}},
    url:tabId=>{try{return pages.get(tabId)?.view.webContents.getURL()||'';}catch{return '';}},
    focus:tabId=>{try{pages.get(tabId)?.view.webContents.focus();}catch{}},
   },
   notify:text=>dispatch({type:'toast',text}),
  });
  return bridge;
 }
 return {
  channels:[...CHANNELS],
  message:(channel,event,payload)=>{if(!privateMode)ensure().message(channel,event,payload);},
  onState:state=>{bridge?.onState(state);},
  relayout:()=>{frame?.relayout();},
  /** Registers the page script on a profile's session once (private windows never get it). */
  attachSession:session=>{
   if(privateMode||!session||attached.has(session))return;attached.add(session);
   try{session.registerPreloadScript({type:'frame',id:'acira-passwords',filePath:PRELOAD});}catch{attached.delete(session);}
  },
  dispose:()=>{bridge?.hide();frame?.dispose();bridge=null;frame=null;},
 };
}
module.exports={createWindowPasswords,readAddressRect};
