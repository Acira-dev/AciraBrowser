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

/** Entries of the host are keyed like Chromium's registries: 'tab:<id>' is a panel that belongs to one tab (options set with a tabId: SidePanelRegistry of that tab, kept alive while another tab is in front),
 * 'window' is the one every tab without a panel of its own shows (the extension-wide options). One panel is shown at a time: the active tab's own, else the window's. */
const WINDOW_KEY='window';
function createSidePanelHost({WebContentsView,getWindow,pageBounds,radius=()=>8,relayout=()=>{},dark=()=>true,motionScale=()=>1,labels=()=>({close:'Close',closeKey:'Esc'}),lang=()=>'en',openTab=()=>{},raiseAbove=null}){
 const entries=new Map();   // key -> panel
 let shown=null,activeKey=null,anchor=null;
 const geometry=()=>shown?panelGeometry(pageBounds(),anchor):null;
 const infoOf=panel=>({extensionId:panel.extensionId,url:panel.url,webContents:panel.view.webContents,tabKey:panel.key,tabId:panel.tabId,shown:panel===shown});
 /** The extension's page no longer exists (window.close() from the panel, the extension unloaded or reloaded). */
 const gone=panel=>{try{return panel.view.webContents.isDestroyed();}catch{return true;}};
 const frameGone=panel=>{try{return panel.frame.webContents.isDestroyed();}catch{return true;}};
 function sendState(panel,phase,motion){if(!panel||frameGone(panel))return;const l=labels();panel.frame.webContents.send('acira:side-panel-frame-state',{phase,name:panel.name,dark:!!dark(),motionScale:motion===undefined?(Number(motionScale())||0):motion,radius:Math.round(radius()),closeLabel:l.close,closeKey:l.closeKey,lang:lang()});}
 /** What is in front: the active tab's own panel, else the window's. Entries whose page is gone are never targets. */
 function targetFor(){
  const own=activeKey?entries.get(activeKey):null;if(own&&!gone(own))return own;
  const all=entries.get(WINDOW_KEY);return all&&!gone(all)?all:null;
 }
 function place(){
  if(!shown)return;const win=getWindow();if(!win||win.isDestroyed())return;const g=geometry();
  if(!g){shown.frame.setVisible(false);shown.view.setVisible(false);return;}raise();
  shown.frame.setBounds(g.panel);shown.view.setBounds(g.content);shown.view.setBorderRadius?.(Math.round(radius()));shown.frame.setVisible(true);shown.view.setVisible(shown.revealed);
 }
 /** Above the pages, below whatever raiseAbove names (the window's popup layer); views are only moved when they are out of place. */
 function raise(){
  if(!shown)return;const win=getWindow();if(!win||win.isDestroyed())return;const children=win.contentView.children,others=children.filter(v=>v!==shown.frame&&v!==shown.view);
  const above=raiseAbove?raiseAbove(others):undefined,at=typeof above==='number'&&above>=0&&above<=others.length?above:others.length;
  if(children.indexOf(shown.frame)===at&&children.indexOf(shown.view)===at+1)return;
  if(at===others.length){win.contentView.addChildView(shown.frame);win.contentView.addChildView(shown.view);}else{win.contentView.addChildView(shown.frame,at);win.contentView.addChildView(shown.view,at+1);}
 }
 function reveal(panel){if(!panel||panel.revealed)return;panel.revealed=true;clearTimeout(panel.cap);if(panel===shown)place();}
 function teardown(panel){
  clearTimeout(panel.cap);clearTimeout(panel.exit);const win=getWindow();
  for(const view of [panel.view,panel.frame]){try{if(win&&!win.isDestroyed())win.contentView.removeChildView(view);}catch{}try{if(!view.webContents.isDestroyed())view.webContents.close();}catch{}}
 }
 /** A panel that is not in front: out of the window, nothing else touched (its page keeps running, as a tab's panel does in Chromium). */
 function hide(panel){
  const win=getWindow();
  for(const view of [panel.frame,panel.view]){try{view.setVisible(false);}catch{}try{if(win&&!win.isDestroyed())win.contentView.removeChildView(view);}catch{}}
 }
 /** Puts the right panel in front: the one that was in front goes out of the window (kept), the new one comes in (no animation: it is only the same panel coming back). */
 function reconcile(){
  const target=targetFor();
  if(target===shown)return;
  const was=shown;shown=target;
  if(was)hide(was);
  if(target){
   /* a panel that was never in front (made for another tab) plays its own entrance when it first comes forward: the frame's animation only runs while its view is visible */
   if(!target.everShown){target.everShown=true;if(!target.entered){target.revealed=false;clearTimeout(target.cap);target.cap=setTimeout(()=>{if(!gone(target))reveal(target);},REVEAL_CAP_MS);}}
   raise();place();
  }
  relayout();
 }
 function closePanel(panel,{silent=false}={}){
  if(entries.get(panel.key)===panel)entries.delete(panel.key);
  const wasShown=panel===shown;if(wasShown)shown=null;
  return new Promise(resolve=>{
   const done=()=>{teardown(panel);if(!silent)try{panel.onClosed?.({extensionId:panel.extensionId,url:panel.url});}catch{}reconcile();resolve();};
   if(!wasShown||!motionScale()||frameGone(panel)){if(wasShown)relayout();done();return;}
   relayout();
   try{panel.view.setVisible(false);sendState(panel,'out');}catch{}
   panel.onGone=done;panel.exit=setTimeout(done,Math.round(260*Math.max(1,Number(motionScale())||1)));
  });
 }
 /** Which panel a request means: the named tab's (or the window's), else the one in front, narrowed to an extension when one is named. */
 function pick({tabKey,extensionId}={}){
  if(tabKey!==undefined){const found=entries.get(tabKey);return found&&(extensionId===undefined||found.extensionId===extensionId)?found:null;}
  if(extensionId===undefined)return shown;
  if(shown&&shown.extensionId===extensionId)return shown;
  for(const panel of entries.values())if(panel.extensionId===extensionId)return panel;
  return null;
 }
 function close({silent=false,tabKey,extensionId,all=false}={}){
  if(all&&extensionId!==undefined){return Promise.all([...entries.values()].filter(panel=>panel.extensionId===extensionId).map(panel=>closePanel(panel,{silent}))).then(()=>undefined);}
  const panel=pick({tabKey,extensionId});if(!panel)return Promise.resolve();
  return closePanel(panel,{silent});
 }
 /** True only when the panel is really on screen: in front, both pages alive, both views in the window. This, not "the host remembers it", is what makes a second open a no-op (Chromium's SidePanelCoordinator::Show looks at the shown entry). */
 function reallyShown(panel){
  if(panel!==shown||gone(panel)||frameGone(panel))return false;
  const win=getWindow();if(!win||win.isDestroyed())return false;
  const children=win.contentView.children;return children.includes(panel.frame)&&children.includes(panel.view);
 }
 async function open({extensionId,name,url,session,onClosed,tabKey=WINDOW_KEY,tabId}){
  const win=getWindow();if(!win||win.isDestroyed())throw new Error('The side panel is not available in this window.');
  if(!panelGeometry(pageBounds()))throw new Error('The window is too narrow for a side panel.');
  let existing=entries.get(tabKey);
  /* A panel whose page is gone (it closed itself: see the 'destroyed' listener below) is not "already open": an open() that answered {reused:true} for it left an empty column and a button that did nothing. */
  if(existing&&gone(existing)){await closePanel(existing,{silent:true});existing=entries.get(tabKey);}
  /* Neither is a panel the host remembers but nobody can see (its card or page out of the window, a card whose page was lost): it is shown again, or made new, so a press is never a no-op for a panel that is not there. */
  if(existing&&existing.extensionId===extensionId&&frameGone(existing)){await closePanel(existing,{silent:true});existing=entries.get(tabKey);}
  if(existing&&existing.extensionId===extensionId){
   if(tabId!==undefined)existing.tabId=tabId;
   if(existing.url!==url)navigate({extensionId,url,tabKey});
   if(!reallyShown(existing)){reconcile();raise();place();relayout();}
   return {reused:true};
  }
  if(existing)await closePanel(existing);
  const frame=new WebContentsView({webPreferences:{preload:FRAME_PRELOAD,sandbox:true,contextIsolation:true,nodeIntegration:false,spellcheck:false,transparent:true}});
  frame.setBackgroundColor?.('#00000000');
  /* a second view that cannot be made must not leave the first behind, and nothing is remembered for a panel that was never made */
  let view;try{view=new WebContentsView({webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,spellcheck:true}});}catch(error){try{frame.webContents.close();}catch{}throw error;}
  const origin=`chrome-extension://${extensionId}/`;
  const panel={key:tabKey,tabId,extensionId,name,url,frame,view,onClosed,revealed:false,cap:null,exit:null,onGone:null,everShown:false};entries.set(tabKey,panel);
  frame.webContents.ipc.on('acira:side-panel-frame',(_event,command)=>{if(command==='close'&&entries.get(panel.key)===panel)void closePanel(panel);else if(command==='entered'){panel.entered=true;if(panel.loaded)reveal(panel);}else if(command==='gone')panel.onGone?.();});
  const external=target=>{try{const u=new URL(target);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
  view.webContents.setWindowOpenHandler(details=>{if(external(details.url))void openTab(details.url);return {action:'deny'};});
  view.webContents.on('will-navigate',(event,target)=>{const to=typeof target==='string'?target:event?.url;if(String(to||'').startsWith(origin))return;event.preventDefault?.();if(external(to))void openTab(to);});
  view.webContents.once('dom-ready',()=>{panel.loaded=true;if(panel.entered)reveal(panel);});
  /* The page closing itself (window.close(), as Image Downloader's own close button does; the extension being unloaded or reloaded does the same): Chromium's ExtensionHost::CloseContents runs the close
     handler the side panel coordinator set, which closes the panel (HandleCloseExtensionSidePanel) and tells the extension (OnClosed). Here the contents are destroyed and the view taken out of the
     window, which left Acira's card as an empty column and the panel "open" for good: the same close as the Close button, so the column goes, the state clears and the button opens it again. */
  view.webContents.on('destroyed',()=>{if(entries.get(panel.key)===panel)void closePanel(panel);});
  frame.webContents.once('did-finish-load',()=>{sendState(panel,'in');});
  panel.cap=setTimeout(()=>{if(entries.get(panel.key)===panel&&panel===shown)reveal(panel);},REVEAL_CAP_MS);
  /* Whatever goes wrong while the panel is being brought up, the host must not keep a half-made panel: every later press would be "already open" for it (the stuck state of the laptop's second run). */
  try{
   reconcile();
   relayout();
   await frame.webContents.loadFile(FRAME).catch(()=>{});
   view.webContents.loadURL(url).catch(()=>{});
  }catch(error){
   if(entries.get(panel.key)===panel)await closePanel(panel,{silent:true});
   throw error;
  }
  return {opened:true};
 }
 function navigate({extensionId,url,tabKey}){const panel=pick({tabKey,extensionId});if(!panel||panel.extensionId!==extensionId)return;panel.url=url;panel.view.webContents.loadURL(url).catch(()=>{});}
 /** The window's tabs, as main knows them: which one is in front (a panel of its own, or the window's, comes with it) and which still exist (a closed tab's panel goes with it, as Chromium destroys the tab's registry). */
 function sync({activeKey:active=null,keys=null}={}){
  activeKey=active;
  if(keys){for(const panel of [...entries.values()])if(panel.key!==WINDOW_KEY&&!keys.has(panel.key))void closePanel(panel);}
  reconcile();
 }
 return {
  open,close,navigate,place,raise,sync,
  /** The panel in front, or null. */
  current:()=>shown?infoOf(shown):null,
  /** Every panel this window keeps for an extension (the one in front and the tabs' kept ones). */
  list:extensionId=>[...entries.values()].filter(panel=>!gone(panel)&&(extensionId===undefined||panel.extensionId===extensionId)).map(infoOf),
  find:({extensionId,tabKey}={})=>{const panel=pick({tabKey,extensionId});return panel&&!gone(panel)?infoOf(panel):null;},
  reallyShown:({extensionId,tabKey}={})=>{const panel=pick({tabKey,extensionId});return !!panel&&reallyShown(panel);},
  /** Called once per layout pass before the page views are placed; trim then remembers the card the panel sits beside. */
  begin(){anchor=null;},
  trim:(bounds,page)=>{const out=trimBounds(bounds,page,shown?panelGeometry(page):null);if(out!==bounds)anchor={...bounds};return out;},
  restyle(){if(shown)sendState(shown,'in');},
  destroy(){const all=[...entries.values()];entries.clear();shown=null;for(const panel of all)teardown(panel);}
 };
}

module.exports={createSidePanelHost,panelGeometry,trimBounds,GAP,HEADER,WINDOW_KEY};
