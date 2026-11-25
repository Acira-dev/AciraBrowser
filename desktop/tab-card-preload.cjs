'use strict';
// The tab card page (desktop/tab-card.html) can only tell main it is ready and how tall it is, and receive its own state.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('tabCard',{
 command:message=>{
  if(message?.type==='ready')ipcRenderer.send('acira:tab-card','ready');
  else if(message?.type==='size'&&Number.isFinite(message.height)&&message.height>0&&message.height<2000)ipcRenderer.send('acira:tab-card',{size:Math.round(message.height),...(Number.isFinite(message.width)&&message.width>0&&message.width<600?{width:Math.round(message.width)}:{})});
 },
 onState:listener=>{ipcRenderer.on('acira:tab-card-state',(_event,state)=>listener(state));},
});
