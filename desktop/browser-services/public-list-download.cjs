'use strict';
/**
 * Native transport in the caller's persistent proxy context; never sends site credentials or cookies.
 * With `etag` / `lastModified` from an earlier download of the same address it asks the server only for a newer copy: status 304 means nothing changed and nothing was sent.
 * Resolves {status, text, etag, lastModified}; text is '' for 304.
 */
function downloadListIfChanged(url,session,{etag,lastModified,maxBytes=12*1024*1024,timeoutMs=30000,work=require('./background-work.cjs').shared(),net=require('electron').net}={}){
 const start=new URL(url);if(start.protocol!=='https:'||start.username||start.password)throw new Error('Filter delivery requires an ordinary HTTPS endpoint.');
 /* 13.8 (background-work.cjs): Acira's own scheduled download starts nothing once the quit has begun, and the one in flight is aborted at once: it is a tracked request of the profile's pipeline that the exit cleanup would otherwise wait for. */
 if(!work.allowed())return Promise.reject(require('./background-work.cjs').closing());
 return new Promise((resolve,reject)=>{const request=net.request({url:start.href,session,redirect:'manual',credentials:'omit',useSessionCookies:false}),chunks=[],signal=work.signal();let size=0,hops=0,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',stop);error?reject(error):resolve(value);};
  const stop=()=>{finish(require('./background-work.cjs').closing());try{request.abort();}catch{}};
  const timer=setTimeout(()=>{finish(new Error('Filter delivery timed out.'));request.abort();},timeoutMs);timer.unref?.();/* a download's limit never keeps the process alive */signal.addEventListener('abort',stop,{once:true});
  if(typeof etag==='string'&&etag)request.setHeader('If-None-Match',etag);
  if(typeof lastModified==='string'&&lastModified)request.setHeader('If-Modified-Since',lastModified);
  request.on('redirect',(_status,_method,value)=>{try{const target=new URL(value);if(++hops>3||target.origin!==start.origin||target.username||target.password)throw new Error('Unexpected filter delivery redirect.');request.followRedirect();}catch(error){finish(error);request.abort();}});
  request.on('response',response=>{const header=name=>{const value=response.headers[name];const text=Array.isArray(value)?value[0]:value;return typeof text==='string'&&text.length<=256?text:undefined;};
   if(response.statusCode===304){finish(null,{status:304,text:'',etag:header('etag')||etag,lastModified:header('last-modified')||lastModified});response.on('data',()=>{});return;}
   if(response.statusCode!==200){finish(new Error('Filter source returned HTTP'+response.statusCode+'.'));request.abort();return;}const declared=Number(response.headers['content-length']?.[0]||0);if(declared>maxBytes){finish(new Error('Filter source exceeds the size limit.'));request.abort();return;}response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){finish(new Error('Filter source exceeds the size limit.'));request.abort();return;}chunks.push(chunk);});response.on('end',()=>finish(null,{status:200,text:Buffer.concat(chunks).toString('utf8'),etag:header('etag'),lastModified:header('last-modified')}));response.on('error',error=>finish(error));});
  request.on('error',error=>finish(error));request.end();
 });
}
/** The text of an address, whatever it says (used by the release scripts' counterpart and older callers). */
function downloadList(url,session,options){return downloadListIfChanged(url,session,{...options,etag:undefined,lastModified:undefined}).then(result=>result.text);}
module.exports={downloadList,downloadListIfChanged};
