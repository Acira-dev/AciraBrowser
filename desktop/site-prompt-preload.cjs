'use strict';
// The site prompt page (desktop/site-prompt.html) can only report that it is ready, how tall it is, the answer the person gave
// and that "Manage in site settings" was pressed, and receive its own state. It gets no browser capabilities.
const {contextBridge,ipcRenderer}=require('electron');
const integer=(value,low,high)=>Number.isInteger(value)&&value>=low&&value<=high;
contextBridge.exposeInMainWorld('sitePrompt',{
 send:message=>{
  if(!message||typeof message.type!=='string')return;
  if(message.type==='ready')ipcRenderer.send('acira:site-prompt',{type:'ready'});
  else if(message.type==='size'&&integer(message.token,1,1e9)&&Number.isFinite(message.height)&&message.height>0&&message.height<4000)ipcRenderer.send('acira:site-prompt',{type:'size',token:message.token,height:Math.round(message.height)});
  else if(message.type==='manage'&&integer(message.token,1,1e9))ipcRenderer.send('acira:site-prompt',{type:'manage',token:message.token});
  else if(message.type==='answer'&&integer(message.token,1,1e9)&&integer(message.index,0,9))ipcRenderer.send('acira:site-prompt',{type:'answer',token:message.token,index:message.index,dismissed:message.dismissed===true,
   ...(typeof message.value==='string'?{value:message.value.slice(0,10000)}:{}),...(typeof message.muted==='boolean'?{muted:message.muted}:{})});
 },
 onState:listener=>{ipcRenderer.on('acira:site-prompt-state',(_event,state)=>listener(state));},
});
