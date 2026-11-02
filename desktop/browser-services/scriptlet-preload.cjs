'use strict';
// Runs before any page script in every frame. Asks the main process for the filter-list scriptlets that apply to this
// address (empty for most sites) and runs them in the page's own world, so they are in place before the page starts.
const {ipcRenderer,webFrame}=require('electron');
if(process.isMainFrame&&/^https?:/.test(location.href)){
 /* Each script carries its own copy of the scriptlet helpers (safeSelf, proxyApplyFn, ...). Run bare, a second script would redefine the global proxyApplyFn, and the first script's Function.prototype.toString stand-in would then call itself without end: every fn.toString() on the page threw "Maximum call stack size exceeded" (Reddit's sidebar never loaded). A function scope gives each script its own helpers. */
 try{const scripts=ipcRenderer.sendSync('acira:scriptlets',location.href);if(Array.isArray(scripts))for(const script of scripts)if(typeof script==='string')void webFrame.executeJavaScript('(function(){'+script+'\n})();');}catch{/* A site without scriptlets, or a closing window. */}
}
