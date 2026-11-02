'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {getDomain}=require('tldts'),{isIP}=require('node:net');
// R4-37: the reader page is a whole renderer (~16 MB). On real sites cookies change every few seconds, so a 1.5 s capture and a 20 s linger kept it alive
// for the whole session. Captures now come at most every 10 s (and at quit), and the page closes 1 s after the read.
const MAX_BYTES=8*1024*1024,MAX_COOKIES=6000,CAPTURE_DELAY_MS=10000,READER_LINGER_MS=1000;
const baseKey=c=>JSON.stringify([c.domain,c.path,c.name]);
const cookieKey=c=>JSON.stringify([c.domain,c.path,c.name,c.partitionKey||null]);
function cookieParam(cookie,{includePersistent=false}={}){
 if(!cookie||(!includePersistent&&cookie.session!==true)||(includePersistent&&cookie.session!==true&&(!Number.isFinite(cookie.expires)||cookie.expires<=0))||cookie.partitionKeyOpaque||typeof cookie.name!=='string'||typeof cookie.value!=='string'||cookie.name.length>4096||cookie.value.length>16384||typeof cookie.domain!=='string'||!cookie.domain||cookie.domain.length>253||typeof cookie.path!=='string'||!cookie.path.startsWith('/')||cookie.path.length>4096)return null;
 const domain=cookie.domain,host=domain.replace(/^\./,''),normalizedHost=host.replace(/^\[|\]$/g,'').toLowerCase();let url;
 try{url=new URL((cookie.sourceScheme==='NonSecure'?'http:':cookie.secure?'https:':'http:')+'//'+(host.includes(':')&&!host.startsWith('[')?'['+host+']':host));if(url.hostname.replace(/^\[|\]$/g,'')!==normalizedHost||url.username||url.password||url.port)return null;}catch{return null;}
 const result={name:cookie.name,value:cookie.value,url:url.origin+cookie.path,path:cookie.path,secure:cookie.secure===true,httpOnly:cookie.httpOnly===true};
 if(cookie.session!==true)result.expires=cookie.expires;
 if(domain.startsWith('.'))result.domain=domain;
 if(['Strict','Lax','None'].includes(cookie.sameSite))result.sameSite=cookie.sameSite;
 if(['Low','Medium','High'].includes(cookie.priority))result.priority=cookie.priority;
 if(['Unset','NonSecure','Secure'].includes(cookie.sourceScheme))result.sourceScheme=cookie.sourceScheme;
 if(Number.isInteger(cookie.sourcePort)&&cookie.sourcePort>=-1&&cookie.sourcePort<=65535)result.sourcePort=cookie.sourcePort;
 if(cookie.partitionKey){
  if(!cookie.secure||typeof cookie.partitionKey.topLevelSite!=='string'||typeof cookie.partitionKey.hasCrossSiteAncestor!=='boolean')return null;
  try{const site=new URL(cookie.partitionKey.topLevelSite);if(!['http:','https:'].includes(site.protocol)||site.username||site.password||site.pathname!=='/'||site.search||site.hash)return null;result.partitionKey={topLevelSite:site.origin,hasCrossSiteAncestor:cookie.partitionKey.hasCrossSiteAncestor};}catch{return null;}
 }
 return result;
}
/** Reads and writes a session's cookies through a hidden page's debugger (Electron's cookie API has no partition keys). The page (a whole renderer, ~16 MB, one per profile session) only exists while a read or a restore needs it:
 *  it is made on use and closed a second after the last one, so a window that is browsing or idle carries none between captures. */
function createProtocolAccess(session){
 let view=null,wc=null,ready=null,idle=null;
 const release=()=>{clearTimeout(idle);idle=null;const page=wc;view=null;wc=null;ready=null;if(page&&!page.isDestroyed()){try{page.debugger.detach();}catch{}page.close();}};
 const open=()=>{
  if(!wc||wc.isDestroyed()){
   const {WebContentsView}=require('electron');view=new WebContentsView({webPreferences:{session,sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});wc=view.webContents;
   const page=wc;ready=page.loadURL('about:blank').then(()=>page.debugger.attach('1.3')).then(()=>page);
  }
  clearTimeout(idle);idle=null;busy++;return ready;
 };
 // The linger starts when the last read or restore has finished, so a slow read is never cut off by its own page closing.
 let busy=0;const done=()=>{busy=Math.max(0,busy-1);if(!busy&&wc){clearTimeout(idle);idle=setTimeout(release,READER_LINGER_MS);idle.unref?.();}};
 const use=async work=>{try{return await work(await open());}finally{done();}};
 return {get ownerView(){return view;},read:()=>use(async page=>(await page.debugger.sendCommand('Network.getAllCookies')).cookies),restore:cookies=>use(async page=>{if(cookies.length)await page.debugger.sendCommand('Network.setCookies',{cookies});}),close:release};
}
function createSessionCookieRestore({directory,safeStorage,platform=process.platform,makeAccess=createProtocolAccess,fileSystem=fs,onError=()=>{},captureDelay=CAPTURE_DELAY_MS,encryptExistingCookies=false}){
 if(!path.isAbsolute(directory))throw new Error('Native session snapshot directory must be absolute');
 const states=new Map(),io=fileSystem;
 const report=()=>{try{onError('Some website sessions could not be securely restored or saved.');}catch{}};
 const available=()=>{try{return safeStorage.isEncryptionAvailable()&&!(platform==='linux'&&['basic_text','unknown'].includes(safeStorage.getSelectedStorageBackend?.()));}catch{return false;}};
 const filename=partition=>path.join(directory,createHash('sha256').update(partition).digest('hex')+'.bin');
 function writeSynced(file,bytes){let descriptor;try{descriptor=io.openSync(file,'w',0o600);io.writeFileSync(descriptor,bytes);io.fsyncSync(descriptor);}finally{if(descriptor!==undefined)io.closeSync(descriptor);}}
 function unlink(file){try{io.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
 function revoke(state){
  state.savedText=null;const file=filename(state.partition);io.mkdirSync(directory,{recursive:true,mode:0o700});
  // This marker contains no cookie/profile values. Startup must ignore any older
  // encrypted snapshot while a credential-deletion save is incomplete.
  try{writeSynced(file+'.revoked',Buffer.from('1\n'));}
  catch(markerError){try{unlink(file);return;}catch{}try{writeSynced(file,Buffer.alloc(0));return;}catch{}throw markerError;}
 }
 function save(state){
  if(state.disabled)return;
  if(!available())throw new Error('Secure website-session storage is unavailable');
  const text=JSON.stringify({version:1,profileId:state.profileId,partition:state.partition,cookies:[...state.cookies.values()]});if(Buffer.byteLength(text)>MAX_BYTES)throw new Error('Website-session snapshot exceeded bounds');
  if(text===state.savedText)return;
  const encrypted=safeStorage.encryptString(text);if(encrypted.length>MAX_BYTES+4096)throw new Error('Encrypted website-session snapshot exceeded bounds');
  io.mkdirSync(directory,{recursive:true,mode:0o700});const file=filename(state.partition);writeSynced(file+'.tmp',encrypted);io.renameSync(file+'.tmp',file);unlink(file+'.revoked');state.savedText=text;
 }
 function persistDeletion(state){
  try{revoke(state);save(state);state.deletionError=null;}
  catch{state.clearing=true;state.deletionError=new Error('Website session recovery is paused because a credential deletion could not be saved. Retry clearing website data.');report();throw state.deletionError;}
 }
 async function capture(state){
  if(state.disabled||state.clearing)return;
  for(let attempt=0;attempt<8;attempt++){
   const version=state.version,cookies=await state.access.read();if(state.disabled||state.clearing)return;if(version!==state.version)continue;
   if(!Array.isArray(cookies)||cookies.length>MAX_COOKIES*4)throw new Error('Cookie snapshot exceeded bounds');
   const next=new Map();for(const cookie of cookies){if(cookieParam(cookie))next.set(cookieKey(cookie),cookie);if(next.size>MAX_COOKIES)throw new Error('Session cookie snapshot exceeded bounds');}
   const removed=[...state.cookies.keys()].some(key=>!next.has(key));state.cookies=next;if(removed)persistDeletion(state);else save(state);return;
  }
  throw new Error('Cookie snapshot did not settle');
 }
 function schedule(state){if(state.disabled)return;state.queue=state.queue.then(()=>capture(state)).catch(report);return state.queue;}
 /** Cookie changes come in bursts (a page load sets a dozen): one capture, a moment after the last, instead of one per change. flush() and the first capture do not wait. */
 function scheduleSoon(state){if(state.timer)return;state.timer=setTimeout(()=>{state.timer=null;void schedule(state);},captureDelay);state.timer.unref?.();}
 function attach({session,profileId,partition,private:privateMode=false}){
  if(privateMode||!partition?.startsWith('persist:')||typeof profileId!=='string'||profileId.startsWith('private-'))return Promise.resolve({supported:false,private:true});
  if(states.has(session)){const known=states.get(session);if(known.partition!==partition||known.profileId!==profileId)throw new Error('Session restore profile assignment changed');return known.ready;}
  const state={session,profileId,partition,cookies:new Map(),version:0,queue:Promise.resolve(),disabled:!available()};states.set(session,state);
  if(state.disabled){try{if(io.existsSync(filename(partition)))revoke(state);}catch{report();}report();state.ready=Promise.resolve({supported:false});return state.ready;}
  try{
   const file=filename(partition);if(!io.existsSync(file+'.revoked')&&io.existsSync(file)){if(io.statSync(file).size>MAX_BYTES+4096)throw new Error();const saved=JSON.parse(safeStorage.decryptString(io.readFileSync(file)));if(saved.version!==1||saved.profileId!==profileId||saved.partition!==partition||!Array.isArray(saved.cookies)||saved.cookies.length>MAX_COOKIES)throw new Error();for(const cookie of saved.cookies)if(cookieParam(cookie))state.cookies.set(cookieKey(cookie),cookie);}
  }catch{report();state.cookies.clear();try{revoke(state);}catch{state.disabled=true;state.ready=Promise.resolve({supported:false});return state.ready;}}
  state.access=makeAccess(session);
  state.listener=(_event,cookie,_cause,removed)=>{
   state.version++;
   if(removed||cookie.session!==true){let held=false;for(const [key,saved]of state.cookies)if(baseKey(saved)===baseKey(cookie)){state.cookies.delete(key);held=true;}if(held)try{persistDeletion(state);}catch{return;}}
   if(!state.restoring)scheduleSoon(state);
  };
  session.cookies.on('changed',state.listener);state.restoring=true;
  state.ready=(async()=>{
   try{
    const current=await state.access.read(),present=new Set(current.map(cookieKey)),restore=[];
    // Enabling Chromium's cookie-encryption fuse encrypts new writes, but does
    // not rewrite an older plaintext row. Rewrite through Chromium once per
    // persistent profile before its first navigation, preserving native expiry,
    // host-only scope and CHIPS keys. Never inspect or edit its SQLite store.
    const migrated=filename(partition)+'.native-encrypted-v1';
    if(encryptExistingCookies&&!io.existsSync(migrated)){
     if(!Array.isArray(current)||current.length>MAX_COOKIES*4)throw new Error('Native cookie migration exceeded bounds');
     const params=current.map(cookie=>cookieParam(cookie,{includePersistent:true}));
     if(params.some(param=>!param))throw new Error('Native cookie migration cannot preserve a cookie');
     await state.access.restore(params);await session.cookies.flushStore();
     io.mkdirSync(directory,{recursive:true,mode:0o700});writeSynced(migrated,Buffer.from('1\n'));
    }
    for(const cookie of state.cookies.values()){const param=cookieParam(cookie);if(param&&!present.has(cookieKey(cookie)))restore.push(param);}
    await state.access.restore(restore);state.restoring=false;await schedule(state);return {supported:true};
   }catch{state.restoring=false;state.disabled=true;report();return {supported:false};}
  })();return state.ready;
 }
 async function flush(){await Promise.all([...states.values()].map(async state=>{await state.ready;if(!state.disabled){await state.queue;if(state.deletionError)throw state.deletionError;await schedule(state);if(state.deletionError)throw state.deletionError;}}));}
 function clear(session,{origin,scope='host',registrableDomain}={}){
  if(registrableDomain!==undefined){if(typeof registrableDomain!=='string'||!registrableDomain||!origin)throw new Error('Invalid native registrable-domain assertion');scope='registrable-domain';}
  if(!['host','registrable-domain'].includes(scope)||scope==='registrable-domain'&&!origin)throw new Error('Invalid native session-cookie clearing scope');
  let host,registrable;
  if(origin){const target=new URL(origin);if(!['http:','https:'].includes(target.protocol)||target.username||target.password||!target.hostname)throw new Error('Invalid native clearing origin');host=target.hostname.replace(/^\[|\]$/g,'').toLowerCase();registrable=isIP(host)?host:getDomain(host,{allowPrivateDomains:true})||host;if(registrableDomain!==undefined&&registrableDomain!==registrable)throw new Error('Native registrable-domain assertion does not match origin');}
  const state=states.get(session);if(!state)return;state.version++;state.clearing=true;
  if(origin){for(const [key,cookie]of state.cookies){const domain=cookie.domain.replace(/^\./,'').replace(/^\[|\]$/g,'').toLowerCase();const matches=scope==='registrable-domain'?(domain===registrable||!isIP(host)&&domain.endsWith('.'+registrable)):(host===domain||cookie.domain.startsWith('.')&&host.endsWith('.'+domain));if(matches)state.cookies.delete(key);}}
  else state.cookies.clear();persistDeletion(state);
 }
 async function completeClear(session){const state=states.get(session);if(!state||state.disabled)return;await state.queue;if(state.deletionError)throw state.deletionError;state.version++;state.clearing=false;try{await capture(state);}catch{state.clearing=true;state.deletionError=new Error('Website session recovery remains paused. Retry clearing website data.');report();throw state.deletionError;}}
 async function removeProfile(partition){revoke({partition});for(const [session,state]of states)if(state.partition===partition){state.disabled=true;state.version++;if(state.listener)session.cookies.removeListener('changed',state.listener);state.access?.close();states.delete(session);}unlink(filename(partition));unlink(filename(partition)+'.tmp');}
 function dispose(){for(const state of states.values()){state.disabled=true;state.version++;if(state.listener)state.session.cookies.removeListener('changed',state.listener);state.access?.close();}states.clear();}
 return {attach,flush,clear,completeClear,removeProfile,dispose};
}
module.exports={createSessionCookieRestore,cookieParam};
