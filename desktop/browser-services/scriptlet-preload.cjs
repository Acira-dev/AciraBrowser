'use strict';
// Runs before any page script in every frame. Asks the main process for the filter-list scriptlets that apply to this
// address (empty for most sites) and runs them in the page's own world, so they are in place before the page starts.
const {ipcRenderer,webFrame}=require('electron');
if(process.isMainFrame&&/^https?:/.test(location.href)){
 try{const scripts=ipcRenderer.sendSync('acira:scriptlets',location.href);if(Array.isArray(scripts))for(const script of scripts)if(typeof script==='string')void webFrame.executeJavaScript(script);}catch{/* A site without scriptlets, or a closing window. */}
}
