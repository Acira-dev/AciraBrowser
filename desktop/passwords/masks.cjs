'use strict';
// Email masks: Acira makes a throwaway forwarding address for a site through a mask service the person already has an account with
// (SimpleLogin, addy.io or Firefox Relay), using THEIR API key. The service makes the address, forwards the mail and can switch it off;
// Acira holds the key and a list. There is no Acira server, account or domain in this path. See the design notes and
// docs/launch/PASSWORDS_SECURITY.md ("Email masks").
//  - The key and the list live in the password vault (sealed per profile, vault.cjs); the key is never returned to a caller outside main.
//  - Every request goes to the one fixed HTTPS host of the chosen service, with no cookies and no redirects, a 15 s limit and a 256 KB
//    answer limit, over the route of the profile (its proxy) when the caller supplies one (mask-network.cjs).
//  - A mask is made only on an explicit choice in Acira's own list (page-bridge.cjs), one at a time, at most 20 an hour per profile.
const {PROVIDERS,MaskError,reason}=require('./mask-providers.cjs');
const {classify,displayHost,normalizeOrigin}=require('./origin-match.cjs');
const {tr}=require('./text.cjs');

const TIMEOUT_MS=15000,MAX_BODY=256*1024,PER_HOUR=20,HOUR=60*60*1000;
const KEY=/^[\x21-\x7e]{8,512}$/;// printable ASCII, no spaces: every service's keys are

/** The site name sent to the service as the mask's note: the host without "www.", never the path or query. */
function siteOf(pageUrl){try{const url=new URL(pageUrl);return /^https?:$/.test(url.protocol)?url.hostname.replace(/^www\./,'').slice(0,200):'';}catch{return '';}}

/** fetchFor(profileId) -> Promise<(url, init) => Promise<Response>>; it may throw a MaskError (route not confirmed). */
function createMasks({vault,fetchFor,providers=PROVIDERS,now=Date.now,timers={setTimeout,clearTimeout},testOrigins={}}){
 const busy=new Set(),made=new Map();// profileId -> times of recent mask creations
 const provider=id=>{const found=Object.hasOwn(providers,id)?providers[id]:null;if(!found)throw new MaskError('invalid',tr('pw.mask.err.unknownService','Choose one of the listed services.'));return found;};

 /** One call to the service. */
 function apiFor(profileId,adapter,key){
  // `peek`: only the status is wanted (a key check on a service whose answer can be a long list): the body is not read, so a big answer is no problem
  return async({method,path,query,body,expect=[200,201,204],peek=false})=>{
   // Only a test run (index.cjs: unpackaged, inside an isolated test profile) may name another origin, and only a local one; otherwise the service's own https host.
   const base=Object.hasOwn(testOrigins,adapter.id)?testOrigins[adapter.id]:`https://${adapter.host}`;
   const url=new URL(`${base}${path}`);
   if(url.origin!==new URL(base).origin||(base!==testOrigins[adapter.id]&&url.protocol!=='https:'))throw new MaskError('unexpected',tr('pw.mask.err.unexpected','{service} sent an answer Acira didn’t expect.',{service:adapter.name}));
   for(const [name,value] of Object.entries(query||{}))url.searchParams.set(name,String(value));
   const headers={Accept:'application/json',...adapter.headers(key)};if(body!==undefined)headers['Content-Type']='application/json';
   const controller=new AbortController(),timer=timers.setTimeout(()=>controller.abort(),TIMEOUT_MS);timer?.unref?.();
   let response,text='';
   try{
    const doFetch=await fetchFor(profileId);
    response=await doFetch(url.href,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,redirect:'manual',credentials:'omit',cache:'no-store'});
    if(peek){try{await response.body?.cancel?.();}catch{}}
    else if(response.status!==204&&response.status!==404){
     const length=Number(response.headers?.get?.('content-length'));
     if(Number.isFinite(length)&&length>MAX_BODY)throw new MaskError('unexpected',tr('pw.mask.err.unexpected','{service} sent an answer Acira didn’t expect.',{service:adapter.name}));
     text=String(await response.text()).slice(0,MAX_BODY);
    }
   }catch(error){
    if(error instanceof MaskError)throw error;
    throw new MaskError('network',tr('pw.mask.err.network','Couldn’t reach {service}. Check the connection and try again.',{service:adapter.name}));
   }finally{timers.clearTimeout(timer);}
   let parsed=null;if(text){try{parsed=JSON.parse(text);}catch{parsed=null;}}
   const status=response.status;
   if(expect.includes(status))return {status,body:parsed};
   // a plan's own limit (Firefox Relay says so with an error_code, as a 400 or a 403): calm words, nothing about the key
   if(parsed&&typeof parsed==='object'&&parsed.error_code==='free_tier_limit')throw new MaskError('limit',tr('pw.mask.err.planFull','Your {service} plan has no room for another mask. Delete one there or upgrade the plan.',{service:adapter.name}),status);
   // a 403 that comes with the service's own words is a refusal, not a wrong key; a 401, or a 403 with no words, is the key
   if(status===403&&reason(parsed))throw new MaskError('refused',tr('pw.mask.err.refusedWhy','{service} said no: {why}',{service:adapter.name,why:reason(parsed)}),status);
   if(status===401||status===403)throw new MaskError('auth',tr('pw.mask.err.auth','{service} didn’t accept the key. Check it and paste it again.',{service:adapter.name}),status);
   if(status===429)throw new MaskError('limit',tr('pw.mask.err.rate','{service} asks you to slow down. Try again in a few minutes.',{service:adapter.name}),status);
   if(status>=500)throw new MaskError('unavailable',tr('pw.mask.err.down','{service} isn’t answering right now. Try again later.',{service:adapter.name}),status);
   if(status===0||(status>=300&&status<400))throw new MaskError('unexpected',tr('pw.mask.err.unexpected','{service} sent an answer Acira didn’t expect.',{service:adapter.name}),status);
   const why=reason(parsed);
   throw new MaskError('refused',why?tr('pw.mask.err.refusedWhy','{service} said no: {why}',{service:adapter.name,why}):tr('pw.mask.err.refused','{service} said no.',{service:adapter.name}),status);
  };
 }
 const connectionOf=profileId=>{
  const connection=vault.connection(profileId);
  if(!connection||!Object.hasOwn(providers,connection.provider))throw new MaskError('notConnected',tr('pw.mask.err.notConnected','Connect a mask service in Settings first.'));
  return connection;
 };

 const api={
  /** Facts for Settings and the field list. Never the key. */
  status(profileId){
   const meta=vault.connectionMeta(profileId),choices=Object.values(providers).map(({id,name,keyPage})=>({id,name,keyPage}));
   if(!meta||!Object.hasOwn(providers,meta.provider))return {connected:false,providers:choices};
   return {connected:true,provider:meta.provider,name:providers[meta.provider].name,offer:meta.offer,note:meta.note,count:vault.masks(profileId).length,providers:choices};
  },
  /** For the field list: whether to offer a mask on this page, and the enabled masks already made for this site. Synchronous: no network. */
  offerFor(profileId,pageUrl){
   const meta=vault.connectionMeta(profileId);
   if(!meta||meta.offer===false||!Object.hasOwn(providers,meta.provider)||!normalizeOrigin(pageUrl))return null;
   const existing=vault.masks(profileId).filter(mask=>mask.provider===meta.provider&&mask.enabled&&['exact','upgrade'].includes(classify(mask.origin,pageUrl))).slice(0,3).map(({id,address})=>({id,address}));
   return {provider:meta.provider,name:providers[meta.provider].name,existing};
  },
  list(profileId){return vault.masks(profileId).map(mask=>({id:mask.id,origin:mask.origin,host:displayHost(mask.origin),address:mask.address,enabled:mask.enabled,provider:mask.provider,createdAt:mask.createdAt}));},
  /** Checks the key with one harmless request, then keeps it sealed. Switching to another service means disconnecting first. */
  async connect(profileId,{provider:id,key}){
   const adapter=provider(id);
   if(typeof key!=='string'||!KEY.test(key.trim()))throw new MaskError('invalid',tr('pw.mask.err.badKey','That doesn’t look like an API key. Copy it from {service} again.',{service:adapter.name}));
   const meta=vault.connectionMeta(profileId);
   if(meta&&meta.provider!==adapter.id)throw new MaskError('invalid',tr('pw.mask.err.disconnectFirst','Disconnect {service} before connecting another service.',{service:providers[meta.provider]?.name||meta.provider}));
   if(busy.has(profileId))throw new MaskError('busy',tr('pw.mask.err.busy','One moment: another request is still running.'));
   busy.add(profileId);
   try{await adapter.verify(apiFor(profileId,adapter,key.trim()));vault.connectionSet(profileId,{provider:adapter.id,key:key.trim(),offer:meta?meta.offer:true,note:meta?meta.note:true});}
   finally{busy.delete(profileId);}
   return api.status(profileId);
  },
  /** Forgets the key and this list. The masks stay at the service: they keep forwarding until switched off there. */
  disconnect(profileId){vault.connectionRemove(profileId);return api.status(profileId);},
  settings(profileId,patch){
   const connection=connectionOf(profileId);
   vault.connectionSet(profileId,{provider:connection.provider,key:connection.key,offer:typeof patch.offer==='boolean'?patch.offer:connection.offer,note:typeof patch.note==='boolean'?patch.note:connection.note});
   return api.status(profileId);
  },
  /** Makes one mask for the page's site. -> {id, address, name, enabled} */
  async create(profileId,{url}){
   const connection=connectionOf(profileId),adapter=provider(connection.provider);
   if(!normalizeOrigin(url))throw new MaskError('invalid',tr('pw.mask.err.notHere','A mask can only be made for a website.'));
   const stamps=(made.get(profileId)||[]).filter(at=>now()-at<HOUR);
   if(stamps.length>=PER_HOUR)throw new MaskError('limit',tr('pw.mask.err.local','You’ve made {count} masks in the last hour. Try again a little later.',{count:PER_HOUR}));
   if(busy.has(profileId))throw new MaskError('busy',tr('pw.mask.err.busy','One moment: another request is still running.'));
   busy.add(profileId);
   try{
    const site=connection.note?siteOf(url):'',call=apiFor(profileId,adapter,connection.key);
    const made1=await adapter.create(call,{site});
    stamps.push(now());made.set(profileId,stamps);
    try{const saved=vault.maskAdd(profileId,{origin:url,address:made1.address,provider:adapter.id,remoteId:made1.remoteId,enabled:true});return {id:saved.id,address:made1.address,name:adapter.name,enabled:true};}
    catch(error){try{await adapter.remove(call,made1.remoteId);}catch{}throw error;}// a mask the list can't hold is taken back, not left running
   }finally{busy.delete(profileId);}
  },
  async setEnabled(profileId,id,enabled){
   if(typeof enabled!=='boolean')throw new MaskError('invalid',tr('pw.mask.err.unknownService','Choose one of the listed services.'));
   const mask=vault.masks(profileId).find(item=>item.id===id);if(!mask)throw new MaskError('invalid',tr('pw.vault.missing','That item no longer exists.'));
   const connection=connectionOf(profileId),adapter=provider(mask.provider);
   if(connection.provider!==mask.provider)throw new MaskError('invalid',tr('pw.mask.err.otherService','This mask belongs to another service.'));
   if(busy.has(profileId))throw new MaskError('busy',tr('pw.mask.err.busy','One moment: another request is still running.'));
   busy.add(profileId);
   try{await adapter.setEnabled(apiFor(profileId,adapter,connection.key),mask.remoteId,enabled);vault.maskSet(profileId,id,{enabled});}
   finally{busy.delete(profileId);}
   return api.list(profileId);
  },
  /** Deletes the mask at the service, then in the list. If the service can't be reached, the row stays. */
  async remove(profileId,id){
   const mask=vault.masks(profileId).find(item=>item.id===id);if(!mask)throw new MaskError('invalid',tr('pw.vault.missing','That item no longer exists.'));
   const connection=connectionOf(profileId),adapter=provider(mask.provider);
   if(connection.provider!==mask.provider)throw new MaskError('invalid',tr('pw.mask.err.otherService','This mask belongs to another service.'));
   if(busy.has(profileId))throw new MaskError('busy',tr('pw.mask.err.busy','One moment: another request is still running.'));
   busy.add(profileId);
   try{await adapter.remove(apiFor(profileId,adapter,connection.key),mask.remoteId);vault.maskRemove(profileId,id);}
   finally{busy.delete(profileId);}
   return api.list(profileId);
  },
  /** A mask by id, for filling a field with one made earlier. */
  find(profileId,id){return vault.masks(profileId).find(item=>item.id===id)||null;},
 };
 return api;
}
/** Any error that is not a MaskError (a vault or disk problem, a bug) becomes one calm sentence; the real reason never reaches the person, the page or a log with a key in it. */
const calm=()=>tr('pw.mask.err.generic','Something went wrong, and nothing was changed. Try again.');
module.exports={createMasks,MaskError,siteOf,calm,TIMEOUT_MS,MAX_BODY,PER_HOUR};
