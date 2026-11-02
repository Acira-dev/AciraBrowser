'use strict';
// chrome.cookies rules that do not need Electron: argument checks, Chrome's cookie shape, filters and ordering.
const STORE_ID='0';
const errors={
 invalidUrl:url=>`Invalid url: "${url}".`,
 invalidStore:id=>`Invalid cookie store id: "${id}".`,
 noHost:url=>`No host permissions for cookies at url: "${url}".`,
 setFailed:name=>`Failed to parse or set cookie named "${name}".`
};

/** The URL as a URL object when it is an http(s) address with a host; throws Chrome's invalid-url error otherwise. */
function parseUrl(value){
 let url;
 try{url=new URL(String(value));}catch{throw new Error(errors.invalidUrl(value));}
 if(!['http:','https:'].includes(url.protocol)||!url.hostname)throw new Error(errors.invalidUrl(value));
 return url;
}
/** storeId is optional; Acira has the profile's one ordinary store, "0". Any other id (a private, Tor or secured store included) is refused. */
function checkStore(storeId){
 if(storeId!==undefined&&storeId!==null&&storeId!==STORE_ID)throw new Error(errors.invalidStore(storeId));
}
const hostOf=cookie=>String(cookie.domain||'').replace(/^\./,'');
/** The address a cookie belongs to, for the host-permission check (Chrome checks the cookie's domain, scheme from `secure`, and path). */
function cookieUrl(cookie){return `${cookie.secure?'https':'http'}://${hostOf(cookie)}${cookie.path||'/'}`;}

/** Electron's cookie as chrome.cookies.Cookie. */
function toChrome(cookie){
 const out={
  name:cookie.name,value:cookie.value,domain:cookie.domain||'',hostOnly:Boolean(cookie.hostOnly),path:cookie.path||'/',
  secure:Boolean(cookie.secure),httpOnly:Boolean(cookie.httpOnly),sameSite:cookie.sameSite||'unspecified',session:Boolean(cookie.session),storeId:STORE_ID
 };
 if(!cookie.session&&typeof cookie.expirationDate==='number')out.expirationDate=cookie.expirationDate;
 return out;
}

const domainMatches=(cookie,domain)=>{
 const wanted=String(domain).replace(/^\./,'').toLowerCase(),have=hostOf(cookie).toLowerCase();
 return have===wanted||have.endsWith('.'+wanted);
};
/** getAll's own filters (Electron already matched `url`). */
function matches(cookie,details){
 if(details.name!==undefined&&cookie.name!==details.name)return false;
 if(details.domain!==undefined&&!domainMatches(cookie,details.domain))return false;
 if(details.path!==undefined&&(cookie.path||'/')!==details.path)return false;
 if(details.secure!==undefined&&Boolean(cookie.secure)!==details.secure)return false;
 if(details.session!==undefined&&Boolean(cookie.session)!==details.session)return false;
 return true;
}
/** Chrome returns the cookies a request would send: longer paths first (a stable sort keeps Electron's order for equal paths). */
const order=cookies=>cookies.map((cookie,index)=>({cookie,index})).sort((a,b)=>(b.cookie.path||'/').length-(a.cookie.path||'/').length||a.index-b.index).map(item=>item.cookie);

/** chrome.cookies.set's details as Electron's cookies.set() details. */
function toElectron(details,url){
 const out={url:url.href,name:details.name===undefined?'':details.name,value:details.value===undefined?'':details.value};
 if(details.domain!==undefined)out.domain=details.domain;
 if(details.path!==undefined)out.path=details.path;
 if(details.secure!==undefined)out.secure=details.secure;
 if(details.httpOnly!==undefined)out.httpOnly=details.httpOnly;
 if(details.expirationDate!==undefined)out.expirationDate=details.expirationDate;
 if(details.sameSite!==undefined)out.sameSite=details.sameSite;
 return out;
}
// Electron says 'inserted' for a cookie that was set (and 'unknown-deletion' for a removal it cannot explain); Chrome's OnChangedCause has neither: both are 'explicit'.
const CAUSES={'expired-overwrite':'expired_overwrite',overwrite:'overwrite',expired:'expired',evicted:'evicted',explicit:'explicit'};
const cause=value=>CAUSES[value]||'explicit';

module.exports={STORE_ID,errors,parseUrl,checkStore,cookieUrl,hostOf,toChrome,matches,order,toElectron,cause};
