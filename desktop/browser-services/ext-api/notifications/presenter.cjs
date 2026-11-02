'use strict';
// How a chrome.notifications notification reaches the person. The default is the system's own notification (Electron's Notification: Windows
// toast, macOS banner, libnotify) with the extension's buttons as its actions; tests and isolated profiles (ACIRA_BROWSER_TEST_DATA) use a
// presenter that shows nothing and lets a test press the notification's parts, so a rig never pops up on a screen.
const fs=require('node:fs'),path=require('node:path');

const URGENCY={'-2':'low','-1':'low','0':'normal','1':'normal','2':'critical'};

/** The notification's text: title, message (a list's items, a progress bar's value) and the context line. */
function textOf(options){
 const lines=[];
 const message=String(options.message||'');
 if(options.type==='list'&&Array.isArray(options.items)&&options.items.length)lines.push(...options.items.slice(0,6).map(item=>`${item.title}: ${item.message}`));
 else if(options.type==='progress'&&Number.isFinite(options.progress))lines.push(message?`${message} (${Math.round(options.progress)}%)`:`${Math.round(options.progress)}%`);
 else lines.push(message);
 if(options.contextMessage)lines.push(String(options.contextMessage));
 return lines.filter(Boolean).join('\n').slice(0,1024);
}

/** The icon as an Electron NativeImage: a data URL, or a file of the extension. Anything else (a web address) is not fetched. */
function iconOf(extension,url,nativeImage){
 try{
  if(typeof url!=='string'||!url)return undefined;
  if(url.startsWith('data:image/'))return nativeImage.createFromDataURL(url);
  if(/^[a-z][a-z0-9+.-]*:/i.test(url)&&!url.startsWith('chrome-extension:'))return undefined;
  const relative=url.startsWith('chrome-extension:')?new URL(url).pathname:url;
  const root=path.resolve(extension.path||''),full=path.resolve(root,relative.replace(/^[\\/]+/,''));
  if(!extension.path||!full.startsWith(root+path.sep)||!fs.existsSync(full))return undefined;
  const image=nativeImage.createFromPath(full);
  return image.isEmpty()?undefined:image;
 }catch{return undefined;}
}

/**
 * presenter.show({key, extension, options}, handlers) -> handle; handlers: {click(), action(index), close(byUser)}; handle.close() removes it quietly.
 * The system presenter. electron: {Notification, nativeImage}.
 */
function systemPresenter({Notification,nativeImage,appName=''}){
 return {
  supported:()=>!!Notification?.isSupported?.(),
  show({extension,options},handlers){
   const notification=new Notification({
    title:String(options.title||'').slice(0,256),subtitle:appName||undefined,body:textOf(options),silent:!!options.silent,
    icon:iconOf(extension,options.iconUrl,nativeImage),urgency:URGENCY[String(options.priority??0)]||'normal',
    timeoutType:options.requireInteraction?'never':'default',
    actions:(Array.isArray(options.buttons)?options.buttons:[]).slice(0,2).map(button=>({type:'button',text:String(button.title||'')}))
   });
   let quiet=false;
   notification.on('click',()=>handlers.click());
   notification.on('action',(details,index)=>handlers.action(typeof details?.actionIndex==='number'?details.actionIndex:index));
   notification.on('close',(details)=>{if(!quiet)handlers.close(details?.reason===undefined||details.reason==='userCanceled');});
   notification.show();
   return {close(){quiet=true;try{notification.close();}catch{/* gone */}}};
  }
 };
}

/** Shows nothing; remembers what would have been shown and lets a test press it. */
function stubPresenter(){
 const shown=new Map();
 return {
  stub:true,shown,
  supported:()=>true,
  show(record,handlers){
   const entry={key:record.key,options:record.options,handlers,closed:false};
   shown.set(record.key,entry);
   return {close(){entry.closed=true;shown.delete(record.key);}};
  }
 };
}

/** The presenter for this process: the system's, except in an isolated test profile. */
function defaultPresenter(){
 if(process.env.ACIRA_BROWSER_TEST_DATA&&process.env.ACIRA_EXT_NOTIFICATIONS_NATIVE!=='1')return stubPresenter();
 try{const {Notification,nativeImage,app}=require('electron');return systemPresenter({Notification,nativeImage,appName:app?.name||''});}
 catch{return stubPresenter();}
}

module.exports={systemPresenter,stubPresenter,defaultPresenter,textOf,iconOf};
