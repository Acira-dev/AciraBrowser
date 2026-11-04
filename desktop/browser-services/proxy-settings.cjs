'use strict';
const {t}=require('./tx.cjs'),chromeSettings=require('./extension-chrome-settings.cjs');
const {isIP}=require('node:net');
function host(value,wildcard=false){
 if(typeof value!=='string'||!value||value.length>253||/[\s/@?#\\\u0000-\u001f]/.test(value))throw new Error('Enter a proxy hostname or IP without credentials, a URL path or port.');
 if(wildcard&&value==='<local>')return value;
 const prefix=wildcard&&value.startsWith('*.')?'*.':'',name=(prefix?value.slice(2):value).replace(/^\[|\]$/g,'').toLowerCase();
 if((value.startsWith('[')||value.endsWith(']'))&&(!value.startsWith('[')||!value.endsWith(']')||isIP(name)!==6))throw new Error('Only IPv6 literals use brackets.');
 if(isIP(name))return prefix?(()=>{throw new Error('IP bypass entries cannot have wildcards.');})():isIP(name)===6?'['+name+']':name;
 if(!name.split('.').every(label=>label.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))throw new Error('Invalid proxy hostname or bypass pattern.');
 return prefix+name;
}
function proxyChoice(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!['system','direct','fixed_servers'].includes(value.mode))throw new Error('Choose system, direct or a fixed HTTP/SOCKS5 proxy.');
 const keys=value.mode==='fixed_servers'?['mode','server','bypassHosts']:['mode'];if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Unsupported proxy option.');
 if(value.mode!=='fixed_servers')return {mode:value.mode};
 const server=value.server;if(!server||typeof server!=='object'||Array.isArray(server)||Object.keys(server).some(key=>!['scheme','host','port'].includes(key))||!['http','socks5'].includes(server.scheme)||!Number.isSafeInteger(server.port)||server.port<1||server.port>65535)throw new Error('Enter an HTTP/SOCKS5 proxy host and a port from1to65535.');
 const bypassHosts=value.bypassHosts??[];if(!Array.isArray(bypassHosts)||bypassHosts.length>100)throw new Error('Use at most100explicit bypass host patterns.');
 return {mode:value.mode,server:{scheme:server.scheme,host:host(server.host),port:server.port},bypassHosts:[...new Set(bypassHosts.map(value=>host(value,true)))]};
}
function nativeProxy(choice){return choice.mode==='fixed_servers'?{mode:'fixed_servers',proxyRules:`${choice.server.scheme}://${choice.server.host}:${choice.server.port}`,proxyBypassRules:choice.bypassHosts.join(',')}:{mode:choice.mode};}
function createProxySettings({database,getContext,getWindow,dialog}){
 const contexts=new Map();
 const lookup=session=>{const state=contexts.get(session);if(!state||state.released)throw new Error('Unknown native browsing session.');return state;};
 /* An extension's proxy (chrome.proxy.settings, ext-api/proxy.cjs) replaces the person's choice while it holds it; never for private or Tor sessions. The person's choice stays saved. */const forcedFor=(session,state)=>state.privateMode?null:chromeSettings.proxyOverride(state.profileId,session);const status=session=>{const state=lookup(session),forced=forcedFor(session,state);return {...(forced?{controlledBy:{extensionId:forced.extensionId,name:forced.name,mode:forced.mode}}:{}),effectiveMode:forced?forced.mode:state.choice.mode,profileId:state.profileId,private:state.privateMode,choice:structuredClone(state.choice),applied:state.applied,busy:state.busy,error:state.error,authenticationSupported:true,scope:'All website traffic in this native profile session. System settings are inherited unless explicitly changed. This configures a proxy, not a VPN.'};};
 async function apply(session,choice,forced=null){await session.setProxy(forced?forced.native:nativeProxy(choice));await session.closeAllConnections();}
 async function attach(session,profileId,privateMode=false){
  if(contexts.has(session)){const existing=lookup(session);if(existing.profileId!==profileId||existing.privateMode!==!!privateMode)throw new Error('Proxy session owner mismatch.');await existing.ready;return status(session);}
  if(session.__aciraTor){const state={profileId,privateMode:true,choice:{mode:'tor'},applied:true,busy:false,error:null,released:false,ready:Promise.resolve()};contexts.set(session,state);return status(session);} // Tor windows own their proxy (browser-services/tor-window.cjs); never reset it to system
  const state={profileId,privateMode:!!privateMode,choice:{mode:'system'},applied:false,busy:true,error:null,released:false};contexts.set(session,state);if(!state.privateMode)chromeSettings.registerHost(session,{userChoice:()=>state.choice,reapply:async()=>{try{await state.ready;}catch{}if(state.released||contexts.get(session)!==state)return;await apply(session,state.choice,forcedFor(session,state));}});
  state.ready=(async()=>{try{const saved=privateMode?null:database.policy(profileId,'*')?.networkProxy;const choice=proxyChoice(saved||{mode:'system'});await apply(session,choice,forcedFor(session,state));state.choice=choice;state.applied=true;return {...status(session),busy:false};}catch(error){state.error=String(error.message||error).slice(0,512);throw error;}finally{state.busy=false;}})();
  return state.ready;
 }
 async function set(session,value){
  const choice=proxyChoice(value),state=lookup(session),held=forcedFor(session,state);if(held)throw new Error(t('proxy.controlledByExtension',{name:held.name}));if(state.busy)throw new Error('A proxy change is already in progress.');state.busy=true;
  const previous=state.choice;let applying=false;
  try{
   const message=choice.mode==='fixed_servers'?t('proxy.messageServer',{server:`${choice.server.scheme}://${choice.server.host}:${choice.server.port}`}):choice.mode==='system'?t('proxy.messageSystem'):t('proxy.messageDirect');
   const answer=await dialog.showMessageBox(getWindow(session),{type:'question',title:t('proxy.changeTitle'),message,detail:t('proxy.changeDetail'),buttons:[t('dialog.cancel'),t('proxy.useButton')],defaultId:0,cancelId:0});
   if(answer.response!==1)return {cancelled:true};if(contexts.get(session)!==state||state.released)throw new Error('The browsing profile closed during review.');
   applying=true;await apply(session,choice,forcedFor(session,state));if(state.released)throw new Error('The browsing profile closed before the change completed.');
   if(!state.privateMode)database.setPolicy(state.profileId,'*',{...(database.policy(state.profileId,'*')||{}),networkProxy:choice});
   state.choice=choice;state.applied=true;state.error=null;state.ready=Promise.resolve();return {...status(session),busy:false};
  }catch(error){
   state.error=String(error.message||error).slice(0,512);
   if(applying)try{await apply(session,previous,forcedFor(session,state));state.applied=true;}catch{state.applied=false;state.error='The proxy change and rollback failed; the current native route is unconfirmed. Retry a known setting before browsing.';}
   throw new Error(state.error);
  }finally{state.busy=false;}
 }
 /** "Use my setting": the person ends an extension's control. The extension's value is cleared (it can set one again; removing or disabling the extension ends it for good). */
 async function takeBack(session){
  const state=lookup(session),held=forcedFor(session,state);
  if(held){const store=chromeSettings.hostFor(session)?.store||chromeSettings.existing(state.profileId);if(store)for(const scope of chromeSettings.SCOPES)store.clearValue('proxy',held.extensionId,scope);await apply(session,state.choice,forcedFor(session,state));}
  return {...status(session),busy:false};
 }
 async function route(wc){
  if(!wc||wc.isDestroyed())throw new Error('Select a live website tab.');const owner=getContext(wc),state=lookup(wc.session),url=new URL(wc.getURL());if(owner?.profileId!==state.profileId||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Select an owned website in this profile.');
  const route=await wc.session.resolveProxy(url.href);if(wc.isDestroyed()||contexts.get(wc.session)!==state||getContext(wc)?.profileId!==state.profileId||wc.getURL()!==url.href)throw new Error('The website changed before its route was resolved.');return {origin:url.origin,route:String(route).slice(0,2048),applied:state.applied};
 }
 /** The Electron proxy configuration this session runs with now: an extension's while it controls the proxy, else the person's choice. Traffic that
  *  must leave the way the profile's pages do (the update check and download, update-route.cjs) is given the same. */
 const nativeRoute=session=>{const state=lookup(session),forced=forcedFor(session,state);return structuredClone(forced?forced.native:nativeProxy(state.choice));};
 return {attach,status,nativeRoute,set,route,takeBack,release(session){const state=contexts.get(session);if(state)state.released=true;contexts.delete(session);}};
}
module.exports={createProxySettings,proxyChoice,nativeProxy};
