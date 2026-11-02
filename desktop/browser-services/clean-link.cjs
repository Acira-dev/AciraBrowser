'use strict';
const tracking=new Set(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','utm_name','utm_reader','utm_viz_id','utm_pubreferrer','utm_swu','gclid','dclid','fbclid','msclkid','mc_cid','mc_eid']);
const sensitive=new Set(['token','access_token','id_token','code','state','nonce','api_key','apikey','policy','key-pair-id','auth','authorization','hmac','hash','checksum','expires','oauth_signature']);
/** Deliberate copy only. Signed/auth links stay byte-for-byte original. No navigation rewrite. */
function cleanLink(value){if(typeof value!=='string'||value.length>16384)return {url:value,changed:false,removed:[]};let url;try{url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return {url:value,changed:false,removed:[]};}catch{return {url:value,changed:false,removed:[]};}
 const keys=[...url.searchParams.keys()];if(keys.some(key=>sensitive.has(key.toLowerCase())||/(?:^|[_-])(?:sig|signature)(?:$|[_-])/i.test(key))||/\/(?:oauth|authorize|authorization|callback)(?:\/|$)/i.test(url.pathname))return {url:value,changed:false,removed:[],reason:'authentication-or-signed-link'};
 const removed=[];for(const key of keys)if(tracking.has(key.toLowerCase())){url.searchParams.delete(key);if(!removed.includes(key))removed.push(key);}return removed.length?{url:url.href,changed:true,removed}:{url:value,changed:false,removed};
}
module.exports={cleanLink,TRACKING:tracking};
