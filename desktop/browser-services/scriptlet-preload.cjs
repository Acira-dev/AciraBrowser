'use strict';
// Runs before any page script in every frame. Asks the main process for the filter-list scriptlets that apply to this
// address (empty for most sites) and runs them in the page's own world, so they are in place before the page starts.
const {ipcRenderer,webFrame}=require('electron');
if(process.isMainFrame&&/^https?:/.test(location.href)){
 /* Each script carries its own copy of the scriptlet helpers (safeSelf, proxyApplyFn, ...). Run bare, a second script would redefine the global proxyApplyFn, and the first script's Function.prototype.toString stand-in would then call itself without end: every fn.toString() on the page threw "Maximum call stack size exceeded" (Reddit's sidebar never loaded). A function scope gives each script its own helpers. */
 try{const scripts=ipcRenderer.sendSync('acira:scriptlets',location.href);if(Array.isArray(scripts))for(const script of scripts)if(typeof script==='string')void webFrame.executeJavaScript('(function(){'+script+'\n})();');}catch{/* A site without scriptlets, or a closing window. */}
 /* Acira's own ad-card rules (content-blocking.cjs AD_SLOT_LEFTOVERS, the same hosts): a user style sheet put in now, before the page lays anything out, so an empty ad card is never drawn and nothing moves when it goes. */
 if(/(?:^|\.)weather\.com$/i.test(location.hostname))try{const css=ipcRenderer.sendSync('acira:ad-slot-styles',location.href);if(typeof css==='string'&&css)webFrame.insertCSS(css,{cssOrigin:'user'});}catch{/* A closing window. */}
}
