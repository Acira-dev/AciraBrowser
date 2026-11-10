'use strict';
// Runs before any page script in every frame of a tab, iframes included (R4-37). Asks the main process for this session's
// website-language preference and runs it in the page's own world. Browser brands remain native. Empty for Google Account
// authentication and frames that are not websites (a srcdoc frame counts as its parent's site).
const {ipcRenderer,webFrame}=require('electron');
/* frame-boot client (frame-boot.cjs) */const bootAnswer=(channel,...args)=>{try{const KEY=Symbol.for('acira.frame-boot');let boot=globalThis[KEY];if(!boot)boot=globalThis[KEY]=ipcRenderer.sendSync('acira:frame-boot',location.href,process.isMainFrame,window===window.top)||{};if(Object.prototype.hasOwnProperty.call(boot,channel))return boot[channel];}catch{/* ask directly */}return ipcRenderer.sendSync(channel,...args);};/* end frame-boot client */
if(/^https?:/.test(location.href)||location.href==='about:srcdoc'){
 try{const script=bootAnswer('acira:chrome-identity');if(typeof script==='string'&&script)void webFrame.executeJavaScript(script);}catch{/* A closing window. */}
}
