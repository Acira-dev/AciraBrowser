'use strict';
// Which saved window each profile last left, so opening that profile again (the profile panel's switch, or its own window)
// brings its own tabs back. A window is remembered when it steps aside for another profile's window (main's switchProfileHere)
// and when the last window of its profile is closed on purpose. Every profile has its own windows, so with two profiles the
// browser is often closed one window at a time: the windows closed before the last one used to be forgotten, and that
// profile's tabs never came back, although they were saved. Its saved record now comes back when the profile is opened, as a
// window hidden at quit always did. A window of a profile that still has another window open is forgotten, as before.
const VALID_ID=/^[\w-]{1,80}$/;

function createProfileWindows({getDatabase,getControllers,warn=message=>console.warn(message)}){
  function read(){try{const map=JSON.parse(getDatabase()?.getMetadata('profile-windows')||'{}');return map&&typeof map==='object'&&!Array.isArray(map)?map:{};}catch{return {};}}
  function write(map){try{getDatabase()?.setMetadata('profile-windows',JSON.stringify(map));}catch(error){warn('Profile windows not recorded: '+error.message);}}
  function remember(profileId,windowId){const map=read();map[profileId]=windowId;write(map);}
  /** The saved window to bring back for this profile: one that is not open now and can still be read. */
  function find(profileId){const id=read()[profileId];return typeof id==='string'&&VALID_ID.test(id)&&![...getControllers()].some(c=>c.windowId===id)&&getDatabase()?.readWindow(id)?id:null;}
  function forget(windowId){const map=read(),kept=Object.fromEntries(Object.entries(map).filter(([,id])=>id!==windowId));if(Object.keys(kept).length!==Object.keys(map).length)write(kept);}
  /** A window was closed on purpose (not by a quit). True when it was its profile's last ordinary window and is now remembered for it. */
  function closed(controller){
    forget(controller.windowId);
    const profileId=controller.profileId;
    if(controller.privateMode||controller.webApp||typeof profileId!=='string'||!profileId)return false;
    if([...getControllers()].some(c=>c!==controller&&!c.privateMode&&!c.webApp&&!c.closing&&c.profileId===profileId))return false;
    remember(profileId,controller.windowId);return true;
  }
  return {read,write,remember,find,forget,closed};
}
module.exports={createProfileWindows};
