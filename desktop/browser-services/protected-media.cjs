'use strict';
const path=require('node:path');
// Protected video needs Widevine. Qualified Mac ECS builds install it automatically.
// Other runtimes, unsupported codecs, or component failures can still reject it. The page's own request for it is refused by the engine; a small preload (protected-media-preload.cjs) notices
// the refusal and tells us once per frame. We pass on only the tab and the site, never anything the page said.
const attached=new WeakSet(),lastTold=new Map();
const COOLDOWN=5000;

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

module.exports={attach,noticed,siteOf};
