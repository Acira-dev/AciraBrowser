'use strict';
// Private windows with Tor (stream N): one shared Tor engine, one hardened in-memory session per window.
// Leak rules (Brave's Tor windows where Electron allows; docs/launch/TOR_WINDOWS.md has the reasoning and the gaps):
//  - the session starts on a dead sentinel proxy; every http(s)/ws(s) request waits behind a gate that opens only after
//    the session proxy is verified to be Tor's SOCKS port. No fallback to direct, ever.
//  - Chromium's socks5 sends host names to the proxy (remote DNS, socks5h); `<-loopback>` drops the implicit localhost bypass.
//  - loopback, private-network and single-label hosts are refused: Tor can't reach them and asking only probes the LAN.
//  - WebRTC locked to disable_non_proxied_udp (Brave's Tor pref); DNS prefetch off in Tor renderers (Electron resolves
//    dns-prefetch hints locally); Link-header hints stripped; HTTPS-only with .onion exempt; geolocation and other
//    identifying permissions denied; extensions off (private window); CNAME DNS checks and Safe Browsing skipped.
const fs=require('node:fs'),path=require('node:path'),{isIP}=require('node:net');
const {createTorEngine,parseKeywords}=require('./tor-engine.cjs'),{createTorUpdater}=require('./tor-update.cjs'),{createTorIsolation,firstPartyOf}=require('./tor-isolation.cjs'),{t}=require('./tx.cjs');

const SENTINEL={proxyRules:'socks5://127.0.0.1:9',proxyBypassRules:'<-loopback>'};
const RENDERER_ARGUMENTS=['--blink-settings=dnsPrefetchingEnabled=false'];
// Security levels (Tor Browser's Standard / Safer / Safest, SecurityLevel.sys.mjs + NoScript caps in Tor Browser 15). What a
// Chromium page can be given: Safer = no JIT (V8 --jitless: Tor Browser turns off ion, baseline JIT, native regexp and asm.js),
// no WebAssembly (--no-expose-wasm), no WebGL, no autoplay (Tor Browser: click-to-play), and no JavaScript on a non-HTTPS page
// (.onion counts as secure, as in Tor Browser); Safest = also no JavaScript anywhere, no web fonts, no audio or video. Not possible in
// Chromium 152: MathML off (mathml.disabled; MathML Core has shipped and has no runtime switch: a probe with disableBlinkFeatures
// MathMLCore still showed MathMLElement), SVG off at Safest (svg.disabled), and the Graphite / SVG-in-OpenType font switches (those
// font paths are not in Chromium's stack at all).
// Page settings are fixed when a page's renderer is made, so a change applies to Tor tabs opened afterwards; open ones keep theirs
// until they reopen (Tor Browser restarts; Acira reopens the Tor tabs at the same pages, tor.level-apply).
const LEVELS=['standard','safer','safest'];
const SAFER_JS_FLAGS='--js-flags=--jitless --no-expose-wasm';
const LEVEL_PREFERENCES={
 standard:{additionalArguments:RENDERER_ARGUMENTS},
 safer:{additionalArguments:[...RENDERER_ARGUMENTS,SAFER_JS_FLAGS],webgl:false,autoplayPolicy:'document-user-activation-required'},
 safest:{additionalArguments:[...RENDERER_ARGUMENTS,SAFER_JS_FLAGS],webgl:false,autoplayPolicy:'document-user-activation-required',javascript:false},
};
/** The level each Tor page was made with. Electron's webContents.getLastWebPreferences() leaves out additionalArguments, webgl and the rest, so the
 * level is stamped when the page is first locked (right after it was created from `LEVEL_PREFERENCES[level]`); a page keeps it until it reopens. */
const pageLevels=new WeakMap();
const levelOfContents=wc=>pageLevels.get(wc)||null;
const NO_SCRIPT="script-src 'none'; object-src 'none'";
/** The extra Content-Security-Policy a Tor document gets at this level (added as its own policy, so it can only take away). */
function levelPolicy(level,url){
 if(level==='safest')return NO_SCRIPT+"; font-src 'none'; media-src 'none'";
 if(level==='safer'){let u;try{u=new URL(url);}catch{return NO_SCRIPT;}if(u.protocol!=='https:'&&u.protocol!=='wss:'&&!isOnion(u.hostname))return NO_SCRIPT;}
 return '';
}
// Tor Browser reports UTC and en-US to every site (privacy.resistFingerprinting). Chromium gives no setting for a page's time zone
// or locale, but DevTools emulation does, per page and per child frame/worker (auto-attach): Tor pages get both before they run.
const EMULATION={timezoneId:'UTC',locale:'en-US'};
// Letterboxing (Tor Browser's RFPHelper.stepping / steppedSize): a page sees its window size rounded down, so most windows report one of a few sizes: up to 500 px
// in steps of 50, up to 1600 px in steps of 200 (width) and 100 (height), above that 200; 50 px or less is left alone. The page's view is made that size and centred in
// the room it had; the margins show the toolbar's colour (src/App.tsx, data-letterbox).
const stepOf=(size,isWidth)=>size<=500?50:size<=1600?(isWidth?200:100):200;
const steppedSize=(size,isWidth=false)=>size<=50?size:size-(size%stepOf(size,isWidth));
/** `bounds` ({x,y,width,height}, whole pixels) made letterbox-sized and centred in itself. Unchanged when it already is. */
function letterboxBounds(bounds){
 const width=steppedSize(bounds.width,true),height=steppedSize(bounds.height,false);
 if(width===bounds.width&&height===bounds.height)return bounds;
 return {x:bounds.x+Math.floor((bounds.width-width)/2),y:bounds.y+Math.floor((bounds.height-height)/2),width,height};
}
// Screen and window size, pixel ratio: Tor Browser reports the (letterboxed) window as the screen and a pixel ratio of 1 (privacy.resistFingerprinting). A Chromium page
// cannot be given those by a setting, and DevTools' device emulation would draw a 1x frame on a sharper display (blurred text), so the properties pages read are
// replaced before any page script runs, in every frame: screen.width/height/availWidth/availHeight and window.outerWidth/outerHeight follow the window's inner size, the
// position is 0,0, the colour depth 24, devicePixelRatio 1. CSS media queries (resolution) and srcset still follow the real display: partial, see TOR_HARDENING.md.
const UNIFORM_SCREEN=()=>{
 const own=(object,name,get)=>{try{Object.defineProperty(object,name,{get,set:undefined,enumerable:true,configurable:true});}catch{}};
 const frame=()=>{try{void window.top.document;return window.top;}catch{return window;}};
 const width=()=>frame().innerWidth,height=()=>frame().innerHeight,zero=()=>0,depth=()=>24;
 const screenType=window.Screen&&window.Screen.prototype||Object.getPrototypeOf(window.screen);
 for(const [name,get] of [['width',width],['height',height],['availWidth',width],['availHeight',height],['availLeft',zero],['availTop',zero],['colorDepth',depth],['pixelDepth',depth]])own(screenType,name,get);
 for(const [name,get] of [['outerWidth',width],['outerHeight',height],['screenX',zero],['screenY',zero],['screenLeft',zero],['screenTop',zero],['devicePixelRatio',()=>1]])own(window,name,get);
};
const UNIFORM_SCREEN_SOURCE='('+UNIFORM_SCREEN.toString()+')();';
const GATE_TIMEOUT=240000,FAVICON_BYTES=200*1024;
const DENIED_PERMISSIONS=new Set(['geolocation','idle-detection','window-management','local-fonts','midi','midiSysex','storage-access','top-level-storage-access']);
const TOR_FLAG=Symbol.for('acira.tor.session');
// A Tor window reads as Tor at a glance: a calm purple finish (custom tint, so the person's light/dark choice still applies)
// and DuckDuckGo, which doesn't answer Tor exits with endless CAPTCHAs (Brave's Tor default too).
const TOR_SETTINGS={colorPreset:'Tor',browserTint:'#4f3d63',accentColor:'#7d4698',searchEngine:'duckduckgo'};

/** The circuits in tor's `GETINFO circuit-status` (control-spec §4.1.1): "ID STATUS $FP~nick,$FP~nick,$FP~nick KEY=value ...". SOCKS_USERNAME and
 * SOCKS_PASSWORD are the credentials the circuit was made for: that is how a site's circuit is told from the others. */
function parseCircuitStatus(text){
 const out=[];
 for(const line of String(text||'').split('\n')){
  const m=/^(\S+) (\S+)(?: (\$\S+))?(.*)$/.exec(line.trim());if(!m)continue;
  const path=(m[3]||'').split(',').map(hop=>/^\$([0-9A-Fa-f]{40})(?:[~=](\S+))?$/.exec(hop)).filter(Boolean).map(hop=>({fingerprint:hop[1].toUpperCase(),nickname:hop[2]||''}));
  const k=parseKeywords(m[4]||'');
  out.push({id:m[1],status:m[2],path,purpose:k.PURPOSE||'',username:k.SOCKS_USERNAME??null,password:k.SOCKS_PASSWORD??null,created:Date.parse(String(k.TIME_CREATED||'').replace(/(\.\d+)?$/,'Z'))||0});
 }
 return out;
}
/** Tor's `GETINFO stream-status` ("ID STATUS CIRCUIT host:port"): which circuit each open stream rides. */
function parseStreamStatus(text){
 const out=[];
 for(const line of String(text||'').split('\n')){const m=/^(\d+) (\S+) (\d+) (\S+)$/.exec(line.trim());if(m)out.push({id:Number(m[1]),status:m[2],circuit:m[3],host:m[4].replace(/:\d+$/,'').replace(/^\[|\]$/g,'').toLowerCase()});}
 return out;
}
/** A `STREAM` event (control-spec 4.1.2): "STREAM id STATUS circuit host:port ... SOCKS_USERNAME=\"x\" SOCKS_PASSWORD=\"y\"". Null for anything else. */
function parseStreamEvent(line){
 const m=/^STREAM (\d+) (\S+) (\d+) (\S+)(.*)$/.exec(String(line||'').trim());if(!m)return null;
 const k=parseKeywords(m[5]||'');return {id:Number(m[1]),status:m[2],circuit:m[3],host:m[4].replace(/:\d+$/,'').replace(/^\[|\]$/g,'').toLowerCase(),username:k.SOCKS_USERNAME??null,password:k.SOCKS_PASSWORD??null};
}
/** The circuit a site's streams ride. Every built circuit made for these credentials is a candidate (tor links several legs per site with conflux, and
 * may build a spare); when an open stream to the page's host (else to the site) is attached to one of them, that one is the answer, else the newest. */
function circuitFor(circuits,credentials,streams=[],host='',latest=''){
 const mine=credentials?circuits.filter(c=>c.status==='BUILT'&&c.path.length>=2&&c.username===credentials.username&&c.password===credentials.password):[];
 if(!mine.length)return null;
 const ids=new Map(mine.map(c=>[c.id,c]));
 if(latest&&ids.has(latest))return ids.get(latest);
 const open=streams.filter(s=>ids.has(s.circuit)&&['SUCCEEDED','SENTCONNECT','CONNECT'].includes(s.status)).sort((a,b)=>b.id-a.id);
 const site=host?firstPartyOf('https://'+host+'/'):'',onHost=open.find(s=>s.host===host),onSite=open.find(s=>site&&(s.host===site||s.host.endsWith('.'+site)));
 const stream=onHost||onSite||open[0];if(stream)return ids.get(stream.circuit);
 return mine.reduce((best,c)=>!best||c.created>=best.created?c:best,null);
}
/** A relay's address and nickname from its consensus entry ("r nickname identity digest date time IP ORPort DirPort"). */
const relayFromConsensus=text=>{const r=/^r (\S+) \S+ \S+ \S+ \S+ (\S+) \d+ \d+/m.exec(String(text||''));return r?{nickname:r[1],address:r[2]}:{nickname:'',address:''};};

// Onion-Location (Tor Browser, torproject.org/onion-location): an https website reached over Tor may name its onion twin in a response header (or, as Tor Browser also reads it, in <meta http-equiv="onion-location" content="...">; the header wins). Only a v3 .onion address
// (56 characters) in an http(s) URL without credentials counts, and only from a secure page that is not itself an onion service; anything else is ignored.
const ONION_V3=/^[a-z2-7]{56}\.onion$/;
const onionPage=pageUrl=>{try{const page=new URL(pageUrl);return page.protocol==='https:'&&!/\.onion$/i.test(page.hostname);}catch{return false;}};
function onionTarget(value,pageUrl){
 const raw=[].concat(value||[])[0];if(typeof raw!=='string')return '';
 let target;try{target=new URL(raw.trim());}catch{return '';}
 if(!onionPage(pageUrl))return '';
 if(!/^https?:$/.test(target.protocol)||target.username||target.password||!ONION_V3.test(target.hostname))return '';
 return target.href;
}
/** Runs inside the page (an isolated world, so a page cannot change what querySelectorAll or getAttribute do here): the content of the first <meta http-equiv="onion-location"> with a value, or ''. Only a string of at most 2048 characters leaves the page. */
function readOnionMeta(document){
 try{
  for(const meta of document.querySelectorAll('meta[http-equiv]')){
   const equiv=meta.getAttribute('http-equiv'),content=meta.getAttribute('content');
   if(typeof equiv==='string'&&equiv.trim().toLowerCase()==='onion-location'&&typeof content==='string'&&content.trim()&&content.length<=2048)return content.trim();
  }
 }catch{}
 return '';
}
const ONION_META_CODE='('+readOnionMeta.toString()+')(document)',ONION_META_WORLD=7131;
// Onion client authorization (Tor Browser's "this onion site needs a key"): an onion service can be limited to clients that hold a key. Tor tells the SOCKS client with
// ExtendedErrors 0xF4 (no key) or 0xF5 (the key is wrong) (socks-extensions.txt §3); the relay passes those on (tor-isolation.cjs onRefused), the tab's page asks for the key,
// and tor learns it with ONION_CLIENT_AUTH_ADD (control-spec §3.31). Session-only: no ClientOnionAuthDir, so a key is never written to disk and goes when Acira closes.
const ONION_ID=/^[a-z2-7]{56}$/;
const onionService=host=>{const labels=String(host||'').toLowerCase().replace(/\.$/,'').split('.');return labels.length>=2&&labels.at(-1)==='onion'&&ONION_ID.test(labels.at(-2))?labels.at(-2):'';};
const BASE32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Bytes(text){let bits=0,value=0;const out=[];for(const ch of text){const at=BASE32.indexOf(ch);if(at<0)return null;value=(value<<5)|at;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
/** An onion client key as the person has it (the 52 letters and digits of an .auth_private file, that whole line, or x25519 base64) -> the base64 tor wants; '' when it is none of those. */
function onionAuthKey(input){
 let text=String(input||'').trim();if(!text||text.length>400)return '';
 const line=/^[a-z2-7]{56}:descriptor:x25519:([A-Z2-7]{52})$/i.exec(text);if(line)text=line[1];
 let bytes=null;
 if(/^[A-Z2-7]{52}$/i.test(text))bytes=base32Bytes(text.toUpperCase());
 else{const b=/^(?:x25519:)?([A-Za-z0-9+/]{43}=?)$/.exec(text);if(b)bytes=Buffer.from(b[1],'base64');}
 return bytes&&bytes.length===32&&!bytes.every(v=>v===0)?bytes.toString('base64'):'';
}
const withoutHash=url=>{try{const u=new URL(url);u.hash='';return u.href;}catch{return '';}};

/** Hosts a Tor window never asks for: loopback, private and link-local ranges, LAN names, single labels. */
function localTarget(hostname){
 const host=String(hostname||'').replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();if(!host)return true;
 if(isIP(host)===4){const [a,b]=host.split('.').map(Number);return a===0||a===127||a===10||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a>=224;}
 if(isIP(host)===6)return host==='::'||host==='::1'||/^f[cd]/.test(host)||/^fe[89ab]/.test(host)||/^::ffff:/.test(host);
 return !host.includes('.')||/(?:^|\.)(?:localhost|local|internal|lan|home\.arpa|intranet|corp)$/.test(host);
}
const isOnion=hostname=>/\.onion\.?$/i.test(String(hostname||''));
const isTorSession=session=>Boolean(session&&session[TOR_FLAG]);
/** Response-header patch: no DNS prefetch for this document, no Link-header hints that resolve outside Tor, and the security
 * level's script policy (`policy`, added beside any policy the site sends). */
function hardenHeaders(headers,documentResponse,policy=''){
 const out={};let changed=false,cspName='';
 for(const [name,values] of Object.entries(headers||{})){
  if(name.toLowerCase()==='link'){const kept=[].concat(values).flatMap(v=>String(v).split(/,(?=\s*<)/)).filter(part=>!/;\s*rel\s*=\s*"?[^";]*\b(?:dns-prefetch|preconnect)\b/i.test(part)).map(s=>s.trim());if(kept.length!==[].concat(values).flatMap(v=>String(v).split(/,(?=\s*<)/)).length)changed=true;if(kept.length)out[name]=[kept.join(', ')];continue;}
  if(documentResponse&&name.toLowerCase()==='x-dns-prefetch-control'){changed=true;continue;}
  if(name.toLowerCase()==='content-security-policy')cspName=name;
  out[name]=values;
 }
 if(documentResponse){out['X-DNS-Prefetch-Control']=['off'];changed=true;}
 if(documentResponse&&policy){const name=cspName||'Content-Security-Policy';out[name]=[...[].concat(out[name]||[]),policy];changed=true;}
 return changed?out:null;
}
/** The first party of a request: the page's own site for a navigation, else the site of the top frame that asked. */
function requestSite(details,fromId=()=>null){
 if(details.resourceType==='mainFrame')return firstPartyOf(details.url);
 try{const top=details.frame?.top?.url;if(top&&/^(?:https?):/i.test(top))return firstPartyOf(top);}catch{}
 try{const wc=details.webContentsId?fromId(details.webContentsId):null,url=wc&&!wc.isDestroyed()?wc.getURL():'';if(/^(?:https?):/i.test(url))return firstPartyOf(url);}catch{}
 return '';
}
/** Bootstrap phase in plain words (tor's own summaries say "networkstatus consensus"). */
function phaseText(status){
 if(status.state==='ready')return 'Connected';if(status.state==='error')return status.error?.title||'Tor can’t connect';
 if(status.state==='starting'||status.state==='idle')return 'Starting Tor';
 const p=status.progress||0;return p<30?'Connecting to the Tor network':p<75?'Loading the network directory':'Building a private circuit';
}
function publicStatus(status){return {state:status.state,progress:status.progress||0,retryInMs:status.retryInMs||0,slowRestarts:status.slowRestarts||0,phase:phaseText(status),error:status.error?{code:status.error.code,title:status.error.title,detail:status.error.detail}:null,version:status.version,firstConnection:Boolean(status.firstConnection),
 // Bridges in use ({type, count}) and "looks blocked" ({phase, progress, offline, bridges}) for the connect page (tor-engine.cjs).
 bridges:status.bridges?{type:status.bridges.type,count:status.bridges.count}:null,blocked:status.blocked?{phase:status.blocked.phase,progress:status.blocked.progress,offline:Boolean(status.blocked.offline),bridges:status.blocked.bridges||null}:null};}

function createTorWindows({app,contentBlocking,userData,vault=null,engine=null,log=message=>console.warn(message),allContents=()=>require('electron').webContents.getAllWebContents(),contentsOf=session=>allContents().filter(wc=>wc.session===session),webContentsFromId=id=>{try{return require('electron').webContents.fromId(id)||null;}catch{return null;}}}={}){
 const updater=engine?null:createTorUpdater({userData,log,fetcher:(url,init)=>tor.fetch(url,init),ready:()=>tor.whenReady()}),tor=engine||createTorEngine({userData,log,updated:()=>updater.updated()});
 const windows=new Map();
 // The onion address each Tor page's latest main-frame response offered (webContents id -> {url, onion}); it counts only while the page still shows that address.
 const onionHints=new Map();
 // Onion services that asked for a key (service id -> 'missing' | 'wrong'), and the keys given this session (service id -> base64), kept in memory only and given to tor again if it restarts.
 const authNeeded=new Map(),authKeys=new Map();
 const onionAuthForUrl=url=>{try{return authNeeded.get(onionService(new URL(url).hostname))||'';}catch{return '';}};
 const onionAuthOf=wc=>onionAuthForUrl(wc.getURL());
 // tor answers ONION_CLIENT_AUTH_ADD with 250 (added), 251 (a key for this service was there and is replaced), 252 (added, and the cached descriptor now decrypts) or 253 (added, descriptor not fetched yet):
 // all four are success, but the control client only resolves on 250, so the others arrive as rejections with their code.
 const addAuthKey=(id,key)=>tor.request(`ONION_CLIENT_AUTH_ADD ${id} x25519:${key}`).catch(error=>{if(error&&['251','252','253'].includes(String(error.code)))return;throw error;});
 function noteOnion(details){
  const headers=details.responseHeaders||{},name=Object.keys(headers).find(key=>key.toLowerCase()==='onion-location'),onion=name?onionTarget(headers[name],details.url):'';
  if(name){onionHints.set(details.webContentsId,{url:withoutHash(details.url),onion,meta:details.meta===true});if(onionHints.size>200)onionHints.delete(onionHints.keys().next().value);}else onionHints.delete(details.webContentsId);
 }
 /** The <meta http-equiv="onion-location"> of a Tor tab's main document, filed through noteOnion like the header. Only the top frame of a page the header rules would accept; a header already seen for this page wins. Resolves true when the tab now has an offer from the tag. */
 async function noteOnionMeta(wc){
  try{
   if(!wc||wc.isDestroyed()||!isTorSession(wc.session))return false;
   const url=wc.getURL(),key=withoutHash(url);
   if(!key||!onionPage(url)||onionHints.get(wc.id)?.url===key)return false;
   const raw=await wc.executeJavaScriptInIsolatedWorld(ONION_META_WORLD,[{code:ONION_META_CODE}]);
   if(wc.isDestroyed()||withoutHash(wc.getURL())!==key||onionHints.get(wc.id)?.url===key||typeof raw!=='string'||!onionTarget(raw,url))return false;
   noteOnion({webContentsId:wc.id,url,responseHeaders:{'onion-location':[raw]},meta:true});
   return Boolean(onionLocationOf(wc));
  }catch{return false;}
 }
 const onionLocationOf=wc=>{const hint=wc&&onionHints.get(wc.id);return hint&&withoutHash(wc.getURL())===hint.url?hint.onion:'';};
 // The circuit each site's latest stream was attached to (Tor Browser's circuit display follows STREAM events the same way): key = SOCKS username and password, which
 // never leave this process. Tor makes extra circuits (conflux legs, spares) for one site, so "the newest" is not always the one in use.
 const latestCircuit=new Map();
 const noteStream=line=>{const e=parseStreamEvent(line);if(!e||e.username===null||e.circuit==='0'||!['SENTCONNECT','SUCCEEDED'].includes(e.status))return;const key=e.username+'\0'+e.password;latestCircuit.delete(key);latestCircuit.set(key,e.circuit);if(latestCircuit.size>500)latestCircuit.delete(latestCircuit.keys().next().value);};
 try{tor.onStream?.(noteStream);}catch{}
 // Every Tor session reaches tor through its own isolation relay (tor-isolation.cjs): one circuit per site.
 const isolation=createTorIsolation({upstreamPort:()=>{const s=tor.status();return s.state==='ready'&&s.socksPort?s.socksPort:0;},log,onRefused:({host,code})=>{const id=onionService(host);if(!id||(code!==0xF4&&code!==0xF5))return;authNeeded.set(id,code===0xF4?'missing':'wrong');if(authNeeded.size>100)authNeeded.delete(authNeeded.keys().next().value);}});
 if(process.env.ACIRA_BROWSER_TEST_DATA){globalThis.__aciraTorIsolation=isolation;globalThis.__aciraTorEngine=tor;} // QA (qa/r9-tor-relay.mjs, qa/r9-tor-packets.mjs): which site each stream rode (never a nonce); the engine's own fetch
 const settingsFile=userData?path.join(userData,'tor','settings.json'):'';
 // Tor preferences, one small file: the security level, whether the download warning still shows (Tor Browser's browser.download.showTorWarning).
 let level='standard',downloadWarning=true,preferOnion=false;try{const saved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));if(LEVELS.includes(saved.level))level=saved.level;if(saved.downloadWarning===false)downloadWarning=false;if(saved.preferOnion===true)preferOnion=true;}catch{}
 /** Writes the preferences with `patch` applied; nothing changes in memory unless the file was written. */
 function persist(patch,message){
  const next={level,downloadWarning,preferOnion,...patch};
  try{fs.mkdirSync(path.dirname(settingsFile),{recursive:true});require('../atomic-file.cjs').writeFileAtomic(settingsFile,JSON.stringify(next));}catch(error){log('Tor settings not saved: '+error.message);if(settingsFile)throw new Error(message);}
  ({level,downloadWarning,preferOnion}=next);
 }
 let unsubscribe=null,identityRun=null,gatesHeld=false;
 // Back from sleep or a locked screen: wake tor and check it still answers (tor-engine heal), instead of waiting for a page to stall.
 try{const {powerMonitor}=require('electron');for(const name of ['resume','unlock-screen'])powerMonitor?.on?.(name,()=>{void Promise.resolve(tor.heal?.()).catch(()=>{});});}catch{}
 // Locks for every webContents in a Tor session (tabs, popups, Peek): later code can't loosen them.
 app?.on?.('web-contents-created',(_event,wc)=>{try{if(isTorSession(wc.session))lockContents(wc);}catch(error){log('Tor contents lock failed: '+error.message);}});
 function lockContents(wc){if(wc.__aciraTorLocked)return;if(!pageLevels.has(wc))pageLevels.set(wc,level);const set=wc.setWebRTCIPHandlingPolicy.bind(wc);set('disable_non_proxied_udp');Object.defineProperty(wc,'setWebRTCIPHandlingPolicy',{configurable:false,writable:false,value:()=>set('disable_non_proxied_udp')});Object.defineProperty(wc,'__aciraTorLocked',{value:true});emulate(wc);}
 /** UTC and en-US for the page, its out-of-process frames and its workers (each waits for its override before it runs). */
 function emulate(wc){
  const dbg=wc.debugger;if(!dbg||typeof dbg.attach!=='function')return;
  const apply=async sessionId=>{for(const [method,params] of [['Emulation.setTimezoneOverride',{timezoneId:EMULATION.timezoneId}],['Emulation.setLocaleOverride',{locale:EMULATION.locale}],['Page.addScriptToEvaluateOnNewDocument',{source:UNIFORM_SCREEN_SOURCE,runImmediately:true}],['Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true}]])try{await dbg.sendCommand(method,params,sessionId);}catch{}};
  try{if(!dbg.isAttached())dbg.attach('1.3');}catch(error){log('Tor page emulation unavailable: '+error.message);return;}
  dbg.on('message',(_event,method,params)=>{if(method!=='Target.attachedToTarget'||!params?.sessionId)return;const id=params.sessionId;void apply(id).finally(()=>dbg.sendCommand('Runtime.runIfWaitingForDebugger',{},id).catch(()=>{}));});
  void apply(undefined);
 }
 function lockSession(session){
  Object.defineProperty(session,TOR_FLAG,{value:true});Object.defineProperty(session,'__aciraTor',{value:true});require('./user-agent.cjs').applyTorUserAgent(session);
  // The permission service installs its handlers after this; wrap them so identifying permissions stay denied.
  const request=session.setPermissionRequestHandler.bind(session),check=session.setPermissionCheckHandler.bind(session);
  Object.defineProperty(session,'setPermissionRequestHandler',{value:handler=>request(handler?(wc,permission,callback,details)=>DENIED_PERMISSIONS.has(permission)?callback(false):handler(wc,permission,callback,details):(wc,permission,callback)=>callback(!DENIED_PERMISSIONS.has(permission)&&permission==='fullscreen'))});
  Object.defineProperty(session,'setPermissionCheckHandler',{value:handler=>check(handler?(wc,permission,origin,details)=>!DENIED_PERMISSIONS.has(permission)&&handler(wc,permission,origin,details):(wc,permission)=>!DENIED_PERMISSIONS.has(permission)&&permission==='fullscreen')});
  session.setPermissionRequestHandler(null);session.setPermissionCheckHandler(null);
 }
 function settle(entry,open){const waiting=[...entry.waiting];entry.waiting.clear();for(const done of waiting)done(open?{}:{cancel:true});if(entry.ready){if(open)entry.ready.resolve();else if(entry.closed||entry.failed)entry.ready.reject(new Error(entry.closed?'Tor window closed.':'Tor is not connected.'));}}
 function gate(entry){return details=>{
  if(!/^(?:https?|wss?):/i.test(details.url))return {};
  let host='';try{host=new URL(details.url).hostname;}catch{return {cancel:true};}
  if(entry.closed||localTarget(host))return {cancel:true};
  // Which site this request belongs to, for its circuit: told to the relay before Chromium opens the socket.
  // A request with no known site (a service worker's fetch) claims too, as somebody else (tor-isolation.cjs), so its socket never rides another site's circuit.
  const site=requestSite(details,webContentsFromId);isolation.note(entry.windowId,details.url,site,details.id);if(site&&details.resourceType==='mainFrame')isolation.setSite(entry.windowId,site);
  if(entry.open)return {};
  if(entry.failed)return {cancel:true};
  return new Promise(resolve=>{const done=value=>{clearTimeout(timer);entry.waiting.delete(done);resolve(value);},timer=setTimeout(()=>done({cancel:true}),GATE_TIMEOUT);entry.waiting.add(done);});
 };}
 /** Points the session at its isolation relay, which forwards to tor's SOCKS port (`port`) with per-site credentials. */
 async function applyProxy(entry,port){
  if(!port)throw new Error('Tor opened no SOCKS port.');
  const relay=await isolation.open(entry.windowId,{shared:!entry.tabId}),rules=`socks5://127.0.0.1:${relay}`;await entry.session.setProxy({proxyRules:rules,proxyBypassRules:'<-loopback>'});await entry.session.closeAllConnections();
  const resolved=String(await entry.session.resolveProxy('https://check.torproject.org/')).trim();
  if(resolved!==`SOCKS5 127.0.0.1:${relay}`)throw new Error(`Tor proxy did not apply (${resolved}).`);
 }
 async function closeGate(entry){entry.open=false;entry.port=0;try{await entry.session.setProxy(SENTINEL);await entry.session.closeAllConnections();}catch{}}
 async function sync(entry,status){
  if(entry.closed)return;entry.emit({type:'tor-status',status:publicStatus(status)});
  if(gatesHeld)return; // a New Tor identity holds every gate shut until tor has applied it; resumeGates() syncs them all
  if(status.state==='ready'&&status.socksPort){
   if(entry.open&&entry.port===status.socksPort)return;
   entry.failed=false;entry.port=status.socksPort;
   try{await applyProxy(entry,status.socksPort);if(entry.closed||entry.port!==status.socksPort)return;entry.open=true;settle(entry,true);}
   catch(error){log(error.message);await closeGate(entry);entry.failed=true;settle(entry,false);}
   return;
  }
  if(entry.open||entry.port)await closeGate(entry);
  entry.failed=status.state==='error';if(entry.failed)settle(entry,false);
 }
 let wasReady=false;
 function ensureSubscribed(){if(!unsubscribe)unsubscribe=tor.onStatus(status=>{if(status.state!=='ready')latestCircuit.clear();const ready=status.state==='ready';if(ready&&!wasReady)for(const [id,key] of authKeys)void addAuthKey(id,key).catch(()=>{});wasReady=ready;for(const entry of windows.values())void sync(entry,status);});}
 /** Hardens one in-memory session and ties it to a Tor lease. `key` is a window id or a private-tab key. */
 async function attach({key,session,profileId,emit=()=>{},tabId=null,wait=false}){
  if(windows.has(key))return windows.get(key);
  lockSession(session);
  // A tab's page exists before its session is flagged (the web-contents-created hook missed it): lock what already lives in it.
  try{for(const wc of contentsOf(session))lockContents(wc);}catch(error){log('Tor contents lock failed: '+error.message);}
  const entry={windowId:key,tabId,session,profileId,emit,open:false,failed:false,closed:false,port:0,waiting:new Set(),ready:null};windows.set(key,entry);
  if(wait){let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});promise.catch(()=>{});entry.ready={promise,resolve,reject};}
  // <link rel=preconnect> opens a socket with no webRequest event: it claims its host:port for the asking frame's site (or as nobody's), so
  // the relay never puts it on the circuit of another site that is waiting on the same host (tor-isolation.cjs preconnect).
  if(typeof session.on==='function'){const onPreconnect=(_event,url,_credentials,frame)=>{let site='';try{const top=frame?.top?.url||'';if(/^https?:/i.test(top))site=firstPartyOf(top);}catch{}try{isolation.preconnect(key,String(url||''),site);}catch{}};
   session.on('preconnect',onPreconnect);entry.offPreconnect=()=>{try{session.removeListener('preconnect',onPreconnect);}catch{}};}
  if(contentBlocking){const pipeline=contentBlocking.attach(session,profileId,true);pipeline.useBefore(gate(entry));pipeline.useHeaders(details=>{isolation.settle(key,details.id);/* the request has its socket: its claim on host:port ends (tor-isolation.cjs) */if(details.resourceType==='mainFrame'&&details.webContentsId)noteOnion(details);const documentResponse=details.resourceType==='mainFrame'||details.resourceType==='subFrame',patch=hardenHeaders(details.responseHeaders,documentResponse,documentResponse?levelPolicy(level,details.url):'');return patch?{responseHeaders:patch}:{};});try{contentBlocking.https.setPrivate(session,true);}catch(error){log('Tor HTTPS-only unavailable: '+error.message);}}
  await session.setProxy(SENTINEL);
  ensureSubscribed();entry.release=tor.acquire(key);void sync(entry,tor.status());
  void updater?.check(); // weekly at most, and only when automatic updates are on; applies the next time Tor starts
  return entry;
 }
 /** Live Tor status for a window that has Tor tabs or is a Tor window, whether or not any Tor page exists yet (a new Tor tab shows
  * its status before it loads anything). `listener` gets the public status now and on every change; returns the unsubscribe. */
 function watch(listener){const send=status=>{try{listener(publicStatus(status));}catch(error){log('Tor status listener failed: '+error.message);}};const off=tor.onStatus(send);send(tor.status());return off;}
 /** A Tor tab was opened: start connecting now, without waiting for its page. One Tor connection serves the whole session (tor-engine.cjs). */
 function warm(){try{void Promise.resolve(tor.warm?.()).catch(()=>{});}catch{}void updater?.check();}
 /** Every Tor tab that never loaded a page is gone: Tor stops retrying on their behalf. */
 function unwarm(){try{tor.unwarm?.();}catch{}}
 /** Called by main.cjs before the window's session is configured. Nothing loads until Tor is ready. */
 const prepare=({windowId,session,profileId,emit})=>attach({key:windowId,session,profileId,emit});
 /** Private-tab kind 'tor' (desktop/main.cjs privateTabKinds): the page waits for this promise and never loads if it rejects. */
 async function prepareTab({key,session,profileId,tabId,emit}){const entry=await attach({key,session,profileId,emit,tabId,wait:true});await entry.ready.promise;}
 function release(key){const entry=windows.get(key);if(!entry)return Promise.resolve();entry.closed=true;entry.open=false;settle(entry,false);windows.delete(key);entry.offPreconnect?.();isolation.close(key);return entry.release?.()||Promise.resolve();}
 const releaseTab=({key})=>release(key);
 /** Empties every live Tor session (storage, cache, auth, sockets). Every session is tried whatever happens to the others; returns the failures. */
 async function clearSessions(){
  const failures=[];
  for(const entry of [...windows.values()]){const ses=entry.session;const done=await Promise.allSettled([ses.clearStorageData(),ses.clearCache(),ses.clearAuthCache(),ses.clearHostResolverCache(),ses.closeAllConnections()]);for(const item of done)if(item.status==='rejected')failures.push(item.reason);}
  return failures;
 }
 /** New Tor identity: new circuits (NEWNYM) and nothing left of the Tor sites (storage, cache, auth, sockets); the caller replaces the tabs (`resetTabs`) and tells each window (`announce`).
  * One at a time: a request that arrives while one runs joins it (one reset, one answer). The steps, in an order that fails safe:
  *  1. every Tor gate shuts: nothing in a Tor session reaches the network until tor has applied the new circuits;
  *  2. NEWNYM, waited out until tor applied it (tor holds one inside its 10 s limit): if this fails nothing has been touched;
  *  3. every session is emptied while the old pages still exist: if that fails the tabs stay, so the person can see what is left and retry;
  *  4. the caller closes the old Tor tabs and opens the fresh ones, and waits until the old pages are gone;
  *  5. every session is emptied again: a page that kept writing (a cookie timer, a beacon) between steps 3 and 4 leaves nothing behind;
  *  6. the gates open on the new circuits. */
 function newIdentity(_entries,options={}){
  if(identityRun)return identityRun;
  identityRun=runIdentity(options).finally(()=>{identityRun=null;});return identityRun;
 }
 async function runIdentity({resetTabs=()=>{},announce=()=>{}}){
  // Nothing to renew while tor is not connected: say so before anything is shut. No entries is fine: a Tor tab that only shows its new-tab page has no session yet.
  if(tor.status().state!=='ready')throw new Error(t('tor.identity.notReady'));
  const every=work=>Promise.all([...windows.values()].map(work));
  gatesHeld=true;
  try{
   await every(closeGate);
   let result;try{result=await tor.newIdentity();}catch(error){log('New Tor identity: NEWNYM failed: '+error.message);throw new Error(t('tor.identity.failed'));}
   isolation.reset(); // every site gets a new circuit password: nothing new can share a circuit with what came before
   const before=await clearSessions();if(before.length){log('New Tor identity: site data could not be cleared: '+before[0]?.message);throw new Error(t('tor.identity.cleanupFailed'));}
   const token=await resetTabs();
   const after=await clearSessions();if(after.length)log('New Tor identity: site data left after the tabs closed: '+after[0]?.message);
   announce(token,{cleared:after.length===0});
   return {...result,cleared:after.length===0,status:publicStatus(tor.status())};
  }finally{gatesHeld=false;await every(entry=>sync(entry,tor.status()));}
 }
 /** Tab icons for the chrome UI, fetched through this window's Tor session (a remote <img> in the UI would bypass Tor). */
 async function favicon(session,url){
  if(!isTorSession(session)||typeof url!=='string'||!/^https?:\/\//i.test(url))return '';
  try{if(localTarget(new URL(url).hostname))return '';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   try{const response=await session.fetch(url,{signal:controller.signal,credentials:'omit',redirect:'follow'});const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(!response.ok||!/^image\/(?:png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml|avif)$/.test(type))return '';const body=Buffer.from(await response.arrayBuffer());if(!body.length||body.length>FAVICON_BYTES)return '';
    return `data:${type};base64,${body.toString('base64')}`;}finally{clearTimeout(timer);}
  }catch{return '';}
 }
 /** `torTabIds`: the Tor tabs of the asking window. A normal window with Tor tabs may ask about Tor too. */
 /** Tor vault (tor-vault.cjs): off by default; bookmarks and last tabs only; reading needs the Windows check. */
 async function vaultRequest(request,ctx){
  const v=vault();
  switch(request.type){
   case 'tor.vault-status':return {torVault:v.status()};
   case 'tor.vault-set':return {torVault:await v.setEnabled(request.enabled)};
   case 'tor.vault-bookmark':{const tab=ctx.activeTab?.();if(!tab?.isTor)throw new Error('Open a page in a Tor tab first.');const saved=v.addBookmark({url:tab.url,title:tab.title});return {torVault:v.status(),saved:saved.created?'saved':'already'};}
   case 'tor.vault-list':{const bookmarks=await v.listBookmarks();return {torVault:{...v.status(),bookmarks}};}
   case 'tor.vault-remove':await v.removeBookmark(request.id);return {torVault:v.status()};
   case 'tor.vault-reopen':{const tabs=await v.lastTabs();ctx.openTabs?.(tabs.map(t=>t.url));return {torVault:v.status(),reopened:tabs.length};}
   case 'tor.vault-clear':v.clearAll();return {torVault:v.status()};
   default:throw new Error('Unknown Tor request.');
  }
 }
 /** "New Tor circuit for this site" (Tor Browser's circuit display button): a fresh circuit password for the current tab's site,
  * its sockets dropped, the page reloaded on the new circuit. Other sites keep theirs. */
 async function newCircuit(tab){
  const wc=tab?.webContents;if(!tab?.isTor||!wc||wc.isDestroyed()||!isTorSession(wc.session))throw new Error(t('tor.circuit.noPage'));
  if(tor.status().state!=='ready')throw new Error(t('tor.identity.notReady'));
  const site=firstPartyOf(wc.getURL());if(!site)throw new Error(t('tor.circuit.noPage'));
  isolation.newCircuit(site);try{await wc.session.closeAllConnections();}catch{}wc.reloadIgnoringCache();
  return {tor:publicStatus(tor.status()),circuit:{site}};
 }
 /** The relays of the circuit this tab's site rides (Tor Browser's circuit display): guard, middle(s), exit (rendezvous point for an onion site), each
  * with its address, nickname and country (tor's own geoip tables). Read from tor's control port; the site's circuit password never leaves this process.
  * `pending`: the site has no circuit yet (nothing loaded). */
 const relayCache=new Map(); // fingerprint -> {nickname,address,country}: relays change rarely, the control port is local but not free
 async function relayDetails(fingerprints){
  for(const fp of fingerprints){
   if(relayCache.has(fp))continue;
   let entry={nickname:'',address:'',country:''};
   try{
    const found=relayFromConsensus((await tor.getInfo('ns/id/'+fp))['ns/id/'+fp]);entry={...entry,...found};
    if(found.address){const cc=String((await tor.getInfo('ip-to-country/'+found.address))['ip-to-country/'+found.address]||'').trim().toLowerCase();entry.country=/^[a-z]{2}$/.test(cc)?cc:'';}
   }catch{}
   relayCache.set(fp,entry);if(relayCache.size>400)relayCache.delete(relayCache.keys().next().value);
  }
  return fingerprints.map(fp=>relayCache.get(fp));
 }
 async function circuitView(tab){
  const wc=tab?.webContents;if(!tab?.isTor||!wc||wc.isDestroyed()||!isTorSession(wc.session))throw new Error(t('tor.circuit.noPage'));
  if(tor.status().state!=='ready'||typeof tor.getInfo!=='function')throw new Error(t('tor.identity.notReady'));
  const site=firstPartyOf(wc.getURL());if(!site)throw new Error(t('tor.circuit.noPage'));
  const credentials=isolation.credentials(site),onion=isOnion(site);
  if(!credentials)return {circuit:{site,onion,hops:[],pending:true}};
  let streams=[];try{streams=parseStreamStatus((await tor.getInfo('stream-status'))['stream-status']);}catch{}
  let host='';try{host=new URL(wc.getURL()).hostname.toLowerCase();}catch{}
  const circuit=circuitFor(parseCircuitStatus((await tor.getInfo('circuit-status'))['circuit-status']),credentials,streams,host,latestCircuit.get(credentials.username+'\0'+credentials.password)||'');
  if(!circuit)return {circuit:{site,onion,hops:[],pending:true}};
  const details=await relayDetails(circuit.path.map(hop=>hop.fingerprint)),last=circuit.path.length-1,rendezvous=onion||/^HS_/.test(circuit.purpose);
  const hops=circuit.path.map((hop,index)=>({role:index===0?'guard':index===last?(rendezvous?'rendezvous':'exit'):'middle',nickname:details[index].nickname||hop.nickname,address:details[index].address,country:details[index].country}));
  return {circuit:{site,onion,hops,pending:false}};
 }
 /** "This onion site needs a key": the key the person pasted goes to tor for the site the tab shows, and the page loads again. The address comes from the tab, never from the request. */
 async function addOnionKey(tab,input){
  const wc=tab?.webContents;if(!tab?.isTor||!wc||wc.isDestroyed()||!isTorSession(wc.session))throw new Error(t('tor.circuit.noPage'));
  if(tor.status().state!=='ready'||typeof tor.request!=='function')throw new Error(t('tor.identity.notReady'));
  let id='';try{id=onionService(new URL(wc.getURL()).hostname);}catch{}if(!id)throw new Error(t('tor.circuit.noPage'));
  const key=onionAuthKey(input);if(!key)throw new Error(t('tor.onionAuth.badKey'));
  try{await addAuthKey(id,key);}catch{throw new Error(t('tor.onionAuth.refused'));}
  authKeys.set(id,key);authNeeded.delete(id);wc.reloadIgnoringCache();
  return {onionAuth:{ok:true}};
 }
 /** Tor pages showing a site that were made at another level than the current one (they keep it until they reopen). */
 function stalePages(){
  let list=[];try{list=allContents();}catch{return 0;}
  return list.filter(wc=>{try{return !wc.isDestroyed()&&isTorSession(wc.session)&&/^https?:/i.test(wc.getURL())&&levelOfContents(wc)!==null&&levelOfContents(wc)!==level;}catch{return false;}}).length;
 }
 const levelStatus=()=>({level,levels:LEVELS,stale:stalePages()});
 function setLevel(next){
  if(!LEVELS.includes(next))throw new Error('Choose Standard, Safer or Safest.');
  persist({level:next},t('tor.level.notSaved'));return levelStatus();
 }
 /** Reopens every Tor tab that runs at another level (all windows, `reopen` from main.cjs), so the level now applies to them too. */
 async function applyLevel(reopen){
  const reopened=typeof reopen==='function'?await reopen():0;
  return {torLevel:levelStatus(),reopened};
 }
 function handle(request,ctx={}){
  const {windowId,resetTabs,torTabIds=[]}=ctx;
  // Engine updates are a Settings matter (C's section): they need no Tor window.
  if(updater&&request.type==='tor.update-status')return {torUpdate:updater.status()};
  if(updater&&request.type==='tor.update-set'){if(typeof request.auto!=='boolean')throw new Error('Choose on or off.');return {torUpdate:updater.setAuto(request.auto)};}
  if(updater&&request.type==='tor.update-check')return updater.check({force:true}).then(torUpdate=>({torUpdate}));
  if(vault&&request.type.startsWith('tor.vault-'))return vaultRequest(request,ctx);
  // The security level is a Tor preference, readable and settable from any window (Settings, a Tor tab's panel).
  if(request.type==='tor.level')return {torLevel:levelStatus()};
  if(request.type==='tor.level-set')return {torLevel:setLevel(request.level)};
  if(request.type==='tor.level-apply')return applyLevel(ctx.reopenTorTabs);
  // The download warning is shown beside any download from a Tor tab until "Got it" is chosen; readable from the Downloads panel and page of any window.
  // "Prefer .onion versions" (Tor Browser's privacy.prioritizeonions): a Tor tab opens the onion address a site offers, once the page has loaded.
  if(request.type==='tor.onion-prefer')return {torOnion:{prefer:preferOnion}};
  if(request.type==='tor.onion-prefer-set'){if(typeof request.prefer!=='boolean')throw new Error('Choose on or off.');persist({preferOnion:request.prefer},t('tor.settings.notSaved'));return {torOnion:{prefer:preferOnion}};}
  if(request.type==='tor.download-warning')return {torDownloadWarning:{show:downloadWarning}};
  if(request.type==='tor.download-warning-dismiss'){persist({downloadWarning:false},t('tor.settings.notSaved'));return {torDownloadWarning:{show:downloadWarning}};}
  // Bridges (tor-bridges.cjs) are a Tor connection setting: Settings and the connect page of a blocked Tor tab use them.
  if(request.type==='tor.bridges')return {torBridges:tor.bridges(),tor:publicStatus(tor.status())};
  if(request.type==='tor.bridges-set'){const torBridges=tor.setBridges(request.bridges);return {torBridges,tor:publicStatus(tor.status())};}
  // Moat: "Request a bridge" from the Tor Project (domain fronted, CAPTCHA), from Settings.
  if(request.type==='tor.moat-fetch')return Promise.resolve(tor.moatFetch()).then(torMoat=>({torMoat}));
  if(request.type==='tor.moat-check'){const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;if(!text(request.challenge,8192)||!text(request.solution,200)||!text(request.transport||'obfs4',40))throw new Error('Type the characters you see.');
   return Promise.resolve(tor.moatCheck({transport:request.transport||'obfs4',challenge:request.challenge,solution:request.solution.trim()})).then(result=>({torMoat:{ok:result.ok,wrong:Boolean(result.wrong),count:result.count||0},torBridges:result.bridges||tor.bridges(),tor:publicStatus(tor.status())}));}
  if(request.type==='tor.bridges-check'){if(typeof request.text!=='string'||request.text.length>64000)throw new Error('Paste bridge lines as text.');return {torBridgeCheck:tor.checkBridges(request.text)};}
  const mine=[...windows.values()].filter(entry=>entry.windowId===windowId||entry.tabId&&torTabIds.includes(entry.tabId));
  // The asker is in Tor when it is a Tor window or has a Tor tab, even a new one that has not loaded a page (and so has no session yet).
  if(!mine.length&&!ctx.inTor&&request.type!=='tor.status')throw new Error('This isn’t a Tor window or tab.');
  switch(request.type){
   case 'tor.status':return {tor:publicStatus(tor.status())};
   case 'tor.retry':tor.retry();return {tor:publicStatus(tor.status())};
   // The site panel, the Acira menu and Ctrl+Shift+L act on the current tab; a Tor tab's own menu names its tab.
   case 'tor.circuit':return circuitView(typeof request.tabId==='string'&&request.tabId&&ctx.tabById?ctx.tabById(request.tabId):ctx.activeTab?.());
   case 'tor.onion-auth-add':return addOnionKey(typeof request.tabId==='string'&&request.tabId&&ctx.tabById?ctx.tabById(request.tabId):ctx.activeTab?.(),request.key);
   case 'tor.new-circuit':return newCircuit(typeof request.tabId==='string'&&request.tabId&&ctx.tabById?ctx.tabById(request.tabId):ctx.activeTab?.());
   // One Tor connection serves every Tor tab and window, so a new identity resets all of them, in every window (R3-61).
   case 'tor.new-identity':return newIdentity(undefined,{resetTabs,announce:ctx.announce}).then(result=>({tor:result.status,identity:{ok:true,delayed:result.delayed,cleared:result.cleared}}));
   default:throw new Error('Unknown Tor request.');
  }
 }
 return {updater,prepare,prepareTab,release,releaseTab,handle,favicon,newIdentity,watch,warm,unwarm,isTorSession,noteOnionMeta,get webPreferences(){return LEVEL_PREFERENCES[level];},level:()=>level,levelOfContents,downloadWarning:()=>downloadWarning,onionAuthOf,onionAuthForUrl,onionLocationOf,preferOnion:()=>preferOnion,isolation,status:()=>publicStatus(tor.status()),engine:tor,windows:()=>windows.size};
}
module.exports={createTorWindows,TOR_SETTINGS,localTarget,isOnion,isTorSession,hardenHeaders,levelPolicy,requestSite,TOR_LEVELS:LEVELS,TOR_LEVEL_PREFERENCES:LEVEL_PREFERENCES,TOR_EMULATION:EMULATION,phaseText,publicStatus,TOR_SENTINEL_PROXY:SENTINEL,onionTarget,readOnionMeta,onionService,onionAuthKey,steppedSize,letterboxBounds,UNIFORM_SCREEN_SOURCE,parseCircuitStatus,parseStreamStatus,parseStreamEvent,circuitFor,relayFromConsensus,TOR_RENDERER_ARGUMENTS:RENDERER_ARGUMENTS,TOR_DENIED_PERMISSIONS:DENIED_PERMISSIONS};
