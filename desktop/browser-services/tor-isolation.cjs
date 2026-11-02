'use strict';
// Per-site Tor circuits (Tor Browser's first-party circuit isolation, TorDomainIsolator.sys.mjs in Tor Browser 15):
// every stream is sent to tor with SOCKS5 username = the first-party site (the address-bar site) and password = a nonce for
// that site, so tor (IsolateSOCKSAuth, on by default; KeepAliveIsolateSOCKSAuth keeps them warm) puts each site on its own
// circuit, third-party requests ride the circuit of the site that made them, and "New Tor circuit for this site" only has to
// change one nonce. Chromium cannot send SOCKS credentials, so each Tor session talks to a small relay on 127.0.0.1 here: the
// relay accepts Chromium's no-auth SOCKS5 CONNECT, looks up which site asked for that host (recorded from the session's own
// request pipeline a moment earlier), and replays the CONNECT to tor's SOCKS port with the credentials. Host names pass
// through unresolved (socks5h): the relay never resolves anything and never connects anywhere but tor's SOCKS port.
const net=require('node:net'),crypto=require('node:crypto');
const {getDomain}=require('tldts');

// Requests with no site of their own (a service worker's fetch, a request the pipeline never saw) share a catch-all
// circuit that is renewed every 10 minutes (Tor Browser's CATCHALL_DOMAIN "--unknown--", CATCHALL_MAX_LIFETIME 600 s).
const CATCHALL='--unknown--',CATCHALL_LIFETIME=600000,HINT_LIFETIME=120000,MAX_HINTS=4000,HANDSHAKE_TIMEOUT=20000;
// One Tor window holds many sites in one session. Chromium partitions its sockets by top-level site there (engine-features.cjs:
// PartitionConnectionsByNetworkIsolationKey), so two sites that embed the same third party open two sockets to it, but the
// CONNECT itself does not say which site asked. Each request therefore "claims" its host:port from the moment the session's
// pipeline sees it until its response headers arrive (onHeadersReceived; Electron's onSendHeaders fires before the socket is
// chosen, too early): a CONNECT that arrives while exactly one site claims
// that host:port belongs to that site. Several sites at once, or none (a preconnect, a page-less worker), cannot be told apart:
// such a stream gets a circuit of its own, shared with nothing, so it can never link two sites. Claims expire after a minute.
// A connection nobody announced must never be taken for the one site that happens to claim the host: while site A waits on
// tracker:443 (a long poll keeps that claim alive), site B's <link rel=preconnect> opens B a socket with no webRequest event, and
// B's later requests reuse it. So a preconnect claims too (the session's 'preconnect' event, for the frame's site when known), and
// so does a request with no known site (a service worker's fetch): as "somebody else", which can never be given a site's circuit.
const CLAIM_LIFETIME=60000,PRECONNECT_LIFETIME=10000,MAX_CLAIMS=4000,ISOLATED='--isolated--';

/** The first-party key for a URL: its registrable domain (eTLD+1), the onion address for .onion, the host for IP literals. */
function firstPartyOf(url){
 let host='';try{host=new URL(String(url)).hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();}catch{return '';}
 if(!host)return '';if(/\.onion$/.test(host))return host.split('.').slice(-2).join('.');if(net.isIP(host))return host;
 return getDomain(host,{allowPrivateDomains:true})||host;
}
const nonce=()=>crypto.randomBytes(16).toString('hex');

/** SOCKS5 request (RFC 1928 §4) from Chromium: returns {host, port, bytes} once complete, null while incomplete, throws if bad. */
function parseConnect(buffer){
 if(buffer.length<5)return null;if(buffer[0]!==5)throw new Error('not SOCKS5');if(buffer[1]!==1)throw Object.assign(new Error('only CONNECT'),{reply:7});
 const type=buffer[3];let host,end;
 if(type===1){end=4+4;if(buffer.length<end+2)return null;host=[...buffer.subarray(4,8)].join('.');}
 else if(type===3){const length=buffer[4];end=5+length;if(buffer.length<end+2)return null;host=buffer.subarray(5,end).toString('latin1');}
 else if(type===4){end=4+16;if(buffer.length<end+2)return null;const b=buffer.subarray(4,20);host=Array.from({length:8},(_,i)=>b.readUInt16BE(i*2).toString(16)).join(':');}
 else throw Object.assign(new Error('bad address type'),{reply:8});
 return {host:host.toLowerCase(),port:buffer.readUInt16BE(end),bytes:buffer.subarray(0,end+2),rest:buffer.subarray(end+2)};
}
/** The username/password sub-negotiation (RFC 1929) for one stream. Fields are at most 255 bytes. */
function authRequest(username,password){const u=Buffer.from(username.slice(0,255),'utf8').subarray(0,255),p=Buffer.from(password,'utf8').subarray(0,255);return Buffer.concat([Buffer.from([1,u.length]),u,Buffer.from([p.length]),p]);}

/** `onRefused({key, host, port, site, code})`: tor answered a CONNECT with an error (its ExtendedErrors code, socks-extensions §3: 0xF4/0xF5 = an
 * onion site wants a client key / refused the one given); tor-window.cjs uses it to ask for the key. */
function createTorIsolation({upstreamPort,log=()=>{},now=()=>Date.now(),onRefused=null}={}){
 if(typeof upstreamPort!=='function')throw new Error('Tor isolation needs tor’s SOCKS port.');
 const nonces=new Map(),relays=new Map(),seen=[];let catchAllSince=0;
 const passwordFor=site=>{if(site===CATCHALL&&now()-catchAllSince>CATCHALL_LIFETIME){nonces.set(CATCHALL,nonce());catchAllSince=now();}if(!nonces.has(site))nonces.set(site,nonce());return nonces.get(site);};
 // A claimant with no site of its own: unique, so it always counts as one more party, and never a site name (ISOLATED is not a domain).
 let unknownClaims=0;const somebody=()=>ISOLATED+'#'+(++unknownClaims);
 /** The sites with a request to host:port waiting for a socket right now (expired claims are dropped on the way). */
 function claimants(relay,key){
  const sites=new Set(),at=now();
  for(const [id,claim] of relay.claims){if(at-claim.at>(claim.ttl||CLAIM_LIFETIME)){relay.claims.delete(id);continue;}if(claim.key===key)sites.add(claim.site);}
  return sites;
 }
 function claim(relay,id,key,site,ttl){
  relay.claims.delete(id);relay.claims.set(id,{key,site:site||somebody(),at:now(),...(ttl?{ttl}:{})});
  if(relay.claims.size>MAX_CLAIMS)for(const k of [...relay.claims.keys()].slice(0,relay.claims.size-MAX_CLAIMS))relay.claims.delete(k);
 }
 const hostPort=url=>{try{const u=new URL(url);return {host:u.hostname.replace(/^\[|\]$/g,'').toLowerCase(),port:Number(u.port)||(/^(?:https|wss):$/.test(u.protocol)?443:80)};}catch{return null;}};
 /** The circuit a CONNECT to host:port rides: {site, password}. A shared (window) session goes by the claims: one site → its circuit;
  * several, none, or one that is not a site (a preconnect or request whose frame is unknown) → a circuit of its own. A single-page
  * session (a Tor tab) has one site at a time: the claim, else the latest request for that host, else the tab's site. */
 function circuitFor(relay,host,port){
  const key=host+':'+port,sites=claimants(relay,key);
  if(sites.size===1){const site=[...sites][0];if(!site.startsWith(ISOLATED))return {site,password:passwordFor(site)};}
  if(relay.shared||sites.size)return {site:ISOLATED,password:nonce()};
  const hint=relay.hints.get(key)||relay.hints.get(host);
  const site=hint&&now()-hint.at<HINT_LIFETIME?hint.site:relay.site||CATCHALL;
  return {site,password:passwordFor(site)};
 }
 function serve(relay,client){
  let stage='greeting',buffer=Buffer.alloc(0),upstream=null;
  const timer=setTimeout(()=>client.destroy(),HANDSHAKE_TIMEOUT);timer.unref?.();
  const reject=code=>{try{client.end(Buffer.from([5,code||1,0,1,0,0,0,0,0,0]));}catch{}};
  client.on('error',()=>{upstream?.destroy();});
  client.on('close',()=>{clearTimeout(timer);upstream?.destroy();});
  const onData=chunk=>{
   buffer=Buffer.concat([buffer,chunk]);
   try{
    if(stage==='greeting'){if(buffer.length<2)return;if(buffer[0]!==5){client.destroy();return;}const count=buffer[1];if(buffer.length<2+count)return;
     const methods=buffer.subarray(2,2+count);buffer=buffer.subarray(2+count);if(!methods.includes(0)){client.end(Buffer.from([5,0xff]));return;}
     client.write(Buffer.from([5,0]));stage='request';}
    if(stage!=='request')return;
    const request=parseConnect(buffer);if(!request)return;
    stage='connecting';client.removeListener('data',onData);client.pause();
    const port=upstreamPort();if(!port){reject(1);return;}
    const {site,password}=circuitFor(relay,request.host,request.port);
    seen.push({relay:relay.key,host:request.host,port:request.port,site,at:now()});if(seen.length>500)seen.shift();
    upstream=net.connect({host:'127.0.0.1',port});upstream.setNoDelay(true);
    let reply=Buffer.alloc(0),step='method';
    upstream.on('error',()=>{if(step!=='piped')reject(1);client.destroy();});
    upstream.on('close',()=>client.destroy());
    upstream.once('connect',()=>upstream.write(Buffer.from([5,1,2])));
    const onUp=data=>{
     reply=Buffer.concat([reply,data]);
     if(step==='method'){if(reply.length<2)return;if(reply[0]!==5||reply[1]!==2){reject(1);upstream.destroy();return;}reply=reply.subarray(2);step='auth';upstream.write(authRequest(site,password));}
     if(step==='auth'){if(reply.length<2)return;if(reply[1]!==0){reject(1);upstream.destroy();return;}reply=reply.subarray(2);step='piped';
      upstream.removeListener('data',onUp);upstream.write(request.bytes);if(request.rest.length)upstream.write(request.rest);
      const inspect=bytes=>{if(onRefused&&bytes.length>=2&&bytes[0]===5&&bytes[1]!==0)try{onRefused({key:relay.key,host:request.host,port:request.port,site,code:bytes[1]});}catch{}};
      if(reply.length){inspect(reply);client.write(reply);}else upstream.once('data',inspect);
      clearTimeout(timer);upstream.pipe(client);client.pipe(upstream);client.resume();}
    };
    upstream.on('data',onUp);
   }catch(error){reject(error.reply);client.destroy();}
  };
  client.on('data',onData);
 }
 return {
  /** A relay for one Tor session (a Tor tab or a Tor window). Resolves to its 127.0.0.1 port. `shared`: many sites live in this
   * session at once (a Tor window), so streams nobody claimed never fall back to a site's circuit. */
  async open(key,{shared=false}={}){
   if(relays.has(key)){const relay=relays.get(key);if(shared)relay.shared=true;return relay.ready;}
   const relay={key,site:'',shared:Boolean(shared),hints:new Map(),claims:new Map(),server:null,ready:null};relays.set(key,relay);
   relay.server=net.createServer(socket=>{socket.setNoDelay(true);serve(relay,socket);});
   relay.server.on('error',error=>log('Tor relay: '+error.message));relay.server.unref(); // a relay never keeps the process alive by itself
   relay.ready=new Promise((resolve,reject)=>{relay.server.once('error',reject);relay.server.listen({host:'127.0.0.1',port:0,exclusive:true},()=>resolve(relay.server.address().port));});
   return relay.ready;
  },
  /** Called for every request the session's pipeline lets through: `site` is the first party of the page that made it.
   * `requestId` (the webRequest id) makes it a claim on host:port until settle() is called for it (its headers went out). A request
   * with no known site ('') still claims, as somebody else: its CONNECT never rides the circuit of a site that claims the same host. */
  note(key,url,site,requestId){
   const relay=relays.get(key),target=relay&&hostPort(url);if(!target)return;
   const {host,port}=target;
   if(site){
    relay.hints.delete(host+':'+port);relay.hints.set(host+':'+port,{site,at:now()});relay.hints.set(host,{site,at:now()});
    if(relay.hints.size>MAX_HINTS)for(const k of [...relay.hints.keys()].slice(0,relay.hints.size-MAX_HINTS))relay.hints.delete(k);
   }
   if(requestId!==undefined&&requestId!==null)claim(relay,requestId,host+':'+port,site,0);
  },
  /** The session is about to preconnect to `url` (Electron's session 'preconnect' event: no webRequest event follows for that socket).
   * `site` is the requesting frame's first party, '' when unknown. A short claim, so that socket never rides another site's circuit. */
  preconnect(key,url,site){
   const relay=relays.get(key),target=relay&&hostPort(url);if(!target)return;
   claim(relay,Symbol('preconnect'),target.host+':'+target.port,site,PRECONNECT_LIFETIME);
  },
  /** The request's response headers arrived (it had its socket): it no longer explains a new CONNECT. */
  settle(key,requestId){relays.get(key)?.claims.delete(requestId);},
  /** The address-bar site of a single-page session (a Tor tab): the fallback for streams nobody claimed. */
  setSite(key,site){const relay=relays.get(key);if(relay&&site)relay.site=site;},
  /** "New Tor circuit for this site": the next streams for `site` use a fresh circuit; the caller drops the old sockets and reloads. */
  newCircuit(site){if(!site)return false;nonces.set(site,nonce());return true;},
  /** The SOCKS credentials tor knows `site`'s current circuit by (circuit display: GETINFO circuit-status lists them). Main process only; null before the site's first stream. */
  credentials(site){return site&&nonces.has(site)?{username:site,password:nonces.get(site)}:null;},
  /** New Tor identity: every site starts over. */
  reset(){nonces.clear();catchAllSince=0;for(const relay of relays.values()){relay.hints.clear();relay.claims.clear();}},
  close(key){const relay=relays.get(key);if(!relay)return;relays.delete(key);try{relay.server.close();}catch{}},
  /** QA and tests: the last streams (host, port, site), never the nonces. */
  streams:()=>seen.map(({relay,host,port,site,at})=>({relay,host,port,site,at})),
  size:()=>relays.size,
 };
}
module.exports={createTorIsolation,firstPartyOf,parseConnect,authRequest,TOR_CATCHALL_SITE:CATCHALL,TOR_ISOLATED_SITE:ISOLATED};
