'use strict';
// Runs before any page script in every frame of a tab, iframes included (R4-37). Asks the main process for this session's
// website-language preference and runs it in the page's own world. Browser brands remain native. Empty for Google Account
// authentication and frames that are not websites (a srcdoc frame counts as its parent's site).
const {ipcRenderer,webFrame}=require('electron');
if(/^https?:/.test(location.href)||location.href==='about:srcdoc'){
 try{const script=ipcRenderer.sendSync('acira:chrome-identity');if(typeof script==='string'&&script)void webFrame.executeJavaScript(script);}catch{/* A closing window. */}
}
