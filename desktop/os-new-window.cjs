'use strict';
// 13.6: "New window" and "New private window" from the operating system's own menu for Acira, as other browsers offer them:
//   Windows  the jump list of the taskbar button and the Start menu entry (app.setUserTasks): each task starts Acira's program with a flag.
//   macOS    the Dock icon's right-click menu (app.dock.setMenu).
//   Linux    launcher actions in the .desktop file (packaging/linux/install-acira-linux.py and packaging/electron-builder-linux.cjs): the same flags.
// A running Acira hears the flag in `second-instance` (main.cjs) and opens the window; a start with the flag is the ordinary start (the last
// session comes back as always) and, for a private window, one private window besides.
//
// The two flags are exact words, never prefixes, and every other launch argument keeps its own meaning: a web app's `--acira-app=<id>` and the installer's
// `--acira-installer-quit` win over them, and a restart (restart.cjs) never carries them on (it drops every `--acira-*` switch).
const path=require('node:path');
const {appIdFromArgv}=require('./web-apps.cjs');
const {parseExternalURLs}=require('./accounts/external-links.cjs');

const NEW_WINDOW_ARG='--acira-new-window',NEW_PRIVATE_WINDOW_ARG='--acira-new-private-window',INSTALLER_QUIT_ARG='--acira-installer-quit';
/** The two menu items, in menu order. `label` is a catalog id the main process already has in every language (desktop/i18n.cjs). */
const ITEMS=Object.freeze([
 Object.freeze({kind:'normal',arg:NEW_WINDOW_ARG,label:'browsermenu.newWindow'}),
 Object.freeze({kind:'private',arg:NEW_PRIVATE_WINDOW_ARG,label:'browsermenu.newPrivateWindow'})]);

/** The window a launch asks for: 'normal', 'private' or null. A web app's launch and the installer's quit are other launches (null); both flags at once is a private window. */
function windowRequestFromArgv(argv){
 if(!Array.isArray(argv)||argv.includes(INSTALLER_QUIT_ARG)||appIdFromArgv(argv))return null;
 if(argv.includes(NEW_PRIVATE_WINDOW_ARG))return 'private';
 if(argv.includes(NEW_WINDOW_ARG))return 'normal';
 return null;
}

/** A launch that only asks for a window (a flag and no web address): the link intake (accounts/external-links.cjs) has nothing to open and must not also bring some other window forward. */
const isWindowOnlyLaunch=argv=>Boolean(windowRequestFromArgv(argv))&&!parseExternalURLs(argv).length;

/** Windows: one jump-list task per item. Only for an installed (packaged) Acira: a development run would write its own program into the real Acira's jump list. */
function jumpListTasks({execPath,tm}){
 const home=path.win32.dirname(execPath);
 return ITEMS.map(item=>{const title=tm(item.label);return {program:execPath,arguments:item.arg,title,description:title,iconPath:execPath,iconIndex:0,workingDirectory:home};});
}

/** macOS: the Dock menu template; `open(kind)` is main's request for that window. */
function dockMenuTemplate({tm,open}){return ITEMS.map(item=>({label:tm(item.label),click:()=>{void Promise.resolve(open(item.kind)).catch(()=>{});}}));}

/** The menus the platform lets a program set while it runs (Windows tasks, the Dock menu); `refresh()` is idempotent and cheap, so main may call it whenever the language might have changed. */
function createOsWindowMenus({app,tm,open,Menu,platform=process.platform,execPath=process.execPath,packaged=Boolean(app&&app.isPackaged),testRun=Boolean(process.env.ACIRA_BROWSER_TEST_DATA),warn=message=>console.warn(message)}){
 let applied='';
 function refresh(){
  try{
   const signature=JSON.stringify(ITEMS.map(item=>tm(item.label)));
   if(signature===applied)return false;
   if(platform==='win32'){
    // A test profile or a development run never touches the person's real jump list (it is one list for the app, not for a profile).
    if(!packaged||testRun)return false;
    if(app.setUserTasks(jumpListTasks({execPath,tm}))===false){warn('The taskbar menu could not be set.');return false;}
   }else if(platform==='darwin'){
    if(!app.dock||typeof app.dock.setMenu!=='function')return false;
    app.dock.setMenu(Menu.buildFromTemplate(dockMenuTemplate({tm,open})));
   }else return false;
   applied=signature;return true;
  }catch(error){warn('The operating system menu for new windows could not be set: '+(error&&error.message));return false;}
 }
 return {refresh};
}

/** Opens the window an operating-system menu or a launch flag asked for.
 *  - normal, with ordinary windows open: like Ctrl/Cmd+N from the window a new window would come from (the focused one, else the one used last, else the first): its profile and settings.
 *  - normal, with none open (only a private window or a web app, or a Mac with every window closed): the ordinary window a link would open, restored or made: that is the new window, never two.
 *  - private: like Ctrl/Cmd+Shift+N from that same window; with no ordinary window, from a private one, else on its own with the saved settings.
 *  A window that is still starting is waited for (its state is empty until then, and would say Personal). */
function createWindowRequests({whenReady,isQuitting,isOpen,controllers,ordinaryController,createWindow,savedSettings=()=>undefined,warn=message=>console.warn(message)}){
 const usable=c=>!c.webApp&&!c.closing;
 /* Once the window has painted and is on screen, bring it to the front with the focus: a request from the taskbar, the Dock or another start must not leave it behind. */
 const raise=c=>{void Promise.resolve(c.firstShown).then(()=>{if(!isQuitting())c.show();});};
 async function open(kind){
  if(kind!=='normal'&&kind!=='private')return null;
  await whenReady();
  if(isQuitting()||!isOpen())return null;
  const ordinary=[...controllers()].filter(c=>usable(c)&&!c.privateMode);
  let source=null;
  if(ordinary.length)source=ordinaryController();
  else if(kind==='normal'){
   source=ordinaryController();/* restores the saved windows or makes a fresh one: that is the new window */
   if(!await source.ready){warn('The new window could not start.');return null;}
   raise(source);
   return source;
  }else source=[...controllers()].find(c=>usable(c)&&c.privateMode)||null;
  if(source){
   if(!await source.ready){warn('The new window could not start.');return null;}
   if(isQuitting())return null;
   const made=source.openNewWindow(kind);
   if(made)raise(made);
   return made||null;
  }
  const made=createWindow({privateMode:true,settings:savedSettings()});
  raise(made);
  return made;
 }
 return {open};
}

module.exports={NEW_WINDOW_ARG,NEW_PRIVATE_WINDOW_ARG,INSTALLER_QUIT_ARG,ITEMS,windowRequestFromArgv,isWindowOnlyLaunch,jumpListTasks,dockMenuTemplate,createOsWindowMenus,createWindowRequests};
