'use strict';
// chrome.userScripts in the page: runs before any page script in every frame of an ordinary profile with extensions. Asks the main process for the
// user scripts registered for this address by extensions whose "Allow user scripts" switch is on (nearly always none), then runs each at its runAt
// time in its world: MAIN is the page's own world; USER_SCRIPT is an isolated world per (extension, worldId). With messaging on for that world, the
// script gets chrome.runtime.sendMessage, answered by the extension's runtime.onUserScriptMessage (extension-apis.cjs).
const {ipcRenderer,webFrame,contextBridge}=require('electron');
if(/^(https?|file):/.test(location.href)){
 let scripts=[];
 try{const answer=ipcRenderer.sendSync('acira:user-scripts',location.href,!!process.isMainFrame);if(Array.isArray(answer))scripts=answer;}catch{/* a closing window */}
 if(scripts.length){
  const prepared=new Set();
  const prepare=script=>{
   const key=script.worldNumber;if(prepared.has(key))return;prepared.add(key);
   try{webFrame.setIsolatedWorldInfo(key,{name:'User scripts',...(typeof script.csp==='string'?{csp:script.csp}:{})});}catch{}
   if(!script.messaging)return;
   const extensionId=script.extensionId,worldId=script.worldId||'';
   try{contextBridge.exposeInIsolatedWorld(key,'__aciraUserScriptPort',{send:message=>ipcRenderer.invoke('acira:user-script-message',{extensionId,worldId,message})});}catch{}
   // chrome.runtime in that world: id, sendMessage (promise or callback), and a connect that reports it is unavailable.
   const prelude=`(()=>{const port=globalThis.__aciraUserScriptPort;if(!port)return;const id=${JSON.stringify(extensionId)};const c=globalThis.chrome||(globalThis.chrome={});const runtime=c.runtime||(c.runtime={});
    let lastError;Object.defineProperty(runtime,'lastError',{configurable:true,get(){return lastError;}});runtime.id=id;
    runtime.sendMessage=function(...args){const callback=typeof args[args.length-1]==='function'?args.pop():undefined;if(args.length>1&&typeof args[0]==='string'&&args[0]!==id)args.shift();const run=Promise.resolve(port.send(args[0])).then(r=>{if(r&&typeof r.__acira_error==='string')throw new Error(r.__acira_error);return r&&r.__acira_value;});
     if(!callback)return run;run.then(v=>callback(v),e=>{lastError={message:String(e&&e.message||e)};try{callback();}finally{lastError=undefined;}});};
    runtime.connect=function(){throw new Error('runtime.connect is not available to user scripts in Acira yet.');};})();`;
   try{void webFrame.executeJavaScriptInIsolatedWorld(key,[{code:prelude}]);}catch{}
  };
  const run=script=>{try{if(script.world==='MAIN')void webFrame.executeJavaScript(script.code);else{prepare(script);void webFrame.executeJavaScriptInIsolatedWorld(script.worldNumber,[{code:script.code}]);}}catch{/* one failing script never stops the others */}};
  const at=name=>scripts.filter(s=>s.runAt===name);
  for(const script of at('document_start'))run(script);
  const end=at('document_end'),idle=at('document_idle');
  if(end.length||idle.length){
   let idleDone=false;const runIdle=()=>{if(idleDone)return;idleDone=true;for(const script of idle)run(script);};
   const ready=()=>{for(const script of end)run(script);if(idle.length){if(document.readyState==='complete')runIdle();else{window.addEventListener('load',runIdle,{once:true});setTimeout(runIdle,200);}}};
   if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
  }
 }
}
