'use strict';
// The side panel frame (side-panel-frame.html) can only send its own commands and receive its own state.
const {contextBridge,ipcRenderer}=require('electron');
const COMMANDS=new Set(['close','entered','gone']);
contextBridge.exposeInMainWorld('sidePanelFrame',{
 command:name=>{if(COMMANDS.has(name))ipcRenderer.send('acira:side-panel-frame',name);},
 onState:listener=>{ipcRenderer.on('acira:side-panel-frame-state',(_event,state)=>listener(state));},
});
