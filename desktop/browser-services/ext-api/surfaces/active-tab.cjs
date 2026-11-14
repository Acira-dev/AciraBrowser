'use strict';
// activeTab, as Chrome grants it: a click on the extension's toolbar button, its keyboard command (also _execute_action) or one of its
// context-menu items lets it read and script the tab the person did that on, until the tab goes to another origin or closes.
// Electron has no UI of its own for this, so Acira keeps the grant here; the actions that grant call grant(), scripting calls has().
//
// Those same three actions are Chromium's user-gesture events: it dispatches action.onClicked / commands.onCommand / contextMenus.onClicked with
// EventRouter::UserGestureState::kEnabled (chrome/browser/extensions/extension_action_dispatcher.cc). A script the extension injects from there runs
// with UserActivationOption::kActivate (extensions/browser/api/scripting/scripting_api.cc user_gesture() -> ScriptExecutor -> Blink RequestExecuteScript),
// so the page frame gets a transient activation and its own EyeDropper.open(), window.open() and the like are allowed. gestureLive() says whether a
// script injected now is still inside that activation.
const bySession=new WeakMap();   // session -> Map("<extensionId>:<tabId>" -> {origin, at})
// third_party/blink/public/common/frame/user_activation_state.h, kActivationLifespan: how long a transient activation lasts.
const GESTURE_MS=5000;

const originOf=url=>{try{const parsed=new URL(String(url));return /^https?:$/.test(parsed.protocol)?parsed.origin:'';}catch{return '';}};
const mapOf=session=>{if(!session||typeof session!=='object')return null;if(!bySession.has(session))bySession.set(session,new Map());return bySession.get(session);};

/** The person acted on this tab through this extension: it may use the tab's current origin. Every action is a new gesture. */
function grant(session,extensionId,tabId,url,now=Date.now()){
 const map=mapOf(session),origin=originOf(url);
 if(!map||!origin||!Number.isInteger(tabId))return false;
 if(map.size>=500)map.delete(map.keys().next().value);
 map.set(`${extensionId}:${tabId}`,{origin,at:now});
 return true;
}
/** Does the grant still hold: same tab, and the tab is still on the origin it was given for. */
function has(session,extensionId,tabId,currentUrl){
 const entry=mapOf(session)?.get(`${extensionId}:${tabId}`);
 return !!entry&&!!entry.origin&&entry.origin===originOf(currentUrl);
}
/** Is a script injected now inside the user activation of the action that made the grant: the grant holds and the action was at most 5 s ago. */
function gestureLive(session,extensionId,tabId,currentUrl,now=Date.now()){
 if(!has(session,extensionId,tabId,currentUrl))return false;
 const age=now-mapOf(session).get(`${extensionId}:${tabId}`).at;
 return age>=0&&age<=GESTURE_MS;
}
const revoke=(session,extensionId,tabId)=>mapOf(session)?.delete(`${extensionId}:${tabId}`);
const clear=(session,extensionId)=>{const map=mapOf(session);if(map)for(const key of [...map.keys()])if(key.startsWith(extensionId+':'))map.delete(key);};

module.exports={grant,has,gestureLive,revoke,clear,originOf,GESTURE_MS};
