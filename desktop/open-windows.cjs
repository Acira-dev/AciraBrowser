'use strict';
// Which windows come back at the next start: the ones open when the app was quit or crashed; a window the person closed on
// purpose does not. The list is kept up to date as windows open and close. When the app itself quits (Ctrl+Q on a Mac, a
// restart for an update, a system shutdown) Electron closes every window one after the other, and each close used to shrink
// the list, so only the last window came back. `begin()` is called when the quit starts: from then on the list stays as it was.
// If that quit is called off (a page asked "Leave this site?"), the list follows the windows again after a few seconds.
const GRACE_MS=5000;
const VALID_ID=/^[\w-]{1,80}$/;

function createOpenWindows({getDatabase,getControllers,isQuitting=()=>false,now=Date.now,warn=message=>console.warn(message)}){
  let beganAt=0;
  const frozen=()=>beganAt>0&&now()-beganAt<GRACE_MS;
  /** Records the ordinary windows that are open now. Private windows, web apps, windows that are closing and windows that stepped aside for another profile (main's switchProfileHere; it brings them back itself) are not part of the list; an empty list never replaces it (closing the last window keeps it as the last one). */
  function persist(){
    const database=getDatabase();
    if(isQuitting()||frozen()||!database)return false;
    try{
      const ids=[...getControllers()].filter(controller=>!controller.privateMode&&!controller.webApp&&!controller.closing&&!controller.switchedAway).map(controller=>controller.windowId);
      if(!ids.length)return false;
      database.setMetadata('open-windows',JSON.stringify(ids));return true;
    }catch(error){warn('Open windows not recorded: '+error.message);return false;}
  }
  /** The windows to open at start (at most twelve); the first window alone when nothing was recorded or nothing recorded can be read back. */
  function restorable(){
    const database=getDatabase();
    try{
      // a record that is there but cannot be read still counts: its window asks what to do (saved-window.cjs) instead of being left out without a word
      const present=id=>{try{return Boolean(database.readWindow(id));}catch{return true;}};
      const ids=JSON.parse(database.getMetadata('open-windows')||'[]').filter(id=>typeof id==='string'&&VALID_ID.test(id)&&present(id));
      return ids.length?ids.slice(0,12):['main'];
    }catch{return ['main'];}
  }
  /** The app has started to quit. */
  const begin=()=>{beganAt=now()||1;};
  /** True while a quit is closing the windows (a window closed then was not closed on purpose). */
  const quitting=()=>isQuitting()||frozen();
  return {persist,restorable,begin,quitting};
}
module.exports={createOpenWindows,GRACE_MS};
