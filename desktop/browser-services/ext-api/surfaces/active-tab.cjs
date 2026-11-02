'use strict';
// activeTab, as Chrome grants it: a click on the extension's toolbar button, its keyboard command (also _execute_action) or one of its
// context-menu items lets it read and script the tab the person did that on, until the tab goes to another origin or closes.
// Electron has no UI of its own for this, so Acira keeps the grant here; the actions that grant call grant(), scripting calls has().
const bySession=new WeakMap();   // session -> Map("<extensionId>:<tabId>" -> origin)

const originOf=url=>{try{const parsed=new URL(String(url));return /^https?:$/.test(parsed.protocol)?parsed.origin:'';}catch{return '';}};
const mapOf=session=>{if(!session||typeof session!=='object')return null;if(!bySession.has(session))bySession.set(session,new Map());return bySession.get(session);};

/** The person acted on this tab through this extension: it may use the tab's current origin. */
function grant(session,extensionId,tabId,url){
 const map=mapOf(session),origin=originOf(url);
 if(!map||!origin||!Number.isInteger(tabId))return false;
 if(map.size>=500)map.delete(map.keys().next().value);
 map.set(`${extensionId}:${tabId}`,origin);
 return true;
}
/** Does the grant still hold: same tab, and the tab is still on the origin it was given for. */
function has(session,extensionId,tabId,currentUrl){
 const origin=mapOf(session)?.get(`${extensionId}:${tabId}`);
 return !!origin&&origin===originOf(currentUrl);
}
const revoke=(session,extensionId,tabId)=>mapOf(session)?.delete(`${extensionId}:${tabId}`);
const clear=(session,extensionId)=>{const map=mapOf(session);if(map)for(const key of [...map.keys()])if(key.startsWith(extensionId+':'))map.delete(key);};

module.exports={grant,has,revoke,clear,originOf};
