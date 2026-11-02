'use strict';
// Acira's "Choose what to share" picker and the sharing pill. One picker for everything that asks for a screen: web pages'
// getDisplayMedia (Meet, Zoom, Discord) and extensions' chrome.desktopCapture (Loom, recorders). Screens and windows come from
// desktopCapturer, with pictures refreshed while the picker is open; Acira tabs of the asking profile are listed with a picture of the page.
// The pill sits at the bottom of the screen while anything is shared, is left out of screen captures (content protection), and its
// Stop ends every capture. Both pages (public/share.html) get only their own text and report a choice; they have no browser capabilities.
// Windows are kept and reused, as app-dialog.cjs does (tearing a view down per question once killed an unrelated renderer).
const GROUPS=['screen','window','tab'];
const LIVE_MS=1500,PILL_GAP=24;

function host(url){try{const u=new URL(String(url));return u.protocol==='file:'?u.pathname.split('/').pop()||'file':u.hostname.replace(/^www\./,'');}catch{return '';}}
const jpeg=image=>{try{return image&&!image.isEmpty()?'data:image/jpeg;base64,'+image.toJPEG(72).toString('base64'):'';}catch{return '';}};

/** The pill's sentence around the sharer's name, so a long name is shortened while "is sharing a tab" stays whole (in every word order). */
function pillParts(tm,id,name){const mark='\u0001',text=String(tm(id,{name:mark})),at=text.indexOf(mark);return at<0?{label:String(tm(id,{name})),before:String(tm(id,{name})),name:'',after:''}:{label:text.replace(mark,name),before:text.slice(0,at),name,after:text.slice(at+1)};}

/** Which sources the picker offers and whether sound can come with each (system sound with a screen on Windows, a tab's own sound). */
function plan({types=GROUPS,audio=false,platform=process.platform}={}){
 const groups=GROUPS.filter(group=>(Array.isArray(types)?types:[]).includes(group));
 return {groups,audio:{screen:!!audio&&platform==='win32'&&groups.includes('screen'),window:false,tab:!!audio&&groups.includes('tab')}};
}

function createShareUi({BaseWindow,WebContentsView,ipcMain,nativeTheme,screen,desktopCapturer,preload,pageURL,tm,listTabs=()=>[],platform=process.platform,setTimer=setInterval,clearTimer=clearInterval}){
 const surfaces=new Map();let chain=Promise.resolve(),current=null;const shares=new Map();
 const dark=()=>!!nativeTheme?.shouldUseDarkColors;

 function surface(kind){
  const existing=surfaces.get(kind);if(existing&&!existing.window.isDestroyed())return existing;
  const pill=kind==='pill';
  const view=new WebContentsView({webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  const contents=view.webContents,url=pageURL+(pill?'?pill':'');
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',(event,next)=>{if(next!==url)event.preventDefault();});
  const window=new BaseWindow({width:pill?320:680,height:pill?76:420,show:false,frame:false,resizable:false,minimizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,title:'Acira',
   ...(pill?{transparent:true,hasShadow:false,alwaysOnTop:true,focusable:false}:{backgroundColor:dark()?'#232428':'#ffffff'})});
  if(pill){try{view.setBackgroundColor('#00000000');}catch{}try{window.setAlwaysOnTop(true,'floating');}catch{}}
  // Neither the picker nor the pill ever appears in what is shared.
  try{window.setContentProtection(true);}catch{}
  window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:pill?320:680,height:pill?76:420});
  const loaded=new Promise(resolve=>contents.once('did-finish-load',resolve));
  contents.loadURL(url).catch(()=>undefined);
  const made={kind,window,view,contents,loaded};surfaces.set(kind,made);
  window.on('closed',()=>{if(surfaces.get(kind)===made)surfaces.delete(kind);if(kind==='picker')current?.finish(null);});
  return made;
 }
 const ownSourceIds=()=>[...surfaces.values()].map(s=>{try{return s.window.getMediaSourceId();}catch{return '';}}).filter(Boolean);

 if(ipcMain){
  ipcMain.on('acira:share-ready',(event,size)=>{
   const made=[...surfaces.values()].find(s=>s.contents===event.sender);if(!made||made.window.isDestroyed())return;
   const width=Math.max(160,Math.min(720,Math.round(Number(size?.width)||0))),height=Math.max(48,Math.min(620,Math.round(Number(size?.height)||0)));
   if(made.kind==='picker'){
    if(!current)return;made.window.setContentSize(680,height);made.view.setBounds({x:0,y:0,width:680,height});
    const parent=current.parent;let x,y;
    if(parent&&!parent.isDestroyed()){const b=parent.getBounds();x=b.x+(b.width-680)/2;y=b.y+Math.min(140,Math.max(40,(b.height-height)/3));}
    else{const area=screen.getPrimaryDisplay().workArea;x=area.x+(area.width-680)/2;y=area.y+(area.height-height)/3;}
    made.window.setPosition(Math.round(x),Math.round(y));made.window.show();made.window.moveTop();made.contents.focus();
   }else{
    if(!shares.size)return;made.window.setContentSize(width,height);made.view.setBounds({x:0,y:0,width,height});
    const anchor=[...shares.values()].at(-1)?.anchor,b=anchor&&!anchor.isDestroyed?.()?anchor.getBounds():null;
    const area=(b?screen.getDisplayMatching(b):screen.getPrimaryDisplay()).workArea;
    made.window.setPosition(Math.round(area.x+(area.width-width)/2),Math.round(area.y+area.height-height-PILL_GAP+16));
    if(!made.window.isVisible())made.window.showInactive();
   }
  });
  ipcMain.on('acira:share-respond',(event,answer)=>{
   const made=surfaces.get('picker');if(!made||event.sender!==made.contents||!current)return;
   if(!answer||typeof answer!=='object'||typeof answer.key!=='string'){current.finish(null);return;}
   const item=current.items.find(entry=>entry.key===answer.key);
   current.finish(item?{source:item.source,audio:!!answer.audio&&!!current.audio[item.group],label:item.label,kind:item.group}:null);
  });
  ipcMain.on('acira:share-stop',event=>{const made=surfaces.get('pill');if(made&&event.sender===made.contents)stopAll();});
 }

 async function sources(groups){
  const kinds=groups.filter(group=>group!=='tab');if(!kinds.length)return [];
  let found=[];try{found=await desktopCapturer.getSources({types:kinds,thumbnailSize:{width:320,height:180},fetchWindowIcons:false});}catch{return [];}
  const own=new Set(ownSourceIds());
  return found.filter(source=>!own.has(source.id)).slice(0,24).map(source=>{const group=source.id.startsWith('screen:')?'screen':'window';return {key:source.id,group,label:source.name||'',thumb:jpeg(source.thumbnail),source:{type:group,id:source.id,name:source.name||''}};});
 }
 function tabs(session){
  let list=[];try{list=listTabs(session)||[];}catch{}
  return list.filter(wc=>wc&&!wc.isDestroyed()).slice(0,16).map(wc=>({key:'tab:'+wc.id,group:'tab',label:wc.getTitle()||host(wc.getURL()),detail:host(wc.getURL()),thumb:'',source:{type:'tab',tabId:wc.id},wc}));
 }
 async function tabThumbs(items){
  const out={};
  for(const item of items){if(item.group!=='tab'||item.wc.isDestroyed())continue;try{const image=await item.wc.capturePage(undefined,{stayHidden:true});const resized=image.isEmpty()?image:image.resize({width:320});const data=jpeg(resized);if(data)out[item.key]=data;}catch{}}
  return out;
 }

 /** Shows the picker. Returns {source, audio, label, kind} for the choice, or null. request.cancel is set while it is open. */
 function pick(options={}){const run=()=>present(options);const next=chain.then(run,run);chain=next.catch(()=>undefined);return next;}
 async function present({session=null,requester='',types=GROUPS,audio=false,parent=null,request=null}={}){
  if(request?.cancelled)return null;
  const {groups,audio:sound}=plan({types,audio,platform});if(!groups.length)return null;
  let made;try{made=surface('picker');await made.loaded;}catch{return null;}
  const items=[...await sources(groups),...(groups.includes('tab')?tabs(session):[])];
  if(request?.cancelled)return null;
  return new Promise(resolve=>{
   let timer=null,busy=false;
   const usable=parent&&!parent.isDestroyed?.()?parent:null;
   const finish=result=>{if(!current||current.finish!==finish)return;current=null;if(timer)clearTimer(timer);usable?.removeListener?.('closed',onParentClosed);if(request)request.cancel=null;
    try{if(!made.window.isDestroyed()){made.window.hide();made.window.setParentWindow(null);}}catch{}resolve(result);};
   const onParentClosed=()=>finish(null);
   current={finish,items,audio:sound,parent:usable};
   if(request)request.cancel=()=>finish(null);
   try{if(usable){usable.once('closed',onParentClosed);made.window.setParentWindow(usable);}}catch{}
   const who=String(requester||'').slice(0,80);
   made.contents.send('acira:share-init',{mode:'picker',dark:dark(),groups,audio:sound,
    items:items.map(({key,group,label,detail,thumb})=>({key,group,label:String(label).slice(0,120),detail:String(detail||'').slice(0,80),thumb})),
    text:{title:tm('main.shareChooseTitle'),detail:who?tm('main.shareChooseDetail',{name:who}):tm('main.onlyWhatYouChooseIs'),screen:tm('main.shareScreens'),window:tm('main.shareWindows'),tab:tm('main.shareTabs'),
     audio:tm('main.shareAudio'),cancel:tm('main.cancel'),share:tm('main.share'),empty:tm('main.shareNothing')}});
   // Pictures stay live while the picker is open: screens and windows from desktopCapturer, tabs from the page itself.
   const refresh=async()=>{if(busy||!current||current.finish!==finish)return;busy=true;try{
    const fresh=await sources(groups),thumbs=Object.fromEntries(fresh.filter(item=>item.thumb&&items.some(known=>known.key===item.key)).map(item=>[item.key,item.thumb]));
    Object.assign(thumbs,await tabThumbs(items));
    if(current?.finish===finish&&Object.keys(thumbs).length&&!made.contents.isDestroyed())made.contents.send('acira:share-thumbs',thumbs);}finally{busy=false;}};
   void refresh();timer=setTimer(refresh,LIVE_MS);timer?.unref?.();
  });
 }

 // The pill: the latest share's wording; Stop ends them all.
 const PILL_TEXT={screen:'main.sharingScreen',window:'main.sharingWindow',tab:'main.sharingTab'};
 async function syncPill(){
  const list=[...shares.values()];let made=surfaces.get('pill');
  if(!list.length){if(made&&!made.window.isDestroyed())made.window.hide();return;}
  try{made=surface('pill');await made.loaded;}catch{return;}
  const latest=[...shares.values()].at(-1);if(!latest||made.contents.isDestroyed())return;
  made.contents.send('acira:share-init',{mode:'pill',dark:dark(),text:{...pillParts(tm,PILL_TEXT[latest.kind]||PILL_TEXT.screen,latest.who||'Acira'),stop:tm('main.stopSharing'),more:list.length>1?`+${list.length-1}`:''}});
 }
 /** Something is being shared: key (unique), who (site host or extension name), kind (screen | window | tab), stop(), anchor (window to place the pill on). */
 function addShare(key,{who='',kind='screen',stop=()=>{},anchor=null}={}){shares.delete(key);shares.set(key,{key,who:String(who).slice(0,60),kind:GROUPS.includes(kind)?kind:'screen',stop,anchor});void syncPill();}
 function removeShare(key){if(shares.delete(key))void syncPill();}
 async function stopAll(){const list=[...shares.values()];shares.clear();void syncPill();await Promise.all(list.map(share=>Promise.resolve().then(()=>share.stop()).catch(()=>undefined)));}
 if(nativeTheme?.on)nativeTheme.on('updated',()=>{if(shares.size)void syncPill();});
 function dispose(){for(const made of surfaces.values())try{if(!made.window.isDestroyed())made.window.destroy();}catch{}surfaces.clear();}
 return {pick,addShare,removeShare,stopAll,shares,dispose,get picking(){return !!current;}};
}
module.exports={createShareUi,plan,host,pillParts};
