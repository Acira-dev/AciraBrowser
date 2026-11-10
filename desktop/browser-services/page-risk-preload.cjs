'use strict';
// Top frame of every website: runs the ClickFix clipboard guard in the page (page-risk.cjs) and reports sign-in forms. It sends only "a rule fired" and, for a
// sign-in form, the page title and first heading; the main process decides and writes the explanation shown to the person.
const {ipcRenderer,webFrame}=require('electron');
/* frame-boot client (frame-boot.cjs) */const bootAnswer=(channel,...args)=>{try{const KEY=Symbol.for('acira.frame-boot');let boot=globalThis[KEY];if(!boot)boot=globalThis[KEY]=ipcRenderer.sendSync('acira:frame-boot',location.href,process.isMainFrame,window===window.top)||{};if(Object.prototype.hasOwnProperty.call(boot,channel))return boot[channel];}catch{/* ask directly */}return ipcRenderer.sendSync(channel,...args);};/* end frame-boot client */
if(window===window.top&&/^https?:/.test(location.href)){
 let enabled=false;
 try{enabled=!!bootAnswer('acira:page-risk-config')?.enabled;}catch{/* A closing window. */}
 if(enabled){
  try{const script=bootAnswer('acira:page-risk-script');if(typeof script==='string'&&script)void webFrame.executeJavaScript(script);}catch{/* No guard without the script. */}
  let clipboardReports=0;
  window.addEventListener('acira-clickfix',()=>{if(clipboardReports++<3)ipcRenderer.send('acira:page-risk',{kind:'clipboard-command'});});
  let sent=false,timer=0;
  const visible=input=>{const rect=input.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(input).visibility!=='hidden';};
  const check=()=>{
   timer=0;if(sent||!document.body)return;
   const password=[...document.querySelectorAll('input[type="password"]')].find(visible);if(!password)return;
   sent=true;const heading=document.querySelector('h1,h2');
   ipcRenderer.send('acira:page-risk',{kind:'login-form',text:((document.title||'')+' | '+(heading?heading.textContent:'')).replace(/\s+/g,' ').slice(0,300)});
  };
  const schedule=()=>{if(!timer&&!sent)timer=setTimeout(check,600);};
  document.addEventListener('DOMContentLoaded',schedule);window.addEventListener('load',schedule);
  new MutationObserver(schedule).observe(document,{childList:true,subtree:true});
 }
}
