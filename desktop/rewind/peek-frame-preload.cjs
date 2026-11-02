'use strict';
// The peek frame page (desktop/rewind/peek-frame.html) can only send its commands and receive its own state.
const {contextBridge,ipcRenderer}=require('electron');
const COMMANDS=new Set(['close','tab','split','copy','back','reload','stop','ready','entered','gone']);
contextBridge.exposeInMainWorld('peekFrame',{
 command:name=>{if(COMMANDS.has(name))ipcRenderer.send('acira:peek-frame',name);},
 onState:listener=>{ipcRenderer.on('acira:peek-frame-state',(_event,state)=>listener(state));},
});
