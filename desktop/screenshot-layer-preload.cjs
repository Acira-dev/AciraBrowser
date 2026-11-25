'use strict';
// The screenshot layer page (desktop/screenshot-layer.html) can only send its few messages and receive its own state.
const {contextBridge,ipcRenderer}=require('electron');
const MESSAGES=new Set(['ready','covered','picked','cancelled','hidden']);
contextBridge.exposeInMainWorld('screenshotLayer',{
 send:(type,detail)=>{if(MESSAGES.has(type))ipcRenderer.send('acira:shot-layer',{type,...(type==='picked'&&detail&&typeof detail==='object'?{rect:{x:Number(detail.x),y:Number(detail.y),width:Number(detail.width),height:Number(detail.height)}}:{})});},
 onState:listener=>{ipcRenderer.on('acira:shot-layer-state',(_event,state)=>listener(state));},
});
