'use strict';
// How the browser-UI packages (ext-api/action, context-menus, commands, notifications, omnibox) reach Acira's interface in main.cjs.
// A package registers one controller per profile session; main.cjs looks controllers up and listens on `hub` for what the interface must
// show. This folder is not a package (ext-api/index.cjs loads only the .cjs files directly in ext-api/).
//
// hub events (main.cjs listens):
//   'menu'        {sender, anchor:{x,y,width,height}, items, run(id), toggles:Set}  an Acira menu at a toolbar button (action context menu)
//   'open-popup'  {session, extensionId, windowId}                                 action.openPopup(): the interface opens it at the button
//   'omnibox'     {session, event}                                                 suggestions or a keyword change for the address bar
// main.cjs provides (set*):
//   setShortcuts(registry)          the shortcut registry, for extension commands in Settings › Shortcuts
//   setProfileInfo({pinned(profileId, extensionId)})  toolbar pin state for action.getUserSettings
const {EventEmitter}=require('node:events');

const hub=new EventEmitter();hub.setMaxListeners(200);
const controllers=new Map();// name -> Map(session -> controller)
let shortcuts=null,profileInfo=null;

function register(session,name,controller){
 if(!controllers.has(name))controllers.set(name,new Map());
 controllers.get(name).set(session,controller);
 hub.emit('registered',{session,name});
 return ()=>{if(controllers.get(name)?.get(session)===controller)controllers.get(name).delete(session);};
}
const controller=(session,name)=>(session&&controllers.get(name)?.get(session))||null;
const all=name=>[...(controllers.get(name)||new Map()).entries()].map(([session,value])=>({session,controller:value}));
function setShortcuts(registry){shortcuts=registry||null;hub.emit('shortcuts',shortcuts);}
const getShortcuts=()=>shortcuts;
function setProfileInfo(info){profileInfo=info||null;}
/** Toolbar pin state of an extension in a profile, or null when Acira's interface has not said (tests, early start). */
function pinned(profileId,extensionId){try{const value=profileInfo?.pinned?.(profileId,extensionId);return typeof value==='boolean'?value:null;}catch{return null;}}
/** main.cjs reports a toolbar pin change (Settings, the extensions panel, the action menu) so action.onUserSettingsChanged fires. */
function pinChanged(profileId,extensionId,isOnToolbar){hub.emit('pinned',{profileId,extensionId,isOnToolbar:!!isOnToolbar});}

module.exports={hub,register,controller,all,setShortcuts,getShortcuts,setProfileInfo,pinned,pinChanged};
