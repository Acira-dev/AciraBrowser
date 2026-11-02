'use strict';
// Chrome match patterns (extensions/common/url_pattern.cc) for webRequest filters and host access: <scheme>://<host><path>, '<all_urls>'.
//  - scheme '*' means http, https, ws or wss; host '*', '*.example.com' (the domain and its subdomains) or an exact host, optional :port
//    (no port in the pattern = any port); the path glob is matched against path + query.
// A request URL is parsed once (urlParts) and then tested against any number of compiled patterns.
const SCHEMES=new Set(['http','https','ws','wss','ftp','file','urn','chrome-extension','about','filesystem','uuid-in-package']);
const WILD=new Set(['http','https','ws','wss']);

/** {scheme, host, port, pathq, origin} of a URL, or null. */
function urlParts(url){
 if(typeof url!=='string')return null;
 let u;try{u=new URL(url);}catch{return null;}
 const scheme=u.protocol.slice(0,-1).toLowerCase();
 return {href:u.href,scheme,host:u.hostname.toLowerCase(),port:u.port,pathq:(u.pathname||'/')+u.search,origin:u.origin};
}

const {globTester}=require('../../glob-match.cjs');
const glob=text=>globTester(text);   // linear time: a pattern with many stars cannot freeze the main process

/** A matcher for one pattern (parts => boolean), or null when the pattern is not a valid match pattern. */
function compilePattern(pattern){
 if(typeof pattern!=='string')return null;
 if(pattern==='<all_urls>')return parts=>!!parts&&SCHEMES.has(parts.scheme);
 const m=/^([a-z*][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(pattern);
 if(!m)return null;
 const scheme=m[1].toLowerCase();
 if(scheme!=='*'&&!SCHEMES.has(scheme))return null;
 let hostPort=m[2],path=m[3];
 if(path===undefined){if(scheme==='file'||scheme==='about')return null;return null;}
 let host=hostPort,port=null;
 const portMatch=/^(\[[^\]]*\]|[^:]*)(?::(\*|\d{1,5}))?$/.exec(hostPort);
 if(!portMatch)return null;
 host=portMatch[1].toLowerCase();port=portMatch[2]===undefined||portMatch[2]==='*'?null:portMatch[2];
 if(scheme==='file'){if(host&&host!=='*'&&host!=='localhost')return null;host='';}
 else if(!host)return null;
 if(host.includes('*')&&host!=='*'&&!(host.startsWith('*.')&&!host.slice(2).includes('*')))return null;
 const pathTest=path==='/*'?null:glob(path);
 const anyHost=host==='*'||scheme==='file',suffix=host.startsWith('*.')?host.slice(2):null;
 return parts=>{
  if(!parts)return false;
  if(scheme==='*'?!WILD.has(parts.scheme):parts.scheme!==scheme)return false;
  if(!anyHost){
   if(suffix!==null){if(parts.host!==suffix&&!parts.host.endsWith('.'+suffix))return false;}
   else if(parts.host!==host)return false;
  }
  if(port!==null&&parts.port!==port&&!(parts.port===''&&defaultPort(parts.scheme)===port))return false;
  return pathTest===null||pathTest.test(parts.pathq);
 };
}
const defaultPort=scheme=>({http:'80',https:'443',ws:'80',wss:'443',ftp:'21'})[scheme]||'';

/** A matcher for a list of patterns; invalid entries are dropped (use compilePattern to report them). */
function compileList(patterns){
 const list=(Array.isArray(patterns)?patterns:[]).map(compilePattern).filter(Boolean);
 if(!list.length)return ()=>false;
 return parts=>{for(const test of list)if(test(parts))return true;return false;};
}

module.exports={urlParts,compilePattern,compileList,SCHEMES};
