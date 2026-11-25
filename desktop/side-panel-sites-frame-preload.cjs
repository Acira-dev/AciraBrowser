'use strict';
// The side panel sites frame (desktop/side-panel-sites-frame.html) can only send its own commands and receive its own state.
const {contextBridge,ipcRenderer}=require('electron');
const COMMANDS=new Set(['close','back','reload','dock','tab','outside','entered','gone','veil-gone','still-ready','resize-start','resize-move','resize-end','reset-width']);
contextBridge.exposeInMainWorld('sidePanelSitesFrame',{
 command:(name,detail)=>{
  if(!COMMANDS.has(name))return;
  const x=detail&&Number.isFinite(detail.x)?Math.round(detail.x):undefined;
  ipcRenderer.send('acira:side-panel-sites-frame',name,x);
 },
 onState:listener=>{ipcRenderer.on('acira:side-panel-sites-frame-state',(_event,state)=>listener(state));},
});
