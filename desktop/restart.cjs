'use strict';
// "Restart Acira" (main.cjs interfaceStopped): an ordinary quit, so every window saves and every question about unsaved work is asked, and a relaunch only
// once that quit is really happening (will-quit: every window has closed). Relaunching first, as app.relaunch() before app.quit() did, restarted Acira
// later by itself when a page had asked "Leave this site?" and the person chose Stay. A quit called off and an ordinary quit long after restart nothing.
// "Called off" is told by main.cjs (calledOff): Cancel on the close card, a page that asked to stay, a window that could not close. Clearing the request
// at the next before-quit would not do: every window holds its first close back while it asks, so the quit that ends a restart comes from the last
// window closing (main.cjs calls app.quit() there), never from request() itself.
// The relaunch replays no link, file or web-app launch argument: only the app folder (when run from source) and command-line switches, never Acira's own.
const WINDOW_MS=2*60*1000;

/** The arguments a restart starts with: the switches of this launch (--use-mock-keychain, --inspect…), not its links, files or --acira-… actions. Run from
 *  source, the app folder is kept too: Electron takes the first argument that is not a switch as the app, after any switches. */
function restartArgs(argv,{defaultApp=false}={}){
 const rest=argv.slice(1),appAt=defaultApp?rest.findIndex(arg=>!String(arg).startsWith('-')):-1;
 return rest.filter((arg,index)=>index===appAt||(String(arg).startsWith('--')&&!String(arg).startsWith('--acira-')));
}

function createRestart({app,now=Date.now,argv=process.argv,defaultApp=Boolean(process.defaultApp),execPath=process.execPath,windowMs=WINDOW_MS}){
 let requestedAt=0;
 app.on('will-quit',()=>{
  if(!requestedAt)return;
  const due=now()-requestedAt<=windowMs;requestedAt=0;
  if(due)try{app.relaunch({execPath,args:restartArgs(argv,{defaultApp})});}catch{}
 });
 return {request(){requestedAt=now()||1;app.quit();},calledOff(){requestedAt=0;}};
}

module.exports={createRestart,restartArgs,WINDOW_MS};
