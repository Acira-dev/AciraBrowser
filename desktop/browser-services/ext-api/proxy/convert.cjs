'use strict';
// chrome.proxy.ProxyConfig <-> Electron's session.setProxy() config. Pure functions; no Electron.
//   validate(config)   -> a normalized copy, or throws Error (the message the extension sees)
//   toElectron(config) -> {mode, pacScript?, proxyRules?, proxyBypassRules?}
// Modes: direct, auto_detect, pac_script, fixed_servers, system (Chromium's proxy.Mode). `pacScript.mandatory` has no Electron
// counterpart (Chromium's net stack decides what a failing PAC script does); it is kept in the value and ignored when applying.
const MODES=['direct','auto_detect','pac_script','fixed_servers','system'];
const SCHEMES=['http','https','quic','socks4','socks5'];
const SPECIFIC=['proxyForHttp','proxyForHttps','proxyForFtp','fallbackProxy'];
const MAX_PAC_BYTES=1024*1024,MAX_BYPASS=1000;
const fail=message=>{throw new Error(message);};

function plainObject(value,name){
 if(!value||typeof value!=='object'||Array.isArray(value))fail(`Invalid proxy configuration: '${name}' must be an object.`);
 return value;
}
function server(value,name){
 plainObject(value,name);
 const out={scheme:'http'};
 if(value.scheme!==undefined){if(!SCHEMES.includes(value.scheme))fail(`Invalid proxy server: '${name}.scheme' must be one of ${SCHEMES.map(item=>`"${item}"`).join(', ')}.`);out.scheme=value.scheme;}
 const host=value.host;
 if(typeof host!=='string'||!host||host.length>253||!(/^[A-Za-z0-9._-]+$/.test(host)||/^\[[0-9A-Fa-f:.]+\]$/.test(host)))fail(`Invalid proxy server: '${name}.host' must be a host name or IP address.`);
 out.host=host.toLowerCase();
 if(value.port!==undefined){if(!Number.isInteger(value.port)||value.port<1||value.port>65535)fail(`Invalid proxy server: '${name}.port' must be an integer from 1 to 65535.`);out.port=value.port;}
 return out;
}
const uri=item=>`${item.scheme}://${item.host}${item.port===undefined?'':':'+item.port}`;

function rules(value){
 plainObject(value,'rules');
 const out={};
 const known=['singleProxy',...SPECIFIC,'bypassList'];
 for(const key of Object.keys(value))if(!known.includes(key))fail(`Invalid proxy configuration: unknown property 'rules.${key}'.`);
 if(value.singleProxy!==undefined){
  if(SPECIFIC.some(key=>value[key]!==undefined))fail("Invalid proxy configuration: 'singleProxy' cannot be combined with a proxy for one protocol.");
  out.singleProxy=server(value.singleProxy,'rules.singleProxy');
 }
 for(const key of SPECIFIC)if(value[key]!==undefined)out[key]=server(value[key],`rules.${key}`);
 if(out.singleProxy===undefined&&!SPECIFIC.some(key=>out[key]!==undefined))fail("Invalid proxy configuration: 'rules' needs a proxy server.");
 if(value.bypassList!==undefined){
  if(!Array.isArray(value.bypassList)||value.bypassList.length>MAX_BYPASS)fail("Invalid proxy configuration: 'rules.bypassList' must be a list of strings.");
  out.bypassList=value.bypassList.map(entry=>{
   if(typeof entry!=='string'||!entry||entry.length>255||/[\s,;\u0000-\u001f]/.test(entry))fail("Invalid proxy configuration: 'rules.bypassList' entries are host patterns such as \"*.example.com\", \"<local>\" or \"10.0.0.0/8\".");
   return entry;
  });
 }
 return out;
}

function pacScript(value){
 plainObject(value,'pacScript');
 const out={};
 for(const key of Object.keys(value))if(!['url','data','mandatory'].includes(key))fail(`Invalid proxy configuration: unknown property 'pacScript.${key}'.`);
 const hasUrl=value.url!==undefined,hasData=value.data!==undefined;
 if(hasUrl===hasData)fail("Invalid proxy configuration: 'pacScript' needs exactly one of 'url' and 'data'.");
 if(hasUrl){
  let parsed;try{parsed=new URL(String(value.url));}catch{fail("Invalid proxy configuration: 'pacScript.url' is not a URL.");}
  if(typeof value.url!=='string'||!['http:','https:','file:','data:'].includes(parsed.protocol))fail("Invalid proxy configuration: 'pacScript.url' must be an http, https, file or data URL.");
  out.url=value.url;
 }else{
  if(typeof value.data!=='string'||!value.data||Buffer.byteLength(value.data)>MAX_PAC_BYTES)fail("Invalid proxy configuration: 'pacScript.data' must be a script of at most 1 MB.");
  out.data=value.data;
 }
 if(value.mandatory!==undefined&&typeof value.mandatory!=='boolean')fail("Invalid proxy configuration: 'pacScript.mandatory' must be a boolean.");
 out.mandatory=value.mandatory===true;
 return out;
}

function validate(config){
 plainObject(config,'value');
 for(const key of Object.keys(config))if(!['mode','rules','pacScript'].includes(key))fail(`Invalid proxy configuration: unknown property '${key}'.`);
 if(!MODES.includes(config.mode))fail(`Invalid proxy configuration: 'mode' must be one of ${MODES.map(item=>`"${item}"`).join(', ')}.`);
 const out={mode:config.mode};
 if(config.mode==='fixed_servers'){
  if(config.rules===undefined)fail("Invalid proxy configuration: mode \"fixed_servers\" needs 'rules'.");
  if(config.pacScript!==undefined)fail("Invalid proxy configuration: mode \"fixed_servers\" does not take 'pacScript'.");
  out.rules=rules(config.rules);
 }else if(config.mode==='pac_script'){
  if(config.pacScript===undefined)fail("Invalid proxy configuration: mode \"pac_script\" needs 'pacScript'.");
  if(config.rules!==undefined)fail("Invalid proxy configuration: mode \"pac_script\" does not take 'rules'.");
  out.pacScript=pacScript(config.pacScript);
 }else if(config.rules!==undefined||config.pacScript!==undefined)fail(`Invalid proxy configuration: mode "${config.mode}" takes no 'rules' or 'pacScript'.`);
 return out;
}

/** Chromium's proxy-rules string: one server for everything, or `http=…;https=…;ftp=…;socks=…` (the fallback proxy is the "socks" entry). */
function proxyRules(rulesValue){
 if(rulesValue.singleProxy)return uri(rulesValue.singleProxy);
 const parts=[];
 if(rulesValue.proxyForHttp)parts.push('http='+uri(rulesValue.proxyForHttp));
 if(rulesValue.proxyForHttps)parts.push('https='+uri(rulesValue.proxyForHttps));
 if(rulesValue.proxyForFtp)parts.push('ftp='+uri(rulesValue.proxyForFtp));
 if(rulesValue.fallbackProxy)parts.push('socks='+uri(rulesValue.fallbackProxy));
 return parts.join(';');
}

function toElectron(config){
 const value=validate(config);
 switch(value.mode){
  case 'fixed_servers':return {mode:'fixed_servers',proxyRules:proxyRules(value.rules),proxyBypassRules:(value.rules.bypassList||[]).join(',')};
  case 'pac_script':return {mode:'pac_script',pacScript:value.pacScript.url||`data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(value.pacScript.data,'utf8').toString('base64')}`};
  default:return {mode:value.mode};
 }
}

/** A script that does not compile can never work: the extension is told with proxy.onProxyError (Chromium: net::ERR_PAC_SCRIPT_FAILED). */
function pacSyntaxError(config){
 const data=config&&config.pacScript&&config.pacScript.data;
 if(typeof data!=='string')return null;
 try{new (require('node:vm').Script)(data,{filename:'proxy.pac'});return null;}catch(error){return String(error&&error.message||error).slice(0,512);}
}

module.exports={validate,toElectron,proxyRules,pacSyntaxError,MODES,SCHEMES};
