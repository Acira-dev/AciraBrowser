'use strict';
// Install now on a Mac (desktop/main.cjs). Electron's autoUpdater.quitAndInstall closes every window, then hands over to Squirrel.Mac, which rewrites the
// request ShipIt is waiting on to "open the new version when done" and then ends the app itself. ShipIt reads that request only after Acira has exited,
// so Acira must not quit first: when the last window closes during an update, Acira waits for Squirrel's ending. If Squirrel reports an error, or has not
// ended the app after FALLBACK_MS, Acira quits the ordinary way: the update is still installed when Acira exits, it just does not reopen by itself.
const FALLBACK_MS=10000;
function createUpdateQuit({quit,setTimer=setTimeout,clearTimer=clearTimeout,fallbackMs=FALLBACK_MS}){
 let timer=null,done=false,errored=false;
 const finish=()=>{if(done)return;done=true;if(timer)clearTimer(timer);timer=null;quit();};
 return {
  /** The last window closed while the update quit runs: Squirrel ends the app; this only arms the way out. */
  lastWindowClosed(){if(done||timer)return;if(errored)return finish();timer=setTimer(finish,fallbackMs);},
  /** Squirrel reported an error: nothing will end the app for it, so quit as soon as the windows are gone (now, if they already are). */
  failed(){errored=true;if(timer)finish();},
  get waiting(){return Boolean(timer)&&!done;},
 };
}
module.exports={createUpdateQuit,FALLBACK_MS};
