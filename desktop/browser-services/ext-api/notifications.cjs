'use strict';
// chrome.notifications (work package P8). Main side: the notifications of each extension (create replaces, update, clear, getAll), Chromium's
// checks, the events — onClicked, onButtonClicked, onClosed — and the presenter (notifications/presenter.cjs). Renderer: notifications-renderer.cjs.
const {randomUUID}=require('node:crypto');
const {defaultPresenter}=require('./notifications/presenter.cjs');
const bridge=require('./surfaces/bridge.cjs');

const MISSING='Some of the required properties are missing: type, iconUrl, title and message are required.';
const MAX_BUTTONS=2,MAX_PER_EXTENSION=50;
const mix=(a,b)=>Object.assign({},a,b);

function check(options,{creating}){
 if(!options||typeof options!=='object')throw new Error(MISSING);
 if(creating&&(!options.type||typeof options.iconUrl!=='string'||options.iconUrl===''||typeof options.title!=='string'||typeof options.message!=='string'))throw new Error(MISSING);
 if(options.type==='list'&&creating&&(!Array.isArray(options.items)||!options.items.length))throw new Error('List items must be provided for list type');
 if(options.type&&options.type!=='list'&&Array.isArray(options.items)&&options.items.length)throw new Error('List items provided for notification type != list');
 if(options.type&&options.type!=='image'&&options.imageUrl)throw new Error('Image resource provided for notification type != image');
 if(options.progress!==undefined&&(options.progress<0||options.progress>100))throw new Error('The progress value should range from 0 to 100');
 if(options.priority!==undefined&&(options.priority<-2||options.priority>2))throw new Error('The priority value should range from -2 to 2');
 if(Array.isArray(options.buttons)&&options.buttons.length>MAX_BUTTONS)throw new Error('The notification may have at most 2 buttons');
}

module.exports={
 namespaces:['notifications'],
 install(api){
  const presenter=module.exports.presenter||defaultPresenter();
  const records=new Map();   // key -> {key, id, extension, options, handle}
  const keyOf=(extensionId,id)=>`${extensionId}\u0000${id}`;
  const mine=extensionId=>[...records.values()].filter(record=>record.extension.id===extensionId);

  function show(record){
   record.handle?.close();
   record.handle=presenter.show(record,{
    click:()=>{if(!records.has(record.key))return;api.emit(record.extension.id,'notifications.onClicked',record.id);finish(record,true);},
    action:index=>{if(!records.has(record.key))return;api.emit(record.extension.id,'notifications.onButtonClicked',record.id,index);finish(record,true);},
    close:byUser=>{if(records.get(record.key)===record){records.delete(record.key);api.emit(record.extension.id,'notifications.onClosed',record.id,!!byUser);}}
   });
  }
  /** A click, a button or the person's dismissal ends the notification, as in Chrome. */
  function finish(record,byUser){
   if(records.get(record.key)!==record)return;
   records.delete(record.key);record.handle?.close();
   api.emit(record.extension.id,'notifications.onClosed',record.id,byUser);
  }

  api.handle('notifications.create',(event,notificationId,options)=>{
   check(options,{creating:true});
   const extension=event.extension,id=typeof notificationId==='string'&&notificationId?notificationId:randomUUID();
   if(!presenter.supported())return id;
   const key=keyOf(extension.id,id),old=records.get(key);
   if(!old&&mine(extension.id).length>=MAX_PER_EXTENSION)throw new Error('Too many notifications.');
   const record={key,id,extension,options:mix(options,{}),handle:null};
   records.set(key,record);
   show(record);
   return id;
  });
  api.handle('notifications.update',(event,notificationId,options)=>{
   const record=records.get(keyOf(event.extension.id,notificationId));
   if(!record)return false;
   check(options,{creating:false});
   record.options=mix(record.options,options);
   show(record);
   return true;
  });
  api.handle('notifications.clear',(event,notificationId)=>{
   const record=records.get(keyOf(event.extension.id,notificationId));
   if(!record)return false;
   finish(record,false);
   return true;
  });
  api.handle('notifications.getAll',event=>Object.fromEntries(mine(event.extension.id).map(record=>[record.id,true])));
  api.handle('notifications.getPermissionLevel',()=>(presenter.supported()?'granted':'denied'));

  const sessionExtensions=api.session?.extensions||api.session;
  const drop=extension=>{for(const record of mine(extension.id)){records.delete(record.key);record.handle?.close();}};
  try{sessionExtensions?.on?.('extension-unloaded',(_event,extension)=>{if(extension)drop(extension);});}catch{/* tests without a session */}

  /** For rigs: press a notification's parts without a screen. kind: 'click' | 'button' | 'close'. */
  function interact(extensionId,id,kind,arg){
   const record=records.get(keyOf(extensionId,id)),entry=presenter.shown?.get?.(keyOf(extensionId,id));
   if(!record||!entry)return false;
   if(kind==='click')entry.handlers.click();
   else if(kind==='button')entry.handlers.action(Number(arg)||0);
   else if(kind==='close')entry.handlers.close(arg!==false);
   else return false;
   return true;
  }
  const release=bridge.register(api.session,'notifications',{interact,list:()=>[...records.values()].map(record=>({extensionId:record.extension.id,id:record.id,options:record.options}))});
  return {forget:extensionId=>drop({id:extensionId}),dispose(){release();for(const record of records.values())record.handle?.close();records.clear();}};
 }
};
