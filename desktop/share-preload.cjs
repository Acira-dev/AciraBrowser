'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// The share picker and the sharing pill (share-ui.cjs) only receive their own text and pictures and report a choice or Stop.
contextBridge.exposeInMainWorld('aciraShare',{
 onInit:callback=>ipcRenderer.on('acira:share-init',(_event,payload)=>callback(payload)),
 onThumbs:callback=>ipcRenderer.on('acira:share-thumbs',(_event,thumbs)=>callback(thumbs)),
 ready:size=>ipcRenderer.send('acira:share-ready',{width:Number(size?.width)||0,height:Number(size?.height)||0}),
 respond:answer=>ipcRenderer.send('acira:share-respond',answer&&typeof answer==='object'?{key:String(answer.key||''),audio:answer.audio===true}:null),
 stop:()=>ipcRenderer.send('acira:share-stop'),
});
