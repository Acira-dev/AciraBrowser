'use strict';
// Runs before any page script in every frame of a tab (tabs set nodeIntegrationInSubFrames so this reaches iframes, including
// cross-site ones in their own process; R4-37). Asks the main process for this site's fingerprint-protection script (empty when
// protection is off, the site is excepted, or the frame is not a website) and runs it in the page's own world. A srcdoc frame is
// a website document too (its parent's origin, its own scripts); a frame that is still about:blank is protected by its parent the
// moment the parent reaches it (fingerprint-farbling.cjs), so it is skipped here and never patched twice.
const {ipcRenderer,webFrame}=require('electron');
/* frame-boot client (frame-boot.cjs) */const bootAnswer=(channel,...args)=>{try{const KEY=Symbol.for('acira.frame-boot');let boot=globalThis[KEY];if(!boot)boot=globalThis[KEY]=ipcRenderer.sendSync('acira:frame-boot',location.href,process.isMainFrame,window===window.top)||{};if(Object.prototype.hasOwnProperty.call(boot,channel))return boot[channel];}catch{/* ask directly */}return ipcRenderer.sendSync(channel,...args);};/* end frame-boot client */
if(/^https?:/.test(location.href)||location.href==='about:srcdoc'){
 try{const script=bootAnswer('acira:farbling',location.href);if(typeof script==='string'&&script)void webFrame.executeJavaScript(script);}catch{/* A closing window. */}
}
