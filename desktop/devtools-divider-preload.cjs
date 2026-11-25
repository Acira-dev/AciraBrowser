'use strict';
// The divider between a page and its docked Developer tools (devtools-divider.html) can only send its own pointer messages and receive its own state.
const {contextBridge,ipcRenderer}=require('electron');
const TYPES=new Set(['down','move','up','reset','key']);
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
contextBridge.exposeInMainWorld('devtoolsDivider',{
 send:message=>{
  if(!message||!TYPES.has(message.type))return;
  ipcRenderer.send('acira:devtools-divider',{type:message.type,x:number(message.x),y:number(message.y),alt:message.alt===true,big:message.big===true,key:typeof message.key==='string'?message.key.slice(0,12):undefined});
 },
 onState:listener=>{ipcRenderer.on('acira:devtools-divider-state',(_event,state)=>listener(state));},
});
