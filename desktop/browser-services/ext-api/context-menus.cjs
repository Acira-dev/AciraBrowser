'use strict';
// chrome.contextMenus (work package P8). Main side: the item store of the profile, Chromium's errors, persistence for event-page and
// service-worker extensions, and the items for Acira's page context menu (the engine's runtime.getContextMenuItems is replaced) and for the
// toolbar button's menu (bridge controller 'context-menus', used by the action package). Renderer side: context-menus-renderer.cjs.
const fs=require('node:fs'),path=require('node:path');
const {createStore}=require('./context-menus/store.cjs');
const {matchesPage,matchesAction,buildTemplates,ACTION_MENU_TOP_LEVEL_LIMIT}=require('./context-menus/build.cjs');
const bridge=require('./surfaces/bridge.cjs');
const activeTab=require('./surfaces/active-tab.cjs');

/** Event pages and service workers lose their JavaScript state, so Chromium keeps their menu items on disk; a persistent background page recreates them. */
function keepsItems(extension){
 const manifest=extension?.manifest||{},background=manifest.background||{};
 if(manifest.manifest_version===3)return true;
 if(background.persistent===false)return true;
 return !(background.scripts||background.page);
}

module.exports={
 namespaces:['contextMenus'],
 install(api){
  const store=createStore(),loadedOnce=new Set(),unloaded=new Set(),icons=new Map();
  const file=api.userData?path.join(api.userData,'extension-context-menus',`${String(api.storeKey||'default').replace(/[^\w.-]+/g,'_')}.json`):null;
  let saved={},timer=null;
  if(file)try{const parsed=JSON.parse(fs.readFileSync(file,'utf8'));if(parsed&&typeof parsed==='object'&&parsed.extensions&&typeof parsed.extensions==='object')saved=parsed.extensions;}catch{saved={};}

  const write=()=>{
   timer=null;
   if(!file)return;
   try{
    const out={};
    for(const id of new Set([...Object.keys(saved),...store.extensions()])){
     const extension=unloaded.has(id)?null:api.getExtension(id);
     // A loaded extension's memory is the truth (an emptied menu is saved empty); one that is not loaded (disabled, or not yet started) keeps what is on disk.
     if(extension){if(store.has(id)&&keepsItems(extension))out[id]=store.snapshot(id).map(({stale,...item})=>item);}
     else if(saved[id])out[id]=saved[id];
    }
    saved=out;
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file+'.tmp',JSON.stringify({version:1,extensions:out}));
    fs.renameSync(file+'.tmp',file);
   }catch(error){api.log('could not save menu items:',error?.message||error);}
  };
  const changed=()=>{if(file&&!timer){timer=setTimeout(write,300);timer.unref?.();}};

  const sessionExtensions=api.session?.extensions||api.session;
  const onLoaded=extension=>{
   if(!extension)return;
   // A browser restart (or enabling) brings the items back; an update or reload runs the extension's install code again, whose create()
   // calls replace them (restored items are "stale": a duplicate id from the extension is not an error then).
   if(saved[extension.id]&&keepsItems(extension)&&!store.has(extension.id))store.restore(extension.id,saved[extension.id]);
   loadedOnce.add(extension.id);unloaded.delete(extension.id);
  };
  const onUnloaded=extension=>{
   if(!extension)return;
   // Disabled or reloading: what it had is kept on disk for the next load.
   if(store.has(extension.id)&&keepsItems(extension))saved[extension.id]=store.snapshot(extension.id).map(({stale,...item})=>item);
   store.removeAll(extension.id);unloaded.add(extension.id);icons.delete(extension.id);changed();
  };
  try{
   sessionExtensions?.on?.('extension-loaded',(_event,extension)=>onLoaded(extension));
   sessionExtensions?.on?.('extension-unloaded',(_event,extension)=>onUnloaded(extension));
   for(const extension of sessionExtensions?.getAllExtensions?.()||[])onLoaded(extension);
  }catch{/* tests without a session */}

  api.handle('contextMenus.create',(event,props)=>{
   if(!props||typeof props!=='object')throw new Error('Invalid arguments.');
   store.create(event.extension.id,props);
   changed();
   return undefined;
  });
  api.handle('contextMenus.update',(event,id,props)=>{store.update(event.extension.id,id,props||{});changed();return undefined;});
  api.handle('contextMenus.remove',(event,id)=>{store.remove(event.extension.id,id);changed();return undefined;});
  api.handle('contextMenus.removeAll',event=>{store.removeAll(event.extension.id);changed();return undefined;});

  // ------------------------------------------------------------------------------------------ what the browser UI shows
  /** The extension's 16 px icon (Electron NativeImage) and a data URL of it for Acira's own menu. Null outside Electron. */
  function iconOf(extension){
   if(icons.has(extension.id))return icons.get(extension.id);
   let value={};
   try{
    const {nativeImage}=require('electron'),manifest=extension.manifest||{},sizes=manifest.icons&&typeof manifest.icons==='object'?manifest.icons:{};
    const pick=Object.keys(sizes).map(Number).filter(Number.isFinite).sort((a,b)=>a-b),best=pick.find(size=>size>=32)||pick.at(-1);
    const relative=best===undefined?null:sizes[best];
    if(typeof relative==='string'&&extension.path){
     const root=path.resolve(extension.path),full=path.resolve(root,relative.replace(/^[\\/]+/,''));
     if(full.startsWith(root+path.sep)){
      const image=nativeImage.createFromPath(full);
      if(image&&!image.isEmpty()){const small=image.resize({width:16,height:16});value={image:small,url:small.toDataURL()};}
     }
    }
   }catch{value={};}
   icons.set(extension.id,value);
   return value;
  }
  function tabFor(webContents){
   try{
    // The tab as chrome.tabs says it (the id the extension knows the tab by); the engine's cached details carry the page's own id.
    const get=api.handler('tabs.get');
    const asked=get?get({type:'frame',sender:webContents,extension:null},webContents.id):undefined;
    if(asked&&!asked.__acira_error)return asked;
    const cached=api.store()?.tabDetailsCache?.get?.(webContents.id);
    if(cached)return cached;
   }catch{/* no tab */}
   return undefined;
  }
  const frameIdOf=(webContents,frame)=>{try{return !frame||frame===webContents.mainFrame?0:frame.frameTreeNodeId;}catch{return 0;}};

  /** The page's right-click: every extension's items as menu templates (context-commands.cjs turns them into rows). */
  function pageTemplates(webContents,params){
   if(!webContents||webContents.isDestroyed?.()||webContents.session!==api.session)return [];
   const out=[];
   for(const id of store.extensions()){
    const extension=api.getExtension(id);
    if(!extension)continue;
    out.push(...buildTemplates({store,extension:{id,name:extension.name},params,icon:iconOf(extension),show:item=>matchesPage(item,params),
     click:item=>()=>{
      if(webContents.isDestroyed())return;
      activeTab.grant(api.session,id,webContents.id,webContents.getURL());
      const state=store.toggle(id,item.id);
      const info={menuItemId:item.id};
      if(item.parentId!==undefined)info.parentMenuItemId=item.parentId;
      if(['image','video','audio'].includes(params.mediaType))info.mediaType=params.mediaType;
      if(params.linkURL)info.linkUrl=params.linkURL;
      if(params.srcURL&&['image','video','audio'].includes(params.mediaType))info.srcUrl=params.srcURL;
      info.pageUrl=params.pageURL||webContents.getURL();
      if(params.frameURL)info.frameUrl=params.frameURL;
      info.frameId=frameIdOf(webContents,params.frame);
      if(params.selectionText)info.selectionText=params.selectionText;
      info.editable=!!params.isEditable;
      if(item.type==='checkbox'||item.type==='radio'){info.wasChecked=state?state.wasChecked:false;info.checked=state?state.checked:false;changed();}
      api.emit(id,'contextMenus.onClicked',info,tabFor(webContents));
     }}));
   }
   return out;
  }
  /** The toolbar button's own items (contexts "action" / "browser_action"), at most ACTION_MENU_TOP_LEVEL_LIMIT of them. */
  function actionTemplates(extensionId,webContents){
   const extension=api.getExtension(extensionId);
   if(!extension||!store.has(extensionId))return [];
   return buildTemplates({store,extension:{id:extensionId,name:extension.name},params:{},group:false,limit:ACTION_MENU_TOP_LEVEL_LIMIT,show:matchesAction,
    click:item=>()=>{
     if(webContents&&!webContents.isDestroyed?.())activeTab.grant(api.session,extensionId,webContents.id,webContents.getURL());
     const state=store.toggle(extensionId,item.id);
     const info={menuItemId:item.id,editable:false};
     if(item.parentId!==undefined)info.parentMenuItemId=item.parentId;
     if(item.type==='checkbox'||item.type==='radio'){info.wasChecked=state?state.wasChecked:false;info.checked=state?state.checked:false;changed();}
     api.emit(extensionId,'contextMenus.onClicked',info,webContents&&!webContents.isDestroyed?.()?tabFor(webContents):undefined);
    }});
  }

  // The engine's own menu builder is replaced: Acira's page menu (main.cjs extensionItems) reads runtime.getContextMenuItems.
  if(api.runtime&&typeof api.runtime==='object')try{api.runtime.getContextMenuItems=(webContents,params)=>pageTemplates(webContents,params||{});}catch{/* frozen runtime */}
  const release=bridge.register(api.session,'context-menus',{pageTemplates,actionTemplates,store});

  return {
   forget(id){store.removeAll(id);delete saved[id];icons.delete(id);changed();},
   dispose(){release();if(timer){clearTimeout(timer);write();}}
  };
 },
 keepsItems
};
