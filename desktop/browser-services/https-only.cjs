'use strict';
const {t}=require('./tx.cjs');
const {randomUUID}=require('node:crypto'),{isIP}=require('node:net');
const FALLBACK_ERRORS=new Set(['ERR_CONNECTION_REFUSED','ERR_SSL_PROTOCOL_ERROR','ERR_CONNECTION_TIMED_OUT','ERR_TIMED_OUT','ERR_CONNECTION_CLOSED','ERR_ADDRESS_UNREACHABLE','ERR_NAME_NOT_RESOLVED']);
/** Loopback, private-network, single-label and .local/.localhost/.internal hosts cannot present a public certificate, so strict mode leaves them alone (like Chrome's HTTPS-First mode). */
function localHost(hostname){const host=hostname.replace(/^\[|\]$/g,'').toLowerCase();if(isIP(host)===4){const [a,b]=host.split('.').map(Number);return a===127||a===10||a===0||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127;}if(isIP(host)===6)return host==='::1'||/^f[cd]/.test(host)||/^fe[89ab]/.test(host);return !host.includes('.')||/\.(?:localhost|local|internal|lan|home\.arpa|onion)$/.test(host);} // onion services are end-to-end encrypted by Tor without a public certificate (Brave exempts them too)
const origin=value=>{try{return new URL(value).origin;}catch{return null;}};
function createHTTPSOnly({database,getProfiles,getContext,resolveContents,getWindow,dialog,navigate,onChange=()=>{},now=Date.now}){
 const sessions=new Map(),pending=new Map(),tickets=new Map(),grants=new Map(),generations=new WeakMap(),watched=new WeakSet();
 const enabled=state=>state.privateMode?state.enabled:database.policy(state.profileId,'*')?.httpsOnly===true;
 function owner(wc){if(!wc||wc.isDestroyed())throw new Error('Select a live website tab.');const context=getContext(wc),state=sessions.get(wc.session);if(!context||typeof context.tabId!=='string'||!state||context.profileId!==state.profileId||!!(context.privateMode||context.private)!==state.privateMode)throw new Error('Unknown website session or profile.');return {...context,state};}
 function notify(wc){try{onChange(wc);}catch{}}
 function clearSession(session){for(const map of [pending,tickets,grants])for(const[key,value]of map)if(value.session===session)map.delete(key);}
 function grantFor(wc,url,main){const grant=grants.get(wc.id);if(!grant)return null;const context=getContext(wc);if(grant.session!==wc.session||context?.profileId!==grant.profileId||context?.tabId!==grant.tabId||!grant.active&&now()>grant.activationDeadline){grants.delete(wc.id);return null;}if(origin(url)!==grant.origin||!main&&origin(wc.getURL())!==grant.origin)return null;if(main)grant.active=true;return grant;}
 function track(wc){
  if(watched.has(wc))return;watched.add(wc);generations.set(wc,0);
  wc.on('did-start-navigation',(_event,url,_inPlace,main)=>{if(!main)return;generations.set(wc,(generations.get(wc)||0)+1);tickets.delete(wc.id);const grant=grants.get(wc.id);if(grant?.active&&origin(url)!==grant.origin)grants.delete(wc.id);const request=pending.get(wc.id);if(request){if(url===request.originalURL||url===request.secureURL)request.generation=generations.get(wc);else pending.delete(wc.id);}});
  wc.on('did-fail-load',(_event,_code,error,url,main)=>{if(!main||!FALLBACK_ERRORS.has(error))return;const request=pending.get(wc.id),state=sessions.get(wc.session),context=getContext(wc);if(!request||!request.secureRequested||!state||!enabled(state)||!context||context.profileId!==state.profileId||request.generation!==generations.get(wc)||![request.originalURL,request.secureURL].includes(url))return;const ticket={...request,id:randomUUID(),profileId:context.profileId,tabId:context.tabId,generation:generations.get(wc),expiresAt:now()+120000,error};tickets.set(wc.id,ticket);if(tickets.size>128)tickets.delete(tickets.keys().next().value);notify(wc);});
  wc.once('destroyed',()=>{pending.delete(wc.id);tickets.delete(wc.id);grants.delete(wc.id);});
 }
 function before(session,details){
  const state=sessions.get(session);if(!state||!enabled(state))return {};
  let url;try{url=new URL(details.url);}catch{return {};}
  const wc=details.webContents||resolveContents(details.webContentsId||0),main=details.resourceType==='mainFrame';if(wc&&!wc.isDestroyed()&&wc.session===session){track(wc);const request=pending.get(wc.id);if(main&&request&&url.href===request.secureURL)request.secureRequested=true;}
  if(url.protocol==='ws:')return localHost(url.hostname)?{}:{cancel:true};if(url.protocol!=='http:'||localHost(url.hostname))return {};
  if(url.username||url.password||url.href.length>65536)return {cancel:true};
  if(wc&&!wc.isDestroyed()&&wc.session===session&&grantFor(wc,url.href,main))return {};
  const originalURL=url.href;url.protocol='https:';
  if(main&&wc&&!wc.isDestroyed()&&wc.session===session)pending.set(wc.id,{session,originalURL,secureURL:url.href,method:String(details.method||'GET').toUpperCase(),generation:generations.get(wc),secureRequested:false});
  return {redirectURL:url.href};
 }
 function attach(session,profileId,privateMode,pipeline){if(sessions.has(session)){const state=sessions.get(session);if(state.profileId!==profileId||state.privateMode!==!!privateMode)throw new Error('HTTPS policy session owner mismatch.');return;}const state={profileId,privateMode:!!privateMode,enabled:false};sessions.set(session,state);state.dispose=pipeline.useBefore(details=>before(session,details));}
 function profileStatus(profileId){if(!getProfiles().some(profile=>profile.id===profileId&&!profile.private))throw new Error('Select an ordinary local profile.');return {profileId,enabled:database.policy(profileId,'*')?.httpsOnly===true,scope:'profile',reloadRequired:true};}
 function setProfile(profileId,value){profileStatus(profileId);if(typeof value!=='boolean')throw new Error('Choose a boolean HTTPS-only setting.');database.setPolicy(profileId,'*',{...(database.policy(profileId,'*')||{}),httpsOnly:value});for(const[session,state]of sessions)if(state.profileId===profileId)clearSession(session);return profileStatus(profileId);}
 function setPrivate(session,value){const state=sessions.get(session);if(!state?.privateMode||typeof value!=='boolean')throw new Error('Select an actual private native session.');state.enabled=value;clearSession(session);return {enabled:value,private:true,reloadRequired:true};}
 function status(wc){const context=owner(wc);let ticket=tickets.get(wc.id);if(ticket&&ticket.expiresAt<now()){tickets.delete(wc.id);ticket=null;}let grant=grants.get(wc.id);if(grant&&(!grant.active&&now()>grant.activationDeadline||grant.profileId!==context.profileId||grant.tabId!==context.tabId)){grants.delete(wc.id);grant=null;}return {enabled:enabled(context.state),profileId:context.profileId,private:context.state.privateMode,upgradeFailure:ticket?{ticketId:ticket.id,originalURL:ticket.originalURL,secureURL:ticket.secureURL,error:ticket.error,expiresAt:ticket.expiresAt,canAllowHTTP:true,requiresResubmit:ticket.method!=='GET'}:null,temporaryHTTP:grant?{origin:grant.origin,active:grant.active,activationExpiresAt:grant.active?null:grant.activationDeadline,scope:'This origin in this tab until you leave the origin or close the tab.'}:null,reloadRequired:enabled(context.state)&&/^http:/.test(wc.getURL())&&!grant,scope:'New HTTP requests upgrade to HTTPS; insecure WebSockets block. Reload existing insecure pages/connections after changing policy. Certificate failures never receive an HTTP bypass here.'};}
 function validTicket(wc,ticket){try{const context=owner(wc);return tickets.get(wc.id)===ticket&&enabled(context.state)&&ticket.expiresAt>=now()&&ticket.session===wc.session&&ticket.profileId===context.profileId&&ticket.tabId===context.tabId&&ticket.generation===generations.get(wc);}catch{return false;}}
 async function allowHTTP(wc,ticketId){
  owner(wc);const ticket=tickets.get(wc.id);if(!ticket||ticket.id!==ticketId||!validTicket(wc,ticket))throw new Error('Review the current native HTTPS upgrade failure first.');
  const answer=await dialog.showMessageBox(getWindow(wc),{type:'warning',title:t('https.title'),message:t('https.message',{host:new URL(ticket.originalURL).host}),detail:t('https.detail',{origin:origin(ticket.originalURL),followup:ticket.method==='GET'?t('https.followupGet'):t('https.followupForm')}),buttons:[t('dialog.cancel'),t('https.allowButton')],defaultId:0,cancelId:0});
  if(answer.response!==1)return {cancelled:true};if(!validTicket(wc,ticket))throw new Error('The website changed during review. No HTTP exception was granted.');
  grants.set(wc.id,{session:wc.session,profileId:ticket.profileId,tabId:ticket.tabId,origin:origin(ticket.originalURL),active:false,activationDeadline:now()+120000});pending.delete(wc.id);tickets.delete(wc.id);if(ticket.method==='GET')await navigate(wc,ticket.originalURL);notify(wc);return {allowed:true,requiresResubmit:ticket.method!=='GET',scope:'origin-in-this-tab-until-leave-or-close'};
 }
 async function revokeHTTP(wc){owner(wc);grants.delete(wc.id);tickets.delete(wc.id);pending.delete(wc.id);wc.stop();await wc.session.closeAllConnections();notify(wc);return {revoked:true,reloadRequired:true};}
 return {attach,profileStatus,setProfile,setPrivate,status,allowHTTP,revokeHTTP,release(session){const state=sessions.get(session);state?.dispose?.();clearSession(session);sessions.delete(session);}};
}
module.exports={createHTTPSOnly,FALLBACK_ERRORS};
