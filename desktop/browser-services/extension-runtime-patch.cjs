'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createLastError}=require('./extension-api-signature.cjs');

// electron-chrome-extensions never sets chrome.runtime.lastError (its preload has no notion of it) and swallows every error the main
// process answers (the call resolves with undefined, after a console.error). This patches the library's preload text (exact edits; if any
// no longer matches, nothing is patched) so that
//  - every call the engine answers behaves like Chrome's bindings (api_request_handler.cc): an error rejects the promise, or runs the callback
//    with chrome.runtime.lastError set (and "Unchecked runtime.lastError: …" on the console when the callback never reads it, as in Chrome);
//    with a callback the call returns undefined, as in Chrome. The error text is the main process's message without Electron's IPC prefix;
//  - the engine's debug build no longer logs every call, its arguments and its result to the extension's console (Chrome logs nothing);
//  - chrome.runtime.sendNativeMessage(app, message, callback) sets lastError during the callback (or rejects, without a callback) when the
//    main process answers {__acira_native_error}, see native-messaging.cjs;
//  - the library freezes `chrome` (Object.freeze(chrome)), which Chrome does not: an extension that wraps `chrome` in its own Proxy (Proton
//    Pass) then throws on every read, because a Proxy must return the real value of a frozen property. The freeze is dropped;
//  - a native port's onDisconnect runs with lastError when the host is missing, forbidden or exits.
// The patched copy is written under the profile's userData and registered in place of the original on each session's runtime.
const WS='\\s+';
// Answers from Acira's handlers: {__acira_error} is a failure, {__acira_value} wraps a value that could look like one.
const UNWRAP='const acira_unwrap = (result) => { if (result && typeof result === "object" && typeof result.__acira_error === "string") throw new Error(result.__acira_error); return result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "__acira_value") ? result.__acira_value : result; };\n'+
 '      const acira_message = (error) => String(error && typeof error === "object" && "message" in error ? error.message : error);\n';
const EDITS=[
 [new RegExp('(ipcRenderer\\.once\\(`crx-native-msg-\\$\\{connectionId\\}-disconnect`,'+WS+')\\(\\)'+WS+'=>'),'$1(_event, reason) =>'],
 [new RegExp('(ipcRenderer\\.off\\(`crx-native-msg-\\$\\{connectionId\\}`,'+WS+'onMessage\\);'+WS+')disconnect\\(\\);'),'$1disconnect(reason);'],
 [new RegExp('_disconnect\\(\\)'+WS+'\\{'+WS+'this\\.disconnect\\(\\);'+WS+'\\}'),'_disconnect(reason) { this.disconnect(reason); }'],
 [new RegExp('disconnect\\(\\)'+WS+'\\{'+WS+'if \\(this\\.connected\\) \\{'+WS+'electron\\.disconnectNative\\(extensionId, this\\.connectionId\\);'+WS+'this\\.onDisconnect\\._emit\\(\\);'+WS+'this\\.connected = false;'+WS+'\\}'+WS+'\\}'),
  'disconnect(reason) { if (this.connected) { electron.disconnectNative(extensionId, this.connectionId); this.connected = false; acira_withLastError(reason, () => this.onDisconnect._emit()); } }'],
 [new RegExp('sendNativeMessage: invokeExtension2\\("runtime\\.sendNativeMessage"\\)'),
  'sendNativeMessage: (application, message, callback) => { const run = invokeExtension2("runtime.sendNativeMessage"); const failure = (result) => result && result.__acira_native_error; if (typeof callback === "function") { run(application, message).then((result) => { const error = failure(result); acira_withLastError(error, () => callback(error ? void 0 : result)); }, (error) => acira_withLastError(acira_message(error), () => callback())); return void 0; } return run(application, message).then((result) => { const error = failure(result); if (error) throw new Error(error); return result; }); }'],
 [new RegExp('class NativePort \\{'),
  ()=>`const acira_withLastError = (${createLastError.toString()})(() => globalThis.chrome, () => console);\n      ${UNWRAP}      class NativePort {`],
 [new RegExp('Object\\.freeze\\(chrome\\);'),'/* chrome stays extensible, as in Chrome (see extension-runtime-patch.cjs) */'],
 // Every chrome.* event's hasListener / hasListeners threw "Method not implemented." Todoist's worker calls
 // webNavigation.onCreatedNavigationTarget.hasListener while applying its options, so that step died. Each event now keeps the
 // set of its own listeners in this context and answers from it, as Chrome does.
 [new RegExp('addListener\\(callback\\)'+WS+'\\{'+WS+'electron\\.addExtensionListener\\(extensionId, this\\.name, callback\\);'+WS+'\\}'+WS+
  'removeListener\\(callback\\)'+WS+'\\{'+WS+'electron\\.removeExtensionListener\\(extensionId, this\\.name, callback\\);'+WS+'\\}'+WS+
  '(getRules\\(ruleIdentifiers, callback\\)'+WS+'\\{'+WS+'throw new Error\\("Method not implemented\\."\\);'+WS+'\\})'+WS+
  'hasListener\\(callback\\)'+WS+'\\{'+WS+'throw new Error\\("Method not implemented\\."\\);'+WS+'\\}'+WS+
  '(removeRules\\(ruleIdentifiers, callback\\)'+WS+'\\{'+WS+'throw new Error\\("Method not implemented\\."\\);'+WS+'\\}'+WS+
  'addRules\\(rules, callback\\)'+WS+'\\{'+WS+'throw new Error\\("Method not implemented\\."\\);'+WS+'\\})'+WS+
  'hasListeners\\(\\)'+WS+'\\{'+WS+'throw new Error\\("Method not implemented\\."\\);'+WS+'\\}'),
  'addListener(callback) { if (typeof callback === "function") (this.acira_listeners || (this.acira_listeners = new Set())).add(callback); electron.addExtensionListener(extensionId, this.name, callback); }\n'+
  '        removeListener(callback) { if (this.acira_listeners) this.acira_listeners.delete(callback); electron.removeExtensionListener(extensionId, this.name, callback); }\n'+
  '        $1\n        hasListener(callback) { return !!this.acira_listeners && this.acira_listeners.has(callback); }\n        $2\n'+
  '        hasListeners() { return !!this.acira_listeners && this.acira_listeners.size > 0; }'],
 // The isolated world's invokeExtension: an error from the main process (a handler that throws, a missing permission) used to become
 // `undefined` after console.error. It now comes back as {__acira_error: message} (Electron's "Error invoking remote method 'crx-msg':
 // Error: " prefix removed), which the main world below turns into a rejection or lastError.
 [new RegExp('catch \\(e\\)'+WS+'\\{'+WS+'console\\.error\\(e\\);'+WS+'result = void 0;'+WS+'\\}'),
  ()=>'catch (e) {\n        result = { __acira_error: String(e && e.message || e).replace(/^Error invoking remote method \'[^\']*\': (?:[A-Za-z]*Error: )?/, "") };\n      }'],
 // The engine's development logging of every call, argument list, result and event (Chrome logs none of it).
 [new RegExp('if \\(true\\)'+WS+'\\{'+WS+'console\\.log\\(name, "\\(result\\)", \\.\\.\\.args\\);'+WS+'\\}'),()=>'/* no per-event log */'],
 [new RegExp('if \\(true\\)'+WS+'\\{'+WS+'console\\.log\\(fnName, args\\);'+WS+'\\}'),()=>'/* no per-call log */'],
 [new RegExp('if \\(true\\)'+WS+'\\{'+WS+'console\\.log\\(fnName, "\\(result\\)", result\\);'+WS+'\\}'),()=>'/* no per-result log */'],
 // The main world's invokeExtension2 makes every engine function (tabs.get, windows.create, cookies.getAll, …): like Chrome's bindings,
 // a callback gets the value, or no arguments with chrome.runtime.lastError set; without one the promise resolves or rejects.
 [new RegExp('const invokeExtension2 = \\(fnName, opts = \\{\\}\\) => \\(\\.\\.\\.args\\) => electron\\.invokeExtension\\(extensionId, fnName, opts, \\.\\.\\.args\\);'),
  ()=>'const invokeExtension2 = (fnName, opts = {}) => (...args) => { const callback = typeof args[args.length - 1] === "function" ? args.pop() : void 0; const run = Promise.resolve(electron.invokeExtension(extensionId, fnName, opts, ...args)).then(acira_unwrap); if (callback) { run.then((value) => acira_withLastError(void 0, () => callback(value)), (error) => acira_withLastError(acira_message(error), () => callback())); return void 0; } return run; };'],
];
// Namespaces the engine lacks (offscreen, sidePanel, identity, userScripts, runtime.getContexts; extension-apis-renderer.cjs) and the
// ext-api packages (ext-api/index.cjs) join the library's own table; after the table is built, every namespace is checked against
// Acira's permission table and Chromium's signatures. The text depends on which extensions may run user scripts and on granted permissions.
const API_EDITS=options=>[
 [new RegExp('const apiDefinitions = \\{'),()=>require('./extension-apis-renderer.cjs').rendererSource(options)+'\n      const apiDefinitions = { ...acira_extra.definitions,'],
 [new RegExp('delete globalThis\\.electron;'),()=>'acira_ext.after(chrome, apiDefinitions, acira_extra);\n      delete globalThis.electron;'],
];

function patchPreload(text,options={}){
 let out=text;
 for(const [pattern,replacement] of [...EDITS,...API_EDITS(options)]){if(!pattern.test(out))return null;out=out.replace(pattern,typeof replacement==='function'?()=>replacement():replacement);}
 return out;
}

// Every page of the profile runs the 'frame' preload, but only extension pages use it (the engine checks for chrome-extension://). The
// patched preload is about 260 KB, which every web page's renderer would parse on each navigation (≈3 ms, against ≈0.25 ms for the
// library's own 22 KB). Frames therefore get a loader of a few lines: on an extension page it asks the main process for the patched text
// (one synchronous IPC) and runs it in the preload's isolated world with the same require/process. Service workers (extension-only)
// keep the whole text in their file.
const LOADER_CHANNEL='acira:extension-preload';
const texts=new Map(); // hash -> patched text, newest last
function frameLoader(hash){
 return `"use strict";
// Acira: loader for the extension engine preload (extension-runtime-patch.cjs). Web pages stop at the first check.
(() => {
  if (typeof location === "undefined" || !String(location.href).startsWith("chrome-extension://")) return;
  let text = null;
  try { text = require("electron").ipcRenderer.sendSync(${JSON.stringify(LOADER_CHANNEL)}, ${JSON.stringify(hash)}); } catch (e) { text = null; }
  if (typeof text !== "string") { console.error("Acira: the extension API preload could not be loaded"); return; }
  new Function("require", "process", text)(require, process);
})();
`;
}
let channel=false;
function listen(){
 if(channel)return;
 const {ipcMain}=require('electron');if(!ipcMain||typeof ipcMain.on!=='function')return;
 channel=true;
 // Only preloads can send on it (pages have no ipcRenderer) and the loader asks only on extension pages; the answer is the same public
 // code the service-worker file holds.
 ipcMain.on(LOADER_CHANNEL,(event,hash)=>{event.returnValue=texts.get(hash)||[...texts.values()].pop()||null;});
}

/** Writes the patched preload next to the profile and swaps it in for this session's runtime. Returns true when patched.
 * options.userScriptsAllowed: the extension IDs whose "Allow user scripts" switch is on; options.grants: optional permissions granted per
 * extension (both are part of the text, so calling this again swaps it for pages and workers that start afterwards). */
function installPatchedPreload(session,userData,options={}){
 try{
  if(typeof session?.getPreloadScripts!=='function'||typeof session?.registerPreloadScript!=='function')return false;
  const original=require.resolve('electron-chrome-extensions/preload'),text=fs.readFileSync(original,'utf8'),patched=patchPreload(text,options);
  if(!patched)return false;
  const hash=crypto.createHash('sha256').update(patched).digest('hex').slice(0,12),dir=path.join(userData,'extension-runtime');
  const file=path.join(dir,`chrome-extension-api.preload.${hash}.js`),loader=path.join(dir,`chrome-extension-api.preload.${hash}.frame.js`);
  fs.mkdirSync(dir,{recursive:true});
  if(!fs.existsSync(file))fs.writeFileSync(file,patched);
  if(!fs.existsSync(loader))fs.writeFileSync(loader,frameLoader(hash));
  texts.delete(hash);texts.set(hash,patched);while(texts.size>8)texts.delete(texts.keys().next().value);
  listen();
  let swapped=false;
  for(const script of session.getPreloadScripts()){
   if(!/chrome-extension-api\.preload(\.[0-9a-f]{12})?(\.frame)?\.js$/.test(script.filePath||''))continue;
   const target=script.type==='frame'&&channel?loader:file;
   if(script.filePath!==target){session.unregisterPreloadScript(script.id);session.registerPreloadScript({id:script.id,type:script.type,filePath:target});}swapped=true;
  }
  return swapped;
 }catch{return false;}
}

module.exports={patchPreload,installPatchedPreload,frameLoader,LOADER_CHANNEL,EDITS};
