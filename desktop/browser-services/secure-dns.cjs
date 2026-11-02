'use strict';
const configured=new WeakSet();
function secureDNSChoice(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['mode','servers'].includes(key))||!['system','off','secure'].includes(value.mode)||!Array.isArray(value.servers)||value.servers.length>4||value.mode==='secure'&&!value.servers.length||value.mode!=='secure'&&value.servers.length)throw new Error('Choose system DNS, disabled secure DNS, or strict secure DNS with one to four HTTPS endpoints.');
 const servers=[...new Set(value.servers.map(value=>{
  if(typeof value!=='string'||!value.length||value.length>2048||/[\s\u0000-\u001f\u007f]/u.test(value))throw new Error('Enter a bounded HTTPS DNS endpoint.');
  const get=value.endsWith('{?dns}'),base=get?value.slice(0,-6):value;if(/[{}]/.test(base))throw new Error('Only a trailing {?dns} GET template or a plain POST endpoint is supported.');
  let url;try{url=new URL(base);}catch{throw new Error('Enter a valid HTTPS DNS endpoint.');}if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw new Error('Secure DNS endpoints must use HTTPS without credentials, a fixed query or a fragment.');
  return url.href+(get?'{?dns}':'');
 }))];return {mode:value.mode,servers};
}
function configureSecureDNS({app,choice={mode:'system',servers:[]},platform=process.platform}){
 const checked=secureDNSChoice(choice);if(!app?.isReady?.())throw new Error('Configure Secure DNS after app.ready and before any browsing or native network request.');if(typeof app.configureHostResolver!=='function')throw new Error('This native runtime has no supported Secure DNS resolver API.');if(configured.has(app))throw new Error('Secure DNS is an application startup choice. Save changes for a restart.');
 const native={enableBuiltInResolver:checked.mode==='secure'||platform==='darwin',secureDnsMode:checked.mode==='system'?'automatic':checked.mode==='secure'?'secure':'off',secureDnsServers:checked.servers};
 configured.add(app);app.configureHostResolver(native);return {configured:true,scope:'application',startupOnly:true,choice:checked,nativeOptions:native,queriesVerified:false};
}
module.exports={secureDNSChoice,configureSecureDNS};
