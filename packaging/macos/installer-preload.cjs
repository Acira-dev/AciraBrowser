'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('aciraInstaller',{
 ready:()=>ipcRenderer.send('acira-installer:ready'),
 action:command=>ipcRenderer.invoke('acira-installer:action',command),
 state:()=>ipcRenderer.invoke('acira-installer:state'),
 subscribe:callback=>{const update=(_event,value)=>callback(value);ipcRenderer.on('acira-installer:state',update);return()=>ipcRenderer.removeListener('acira-installer:state',update);}
});
