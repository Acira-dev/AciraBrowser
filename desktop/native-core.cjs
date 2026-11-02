'use strict';
const { tm } = require('./tm.cjs');
// Stream D native services behind one validated trusted-UI channel (window.acira.native -> 'acira:native').
// Each request is {type, ...fields}; unknown types and extra fields are rejected.
const fail=message=>{throw new Error(message);};
const str=(value,label,max=200)=>{if(typeof value!=='string'||!value||value.length>max)fail(`${label} must be text of at most ${max} characters.`);return value;};

function createNativeCore({shortcutRegistry,spellcheck,downloadPreferences,dialog}){
 const exact=(request,allowed)=>{for(const key of Object.keys(request))if(key!=='type'&&!allowed.includes(key))fail('Unexpected native request field.');};
 const handlers={
  'shortcuts.list':(request)=>{exact(request,[]);return {shortcuts:{commands:shortcutRegistry.list(),recording:shortcutRegistry.isRecording(),hints:shortcutRegistry.hints()}};},
  'shortcuts.set':(request)=>{exact(request,['id','accelerator','replace']);return {shortcuts:shortcutRegistry.set(str(request.id,'Command'),str(request.accelerator,'Shortcut',40),{replace:request.replace===true})};},
  'shortcuts.clear':(request)=>{exact(request,['id']);return {shortcuts:shortcutRegistry.clear(str(request.id,'Command'))};},
  'shortcuts.reset':(request)=>{exact(request,['id']);return {shortcuts:shortcutRegistry.reset(str(request.id,'Command'))};},
  'shortcuts.reset-all':(request)=>{exact(request,[]);return {shortcuts:shortcutRegistry.resetAll()};},
  'shortcuts.record-start':(request,context)=>{exact(request,[]);return {shortcuts:shortcutRegistry.startRecording(context.senderId)};},
  'shortcuts.record-stop':(request)=>{exact(request,[]);return {shortcuts:shortcutRegistry.stopRecording()};},
  'shortcuts.describe':(request)=>{exact(request,['accelerator','id']);const accel=shortcutRegistry.canonical(str(request.accelerator,'Shortcut',40));return {shortcuts:accel?shortcutRegistry.describe(accel,typeof request.id==='string'?request.id:null):{accelerator:null,valid:false,reason:'That key combination could not be read.',conflict:null}};},
  'spellcheck.status':(request,context)=>{exact(request,[]);const session=context.profileSession();return {spellcheck:{...spellcheck.status(session),available:[...session.availableSpellCheckerLanguages]}};},
  'spellcheck.set':(request,context)=>{exact(request,['enabled','languages']);if(typeof request.enabled!=='boolean'||!Array.isArray(request.languages))fail('Choose spellchecking on or off and a language list.');return {spellcheck:spellcheck.set(context.profileSession(),{enabled:request.enabled,languages:request.languages.map(language=>str(language,'Language',40))})};},
  'profiles.remove':(request,context)=>{exact(request,['id']);return Promise.resolve(context.removeProfile(str(request.id,'Profile',200))).then(result=>({profiles:result}));},
 'downloads.preferences':(request)=>{exact(request,[]);return {downloads:{preferences:downloadPreferences.get()}};},
  'downloads.preferences.set':(request)=>{exact(request,['askWhere','folder']);return {downloads:{preferences:downloadPreferences.set({askWhere:request.askWhere,folder:request.folder})}};},
  'downloads.choose-folder':async(request,context)=>{exact(request,[]);const current=downloadPreferences.get().folder;const result=await dialog.showOpenDialog(context.window?.(),{title:tm("nativeCore.chooseDownloadFolder"),defaultPath:current,properties:['openDirectory','createDirectory']});if(result.canceled||!result.filePaths[0])return {downloads:{preferences:downloadPreferences.get(),cancelled:true}};return {downloads:{preferences:downloadPreferences.set({folder:result.filePaths[0]})}};},
 'permissions.list':(request,context)=>{exact(request,[]);return {permissions:{rows:context.permissions.list()}};},
  'permissions.reset':(request,context)=>{exact(request,['requester','embedder','permission']);context.permissions.reset(str(request.requester,'Site',300),str(request.embedder,'Embedding site',300),str(request.permission,'Permission',80));return {permissions:{rows:context.permissions.list()}};},
  'permissions.reset-all':(request,context)=>{exact(request,[]);context.permissions.clear();return {permissions:{rows:context.permissions.list()}};},
 'shortcuts.export':(request)=>{exact(request,[]);return {shortcuts:{json:shortcutRegistry.exportJson()}};},
  'shortcuts.import':(request)=>{exact(request,['json']);return {shortcuts:shortcutRegistry.importJson(str(request.json,'Shortcut file',64*1024))};},
  // Runs one registry entry (stock, or dynamic like routine:<id>) through main's own shortcut path, as if its keys were pressed.
  'shortcuts.run':(request,context)=>{exact(request,['id']);const id=str(request.id,'Command',160),command=shortcutRegistry.commands.find(item=>item.id===id);if(!command)return {shortcuts:{ok:false,code:'unknown',message:tm("nativeCore.unknownCommand")}};if(command.action.action==='tab-switcher')return {shortcuts:{ok:false,code:'keyboard-only',message:tm("nativeCore.holdCtrlAndPressTab")}};if(typeof context.runCommand!=='function')return {shortcuts:{ok:false,code:'unavailable',message:tm("nativeCore.commandsAreUnavailableInThis")}};context.runCommand({...command.action});return {shortcuts:{ok:true,ran:id}};},
 };
 return {
  handle(request,context={}){
   if(!request||typeof request!=='object'||Array.isArray(request)||typeof request.type!=='string'||JSON.stringify(request).length>70*1024)fail('Invalid native request.');
   if(request.type.startsWith('webapps.')&&typeof context.webApps==='function')return context.webApps(request);// G · F52 installed apps (desktop/web-apps.cjs)
   if(request.type.startsWith('tor.')&&typeof context.tor==='function')return context.tor(request);// N · private windows with Tor (desktop/browser-services/tor-window.cjs)
   const handler=Object.hasOwn(handlers,request.type)?handlers[request.type]:null;if(!handler)fail('Unknown native request.');
   return handler(request,context);
  },
 };
}
module.exports={createNativeCore};
