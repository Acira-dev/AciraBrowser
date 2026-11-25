'use strict';
// The three email-mask services Acira can connect to with the person's OWN API key (desktop/passwords/masks.cjs is the service that calls
// them). Each adapter is a few calls: check a key, make one mask, turn one on or off, delete one. Nothing here touches the network itself:
// `api({method, path, query, body, expect})` is handed in (masks.cjs builds it: fixed HTTPS host, the key in the auth header, no redirects,
// a size and time cap) and returns {status, body}. Request and response shapes follow each service's public API documentation (see
// the design notes for the pages and dates); they have only been run against a local stand-in (tests/passwords-masks.test.cjs).
// Whatever a service sends back is untrusted: an address must look like an address, an id must look like that service's ids (it ends up in a
// URL path), and error text is cut and stripped before anyone reads it.
const {tr}=require('./text.cjs');

class MaskError extends Error{
 /** code: auth | limit | refused | network | unavailable | unexpected | invalid | busy | notConnected */
 constructor(code,message,status=0){super(message);this.name='MaskError';this.code=code;this.status=status;}
}
const ADDRESS=/^[A-Za-z0-9._%+'=-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const unexpected=name=>new MaskError('unexpected',tr('pw.mask.err.unexpected','{service} sent an answer Acira didn’t expect.',{service:name}));
const address=(value,name)=>{if(typeof value!=='string'||value.length>254||value.includes('..')||!ADDRESS.test(value))throw unexpected(name);return value;};
const idChecker=(pattern,name)=>value=>{const text=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;if(typeof text!=='string'||!pattern.test(text))throw unexpected(name);return text;};
/** Plain text from a service's error body: control characters and angle brackets out, 160 characters at most. */
const reason=body=>{const raw=body&&typeof body==='object'?(body.error??body.detail??body.message):null;return typeof raw==='string'?raw.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,160):'';};

const SIMPLELOGIN={
 id:'simplelogin',name:'SimpleLogin',host:'app.simplelogin.io',keyPage:'https://app.simplelogin.io/dashboard/api_key',
 headers:key=>({Authentication:key}),
 async verify(api){const out=await api({method:'GET',path:'/api/user_info'});if(!out.body||typeof out.body!=='object')throw unexpected(SIMPLELOGIN.name);},
 async create(api,{site}){
  const out=await api({method:'POST',path:'/api/alias/random/new',query:{mode:'word',...(site?{hostname:site}:{})},body:site?{note:site}:{},expect:[200,201]});
  const id=idChecker(/^\d{1,12}$/,SIMPLELOGIN.name);return {address:address(out.body?.email,SIMPLELOGIN.name),remoteId:id(out.body?.id)};
 },
 async setEnabled(api,remoteId,enabled){
  const id=idChecker(/^\d{1,12}$/,SIMPLELOGIN.name)(remoteId);
  const now=await api({method:'GET',path:`/api/aliases/${id}`});if(typeof now.body?.enabled!=='boolean')throw unexpected(SIMPLELOGIN.name);
  if(now.body.enabled===enabled)return;
  const out=await api({method:'POST',path:`/api/aliases/${id}/toggle`});if(out.body?.enabled!==enabled)throw unexpected(SIMPLELOGIN.name);
 },
 async remove(api,remoteId){await api({method:'DELETE',path:`/api/aliases/${idChecker(/^\d{1,12}$/,SIMPLELOGIN.name)(remoteId)}`,expect:[200,403,404]});},// SimpleLogin answers 403 for an alias that is not this key's (deleted there, or made with another account's key): it is gone for this key
};

const ADDY_FORMATS=new Set(['random_characters','uuid','random_words','random_male_name','random_female_name','random_noun']);
const ADDY={
 id:'addy',name:'addy.io',host:'app.addy.io',keyPage:'https://app.addy.io/settings/api',
 headers:key=>({Authorization:`Bearer ${key}`,'X-Requested-With':'XMLHttpRequest'}),
 async verify(api){const out=await api({method:'GET',path:'/api/v1/api-token-details'});if(!out.body||typeof out.body!=='object')throw unexpected(ADDY.name);},
 async create(api,{site}){
  const options=(await api({method:'GET',path:'/api/v1/domain-options'})).body||{};
  const domain=[options.defaultAliasDomain,...(Array.isArray(options.data)?options.data:[])].find(value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9.-]{2,252}$/.test(value));
  if(!domain)throw unexpected(ADDY.name);
  const format=ADDY_FORMATS.has(options.defaultAliasFormat)?options.defaultAliasFormat:'random_words';// the person's own account setting, never 'custom'
  const out=await api({method:'POST',path:'/api/v1/aliases',body:{domain,format,...(site?{description:site}:{})},expect:[200,201]});
  const data=out.body?.data;return {address:address(data?.email,ADDY.name),remoteId:idChecker(/^[0-9a-f-]{36}$/i,ADDY.name)(data?.id)};
 },
 async setEnabled(api,remoteId,enabled){
  const id=idChecker(/^[0-9a-f-]{36}$/i,ADDY.name)(remoteId);
  if(enabled)await api({method:'POST',path:'/api/v1/active-aliases',body:{id},expect:[200,201]});
  else await api({method:'DELETE',path:`/api/v1/active-aliases/${id}`,expect:[200,204,404]});
 },
 async remove(api,remoteId){await api({method:'DELETE',path:`/api/v1/aliases/${idChecker(/^[0-9a-f-]{36}$/i,ADDY.name)(remoteId)}`,expect:[200,204,404]});},
};

/** Firefox Relay's `description` holds 64 characters at most (its serializer), so a long host is cut for that field only; `generated_for` keeps the whole host. */
const RELAY={
 id:'relay',name:'Firefox Relay',host:'relay.firefox.com',keyPage:'https://relay.firefox.com/accounts/settings/',
 headers:key=>({Authorization:`Token ${key}`}),
 // the list can be long (every mask the account has): only its status is wanted, so its body is never read
 async verify(api){const out=await api({method:'GET',path:'/api/v1/relayaddresses/',peek:true,expect:[200]});if(out.status!==200)throw unexpected(RELAY.name);},
 async create(api,{site}){
  const out=await api({method:'POST',path:'/api/v1/relayaddresses/',body:{enabled:true,...(site?{description:site.slice(0,64),generated_for:site}:{})},expect:[200,201]});
  return {address:address(out.body?.full_address,RELAY.name),remoteId:idChecker(/^\d{1,12}$/,RELAY.name)(out.body?.id)};
 },
 async setEnabled(api,remoteId,enabled){
  const id=idChecker(/^\d{1,12}$/,RELAY.name)(remoteId);
  const out=await api({method:'PATCH',path:`/api/v1/relayaddresses/${id}/`,body:{enabled}});if(out.body&&typeof out.body.enabled==='boolean'&&out.body.enabled!==enabled)throw unexpected(RELAY.name);
 },
 async remove(api,remoteId){await api({method:'DELETE',path:`/api/v1/relayaddresses/${idChecker(/^\d{1,12}$/,RELAY.name)(remoteId)}/`,expect:[200,204,404]});},
};

/** In the order the Settings picker shows them (alphabetical; none is preferred). */
const PROVIDERS=Object.freeze({addy:ADDY,relay:RELAY,simplelogin:SIMPLELOGIN});
module.exports={PROVIDERS,MaskError,reason,address};
