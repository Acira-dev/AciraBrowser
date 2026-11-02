'use strict';
// chrome.webRequest in extension pages and service workers (P5; main side: web-request.cjs). Chromium's per-context dispatch
// (extensions/renderer/resources/web_request_event.js): each addListener(callback, filter, extraInfoSpec) is checked against the
// (filter, extraInfoSpec) signature, registered with the main process under an id, and the main process sends each event once to this
// context with the ids of the listeners that match. Every listener gets its own deep copy of the details trimmed to its extraInfoSpec
// (requestHeaders / responseHeaders / requestBody; without 'extraHeaders' the Cookie, Referer, Origin, Accept-Language, Accept-Encoding
// and Set-Cookie headers are erased). A service worker's ids are stable across restarts (Chrome's lazy listeners wake the worker).
module.exports={
 namespaces:['webRequest'],
 renderer(acira){
  return {webRequest:{factory(){
   // Chromium 152's web_request.json (the preload's slim schema has no event parameter types, so the signature is spelled out here).
   const OPTIONS={onBeforeRequest:['blocking','requestBody','extraHeaders'],onBeforeSendHeaders:['requestHeaders','blocking','extraHeaders'],
    onSendHeaders:['requestHeaders','extraHeaders'],onHeadersReceived:['blocking','responseHeaders','extraHeaders','securityInfo','securityInfoRawDer'],
    onAuthRequired:['responseHeaders','blocking','asyncBlocking','extraHeaders'],onResponseStarted:['responseHeaders','extraHeaders'],
    onBeforeRedirect:['responseHeaders','extraHeaders'],onCompleted:['responseHeaders','extraHeaders'],onErrorOccurred:['extraHeaders']};
   const RESOURCE_TYPES=['main_frame','sub_frame','stylesheet','script','image','font','object','xmlhttprequest','ping','csp_report','media','websocket','webbundle','other'];
   const REQUEST_FILTER={type:'object',properties:{urls:{type:'array',items:{type:'string'}},types:{type:'array',optional:true,items:{type:'string',enum:RESOURCE_TYPES}},
    tabId:{type:'integer',optional:true},windowId:{type:'integer',optional:true}}};
   const EXTRA_REQUEST=['accept-encoding','accept-language','cookie','origin','referer'],EXTRA_RESPONSE=['set-cookie'];
   const token=acira.isWorker?'w':(Math.random().toString(36).slice(2,10)+Date.now().toString(36));
   const byId=new Map(),signatures={};
   let next=0,source=null;
   const add=acira.call('webRequest.addListener'),drop=acira.call('webRequest.removeListener'),reply=acira.call('webRequest.authReply');
   const report=(message)=>{try{console.error(message);}catch(e){}};
   const signature=name=>{
    if(signatures[name])return signatures[name];
    const sig=acira.bindings.signatureFor({parameters:[{...REQUEST_FILTER,name:'filter'},{type:'array',optional:true,name:'extraInfoSpec',items:{type:'string',enum:OPTIONS[name]}}]});
    sig.text='webRequest.RequestFilter filter, optional array extraInfoSpec';
    return signatures[name]=sig;
   };
   const erase=(headers,hidden)=>headers.filter(h=>hidden.indexOf(String(h.name).toLowerCase())<0);
   const copyBody=body=>{
    if(!body||typeof body!=='object')return body;
    const out={};
    if(body.formData)out.formData=JSON.parse(JSON.stringify(body.formData));
    if(Array.isArray(body.raw))out.raw=body.raw.map(item=>{if(item&&item.bytes){const bytes=item.bytes instanceof Uint8Array?item.bytes:new Uint8Array(item.bytes);return {bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}return {...item};});
    if(body.error)out.error=body.error;
    return out;
   };
   const filtered=(details,record)=>{
    const copy={};
    for(const key of Object.keys(details)){
     const value=details[key];
     if(key==='requestHeaders'){if(record.requestHeaders)copy.requestHeaders=(record.extraHeaders?value:erase(value,EXTRA_REQUEST)).map(h=>({...h}));continue;}
     if(key==='responseHeaders'){if(record.responseHeaders)copy.responseHeaders=(record.extraHeaders?value:erase(value,EXTRA_RESPONSE)).map(h=>({...h}));continue;}
     if(key==='requestBody'){if(record.requestBody)copy.requestBody=copyBody(value);continue;}
     copy[key]=value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):value;
    }
    return copy;
   };
   const fail=error=>{try{console.error('Error in event handler: '+(error&&error.stack||error));}catch(e){}};
   function receive(payload){
    if(!payload||typeof payload!=='object'||!Array.isArray(payload.ids))return;
    const blockToken=typeof payload.b==='string'&&payload.k===token?payload.b:null;
    let waiting=0,answered=false;const responses=[];
    const settle=()=>{if(answered||waiting>0||!blockToken)return;answered=true;
     const credentials=responses.find(r=>r&&r.authCredentials);const response=credentials?{authCredentials:credentials.authCredentials}:responses.some(r=>r&&r.cancel===true)?{cancel:true}:null;
     reply(blockToken,token,response).catch(()=>{});};
    for(const id of payload.ids){
     const record=byId.get(id);if(!record||record.name!==payload.e)continue;
     const details=filtered(payload.d,record);
     if(blockToken&&record.asyncBlocking){
      waiting++;let done=false;
      try{record.callback(details,response=>{if(done)return;done=true;responses.push(response);waiting--;settle();});}catch(error){if(!done){done=true;waiting--;}fail(error);}
      continue;
     }
     try{const result=record.callback(details);if(blockToken&&record.blocking)responses.push(result);}catch(error){fail(error);}
    }
    settle();
   }
   const subscribe=()=>{if(source)return;source=acira.event('aciraWebRequest.event');source.addListener(receive);};
   function makeEvent(name){
    const records=[];
    return {
     addListener(callback,...rest){
      acira.bindings.parseWith('webRequest.'+name,signature(name),rest);
      if(typeof callback!=='function')return;
      const filter=rest[0],spec=Array.isArray(rest[1])?rest[1].slice():[];
      const id=token+':'+(next++);
      const record={id,name,callback,spec,requestHeaders:spec.indexOf('requestHeaders')>=0,responseHeaders:spec.indexOf('responseHeaders')>=0,
       requestBody:spec.indexOf('requestBody')>=0,extraHeaders:spec.indexOf('extraHeaders')>=0,blocking:spec.indexOf('blocking')>=0,asyncBlocking:spec.indexOf('asyncBlocking')>=0};
      records.push(record);byId.set(id,record);subscribe();
      const plainFilter={urls:Array.isArray(filter.urls)?filter.urls.slice():[]};
      if(Array.isArray(filter.types))plainFilter.types=filter.types.slice();
      if(typeof filter.tabId==='number')plainFilter.tabId=filter.tabId;
      if(typeof filter.windowId==='number')plainFilter.windowId=filter.windowId;
      add(name,id,plainFilter,spec,token).catch(error=>report(error&&error.message||String(error)));
     },
     removeListener(callback){
      const at=records.findIndex(r=>r.callback===callback);if(at<0)return;
      const record=records.splice(at,1)[0];byId.delete(record.id);drop(name,record.id,token).catch(()=>{});
     },
     hasListener(callback){return records.some(r=>r.callback===callback);},
     hasListeners(){return records.length>0;}
    };
   }
   const events={};for(const name of Object.keys(OPTIONS))events[name]=makeEvent(name);
   return acira.build('webRequest',{functions:{handlerBehaviorChanged:()=>acira.call('webRequest.handlerBehaviorChanged')()},events});
  }}};
 }
};
