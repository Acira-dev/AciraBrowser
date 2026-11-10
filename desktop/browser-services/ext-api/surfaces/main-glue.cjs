'use strict';
// The browser side of the P8 packages (action, commands, context menus, notifications): one place that connects what they ask of Acira's
// interface to a window of main.cjs. main.cjs calls attachWindow() once per ordinary window and runCommand() / noted() from two small hooks.
const bridge=require('./bridge.cjs');
const {menuData}=require('../../context-commands.cjs');
const {trace}=require('../../ext-trace.cjs');

/**
 * One ordinary (not private, not Tor) window.
 * deps: {
 *   getChrome()            the interface's webContents (the toolbar lives there)
 *   isActive()             is this the window the person is working in?
 *   activeProfileId()      the profile of its active tab
 *   showMenu(menu, anchor) puts {items, run} on screen at a rectangle of the interface (CSS pixels); true when shown
 *   sendToChrome(event)    a browser event for the interface
 *   unpin(profileId, id)   takes the extension off the toolbar
 *   profileInfo            {pinned(profileId, extensionId)} the toolbar pin state of any ordinary profile
 *   notify(...)            see notifications
 * }
 * Returns detach().
 */
function attachWindow(deps){
 const offers=[];
 const on=(name,listener)=>{bridge.hub.on(name,listener);offers.push(()=>bridge.hub.off(name,listener));};
 // The toolbar button's menu: only the interface itself can show it where the button is.
 on('menu',request=>{
  if(request.handled)return;
  const chrome=deps.getChrome();
  if(!chrome||chrome.isDestroyed()||request.sender!==chrome)return;
  const menu=menuData(request.templates);
  if(menu.items.length&&deps.showMenu(menu,request.anchor))request.handled=true;
 });
 // action.openPopup() and the shortcut of _execute_action: the interface presses the extension's own button.
 on('open-popup',request=>{
  if(request.handled||!deps.isActive())return;
  // The extension (action.openPopup, or the key of its _execute_action) asked for its popup: told apart in the local trace from a click on the button.
  trace('an extension asked for its popup',request.extensionId);
  deps.sendToChrome({type:'extension-popup',extensionId:request.extensionId});
  request.handled=true;
 });
 on('unpin',request=>{
  if(request.handled||request.profileId!==deps.activeProfileId())return;
  request.handled=true;
  void Promise.resolve(deps.unpin(request.profileId,request.extensionId)).catch(()=>{});
 });
 if(deps.profileInfo)bridge.setProfileInfo(deps.profileInfo);
 return ()=>{for(const off of offers)off();};
}

/** A shortcut of an extension command was pressed (main.cjs shortcut dispatch: action 'extension-command'). */
function runCommand(command,{webContents,privateMode=false}={}){
 if(!command||typeof command.extensionId!=='string'||typeof command.command!=='string')return false;
 if(privateMode){
  // A private window or tab: the command runs in that page's own private session, which holds only the extensions allowed in private tabs (private-extension-
  // sessions.cjs), and only for the profile whose key was pressed. Tor, secured workspaces, private pages without such a session and Acira's own pages: nothing.
  let session=null;
  try{session=webContents&&!webContents.isDestroyed?.()?webContents.session:null;}catch{session=null;}
  const entry=session&&bridge.all('commands').find(item=>item.session===session);
  if(!entry||!entry.controller.sourceProfileId||entry.controller.sourceProfileId!==command.profileId)return false;
  return !!entry.controller.run(command.extensionId,command.command,webContents);
 }
 for(const {controller} of bridge.all('commands')){
  if(controller.profileId===command.profileId)return !!controller.run(command.extensionId,command.command,webContents);
 }
 return false;
}

/** main.cjs reports a finished extensions command (acira:extensions): a pin change reaches action.onUserSettingsChanged. */
function noted(request){
 if(request&&request.type==='pin'&&typeof request.extensionId==='string'&&typeof request.pinned==='boolean')bridge.pinChanged(request.profileId,request.extensionId,request.pinned);
}

module.exports={attachWindow,runCommand,noted};
