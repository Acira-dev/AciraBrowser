'use strict';
const NETWORK_STATE=Symbol.for('acira.native.request-network-state-v1');
// Observers (P5, ext-api/web-request.cjs: chrome.webRequest for extensions). Electron gives a session ONE listener per webRequest event and
// this pipeline owns it, so an extension's chrome.webRequest listener can only hear requests through here. An observer is registered on the
// session (observeRequests below, any time, before or after the pipeline exists) with the phases it wants; the pipeline calls it with each
// event's Electron details (and, for the three events Acira decides, Acira's own result so far). While no observer wants a phase nothing
// extra runs: the always-hooked phases test one boolean, and onSendHeaders / onResponseStarted / onBeforeRedirect (and onCompleted /
// onErrorOccurred without lifetime tracking) get an Electron listener only while an observer wants them. Observers never change requests.
const OBSERVERS=Symbol.for('acira.request-observers-v1');
const PHASES=['before','sendHeaders','sent','headers','responseStarted','redirect','completed','error'];
const LAZY={sent:'onSendHeaders',responseStarted:'onResponseStarted',redirect:'onBeforeRedirect',completed:'onCompleted',error:'onErrorOccurred'};
const observerRegistry=session=>{if(!session[OBSERVERS])Object.defineProperty(session,OBSERVERS,{value:{list:[],pipelines:new Set()},configurable:true});return session[OBSERVERS];};
/** observer: {phases: iterable of PHASES, notify(phase, details, result)}. Returns {update(phases), dispose()}. */
function observeRequests(session,observer){
 const registry=observerRegistry(session),entry={phases:new Set(observer.phases||[]),notify:observer.notify};registry.list.push(entry);
 const sync=()=>{for(const pipeline of registry.pipelines)pipeline.rewatch();};sync();
 return {update(phases){entry.phases=new Set(phases||[]);sync();},dispose(){const at=registry.list.indexOf(entry);if(at>=0)registry.list.splice(at,1);sync();}};
}
/** What each participant of one request is handed: the details plus the headers the earlier ones set. Electron's `details.frame` is a getter
 * that, read once the frame has navigated or gone, answers null and logs "Frame property was accessed after it navigated or was destroyed".
 * Spreading the details for every participant read it every time, also after an asynchronous one (CNAME uncloaking), when the frame was often
 * gone. Now it is read only when a participant asks for it, and at most once per request. */
function requestView(details){
 const headers=result=>({...(result.responseHeaders?{responseHeaders:result.responseHeaders}:{}),...(result.requestHeaders?{requestHeaders:result.requestHeaders}:{})});
 if(!details||typeof details!=='object'||!('frame' in details))return result=>({...details,...headers(result)});
 const rest={};for(const key of Object.keys(details))if(key!=='frame')rest[key]=details[key];
 let read=false,frame=null;const get=()=>{if(!read){read=true;frame=details.frame;}return frame;};
 return result=>Object.defineProperty({...rest,...headers(result)},'frame',{get,enumerable:true,configurable:true});
}
/** One owner for each Electron webRequest event; participants return patches, never replace listeners. */
class RequestPipeline{
 constructor(session){
  const supportsLifetime=typeof session.webRequest.onCompleted==='function'&&typeof session.webRequest.onErrorOccurred==='function';this.session=session;if(!session[NETWORK_STATE])Object.defineProperty(session,NETWORK_STATE,{value:{version:1,holds:new Set(),retired:false,reason:null,active:new Set(),tracking:supportsLifetime}});this.networkState=session[NETWORK_STATE];if(this.networkState.version!==1||typeof this.networkState.holds?.add!=='function'||typeof this.networkState.retired!=='boolean')throw new Error('Native request seal state is invalid.');if(!this.networkState.active){this.networkState.active=new Set();this.networkState.tracking=false;}if(!supportsLifetime)this.networkState.tracking=false;
  this.before=[];this.headers=[];this.sending=[];this.active=this.networkState.active;Object.defineProperty(this,'tracking',{get:()=>this.networkState.tracking,set:value=>{this.networkState.tracking=value;}});
  this.observers=observerRegistry(session);this.watching=Object.fromEntries(PHASES.map(phase=>[phase,false]));this.hooked=new Set();
  session.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{if(this.tracking&&/^(?:https?|wss?):/i.test(details.url)){if(!Number.isSafeInteger(details.id)||this.active.size>=100000){this.tracking=false;this.active.clear();}else this.active.add(details.id);}this.run(this.before,details,this.watching.before?this.tap('before',details,callback):callback);});
  session.webRequest.onHeadersReceived({urls:['<all_urls>']},(details,callback)=>this.run(this.headers,details,this.watching.headers?this.tap('headers',details,callback):callback));
  if(typeof session.webRequest.onBeforeSendHeaders==='function')session.webRequest.onBeforeSendHeaders({urls:['<all_urls>']},(details,callback)=>this.run(this.sending,details,this.watching.sendHeaders?this.tap('sendHeaders',details,callback):callback));
  if(this.tracking){this.hook('completed');this.hook('error');}
  this.observers.pipelines.add(this);this.rewatch();
 }
 /** Which phases observers want now; Electron listeners for lazily hooked phases follow (lifetime tracking keeps onCompleted / onErrorOccurred). */
 rewatch(){for(const phase of PHASES)this.watching[phase]=this.observers.list.some(entry=>entry.phases.has(phase));for(const phase of Object.keys(LAZY)){const keep=this.watching[phase]||(this.tracking&&(phase==='completed'||phase==='error'));if(keep)this.hook(phase);else this.unhook(phase);}}
 hook(phase){const name=LAZY[phase];if(this.hooked.has(phase)||typeof this.session.webRequest[name]!=='function')return;this.hooked.add(phase);const watching=this.watching,active=this.active;
  // Lifetime hooks stay as cheap as before P5 while nobody watches: one Set delete and one boolean.
  const listener=phase==='completed'?details=>{active.delete(details.id);if(watching.completed)this.notify('completed',details);}:phase==='error'?details=>{active.delete(details.id);if(watching.error)this.notify('error',details);}:details=>{if(watching[phase])this.notify(phase,details);};
  this.session.webRequest[name]({urls:['<all_urls>']},listener);}
 unhook(phase){if(!this.hooked.has(phase))return;this.hooked.delete(phase);try{this.session.webRequest[LAZY[phase]](null);}catch{}}
 notify(phase,details,result){for(const entry of this.observers.list)if(entry.phases.has(phase))try{entry.notify(phase,details,result);}catch(error){console.error('Request observer failed',error?.message);}}
 /** The callback Acira's chain finishes with, telling observers its result first (observers only watch; the request is never held). */
 tap(phase,details,callback){return result=>{this.notify(phase,details,result||{});callback(result);};}
 useBefore(handler){this.before.push(handler);return()=>{this.before=this.before.filter(h=>h!==handler);};}
 useHeaders(handler){this.headers.push(handler);return()=>{this.headers=this.headers.filter(h=>h!==handler);};}
 /** Outgoing request headers: handlers may return {cancel:true} or {requestHeaders}. */
 useSendHeaders(handler){this.sending.push(handler);return()=>{this.sending=this.sending.filter(h=>h!==handler);};}
 /** Native lifetime events, including page-less requests. Unknown never means idle. */
 hasActiveRequests(){return this.tracking?this.active.size>0:null;}
 holdNetwork(reason='native transition'){if(typeof reason!=='string'||reason.length>120||/[\u0000-\u001f]/.test(reason))throw new Error('Use a bounded native network-hold reason.');const token={reason};this.networkState.holds.add(token);let released=false;return()=>{if(!released){released=true;this.networkState.holds.delete(token);}};}
 sealNetwork(reason='retired native context'){if(typeof reason!=='string'||reason.length>120||/[\u0000-\u001f]/.test(reason))throw new Error('Use a bounded native retirement reason.');this.networkState.retired=true;this.networkState.reason=reason;return this.networkStatus();}
 networkStatus(){return {blocked:this.networkState.retired||this.networkState.holds.size>0,retired:this.networkState.retired,temporaryHolds:this.networkState.holds.size};}
 /** A handler may return a promise (CNAME uncloaking waits for one DNS answer); the chain continues when it settles and a rejected promise cancels like a thrown error. Handlers that return plain patches never leave the synchronous path. */
 run(handlers,details,callback){let settled=false;const finish=result=>{if(!settled){settled=true;callback(result);}},fail=error=>{console.error('Request policy failed',error.message);finish({cancel:true});};try{if(this.networkStatus().blocked&&/^(?:https?|wss?):/i.test(details.url)){finish({cancel:true});return;}const view=requestView(details),step=(index,result)=>{for(let i=index;i<handlers.length;i++){const patch=handlers[i](view(result))||{};if(typeof patch.then==='function'){patch.then(value=>{const merged={...result,...(value||{})};if(merged.cancel||merged.redirectURL)finish(merged);else step(i+1,merged);}).catch(fail);return;}result={...result,...patch};if(result.cancel||result.redirectURL)break;}finish(result);};step(0,{});}catch(error){fail(error);}}
}
module.exports={RequestPipeline,observeRequests,REQUEST_PHASES:PHASES};
