'use strict';
// Runs before any page script in every frame. Protected video (Netflix, Spotify, Disney+, Prime Video) needs the Widevine
// decryption module, which Acira does not include yet, so the page's own request for it is refused by the engine. This
// notices that refusal and tells the browser once per page, so it can say so calmly. The page is never changed in any way it can
// see: the call is passed through untouched (same arguments, same promise, same errors); we only watch the promise.
const {ipcRenderer,webFrame}=require('electron');
if(process.isMainFrame&&/^https?:/.test(location.href)){
 try{
  // An unguessable event name carries the signal from the page's world to this one; nothing else crosses.
  const bytes=new Uint8Array(12);crypto.getRandomValues(bytes);
  const token='acira-'+Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  window.addEventListener(token,()=>{try{ipcRenderer.send('acira:protected-media');}catch{/* A closing window. */}},{once:true});
  const script=`(()=>{try{
   const proto=Navigator.prototype,name='requestMediaKeySystemAccess',original=proto[name],descriptor=Object.getOwnPropertyDescriptor(proto,name);
   if(typeof original!=='function'||!descriptor||!descriptor.configurable)return;
   const tell=()=>{try{window.dispatchEvent(new Event(${JSON.stringify(token)}));}catch{}};
   const wrapped=new Proxy(original,{apply(target,self,args){
    const result=Reflect.apply(target,self,args);
    try{if(/^com\\.widevine\\.alpha/.test(String(args[0]))&&result&&typeof result.then==='function')result.then(undefined,tell);}catch{}
    return result;
   }});
   Object.defineProperty(proto,name,{configurable:descriptor.configurable,enumerable:descriptor.enumerable,writable:descriptor.writable,value:wrapped});
  }catch{}})();`;
  void webFrame.executeJavaScript(script);
 }catch{/* Never get in the way of the page. */}
}
