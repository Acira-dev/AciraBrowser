'use strict';
// Moat: "Request a bridge" from the Tor Project when Tor itself is blocked (Tor Browser 15: Moat.sys.mjs, DomainFrontedRequests.sys.mjs,
// prefs extensions.torlauncher.moat_service / bridgedb_targets). No account and no secret: the Tor Project's BridgeDB hands out a
// few obfs4 bridges to whoever solves its CAPTCHA. Reaching it must work on a network that blocks Tor, so the request is domain
// fronted exactly as Tor Browser does it: the bundled, pinned lyrebird runs as a managed meek_lite client (PT spec v1), the
// reflector and front domains go to it as SOCKS5 credentials ("targets=…"), and the HTTPS request to bridges.torproject.org travels
// inside that tunnel (TLS end to end with bridges.torproject.org; the network sees a TLS connection to the CDN front only).
// Nothing here touches tor, and no site's data: one POST per step, JSON in and out, the process stopped when done.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),tls=require('node:tls'),{spawn}=require('node:child_process');

// Tor Browser 15.0.25 defaults (browser-omni/defaults/preferences/000-tor-browser.js).
const MOAT_SERVICE='https://bridges.torproject.org/moat',MOAT_TARGETS='https://1723079976.rsc.cdn77.org|cdn.zk.mk+www.cdn77.com';
const START_TIMEOUT=20000,REQUEST_TIMEOUT=120000,IDLE_STOP=300000,MAX_RESPONSE=4*1024*1024;

/** SOCKS5 credentials carrying meek's per-connection argument (PT spec 3.5 escaping), as Tor Browser's makeMeekCredentials. */
function meekCredentials(targets=MOAT_TARGETS){
 const escaped='targets='+targets.replaceAll('\\','\\\\').replaceAll('=','\\=').replaceAll(';','\\;');
 return escaped.length<=255?[escaped,'\x00']:[escaped.slice(0,255),escaped.slice(255)];
}
/** "CMETHOD meek_lite socks5 127.0.0.1:port" from a managed client's stdout (PT spec 3.3.3). */
function parseCmethods(text){
 const out={version:null,port:0,error:null,done:false};
 for(const line of String(text).split(/\r?\n/)){const [keyword,...args]=line.trim().split(' ');
  if(keyword==='VERSION')out.version=args[0];else if(keyword==='VERSION-ERROR'||keyword==='ENV-ERROR'||keyword==='CMETHOD-ERROR')out.error=line.trim();
  else if(keyword==='CMETHOD'&&args[0]==='meek_lite'&&args[1]==='socks5'){const m=/^127\.0\.0\.1:(\d{1,5})$/.exec(args[2]||'');if(m)out.port=Number(m[1]);}
  else if(keyword==='CMETHODS'&&args[0]==='DONE')out.done=true;}
 return out;
}
/** Body of an HTTP/1.1 response (Content-Length or chunked), with its status. */
function parseHttpResponse(buffer){
 const head=buffer.indexOf('\r\n\r\n');if(head<0)throw new Error('Moat answered without headers.');
 const lines=buffer.subarray(0,head).toString('latin1').split('\r\n'),status=Number(/^HTTP\/1\.[01] (\d{3})/.exec(lines[0])?.[1]||0);
 const headers=Object.fromEntries(lines.slice(1).map(l=>{const i=l.indexOf(':');return [l.slice(0,i).trim().toLowerCase(),l.slice(i+1).trim()];}));
 let body=buffer.subarray(head+4);
 if(/chunked/i.test(headers['transfer-encoding']||'')){const parts=[];let at=0;for(;;){const end=body.indexOf('\r\n',at);if(end<0)break;const size=parseInt(body.subarray(at,end).toString('latin1'),16);if(!size)break;parts.push(body.subarray(end+2,end+2+size));at=end+2+size+2;}body=Buffer.concat(parts);}
 else if(headers['content-length'])body=body.subarray(0,Number(headers['content-length']));
 return {status,headers,body:body.toString('utf8')};
}

function createTorMoat({userData,transports,pins,verify,platform=process.platform,spawnClient=spawn,log=()=>{},service=MOAT_SERVICE,targets=MOAT_TARGETS,timeouts={}}){
 const limits={start:START_TIMEOUT,request:REQUEST_TIMEOUT,idle:IDLE_STOP,...timeouts};
 let client=null,idleTimer=null;
 function stop(){clearTimeout(idleTimer);idleTimer=null;const c=client;client=null;if(c?.proc&&c.proc.exitCode===null){try{c.proc.stdin?.end();}catch{}const t=setTimeout(()=>{try{c.proc.kill();}catch{}},3000);t.unref?.();}}
 /** The managed meek_lite client: started once (pinned lyrebird only), stopped after a few idle minutes. */
 async function meekPort(){
  clearTimeout(idleTimer);idleTimer=setTimeout(stop,limits.idle);idleTimer.unref?.();
  if(client)return client.ready;
  const dir=transports(),name=platform==='darwin'?'lyrebird':'lyrebird.exe',exe=dir&&path.join(dir,name);
  if(!exe||!fs.existsSync(exe))throw Object.assign(new Error('The bridge program is missing from this install.'),{code:'transports'});
  if(!pins()[name]||!await verify(exe,pins()[name]))throw Object.assign(new Error('The bridge program failed its integrity check.'),{code:'integrity'});
  const state=path.join(userData,'tor','moat-pt-state');fs.mkdirSync(state,{recursive:true});
  const proc=spawnClient(exe,[],{cwd:dir,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,TOR_PT_MANAGED_TRANSPORT_VER:'1',TOR_PT_STATE_LOCATION:state,TOR_PT_EXIT_ON_STDIN_CLOSE:'1',TOR_PT_CLIENT_TRANSPORTS:'meek_lite'}});
  const entry={proc,ready:null};client=entry;
  entry.ready=new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>{reject(new Error('The bridge program did not start.'));stop();},limits.start);
   proc.stdout.on('data',chunk=>{out+=chunk.toString('latin1');const parsed=parseCmethods(out);if(parsed.error){clearTimeout(timer);reject(new Error(parsed.error));stop();}else if(parsed.done){clearTimeout(timer);parsed.port?resolve(parsed.port):(reject(new Error('The bridge program offered no meek client.')),stop());}});
   proc.stderr?.on('data',chunk=>log('Moat lyrebird: '+String(chunk).trim().slice(0,200)));
   proc.once('error',error=>{clearTimeout(timer);reject(error);if(client===entry)client=null;});
   proc.once('exit',()=>{clearTimeout(timer);reject(new Error('The bridge program stopped.'));if(client===entry)client=null;});});
  entry.ready.catch(()=>{});
  return entry.ready;
 }
 /** One domain-fronted POST to Moat: SOCKS5 to lyrebird with the meek targets, TLS to bridges.torproject.org inside it. */
 async function post(procedure,args){
  const port=await meekPort(),url=new URL(service+'/'+procedure),[user,pass]=meekCredentials(targets),body=Buffer.from(JSON.stringify(args));
  return await new Promise((resolve,reject)=>{
   const socket=net.connect({host:'127.0.0.1',port});let stage='greet',buf=Buffer.alloc(0),done=false;
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);};
   const timer=setTimeout(()=>finish(new Error('The Tor Project did not answer in time.')),limits.request);
   socket.on('error',error=>finish(error));socket.on('connect',()=>socket.write(Buffer.from([5,1,2])));
   socket.on('data',function onData(chunk){buf=Buffer.concat([buf,chunk]);
    if(stage==='greet'&&buf.length>=2){if(buf[1]!==2)return finish(new Error('The bridge program refused the request.'));buf=buf.subarray(2);const u=Buffer.from(user,'latin1'),p=Buffer.from(pass,'latin1');socket.write(Buffer.concat([Buffer.from([1,u.length]),u,Buffer.from([p.length]),p]));stage='auth';}
    if(stage==='auth'&&buf.length>=2){if(buf[1]!==0)return finish(new Error('The bridge program refused the request.'));buf=buf.subarray(2);const h=Buffer.from(url.hostname);socket.write(Buffer.concat([Buffer.from([5,1,0,3,h.length]),h,Buffer.from([1,187])]));stage='connect';}
    if(stage==='connect'&&buf.length>=10){if(buf[1]!==0)return finish(new Error('The Tor Project could not be reached (code '+buf[1]+').'));stage='tls';socket.removeListener('data',onData);
     const secure=tls.connect({socket,servername:url.hostname,ALPNProtocols:['http/1.1']},()=>secure.write(Buffer.concat([Buffer.from(`POST ${url.pathname} HTTP/1.1\r\nHost: ${url.hostname}\r\nContent-Type: application/vnd.api+json\r\nContent-Length: ${body.length}\r\nConnection: close\r\nUser-Agent: Mozilla/5.0\r\n\r\n`,'latin1'),body])));
     let response=Buffer.alloc(0);secure.on('data',d=>{response=Buffer.concat([response,d]);if(response.length>MAX_RESPONSE)finish(new Error('Moat answered too much.'));});
     secure.on('error',error=>finish(error));secure.on('end',()=>{try{const r=parseHttpResponse(response);if(r.status!==200)return finish(new Error('The Tor Project answered '+r.status+'.'));finish(null,JSON.parse(r.body));}catch(error){finish(error);}});}
   });
  });
 }
 const moatError=response=>{const e=response?.errors?.[0];return e?Object.assign(new Error(String(e.detail||'Moat refused the request.')),{code:Number(e.code)||0}):null;};
 return {
  /** A CAPTCHA for obfs4 bridges (Tor Browser asks for obfs4): {transport, image (base64 JPEG), challenge}. */
  async fetch(){
   const response=await post('fetch',{data:[{version:'0.1.0',type:'client-transports',supported:['obfs4']}]});const error=moatError(response);if(error)throw error;
   const item=response?.data?.[0];if(!item||typeof item.image!=='string'||typeof item.challenge!=='string')throw new Error('Moat sent no CAPTCHA.');
   return {transport:String(item.transport||'obfs4'),image:item.image,challenge:item.challenge};
  },
  /** The person's answer: bridge lines, or null when the answer was wrong (Moat code 419). */
  async check({transport='obfs4',challenge,solution}){
   const response=await post('check',{data:[{id:'2',version:'0.1.0',type:'moat-solution',transport,challenge,solution,qrcode:'false'}]});
   const error=moatError(response);if(error){if(error.code===419)return null;throw error;}
   const lines=response?.data?.[0]?.bridges;if(!Array.isArray(lines)||!lines.length)throw new Error('Moat sent no bridges.');return lines.map(String);
  },
  /** Tor Browser's "built-in bridges, latest copy" call (no CAPTCHA): proves the fronted channel works end to end. */
  async builtin(transportsWanted=['obfs4']){const response=await post('circumvention/builtin',{transports:transportsWanted});const error=moatError(response);if(error)throw error;return response;},
  stop,
 };
}
module.exports={createTorMoat,meekCredentials,parseCmethods,parseHttpResponse,TOR_MOAT_SERVICE:MOAT_SERVICE,TOR_MOAT_TARGETS:MOAT_TARGETS};
