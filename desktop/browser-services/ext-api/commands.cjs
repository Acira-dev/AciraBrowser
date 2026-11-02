'use strict';
// chrome.commands (work package P8). Every command in an extension's manifest becomes a command in Acira's shortcut registry (Settings › Shortcuts,
// category Extensions): its suggested key is its default unless Acira (or another extension) already uses that key, the person can change or clear
// it there, and a key press anywhere, also inside a web page, reaches the extension — onCommand for a named command, the action button for
// _execute_action. Renderer side: commands-renderer.cjs.
const {commandsOf}=require('./commands/keys.cjs');
const bridge=require('./surfaces/bridge.cjs');
const activeTab=require('./surfaces/active-tab.cjs');

const PREFIX='ext:';
const commandId=(profileId,extensionId,name)=>`${PREFIX}${profileId}:${extensionId}:${encodeURIComponent(name)}`;
const groups=new Map();   // one entry per profile session: Map(commandId -> registry command)

/** Replaces the extension commands of every profile in the registry (it takes the whole set under one prefix). */
function publish(){
 const registry=bridge.getShortcuts();
 if(!registry||typeof registry.setDynamic!=='function')return;
 // A suggested key that Acira (or an extension that came first) already uses stays unassigned, as in Chrome.
 const taken=new Set();
 try{for(const command of registry.list())if(!command.id.startsWith(PREFIX))for(const accel of command.bindings)taken.add(accel);}catch{/* registry not ready */}
 const merged=[];
 for(const group of groups.values())for(const command of group.values()){
  let defaults=[];
  if(command.key){
   const accel=registry.canonical?.(command.key)||command.key;
   if(!taken.has(accel)){defaults=[accel];taken.add(accel);}
  }
  merged.push({...command.entry,defaults});
 }
 try{registry.setDynamic(PREFIX,merged);}catch(error){console.warn('[ext-api:commands] shortcuts were not registered:',error?.message||error);}
}
bridge.hub.on('shortcuts',()=>publish());

module.exports={
 namespaces:['commands'],
 PREFIX,commandId,publish,
 install(api){
  const mine=new Map(),byExtension=new Map();   // commandId -> {key, entry}; extension id -> [{name, description, key, execute}]
  groups.set(api.session,mine);
  const profileId=String(api.storeKey||'default');

  function register(extension){
   if(!extension?.manifest?.commands)return;
   const list=commandsOf(extension.manifest);
   if(!list.length)return;
   byExtension.set(extension.id,list);
   const name=String(extension.name||'Extension').slice(0,60);
   for(const command of list){
    if(command.global)continue;   // global (system-wide) shortcuts are not offered
    mine.set(commandId(profileId,extension.id,command.name),{key:command.key,entry:{
     id:commandId(profileId,extension.id,command.name),
     label:command.execute?api.t('ext.command.activate',{name}):`${name}: ${command.description||command.name}`,
     category:'Extensions',
     action:{action:'extension-command',profileId,extensionId:extension.id,command:command.name}
    }});
   }
  }
  function unregister(extensionId){
   byExtension.delete(extensionId);
   for(const id of [...mine.keys()])if(id.startsWith(`${PREFIX}${profileId}:${extensionId}:`))mine.delete(id);
  }
  const sessionExtensions=api.session?.extensions||api.session;
  try{
   sessionExtensions?.on?.('extension-loaded',(_event,extension)=>{if(extension){unregister(extension.id);register(extension);publish();}});
   sessionExtensions?.on?.('extension-unloaded',(_event,extension)=>{if(extension){unregister(extension.id);publish();}});
   for(const extension of sessionExtensions?.getAllExtensions?.()||[])register(extension);
  }catch{/* tests without a session */}
  publish();

  /** The current key of a command in Chrome's notation, '' when it has none. */
  function shortcutOf(extensionId,name){
   try{
    const found=bridge.getShortcuts()?.list?.().find(command=>command.id===commandId(profileId,extensionId,name));
    return found&&found.bindings[0]?String(found.bindings[0]).replace(/\bCmd\b/g,'Command'):'';
   }catch{return '';}
  }
  api.handle('commands.getAll',event=>{
   const extension=event.extension,list=byExtension.get(extension.id)||commandsOf(extension.manifest);
   return list.map(command=>({name:command.name,description:command.description||(command.execute?'Activate the extension':''),shortcut:shortcutOf(extension.id,command.name)}));
  });

  /** A key was pressed (main.cjs shortcut dispatch): run the command in this profile. */
  function run(extensionId,name,webContents){
   const extension=api.getExtension(extensionId);
   const known=byExtension.get(extensionId)?.some(command=>command.name===name);
   if(!extension||!known)return false;
   if(name.startsWith('_execute_')){
    return !!bridge.controller(api.session,'action')?.invoke?.(extensionId,webContents);
   }
   let tab;
   try{tab=api.store()?.tabDetailsCache?.get?.(webContents?.id)||(webContents?api.handler('tabs.get')?.({type:'frame',sender:webContents,extension:null},webContents.id):undefined);}catch{tab=undefined;}
   if(webContents&&!webContents.isDestroyed?.())activeTab.grant(api.session,extensionId,webContents.id,webContents.getURL?.());
   api.emit(extensionId,'commands.onCommand',name,tab);
   return true;
  }
  const release=bridge.register(api.session,'commands',{profileId,run});

  return {
   forget(id){unregister(id);publish();},
   dispose(){release();groups.delete(api.session);publish();}
  };
 }
};
