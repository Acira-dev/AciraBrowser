'use strict';
// Acira-styled question window for the things the browser asks (site permission, downloads, opening files).
// Same call shape as electron's dialog.showMessageBox so existing callers keep working. One hidden window is kept and
// reused: tearing a view down per question also killed an unrelated renderer process in the same app.
function createAppDialog({BaseWindow,WebContentsView,ipcMain,nativeTheme,preload,pageURL,fallback,enabled=()=>true,anchorFor=()=>null,loadTimeout=10000}){
 const WIDTH=400,WIDE=680,POPOVER=320; // bible §4 Transient surfaces: dialog 400, picker 680, prompt 320
 let pool=null,chain=Promise.resolve(),current=null;

 function ensure(){
  if(pool&&!pool.window.isDestroyed())return pool;
  const view=new WebContentsView({webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
  const contents=view.webContents;
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',(event,url)=>{if(url!==pageURL)event.preventDefault();});
  const window=new BaseWindow({width:WIDTH,height:220,show:false,frame:false,resizable:false,minimizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,backgroundColor:nativeTheme.shouldUseDarkColors?'#232428':'#ffffff',title:'Acira'});
  window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:WIDTH,height:220});
  // true once the page is there; false when it never gets there (its renderer stopped, the load failed, or ten seconds went by)
  const loaded=new Promise(resolve=>{contents.once('did-finish-load',()=>resolve(true));contents.once('render-process-gone',()=>resolve(false));contents.once('did-fail-load',(_event,code)=>{if(code!==-3)resolve(false);});setTimeout(()=>resolve(false),loadTimeout).unref?.();});
  contents.loadURL(pageURL).catch(()=>undefined);
  const made={window,view,contents,loaded};pool=made;
  window.on('closed',()=>{if(pool===made)pool=null;if(current?.made===made)current.finish(current.cancelId);try{if(!contents.isDestroyed())contents.close();}catch{}});
  // The question's page stopped (its renderer crashed): it used to stay on screen blank, never answered, and every later question waited behind it.
  // The window is thrown away (the next question makes a new one) and the question that was showing is asked again in a new one, once.
  // Only this window's own question: a page that outlived its window (given up on below) must not clear the one now asked in a new window.
  contents.on('render-process-gone',(_event,details)=>{if(details?.reason==='clean-exit')return;if(pool===made)pool=null;const asking=current?.made===made?current:null;if(asking)current=null;try{if(!window.isDestroyed())window.destroy();}catch{}asking?.again();});
  const onReady=(event,height)=>{if(event.sender!==contents||!current||window.isDestroyed())return;
   const h=Math.max(120,Math.min(520,Math.round(Number(height)||220)));const width=current.width;window.setContentSize(width,h);view.setBounds({x:0,y:0,width,height:h});
   const parent=current.parent,anchor=current.popover&&parent&&!parent.isDestroyed()?anchorFor(parent):null;if(anchor){window.setPosition(Math.round(anchor.x),Math.round(anchor.y));}else if(parent&&!parent.isDestroyed()){const b=parent.getBounds();window.setPosition(Math.round(b.x+(b.width-width)/2),Math.round(b.y+Math.min(160,Math.max(40,(b.height-h)/3))));}
   window.show();window.moveTop();contents.focus();
   // Activation focuses the first button; put focus back on the default (the safe answer when the action is risky).
   contents.executeJavaScript("typeof focusDefault==='function'&&focusDefault()").catch(()=>undefined);};
  const onRespond=(event,index,selected,dismissed)=>{if(event.sender===contents&&current&&Number.isInteger(index)&&index>=0&&index<current.count)current.finish(index,Number.isInteger(selected)&&selected>=0&&selected<current.items?selected:undefined,dismissed===true);};
  ipcMain.on('acira:dialog-ready',onReady);ipcMain.on('acira:dialog-respond',onRespond);
  // a window made again after its page stopped must not leave its listeners behind
  window.on('closed',()=>{ipcMain.removeListener('acira:dialog-ready',onReady);ipcMain.removeListener('acira:dialog-respond',onRespond);});
  return made;
 }

 async function present(parent,options,attempt=0){
  const buttons=(Array.isArray(options.buttons)&&options.buttons.length?options.buttons:['OK']).map(String).slice(0,5);
  const cancelId=Number.isInteger(options.cancelId)&&options.cancelId>=0&&options.cancelId<buttons.length?options.cancelId:buttons.length-1;
  const defaultId=Number.isInteger(options.defaultId)&&options.defaultId>=0&&options.defaultId<buttons.length?options.defaultId:0;
  let made;
  try{made=ensure();if(!await made.loaded){if(pool===made)pool=null;try{if(!made.window.isDestroyed())made.window.destroy();}catch{}try{if(!made.contents.isDestroyed())made.contents.close();}catch{}return attempt<1?present(parent,options,attempt+1):{response:cancelId,checkboxChecked:false,dismissed:true};}}catch{return {response:cancelId,checkboxChecked:false};}
  return new Promise(resolve=>{
   const usable=parent&&!parent.isDestroyed?.()?parent:null;
   const finish=(response,selected,dismissed)=>{if(!current||current.finish!==finish)return;current=null;usable?.removeListener?.('closed',onParentClosed);try{if(!made.window.isDestroyed()){made.window.hide();made.window.setParentWindow(null);}}catch{}resolve({response,checkboxChecked:false,...(selected===undefined?{}:{selected}),...(dismissed===true?{dismissed:true}:{})});};
   const onParentClosed=()=>finish(cancelId,undefined,true);
   // its page stopped: asked again in a new window, once; then answered the safe way (cancel), so nothing waits for good
   const again=()=>{usable?.removeListener?.('closed',onParentClosed);resolve(attempt<1?present(parent,options,attempt+1):{response:cancelId,checkboxChecked:false,dismissed:true});};
   const items=(Array.isArray(options.items)?options.items:[]).slice(0,30).map(item=>({label:String(item?.label||'').slice(0,120),kind:String(item?.kind||'').slice(0,20),thumb:typeof item?.thumb==='string'&&/^data:image\/(?:png|jpeg);base64,/.test(item.thumb)&&item.thumb.length<200000?item.thumb:''}));
   current={made,finish,again,cancelId,count:buttons.length,parent:usable,items:items.length,popover:!!options.popover&&!items.length,width:items.length?WIDE:options.popover?POPOVER:WIDTH};
   try{if(usable){usable.once('closed',onParentClosed);made.window.setParentWindow(usable);}}catch{}
   made.contents.send('acira:dialog-init',{kicker:String(options.title||'').slice(0,60),title:String(options.message||'').slice(0,240),detail:String(options.detail||'').slice(0,1200),buttons,defaultId,cancelId,dark:nativeTheme.shouldUseDarkColors,warning:options.type==='warning',popover:!!options.popover&&!items.length,items});
  });
 }

 /** Drop-in for dialog.showMessageBox([window,] options). Questions are asked one at a time. */
 function showMessageBox(...args){
  const options=args.at(-1)&&typeof args.at(-1)==='object'?args.at(-1):{},parent=args.length>1?args[0]:null;
  if(!enabled(parent))return fallback.showMessageBox(...args);
  const run=()=>present(parent,options);
  const next=chain.then(run,run);chain=next.catch(()=>undefined);return next;
 }
 /** Closes the hidden window so it never keeps the app alive after the last browser window is gone. */
 function dispose(){const made=pool;pool=null;try{if(made&&!made.window.isDestroyed())made.window.destroy();}catch{}}
 return {showMessageBox,dispose,available:enabled};
}
module.exports={createAppDialog};
