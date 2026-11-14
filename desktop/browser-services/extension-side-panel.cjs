'use strict';
// chrome.sidePanel's surface: one extension side panel per window, docked on the right of the page area beside the page, the way a split
// pane sits (6px gap, the page radius). The page views give up that width (trim), so nothing is covered. Two native views: an Acira frame
// (side-panel-frame.html: the card, a 40px header with the extension's name and Close) and the extension's page in the extension's own
// session. Links from the panel open as tabs; the panel never navigates away from its extension. Esc in the frame or Close ends it.
// The panel page closing itself (window.close()) ends it exactly as Close does: ported from Chromium 152, extensions/browser/extension_host.cc (CloseContents -> Close(): the host's close
// handler runs once) and chrome/browser/ui/views/side_panel/extensions/extension_side_panel_coordinator.cc (HandleCloseExtensionSidePanel: the panel is closed, the state is reset, and
// OnClosed() tells the extension). Electron has no such handler: a page's window.close() DESTROYS its contents and takes its view out of the window, so the panel listens for that.
const path=require('node:path');
const FRAME=path.join(__dirname,'side-panel-frame.html'),FRAME_PRELOAD=path.join(__dirname,'side-panel-frame-preload.cjs');
const GAP=6,HEADER=40,MIN_PAGE=360,MIN_WIDTH=320,MAX_WIDTH=420,REVEAL_CAP_MS=500;

/** Width and place of the panel in a page area, or null when the area is too narrow to share. The width comes from the page area; the right
 * edge, top and height from `anchor`, the page card the panel sits beside (its bounds before narrowing), so both line up. Pure. */
function panelGeometry(page,anchor=null){
 if(!page||!(page.width>0)||!(page.height>0))return null;
 const width=Math.min(MAX_WIDTH,Math.max(MIN_WIDTH,Math.round(page.width*.3)));
 if(page.width-width-GAP<MIN_PAGE)return null;
 const box=anchor&&anchor.width>0&&anchor.height>0?anchor:page;
 const panel={x:Math.round(box.x+box.width-width),y:Math.round(box.y),width,height:Math.round(box.height)};
 return {panel,content:{x:panel.x,y:panel.y+HEADER,width:panel.width,height:Math.max(0,panel.height-HEADER)},reserve:width+GAP};
}
/** A page view that reaches the right edge of the page area (within its card inset) gives the panel its width. Pure. */
function trimBounds(bounds,page,geometry){
 if(!geometry||!bounds||!page)return bounds;
 const right=page.x+page.width;if(bounds.x+bounds.width<right-24)return bounds;
 return {...bounds,width:Math.max(1,bounds.width-geometry.reserve)};
}

function createSidePanelHost({WebContentsView,getWindow,pageBounds,radius=()=>8,relayout=()=>{},dark=()=>true,motionScale=()=>1,labels=()=>({close:'Close',closeKey:'Esc'}),lang=()=>'en',openTab=()=>{},raiseAbove=null}){
 let current=null,anchor=null;
 const geometry=()=>current?panelGeometry(pageBounds(),anchor):null;
 function sendState(phase){if(!current||current.frame.webContents.isDestroyed())return;const l=labels();current.frame.webContents.send('acira:side-panel-frame-state',{phase,name:current.name,dark:!!dark(),motionScale:Number(motionScale())||0,radius:Math.round(radius()),closeLabel:l.close,closeKey:l.closeKey,lang:lang()});}
 function place(){
  if(!current)return;const win=getWindow();if(!win||win.isDestroyed())return;const g=geometry();
  if(!g){current.frame.setVisible(false);current.view.setVisible(false);return;}raise();
  current.frame.setBounds(g.panel);current.view.setBounds(g.content);current.view.setBorderRadius?.(Math.round(radius()));current.frame.setVisible(true);current.view.setVisible(current.revealed);
 }
 /** Above the pages, below whatever raiseAbove names (the window's popup layer); views are only moved when they are out of place. */
 function raise(){
  if(!current)return;const win=getWindow();if(!win||win.isDestroyed())return;const children=win.contentView.children,others=children.filter(v=>v!==current.frame&&v!==current.view);
  const above=raiseAbove?raiseAbove(others):undefined,at=typeof above==='number'&&above>=0&&above<=others.length?above:others.length;
  if(children.indexOf(current.frame)===at&&children.indexOf(current.view)===at+1)return;
  if(at===others.length){win.contentView.addChildView(current.frame);win.contentView.addChildView(current.view);}else{win.contentView.addChildView(current.frame,at);win.contentView.addChildView(current.view,at+1);}
 }
 function reveal(){if(!current||current.revealed)return;current.revealed=true;clearTimeout(current.cap);place();}
 /** The extension's page no longer exists (window.close() from the panel, the extension unloaded or reloaded). */
 const gone=panel=>{try{return panel.view.webContents.isDestroyed();}catch{return true;}};
 function teardown(panel){
  clearTimeout(panel.cap);clearTimeout(panel.exit);const win=getWindow();
  for(const view of [panel.view,panel.frame]){try{if(win&&!win.isDestroyed())win.contentView.removeChildView(view);}catch{}try{if(!view.webContents.isDestroyed())view.webContents.close();}catch{}}
 }
 function close({silent=false}={}){
  if(!current)return Promise.resolve();const panel=current;current=null;relayout();
  return new Promise(resolve=>{
   const done=()=>{teardown(panel);if(!silent)try{panel.onClosed?.({extensionId:panel.extensionId,url:panel.url});}catch{}resolve();};
   if(!motionScale()||panel.frame.webContents.isDestroyed()){done();return;}
   try{panel.view.setVisible(false);panel.frame.webContents.send('acira:side-panel-frame-state',{phase:'out',name:panel.name,dark:!!dark(),motionScale:Number(motionScale()),radius:Math.round(radius()),closeLabel:labels().close,closeKey:labels().closeKey,lang:lang()});}catch{}
   panel.onGone=done;panel.exit=setTimeout(done,Math.round(260*Math.max(1,Number(motionScale())||1)));
  });
 }
 async function open({extensionId,name,url,session,onClosed}){
  const win=getWindow();if(!win||win.isDestroyed())throw new Error('The side panel is not available in this window.');
  if(!panelGeometry(pageBounds()))throw new Error('The window is too narrow for a side panel.');
  /* A panel whose page is gone (it closed itself: see the 'destroyed' listener below) is not "already open": an open() that answered {reused:true} for it left an empty column and a button that did nothing. */
  if(current&&current.extensionId===extensionId&&gone(current))await close({silent:true});
  if(current&&current.extensionId===extensionId){if(current.url!==url)navigate({extensionId,url});return {reused:true};}
  if(current)await close();
  const frame=new WebContentsView({webPreferences:{preload:FRAME_PRELOAD,sandbox:true,contextIsolation:true,nodeIntegration:false,spellcheck:false,transparent:true}});
  frame.setBackgroundColor?.('#00000000');
  const view=new WebContentsView({webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,spellcheck:true}});
  const origin=`chrome-extension://${extensionId}/`;
  const panel={extensionId,name,url,frame,view,onClosed,revealed:false,cap:null,exit:null,onGone:null};current=panel;
  frame.webContents.ipc.on('acira:side-panel-frame',(_event,command)=>{if(command==='close'&&current===panel)void close();else if(command==='entered'&&current===panel){panel.entered=true;if(panel.loaded)reveal();}else if(command==='gone')panel.onGone?.();});
  const external=target=>{try{const u=new URL(target);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
  view.webContents.setWindowOpenHandler(details=>{if(external(details.url))void openTab(details.url);return {action:'deny'};});
  view.webContents.on('will-navigate',(event,target)=>{const to=typeof target==='string'?target:event?.url;if(String(to||'').startsWith(origin))return;event.preventDefault?.();if(external(to))void openTab(to);});
  view.webContents.once('dom-ready',()=>{panel.loaded=true;if(current===panel&&panel.entered)reveal();});
  /* The page closing itself (window.close(), as Image Downloader's own close button does; the extension being unloaded or reloaded does the same): Chromium's ExtensionHost::CloseContents runs the close
     handler the side panel coordinator set, which closes the panel (HandleCloseExtensionSidePanel) and tells the extension (OnClosed). Here the contents are destroyed and the view taken out of the
     window, which left Acira's card as an empty column and the panel "open" for good: the same close as the Close button, so the column goes, the state clears and the button opens it again. */
  view.webContents.on('destroyed',()=>{if(current===panel)void close();});
  frame.webContents.once('did-finish-load',()=>{sendState('in');});
  panel.cap=setTimeout(()=>{if(current===panel)reveal();},REVEAL_CAP_MS);
  raise();relayout();place();
  await frame.webContents.loadFile(FRAME).catch(()=>{});
  view.webContents.loadURL(url).catch(()=>{});
  return {opened:true};
 }
 function navigate({extensionId,url}){if(!current||current.extensionId!==extensionId)return;current.url=url;current.view.webContents.loadURL(url).catch(()=>{});}
 return {
  open,close,navigate,place,raise,
  current:()=>current?{extensionId:current.extensionId,url:current.url,webContents:current.view.webContents}:null,
  /** Called once per layout pass before the page views are placed; trim then remembers the card the panel sits beside. */
  begin(){anchor=null;},
  trim:(bounds,page)=>{const out=trimBounds(bounds,page,current?panelGeometry(page):null);if(out!==bounds)anchor={...bounds};return out;},
  restyle(){if(current)sendState('in');},
  destroy(){if(!current)return;const panel=current;current=null;teardown(panel);}
 };
}

module.exports={createSidePanelHost,panelGeometry,trimBounds,GAP,HEADER};
