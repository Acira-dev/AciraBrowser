'use strict';
// The native view for password suggestions and the save/update prompt: one transparent-background WebContentsView per window,
// kept above the page views, positioned from the field's rectangle (suggestions) or the top-right of the page area (prompt).
// It is Acira's own page (prompt-frame.html), never page content, so a website can't read, restyle or click through it.
const path=require('node:path');
const {frameStrings}=require('./text.cjs');
const HTML=path.join(__dirname,'prompt-frame.html'),PRELOAD=path.join(__dirname,'prompt-frame-preload.cjs');
const ROW=34,PAD=4,EXIT_MS=120,SAVE={width:320,height:164,gap:16};

/**
 * Window-space rectangle for the view. Pure, so it is tested. page: the tab's view bounds; rect: the field in CSS px.
 * The prompt hangs under the right end of the address field like Chrome's (anchor: that field in window DIPs, window: the content size);
 * with no anchor (no address field on screen) it sits at the page's top-right.
 */
function placement({mode,page,rect,zoom=1,count=0,anchor=null,window:size=null}){
 if(!page||!(page.width>0)||!(page.height>0))return null;
 const pageWidth=Math.floor(page.width),pageHeight=Math.floor(page.height);
 if(!pageWidth||!pageHeight)return null;
 if(mode==='save'){
  if(anchor&&[anchor.x,anchor.y,anchor.width,anchor.height].every(Number.isFinite)&&anchor.width>0&&anchor.height>0){
   const edge=Math.max(1,Math.floor(size?.width>0?size.width:page.x+pageWidth)),bottom=Math.max(1,Math.floor(size?.height>0?size.height:page.y+pageHeight));
   const marginX=Math.min(8,Math.floor((edge-1)/2)),marginY=Math.min(8,Math.floor((bottom-1)/2));
   const width=Math.min(SAVE.width,edge-2*marginX),height=Math.min(SAVE.height,bottom-2*marginY);
   return {x:Math.round(Math.max(marginX,Math.min(anchor.x+anchor.width-width,edge-width-marginX))),y:Math.round(Math.max(marginY,Math.min(anchor.y+anchor.height+4,bottom-height-marginY))),width,height};
  }
  const width=Math.min(SAVE.width,Math.max(240,pageWidth-2*SAVE.gap),pageWidth),height=Math.min(SAVE.height,pageHeight);
  const gap=Math.min(SAVE.gap,pageWidth-width);
  return {x:Math.round(page.x+pageWidth-width-gap),y:Math.round(page.y+Math.min(8,pageHeight-height)),width,height};
 }
 const width=Math.min(pageWidth,Math.max(260,Math.min(420,Math.round(rect.width*zoom)))),height=Math.min(count*ROW+2*PAD,pageHeight);
 let x=page.x+rect.x*zoom,y=page.y+(rect.y+rect.height)*zoom+4;
 if(y+height>page.y+pageHeight)y=page.y+rect.y*zoom-height-4;
 x=Math.max(page.x,Math.min(x,page.x+pageWidth-width));
 y=Math.max(page.y,Math.min(y,page.y+pageHeight-height));
 return {x:Math.round(x),y:Math.round(y),width,height};
}

function createPromptFrame({WebContentsView,getWindow,boundsOf,zoomOf=()=>1,onChoose,onAction,onDismiss,isDark=()=>true,reducedMotion=()=>false,focusPage=()=>{},anchorOf=async()=>null}){
 let view=null,ready=false,queued=null,spec=null,visible=false,shownMode='',leaving=null,showToken=0;
 const askAnchor=()=>Promise.resolve().then(anchorOf).catch(()=>null);
 function ensure(){
  if(view&&!view.webContents.isDestroyed())return view;
  view=new WebContentsView({webPreferences:{preload:PRELOAD,contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'acira-pw-frame'}});
  view.setBackgroundColor('#00000000');view.setVisible(false);
  const wc=view.webContents;ready=false;
  wc.setWindowOpenHandler(()=>({action:'deny'}));
  wc.on('will-navigate',event=>event.preventDefault());
  wc.ipc.on('acira:pw-frame',(_event,command,argument)=>{
   if(command==='ready'){ready=true;if(queued){send(queued);queued=null;}}
   else if(command==='choose'&&Number.isInteger(argument))onChoose(argument);
   else if(command==='action'&&['save','never','dismiss'].includes(argument))onAction(argument);
  });
  wc.loadFile(HTML).catch(()=>{});
  const win=getWindow();if(win&&!win.isDestroyed())win.contentView.addChildView(view);
  return view;
 }
 function send(state){const wc=view?.webContents;if(!wc||wc.isDestroyed())return;wc.send('acira:pw-frame-state',{...state,t:frameStrings(),dark:isDark(),reducedMotion:reducedMotion()});}
 function place(){
  if(!spec||!view)return false;
  const win=getWindow();if(!win||win.isDestroyed())return false;
  let size=null;try{const [width,height]=win.getContentSize();size={width,height};}catch{}
  const bounds=placement({mode:spec.mode,page:boundsOf(spec.tabId),rect:spec.rect,zoom:zoomOf(spec.tabId),count:spec.items?.length||0,anchor:spec.anchor,window:size});
  if(!bounds)return false;
  view.setBounds(bounds);return true;
 }
 function raise(){const win=getWindow();if(!view||!win||win.isDestroyed())return;const kids=win.contentView.children;if(kids.at(-1)!==view)win.contentView.addChildView(view);}
 return {
  show(next){
   // The prompt's anchor (the address field) is read from the interface first; a newer show or hide cancels a pending one.
   if(next.mode==='save'&&!next.anchored){const token=++showToken;askAnchor().then(anchor=>{if(token===showToken)this.show({...next,anchor,anchored:true});});return;}
   showToken++;clearTimeout(leaving);leaving=null;spec=next;ensure();
   if(!place()){this.hide(true);return;}
   raise();view.setVisible(true);visible=true;shownMode=next.mode;
   const state={mode:next.mode,focus:next.focus===true,kind:next.kind||'',items:next.items||[],index:next.index??-1,host:next.host||'',username:next.username||'',masked:next.masked||''};
   if(ready)send(state);else queued=state;
   if(next.mode==='save'&&next.focus)view.webContents.focus();
  },
  /** The prompt leaves in 120ms (bible §4 Transient surfaces); the suggestion list and every forced hide go at once. */
  hide(immediate=false){
   showToken++;const wasVisible=visible,mode=shownMode;visible=false;spec=null;queued=null;clearTimeout(leaving);leaving=null;
   if(!view||view.webContents.isDestroyed())return;
   const finish=()=>{leaving=null;if(visible||!view||view.webContents.isDestroyed())return;view.setVisible(false);view.setBounds({x:0,y:0,width:0,height:0});send({mode:'none'});};
   if(wasVisible&&mode==='save'&&!immediate){send({mode:'leave'});leaving=setTimeout(finish,EXIT_MS+20);return;}
   view.setVisible(false);view.setBounds({x:0,y:0,width:0,height:0});if(wasVisible)send({mode:'none'});
  },
  /** Called after layout changes: stay on top and follow the page area. */
  relayout(){
   if(!visible)return;if(!place()){this.hide(true);onDismiss();return;}raise();
   if(spec?.mode==='save'){const current=spec;askAnchor().then(anchor=>{if(anchor&&spec===current&&visible){current.anchor=anchor;place();}});}// the toolbar may have moved
  },
  get visible(){return visible;},
  get webContents(){return view?.webContents||null;},
  dispose(){showToken++;spec=null;queued=null;clearTimeout(leaving);leaving=null;const win=getWindow();try{if(view&&win&&!win.isDestroyed())win.contentView.removeChildView(view);}catch{}try{if(view&&!view.webContents.isDestroyed())view.webContents.close();}catch{}view=null;visible=false;},
 };
}
module.exports={createPromptFrame,placement,ROW,PAD};
