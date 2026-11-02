'use strict';
// Tab and screen capture for extensions: chrome.tabCapture and chrome.desktopCapture (Loom, screen recorders, meeting tools).
// In Chrome an extension is handed a stream id, and a page of the extension passes it to
//   getUserMedia({video: {mandatory: {chromeMediaSource: 'tab' | 'desktop', chromeMediaSourceId: id}}}).
// Electron cannot resolve such ids, so Acira keeps its own:
//  - an id is issued here only after Chrome's checks: the extension was invoked on that tab (its toolbar button was clicked there), or the
//    person picked a screen, window or tab in Acira's share picker (share-ui.cjs). It belongs to that extension, works once and expires
//    after 10 seconds, as Chrome's do;
//  - the extension page's getUserMedia call is answered by the extension preload (extension-apis-renderer.cjs) through getDisplayMedia:
//    the page first "arms" its own web contents here with the id, and the session's display-media handler (permission-engine.cjs) answers
//    that one request with the chosen tab or screen, with no second picker;
//  - while a capture runs it is listed here (tabCapture.getCapturedTabs, onStatusChanged, the "sharing" pill with Stop).
const crypto=require('node:crypto');

const TTL=10000,ARM_TTL=5000;
const SOURCES=['screen','window','tab','audio'];
// Chrome's own wording (extensions/browser/api/tab_capture, desktop_capture), so extensions that match on it keep working.
const MESSAGES={
 tabGrant:'Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.',
 tabInvalid:'Invalid tab specified.',
 tabFinding:'Error finding tab to capture.',
 tabSame:'Cannot capture a tab with an active stream.',
 noAudioOrVideo:'Capture failed. No audio or video requested.',
 consumerInvalid:'Invalid consumer tab specified.',
 sourcesEmpty:'At least one source type must be specified.',
 sourcesInvalid:'Invalid source type specified.',
 targetRequired:'A target tab is required when called from a service worker context.',
 targetInvalid:'The specified target tab was not found.',
 streamInvalid:'Invalid state: the capture stream id is unknown, used or expired.',
 frameOnly:'Capture streams can only be used by a page of the extension.',
 pickerBusy:'Another share request is already open.'
};
const originOf=url=>{try{const u=new URL(String(url));return u.protocol==='chrome-extension:'?`chrome-extension://${u.hostname}`:u.origin==='null'?'':u.origin;}catch{return '';}};
const capturable=url=>/^(https?|file):/i.test(String(url||''));

/** chrome.tabCapture: may the extension capture this tab now? Returns Chrome's error message, or '' when it may.
 *  tab: {id, url}; invoked: the extension's last invocation {tabId, origin} (toolbar click), busy: the tab already has a capture. */
function tabCaptureError({tab,invoked,busy=false}){
 if(!tab||!Number.isInteger(tab.id))return MESSAGES.tabInvalid;
 if(!capturable(tab.url))return MESSAGES.tabGrant; // Chrome pages (here acira://, chrome://) cannot be captured
 if(!invoked||invoked.tabId!==tab.id||invoked.origin!==originOf(tab.url))return MESSAGES.tabGrant; // the grant ends when the tab leaves that site
 if(busy)return MESSAGES.tabSame;
 return '';
}

/** chrome.desktopCapture.chooseDesktopMedia's arguments. Returns Chrome's error message, or ''. */
function desktopSourcesError(sources,{fromWorker=false,targetTab=null}={}){
 if(!Array.isArray(sources)||!sources.length)return MESSAGES.sourcesEmpty;
 if(sources.some(source=>!SOURCES.includes(source)))return MESSAGES.sourcesInvalid;
 if(!sources.some(source=>source!=='audio'))return MESSAGES.sourcesEmpty;
 if(fromWorker&&!targetTab)return MESSAGES.targetRequired;
 return '';
}

/** Which video (and audio) Electron's display-media handler should answer with, for a capture source.
 *  source: {type:'tab', tabId} | {type:'screen'|'window', id, name}. fromId: webContents.fromId. */
function streamsFor(source,{audio=false,audioRequested=false,fromId,platform=process.platform}={}){
 if(!source)return null;
 if(source.type==='tab'){
  const wc=fromId?.(source.tabId);if(!wc||wc.isDestroyed?.()||!wc.mainFrame)return null;
  return {video:wc.mainFrame,...(audio&&audioRequested?{audio:wc.mainFrame}:{})};
 }
 if((source.type==='screen'||source.type==='window')&&typeof source.id==='string'&&source.id){
  // System sound comes with a whole screen, on Windows only (Electron's loopback device); a window has none, as in Chrome.
  return {video:{id:source.id,name:String(source.name||'')},...(audio&&audioRequested&&source.type==='screen'&&platform==='win32'?{audio:'loopback'}:{})};
 }
 return null;
}

function createCaptureBroker({now=Date.now,randomId=()=>crypto.randomBytes(24).toString('base64'),uuid=()=>crypto.randomUUID()}={}){
 const streams=new Map(),armed=new Map(),captures=new Map(),listeners=new Set();
 const notify=(status,capture)=>{for(const listener of [...listeners])try{listener(status,capture);}catch{}};
 function prune(){const t=now();for(const [id,stream] of streams)if(stream.expires<=t)streams.delete(id);for(const [id,entry] of armed)if(entry.expires<=t)armed.delete(id);}
 /** A new stream id for `extensionId` (and its owner, the runtime that issued it): source {type, tabId | id, name}, audio wanted. */
 function issue({extensionId,owner=null,source,audio=false,label=''}){
  prune();let id;do id=randomId();while(streams.has(id));
  streams.set(id,{id,extensionId,owner,source:{...source},audio:!!audio,label:String(label||''),expires:now()+TTL});
  return id;
 }
 /** A page of the extension (web contents `contentsId`) is about to use stream `id`: checks it is this extension's and still fresh, uses it up,
  *  and arms that web contents for its next display-media request. Returns {captureId, audio, source} or {error}. */
 function arm(id,{extensionId,contentsId}){
  prune();const stream=typeof id==='string'?streams.get(id):null;
  if(!stream||stream.extensionId!==extensionId||!Number.isInteger(contentsId))return {error:MESSAGES.streamInvalid};
  streams.delete(id);
  const captureId=uuid();armed.set(contentsId,{...stream,captureId,contentsId,expires:now()+ARM_TTL});
  return {captureId,audio:stream.audio,source:{type:stream.source.type}};
 }
 const isArmed=contentsId=>{prune();return armed.has(contentsId);};
 /** The display-media request of an armed web contents: hands out (once) what it was armed with, and lists the capture as pending. */
 function take(contentsId){
  prune();const entry=armed.get(contentsId);if(!entry)return null;armed.delete(contentsId);
  const capture={captureId:entry.captureId,extensionId:entry.extensionId,owner:entry.owner,contentsId,source:entry.source,audio:entry.audio,label:entry.label,status:'pending'};
  captures.set(capture.captureId,capture);notify('pending',capture);return entry;
 }
 function started(captureId,extensionId){const capture=captures.get(captureId);if(!capture||capture.extensionId!==extensionId||capture.status==='active')return false;capture.status='active';notify('active',capture);return true;}
 function ended(captureId,extensionId){const capture=captures.get(captureId);if(!capture||(extensionId!==undefined&&capture.extensionId!==extensionId))return false;captures.delete(captureId);capture.status='stopped';notify('stopped',capture);return true;}
 /** The page that held captures is gone (closed, navigated away): they all end. */
 function endFor(contentsId){for(const capture of [...captures.values()])if(capture.contentsId===contentsId)ended(capture.captureId);}
 const capturedTabs=extensionId=>[...captures.values()].filter(c=>c.extensionId===extensionId&&c.source.type==='tab').map(c=>({tabId:c.source.tabId,status:c.status,fullscreen:false}));
 const tabBusy=tabId=>[...captures.values()].some(c=>c.source.type==='tab'&&c.source.tabId===tabId);
 const subscribe=listener=>{listeners.add(listener);return ()=>listeners.delete(listener);};
 return {issue,arm,isArmed,take,started,ended,endFor,capturedTabs,tabBusy,subscribe,active:()=>[...captures.values()],streams,armed,captures};
}

// One broker for the app: the extension engine of every profile issues ids, the session handlers answer them, the pill lists them.
let shared=null,services={};
const broker=()=>shared||(shared=createCaptureBroker());
/** main.cjs hands in the share picker (share-ui.cjs) and the page lookup; the extension engine reads them when an extension asks. */
function configure(next){services={...services,...next};}
const service=name=>services[name];

module.exports={createCaptureBroker,broker,configure,service,tabCaptureError,desktopSourcesError,streamsFor,originOf,capturable,MESSAGES,SOURCES,TTL,ARM_TTL};
