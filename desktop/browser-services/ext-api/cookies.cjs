'use strict';
// chrome.cookies for extensions (docs/launch/EXTENSION_WORK_PACKAGES.md, package P6). Replaces the engine's handlers, which ignored the
// store, answered without a host-permission check and returned the input from remove().
//   get / getAll / set / remove / getAllCookieStores / onChanged
// Which cookies an extension can reach: the profile's one ordinary store, "0" (`api.session`), and only on hosts its manifest has
// permission for. Private windows, Tor windows and secured workspaces use other sessions and run no extension: their cookies are not
// reachable by any store id, and a Tor session answers nothing at all.
// Not supported: partitioned (CHIPS) cookies. A call that names a partitionKey finds nothing (get / getAll), cannot be set, and removes
// nothing; Electron's cookie API has no partition key to read or write.
const model=require('./cookies/model.cjs');
const tabIdBridge=require('./surfaces/tab-ids.cjs');

module.exports={
 namespaces:['cookies'],
 install(api){
  const session=api.session,table=api.permissions;
  const allowed=(extension,url)=>{
   if(!extension)return false;
   try{return table?!!table.hasOrigin(extension,url):(extension.manifest?.host_permissions||extension.manifest?.permissions||[]).some(pattern=>pattern==='<all_urls>');}catch{return false;}
  };
  const store=()=>{
   if(session.__aciraTor)throw new Error('Access to extension API denied.');
   return session.cookies;
  };
  const request=(event,details)=>{
   if(!details||typeof details!=='object')throw new Error('Invalid arguments.');
   model.checkStore(details.storeId);
   return details.partitionKey!==undefined;
  };
  const needHost=(event,url)=>{if(!allowed(event.extension,url.href))throw new Error(model.errors.noHost(url.href));};

  async function getAll(event,details){
   const partitioned=request(event,details);
   let list,url=null;
   if(details.url!==undefined){url=model.parseUrl(details.url);needHost(event,url);}
   if(partitioned)return [];
   list=await store().get(url?{url:url.href}:{});
   list=list.filter(cookie=>model.matches(cookie,details));
   if(!url)list=list.filter(cookie=>allowed(event.extension,model.cookieUrl(cookie)));
   return model.order(list).map(model.toChrome);
  }

  api.handle('cookies.getAll',getAll);
  api.handle('cookies.get',async(event,details)=>{
   const partitioned=request(event,details),url=model.parseUrl(details.url);
   needHost(event,url);
   if(partitioned)return null;
   const list=model.order((await store().get({url:url.href,name:details.name})).filter(cookie=>cookie.name===details.name));
   return list.length?model.toChrome(list[0]):null;
  });
  api.handle('cookies.set',async(event,details)=>{
   const partitioned=request(event,details),url=model.parseUrl(details.url);
   needHost(event,url);
   const name=details.name===undefined?'':details.name;
   if(partitioned)throw new Error(model.errors.setFailed(name));
   const jar=store();
   try{await jar.set(model.toElectron(details,url));}catch{throw new Error(model.errors.setFailed(name));}
   const found=(await jar.get({url:url.href,name})).filter(cookie=>cookie.name===name&&(details.path===undefined||cookie.path===details.path)&&(details.domain===undefined||model.hostOf(cookie)===String(details.domain).replace(/^\./,'')));
   return found.length?model.toChrome(model.order(found)[0]):null;
  });
  api.handle('cookies.remove',async(event,details)=>{
   const partitioned=request(event,details),url=model.parseUrl(details.url);
   needHost(event,url);
   if(!partitioned)await store().remove(url.href,details.name);
   return {url:details.url,name:details.name,storeId:model.STORE_ID};
  });
  api.handle('cookies.getAllCookieStores',async()=>{
   const tabs=api.store()?.tabs;
   const tabIds=[];
   if(tabs)for(const tab of tabs){try{if(tab&&!tab.isDestroyed()&&tab.session===session&&!tab.__aciraTorLocked&&typeof tab.id==='number')tabIds.push(tabIdBridge.ofPage(session,tab)??tab.id);}catch{/* closing */}}
   return [{id:model.STORE_ID,tabIds}];
  });

  // onChanged: only extensions whose manifest has host permission for the cookie's address hear of it.
  const onChanged=(_event,cookie,cause,removed)=>{
   const listening=api.listening('acira.cookies.onChanged');
   if(!listening.length)return;
   const url=model.cookieUrl(cookie),info={removed:Boolean(removed),cookie:model.toChrome(cookie),cause:model.cause(cause)};
   for(const id of listening){
    const extension=api.getExtension(id);
    if(extension&&api.available(id,'cookies')&&allowed(extension,url))api.emit(id,'acira.cookies.onChanged',info);
   }
  };
  if(!session.__aciraTor&&session.cookies&&typeof session.cookies.on==='function')session.cookies.on('changed',onChanged);
  return {dispose(){try{session.cookies.removeListener('changed',onChanged);}catch{/* closing */}}};
 }
};
