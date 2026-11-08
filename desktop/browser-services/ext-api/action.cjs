'use strict';
// chrome.action (work package P8). Main side: the toolbar button's state (the engine's action map, so <browser-action-list>, the icon route
// and the popup keep working), imageData icons, enable/disable, per-tab values that reset when the tab navigates, the pin state, openPopup, and
// the button's right-click menu in Acira's design (the extension's own "action" menu items first). Renderer side: action-renderer.cjs.
const {parseColor,toCss}=require('./action/color.cjs');
const {normalizeIcon}=require('./action/icon.cjs');
const bridge=require('./surfaces/bridge.cjs');
const activeTab=require('./surfaces/active-tab.cjs');

const DEFAULT_BACKGROUND=[0,0,0,0],DEFAULT_TEXT=[255,255,255,255];
const FIELDS=['title','text','color','colorValue','textColor','textColorValue','enabled'];   // what a tab's own entry may hold on top of the global value
const MAX_TAB_ENTRIES=5000;
const NO_POPUP='Failed to show popup either because there is an existing popup or another error occurred.';

const tabIdOf=value=>(Number.isInteger(value)&&value>=0?value:undefined);
const manifestAction=extension=>extension?.manifest?.action||extension?.manifest?.browser_action||{};

/** The state the toolbar needs, with a tab's own values laid over the global ones (the engine's component lets global values win). */
function reshapeState(state,tabIds=[]){
 if(!state||!Array.isArray(state.actions))return state;
 return {...state,actions:state.actions.map(action=>{
  const own=action.tabs||{},global={};
  for(const name of FIELDS)if(action[name]!==undefined)global[name]=action[name];
  let stamp=action.iconModified||0;
  for(const entry of Object.values(own))if(entry&&entry.iconModified>stamp)stamp=entry.iconModified;
  const tabs={};
  for(const id of new Set([...tabIds.map(String),...Object.keys(own)])){
   const entry={...global};
   for(const [name,value] of Object.entries(own[id]||{}))if(value!==undefined)entry[name]=value;
   tabs[id]=entry;
  }
  const rest={...action};
  for(const name of FIELDS)delete rest[name];
  return {...rest,...(stamp?{iconModified:stamp}:{}),tabs};
 })};
}

module.exports={
 namespaces:['action'],
 reshapeState,
 install(api){
  const engine=()=>api.runtime?.api?.browserAction||null;
  const actionOf=id=>{const e=engine();if(!e)throw new Error('The extension toolbar is not available.');return e.getAction(id);};
  let stamp=0;
  const refresh=()=>engine()?.onUpdate?.();
  /** Writes values for one tab (tabId) or for the extension (no tabId). */
  function put(id,tabId,patch){
   const action=actionOf(id);
   if(tabId===undefined)Object.assign(action,patch);
   else{
    if(!action.tabs[tabId]&&Object.keys(action.tabs).length>=MAX_TAB_ENTRIES)delete action.tabs[Object.keys(action.tabs)[0]];
    action.tabs[tabId]=Object.assign(action.tabs[tabId]||{},patch);
   }
   refresh();
  }
  /** A value as the tab sees it: its own, else the global one. */
  const read=(id,tabId,name)=>{const action=actionOf(id),own=tabId===undefined?undefined:action.tabs[tabId]?.[name];return own!==undefined?own:action[name];};
  const detailsOf=value=>(value&&typeof value==='object'?value:{});
  /** The tab an extension names is the id chrome.tabs gave it, which stays the same for the tab's life; the toolbar and the engine know the tab by its page's id, and
   *  that is another number once the tab was asleep (it has a number of its own, 2000000002) or has moved to a new page. A badge set for the extension's id never
   *  showed (Bitwarden's per-tab count and unlocked icon fell back to the lock). The tab's values are kept under its page's id; ids the tabs package does not know stay as given. */
  const tabKey=(event,value)=>{
   const id=tabIdOf(value);
   if(id===undefined)return undefined;
   try{
    const ask=api.handler('acira.tabs.pageId'),page=ask?ask({type:'service-worker',sender:null,extension:event.extension},id):null;
    if(Number.isInteger(page)&&page>=0)return page;
   }catch{/* the tabs package is not there: the id as given */}
   return id;
  };
  const colorOf=value=>{const color=parseColor(value);if(!color)throw new Error('The color specification could not be parsed.');return color;};

  const members={
   setTitle:(event,details)=>{put(event.extension.id,tabKey(event,detailsOf(details).tabId),{title:String(detailsOf(details).title??'')});},
   getTitle:(event,details)=>{const id=event.extension.id;return String(read(id,tabKey(event,detailsOf(details).tabId),'title')??manifestAction(event.extension).default_title??'');},
   setPopup:(event,details)=>{put(event.extension.id,tabKey(event,detailsOf(details).tabId),{popup:String(detailsOf(details).popup??'')});},
   getPopup:(event,details)=>{const url=engine()?.getPopupUrl?.(event.extension.id,tabKey(event,detailsOf(details).tabId));return url||'';},
   setBadgeText:(event,details)=>{put(event.extension.id,tabKey(event,detailsOf(details).tabId),{text:String(detailsOf(details).text??'')});},
   getBadgeText:(event,details)=>String(read(event.extension.id,tabKey(event,detailsOf(details).tabId),'text')??''),
   setBadgeBackgroundColor:(event,details)=>{const color=colorOf(detailsOf(details).color);put(event.extension.id,tabKey(event,detailsOf(details).tabId),{color:toCss(color),colorValue:color});},
   getBadgeBackgroundColor:(event,details)=>[...(read(event.extension.id,tabKey(event,detailsOf(details).tabId),'colorValue')||DEFAULT_BACKGROUND)],
   setBadgeTextColor:(event,details)=>{const color=colorOf(detailsOf(details).color);put(event.extension.id,tabKey(event,detailsOf(details).tabId),{textColor:toCss(color),textColorValue:color});},
   getBadgeTextColor:(event,details)=>[...(read(event.extension.id,tabKey(event,detailsOf(details).tabId),'textColorValue')||DEFAULT_TEXT)],
   setIcon:(event,details)=>{
    const icon=normalizeIcon(detailsOf(details),{extension:event.extension});
    put(event.extension.id,tabKey(event,detailsOf(details).tabId),{icon,iconModified:++stamp+Date.now()*1000});
   },
   enable:(event,tabId)=>{put(event.extension.id,tabKey(event,tabId),{enabled:true});},
   disable:(event,tabId)=>{put(event.extension.id,tabKey(event,tabId),{enabled:false});},
   isEnabled:(event,tabId)=>read(event.extension.id,tabKey(event,tabId),'enabled')!==false,
   getUserSettings:event=>({isOnToolbar:bridge.pinned(api.storeKey,event.extension.id)??true}),
   openPopup:(event,options)=>openPopup(event.extension,options)
  };
  for(const [name,impl] of Object.entries(members)){
   api.handle(`action.${name}`,impl);
   // Manifest V2 extensions (chrome.browserAction) share the same state; their calls reach the same code.
   if(name!=='isEnabled'&&name!=='setBadgeTextColor'&&name!=='getBadgeTextColor')api.wrap(`browserAction.${name}`,()=>impl);
  }

  /** The tabs the engine tracks (Acira's web pages), for per-tab entries in the toolbar's state. */
  const knownTabIds=()=>{try{return [...(api.store()?.tabs||[])].filter(wc=>!wc.isDestroyed?.()).map(wc=>wc.id);}catch{return [];}};
  api.wrap('browserAction.getState',original=>(event,...args)=>reshapeState(original?original(event,...args):{actions:[]},knownTabIds()));

  const enabledFor=(id,tabId)=>{try{return read(id,tabIdOf(tabId),'enabled')!==false;}catch{return true;}};

  // The toolbar button was clicked or right-clicked.
  api.wrap('browserAction.activate',original=>(event,details)=>{
   if(details&&typeof details==='object'&&typeof details.extensionId==='string'){
    if(details.eventType==='click'&&!enabledFor(details.extensionId,details.tabId))return undefined;
    // The click is the person using the extension on this tab: activeTab (Chrome grants it the same way).
    if(details.eventType==='click'){try{const wc=api.store()?.getTabById?.(details.tabId);if(wc&&!wc.isDestroyed?.())activeTab.grant(api.session,details.extensionId,wc.id,wc.getURL());}catch{/* no tab */}}
    if(details.eventType==='contextmenu'&&showMenu(event,details))return undefined;
   }
   return original?original(event,details):undefined;
  });

  /** The right-click menu: the extension's own "action" items, then Options and Unpin, in Acira's menu (the browser UI shows it). */
  function showMenu(event,details){
   const extension=api.getExtension(details.extensionId);
   if(!extension||!details.anchorRect||typeof details.anchorRect!=='object')return false;
   const wc=(()=>{try{return api.store()?.getTabById?.(details.tabId)||null;}catch{return null;}})();
   const contextMenus=bridge.controller(api.session,'context-menus');
   const templates=contextMenus?.actionTemplates?.(extension.id,wc)||[];
   const manifest=extension.manifest||{},options=manifest.options_page||manifest.options_ui?.page;
   const rows=[...templates];
   if(rows.length)rows.push({type:'separator'});
   const profile=api.storeKey;
   rows.push({id:'ext-action:options',label:api.t('ext.menu.options'),enabled:typeof options==='string'&&options!=='',click:()=>{
    try{void Promise.resolve(api.store().createTab({url:new URL(String(options).replace(/^\/+/,''),`chrome-extension://${extension.id}/`).href})).catch(()=>{});}catch{/* no window */}
   }});
   rows.push({id:'ext-action:unpin',label:api.t('ext.menu.unpin'),enabled:true,click:()=>{bridge.hub.emit('unpin',{session:api.session,profileId:profile,extensionId:extension.id,handled:false});}});
   const request={session:api.session,sender:event?.sender||null,anchor:details.anchorRect,extension:{id:extension.id,name:extension.name},templates:rows,handled:false};
   bridge.hub.emit('menu',request);
   return request.handled;
  }

  /** action.openPopup: the browser UI opens the popup at the extension's own button; the engine's popup is the fallback. */
  function openPopup(extension,options){
   const store=api.store();
   if(!store)return Promise.reject(new Error(NO_POPUP));
   const popup=engine()?.getPopupUrl?.(extension.id,tabIdOf(store.getActiveTabOfCurrentWindow?.()?.id));
   if(!popup)return Promise.reject(new Error(NO_POPUP));
   return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{api.runtime.removeListener?.('browser-action-popup-created',created);reject(new Error(NO_POPUP));},2500);
    timer.unref?.();
    const created=popup=>{if(popup?.extensionId&&popup.extensionId!==extension.id)return;clearTimeout(timer);api.runtime.removeListener?.('browser-action-popup-created',created);resolve(undefined);};
    api.runtime.on?.('browser-action-popup-created',created);
    const request={session:api.session,extensionId:extension.id,windowId:options&&Number.isInteger(options.windowId)?options.windowId:undefined,handled:false};
    bridge.hub.emit('open-popup',request);
    if(!request.handled){
     try{engine().openPopup({extension},options||{});}catch(error){clearTimeout(timer);api.runtime.removeListener?.('browser-action-popup-created',created);reject(error);}
    }
   });
  }

  /** The shortcut of a command named _execute_action: the same as a click on the button (popup, or onClicked with the tab). */
  function invoke(extensionId,webContents){
   const tabId=webContents&&!webContents.isDestroyed?.()?webContents.id:tabIdOf(api.store()?.getActiveTabOfCurrentWindow?.()?.id);
   if(tabId===undefined||!api.getExtension(extensionId)||!enabledFor(extensionId,tabId))return false;
   const request={session:api.session,extensionId,tabId,handled:false};
   if(engine()?.getPopupUrl?.(extensionId,tabId))bridge.hub.emit('open-popup',request);
   if(request.handled)return true;
   const activate=api.handler('browserAction.activate');
   if(!activate)return false;
   try{activate({type:'frame',sender:null,extension:api.getExtension(extensionId)},{eventType:'click',extensionId,tabId,anchorRect:{x:900,y:0,width:64,height:64}});}catch{return false;}
   return true;
  }

  // A tab's own values end when it navigates to another page (Chromium: ExtensionActionAPI::ClearAllValuesForTab).
  const watched=new WeakSet();
  const watch=wc=>{
   if(!wc||watched.has(wc)||typeof wc.on!=='function')return;
   watched.add(wc);
   wc.on('did-navigate',()=>{
    const e=engine();if(!e)return;
    let changed=false;
    for(const action of e.actionMap?.values?.()||[])if(action.tabs&&action.tabs[wc.id]){delete action.tabs[wc.id];changed=true;}
    if(changed)refresh();
   });
  };
  const store=api.store();
  store?.on?.('tab-added',watch);
  for(const wc of store?.tabs||[])watch(wc);

  // The pin state changed in Acira (Settings, the extensions panel, the button's menu): action.onUserSettingsChanged.
  const onPinned=({profileId,extensionId,isOnToolbar})=>{if(profileId===api.storeKey)api.emit(extensionId,'action.onUserSettingsChanged',{isOnToolbar});};
  bridge.hub.on('pinned',onPinned);
  const release=bridge.register(api.session,'action',{reshapeState:state=>reshapeState(state,knownTabIds()),enabledFor,invoke});

  return {
   forget(id){try{engine()?.removeActions?.(id);}catch{/* gone already */}},
   dispose(){bridge.hub.off('pinned',onPinned);release();}
  };
 }
};
