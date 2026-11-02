'use strict';
const {requestFor,validateResult}=require('./mac-passkey-policy.cjs');
function nativeBridge(){
 if(process.platform!=='darwin')return null;
 try{
  const bridge=require(require('node:path').join(__dirname,'..','native','build','mac-material.node'));
  return {support:()=>JSON.parse(bridge.passkeySupport()),start:(handle,input)=>bridge.passkeyStart(handle,JSON.stringify(input)).then(JSON.parse),cancel:id=>bridge.passkeyCancel(id)};
 }catch{return null;}
}
function createMacPasskeys({ipcMain,native=nativeBridge(),platform=process.platform}){
 const owners=new WeakMap();let pending=null;
 const available=()=>{try{return platform==='darwin'&&native?.support().available===true;}catch{return false;}};
 function ownerFor(event,focused=false,requireActive=true){
  const wc=event.sender,frame=event.senderFrame;
  if(!wc||wc.isDestroyed()||!frame||frame.isDestroyed()||frame!==wc.mainFrame)return null;
  let owner;try{owner=owners.get(wc)?.();}catch{return null;}
  if(!owner||owner.tor||owner.certificateException||!owner.window||owner.window.isDestroyed()||(requireActive&&(!owner.active||!owner.window.isVisible()||owner.window.isMinimized()))||(focused&&!owner.window.isFocused()))return null;
  try{if(new URL(frame.url).protocol!=='https:')return null;}catch{return null;}
  return owner;
 }
 function cancelFor(wc,id,name='AbortError'){if(pending&&pending.wc===wc&&(!id||pending.id===id)){const current=pending;pending=null;try{native.cancel(current.id);}catch{}current.abort(name);}}
 function attach(wc,resolve){
  if(platform!=='darwin'||owners.has(wc))return;
  owners.set(wc,resolve);
  const cancel=()=>cancelFor(wc);
  wc.on('will-navigate',cancel);
  wc.on('did-start-navigation',event=>{if(event.isMainFrame&&!event.isSameDocument)cancel();});
  wc.on('render-process-gone',cancel);
  wc.once('destroyed',()=>{cancel();owners.delete(wc);});
 }
 ipcMain.on('acira:mac-passkey-ready',event=>{event.returnValue=available()&&Boolean(ownerFor(event,false,false));});
 ipcMain.handle('acira:mac-passkey-cancel',(event,id)=>{if(event.senderFrame===event.sender.mainFrame&&typeof id==='string')cancelFor(event.sender,id);});
 ipcMain.handle('acira:mac-passkey-start',async(event,input)=>{
  let current,timer;
  try{
   const owner=ownerFor(event,true);
   if(!available()||!owner)throw Object.assign(new Error(),{name:'NotAllowedError'});
   if(pending)throw Object.assign(new Error(),{name:'NotAllowedError'});
   const frame=event.senderFrame,url=frame.url,request=requestFor(url,input);
   let abort;const cancelled=new Promise((_,reject)=>{abort=(name='AbortError')=>reject(Object.assign(new Error(),{name}));});
   current={wc:event.sender,id:request.id,abort};pending=current;
   timer=setTimeout(()=>cancelFor(current.wc,current.id,'NotAllowedError'),request.timeout);timer.unref?.();
   const result=await Promise.race([Promise.resolve().then(()=>{if(pending!==current)throw Object.assign(new Error(),{name:'AbortError'});return native.start(owner.window.getNativeWindowHandle(),request);}),cancelled]);
   if(pending!==current||frame.isDestroyed()||frame.url!==url||!ownerFor(event))throw Object.assign(new Error(),{name:'AbortError'});
   return {ok:true,credential:validateResult(request,result)};
  }catch(error){return {ok:false,name:['SecurityError','TypeError','NotSupportedError','InvalidStateError','AbortError'].includes(error.name)?error.name:'NotAllowedError',message:'The passkey request could not be completed.'};}
  finally{clearTimeout(timer);if(current&&pending===current)pending=null;}
 });
 return {attach,available,cancelAll:()=>{if(pending)cancelFor(pending.wc);}};
}
module.exports={createMacPasskeys,nativeBridge};
