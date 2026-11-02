'use strict';
const {randomUUID,X509Certificate}=require('node:crypto'),net=require('node:net');
const ALLOWED_ERRORS=new Set(['net::ERR_CERT_AUTHORITY_INVALID','net::ERR_CERT_COMMON_NAME_INVALID','net::ERR_CERT_DATE_INVALID','ERR_CERT_AUTHORITY_INVALID','ERR_CERT_COMMON_NAME_INVALID','ERR_CERT_DATE_INVALID']);
// Literal local addresses cannot acquire dynamic HSTS from response headers. DNS
// names are denied: Electron44 drops Chromium's strict_enforcement argument.
function localLiteral(host){const value=host.replace(/^\[|\]$/g,'');if(net.isIP(value)===4){const p=value.split('.').map(Number);return p[0]===127||p[0]===10||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===169&&p[1]===254;}return net.isIP(value)===6&&(value==='::1'||/^(?:f[cd]|fe[89ab])/i.test(value));}
// localhost and *.localhost always resolve to the loopback interface, so they cannot be spoofed from the network.
const loopbackName=host=>host==='localhost'||host.endsWith('.localhost');
function destination(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||!localLiteral(url.hostname)&&!loopbackName(url.hostname))return null;url.hash='';return {url:url.href,origin:url.origin,host:url.hostname,port:Number(url.port||443)};}catch{return null;}}
function fingerprint(certificate){try{return new X509Certificate(certificate.data).fingerprint256.replaceAll(':','').toLowerCase();}catch{return null;}}

/** Main-only temporary exceptions; no disk store or renderer-selected certificate. */
function createCertificatePolicy({getContext,onChange=()=>{},now=Date.now,ttlMs=5*60*1000,ticketTtlMs=2*60*1000,setTimer=setTimeout,clearTimer=clearTimeout}){
 const failures=new Map(),grants=new Map(),watched=new WeakSet(),pipelines=new WeakMap(),protectedOrigins=new WeakMap();
 const same=(a,b)=>a&&b&&a.tabId===b.tabId&&a.profileId===b.profileId&&a.session===b.session;
 const current=wc=>{if(!wc||wc.isDestroyed())return null;const context=getContext(wc);return context?{...context,session:wc.session}:null;};
 function watch(wc){if(watched.has(wc))return;watched.add(wc);wc.once('destroyed',()=>{void revoke(wc).catch(()=>{});failures.delete(wc);});}
 function status(wc){const context=current(wc),failure=failures.get(wc),grant=grants.get(wc);return {failure:failure&&same(context,failure.context)&&failure.expiresAt>now()?{ticketId:failure.id,url:failure.url,origin:failure.origin,host:failure.host,port:failure.port,error:failure.error,fingerprint:failure.fingerprint,canContinue:failure.canContinue,reason:failure.reason,expiresAt:failure.expiresAt}:null,exception:grant&&same(context,grant.context)&&grant.expiresAt>now()?{origin:grant.origin,url:grant.url,fingerprint:grant.fingerprint,expiresAt:grant.expiresAt,warning:'Identity could not be verified. Temporary exception for this tab only.'}:null};}
 async function revoke(wc){const grant=grants.get(wc);if(grant)clearTimer(grant.timer);grants.delete(wc);failures.delete(wc);const session=grant?.context.session||(!wc?.isDestroyed()?wc?.session:null);if(wc&&!wc.isDestroyed())wc.stop();if(session){await session.closeAllConnections();if(grant&&![...grants.values()].some(g=>g.context.session===session&&g.origin===grant.origin))protectedOrigins.get(session)?.delete(grant.origin);}onChange(wc,status(wc));return {revoked:true};}
 function attach(session,pipeline){if(pipelines.has(session))return;if(!pipeline||typeof pipeline.useBefore!=='function')throw new Error('Certificate exceptions require the shared native request pipeline.');const origins=new Set();protectedOrigins.set(session,origins);const dispose=pipeline.useBefore(details=>{let origin;try{origin=new URL(details.url).origin;}catch{return {};}if(!origins.has(origin))return {};const match=[...grants].find(([wc,g])=>g.context.session===session&&g.origin===origin&&wc.id===details.webContentsId&&g.expiresAt>now()&&same(current(wc),g.context));return match?{}:{cancel:true};});pipelines.set(session,dispose);}
 function handle(event,wc,url,error,certificate,callback,isMainFrame){
  let called=false;const reply=value=>{if(!called){called=true;callback(value);}};
  try{
   const context=current(wc);if(!context){reply(false);return;}watch(wc);event.preventDefault();
   const target=destination(url),digest=fingerprint(certificate),grant=grants.get(wc);
   const expected=context.failedURL||context.requestedURL||url;
   if(isMainFrame===true&&target&&digest&&ALLOWED_ERRORS.has(error)&&grant&&grant.expiresAt>now()&&same(grant.context,context)&&grant.origin===target.origin&&grant.fingerprint===digest&&destination(expected)?.origin===target.origin){reply(true);onChange(wc,status(wc));return;}
   // Only the failed main navigation can create a continuation ticket. A frame or
   // hidden popup cannot ask the UI to grant an exception for its own resource.
   if(isMainFrame===true){const canContinue=!!target&&!!digest&&ALLOWED_ERRORS.has(error)&&context.isActive!==false&&new URL(expected).href.replace(/#.*$/,'')===new URL(url).href.replace(/#.*$/,'');failures.set(wc,{id:randomUUID(),context,url:target?.url||url,origin:target?.origin||null,host:target?.host||new URL(url).hostname,port:target?.port||null,error,fingerprint:digest,canContinue,expiresAt:now()+ticketTtlMs,reason:canContinue?'A deliberate temporary exception is available for this local address.':'This certificate failure cannot be safely overridden by this engine. DNS/HSTS and hard certificate errors remain blocked.'});onChange(wc,status(wc));}
   reply(false);
  }catch{reply(false);}
 }
 async function continueOnce(wc,ticketId){
  const failure=failures.get(wc),context=current(wc);if(!failure||typeof ticketId!=='string'||failure.id!==ticketId||!same(failure.context,context)||failure.expiresAt<=now()||!failure.canContinue||context.isActive===false||destination(context.failedURL||context.requestedURL)?.url!==failure.url)throw new Error('The certificate warning changed or expired. Reload the destination and review it again.');
  if(!pipelines.has(wc.session))throw new Error('The scoped certificate request guard is unavailable.');
  const previous=grants.get(wc);if(previous)clearTimer(previous.timer);const grant={...failure,expiresAt:now()+Math.max(1000,Math.min(ttlMs,10*60*1000))};grant.timer=setTimer(()=>{void revoke(wc).catch(()=>{});},grant.expiresAt-now());grant.timer.unref?.();grants.set(wc,grant);protectedOrigins.get(wc.session).add(grant.origin);failures.delete(wc);await wc.session.closeAllConnections();onChange(wc,status(wc));return {url:grant.url,exception:status(wc).exception};
 }
 return {attach,handle,status,continueOnce,revoke,clearProfile:async profileId=>{await Promise.all([...grants].filter(([,g])=>g.context.profileId===profileId).map(([wc])=>revoke(wc)));for(const [wc,failure]of failures)if(failure.context.profileId===profileId)failures.delete(wc);}};
}
module.exports={createCertificatePolicy,destination,localLiteral,fingerprint};
