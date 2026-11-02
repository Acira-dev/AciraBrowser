'use strict';
const path=require('node:path');
// Protected video needs Widevine. Qualified Mac ECS builds install it automatically.
// Other runtimes, unsupported codecs, or component failures can still reject it. The page's own request for it is refused by the engine; a small preload (protected-media-preload.cjs) notices
// the refusal and tells us once per frame. We pass on only the tab and the site, never anything the page said.
const attached=new WeakSet(),lastTold=new Map(),held=new Map();
const COOLDOWN=5000,MAX_HELD=50;

/** Every page in this profile session gets the preload; a session is set up once. */
function attach(session){
 if(!session||attached.has(session))return;
 attached.add(session);
 try{session.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'protected-media-preload.cjs')});}
 catch(error){console.warn('Protected video notice unavailable:',error.message);}
}

/** The site the user sees (the top page, not the frame that asked). Null for anything that is not a website. */
function siteOf(url){
 try{
  const parsed=new URL(url);
  if(!/^https?:$/.test(parsed.protocol)||!parsed.hostname)return null;
  return parsed.hostname.replace(/^www\./,'').toLowerCase();
 }catch{return null;}
}

/** A frame of `contents` (the page of `tabId`) was refused Widevine. `emit` sends the browser event to the interface. */
function noticed(contents,tabId,emit,now=Date.now()){
 if(!contents||contents.isDestroyed?.()||typeof tabId!=='string'||!tabId)return false;
 const host=siteOf(contents.getURL());
 if(!host)return false;
 const key=tabId+'|'+host;
 if(now-(lastTold.get(key)||0)<COOLDOWN)return false;
 lastTold.set(key,now);
 if(lastTold.size>200)for(const [item,at] of lastTold)if(now-at>COOLDOWN)lastTold.delete(item);
 emit({type:'protected-media',tabId,host});
 return true;
}

/** A refusal, with the CDM's state (widevine.cjs widevineState). While a first run or a missing CDM is still installing the refusal is held quietly: the tab is
 *  reloaded once the CDM is ready, which takes a few seconds. A CDM that is not there (failed, or still missing after the wait) gets the usual notice, and the
 *  tab is still reloaded if it arrives later. A ready CDM refused for another reason, or a runtime with none, gets the notice only. */
function refused(contents,tabId,emit,cdm={},now=Date.now()){
 if(!contents||contents.isDestroyed?.()||typeof tabId!=='string'||!tabId)return false;
 if(cdm.expected&&cdm.status!=='ready'){
  const host=siteOf(contents.getURL());if(!host)return false;
  if(!held.has(contents)){if(held.size>=MAX_HELD)return noticed(contents,tabId,emit,now);contents.once?.('destroyed',()=>held.delete(contents));}
  const told=cdm.status!=='installing';held.set(contents,{tabId,host,emit,told});
  return told?noticed(contents,tabId,emit,now):false;
 }
 return noticed(contents,tabId,emit,now);
}
/** The CDM's state changed: ready reloads each held tab still showing the site it was refused on; not there tells the held tabs that were not told yet. */
function cdmChanged(cdm={},now=Date.now()){
 for(const [contents,entry] of held){
  if(contents.isDestroyed?.()){held.delete(contents);continue;}
  if(cdm.status==='ready'){held.delete(contents);if(siteOf(contents.getURL())===entry.host)try{contents.reload();}catch{/* a closing tab */}}
  else if(cdm.status!=='installing'&&!entry.told){entry.told=true;noticed(contents,entry.tabId,entry.emit,now);}
 }
}

module.exports={attach,noticed,refused,cdmChanged,siteOf};
