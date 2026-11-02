'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// The dialog page only receives its own text and reports a button index; it gets no browser capabilities.
contextBridge.exposeInMainWorld('aciraDialog',{
 onInit:callback=>ipcRenderer.on('acira:dialog-init',(_event,payload)=>callback(payload)),
 ready:height=>ipcRenderer.send('acira:dialog-ready',height),
 respond:(index,selected,dismissed)=>ipcRenderer.send('acira:dialog-respond',index,selected,dismissed===true),
});
