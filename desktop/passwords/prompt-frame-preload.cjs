'use strict';
// The password prompt frame (desktop/passwords/prompt-frame.html) can only report a choice and receive its own state.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pwFrame',{
 ready:()=>ipcRenderer.send('acira:pw-frame','ready'),
 choose:index=>{if(Number.isInteger(index)&&index>=0&&index<20)ipcRenderer.send('acira:pw-frame','choose',index);},
 action:name=>{if(name==='save'||name==='never'||name==='dismiss')ipcRenderer.send('acira:pw-frame','action',name);},
 onState:listener=>{ipcRenderer.on('acira:pw-frame-state',(_event,state)=>listener(state));},
});
