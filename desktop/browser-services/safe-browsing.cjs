'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
// Google Safe Browsing Update API v4: hash-prefix lists are mirrored locally, so a URL is checked on this computer first and only a short hash prefix is sent to Google when it might match.
// Google licenses v4 for non-commercial use only (Web Risk is the commercial API). With no API key this module is off and makes no network request at all.
const API='https://safebrowsing.googleapis.com/v4/',THREATS=Object.freeze(['MALWARE','SOCIAL_ENGINEERING','UNWANTED_SOFTWARE']),PLATFORMS=Object.freeze(['WINDOWS','ANY_PLATFORM']);
const LISTS=Object.freeze(THREATS.flatMap(t=>PLATFORMS.map(p=>Object.freeze({threatType:t,platformType:p,id:t+'_'+p}))));
const MINUTE=60000,HOUR=60*MINUTE,DAY=24*HOUR,UPDATE_PERIOD=30*MINUTE,POSITIVE_CAP=30*MINUTE,MAX_TOTAL=64*1024*1024,MAX_RESPONSE=64*1024*1024,MAX_ENTRIES=2**20,MAX_CACHE=4096,TIMEOUT=20000;
const sha256=data=>createHash('sha256').update(data).digest(),validKey=key=>typeof key==='string'&&/^[A-Za-z0-9_-]{30,60}$/.test(key);
// Google's back-off rule: MIN((2^N - 1) * 15 minutes * (RAND + 1), 24 hours) after N consecutive failures.
const backoffMs=(failures,rand=Math.random())=>Math.min((2**failures-1)*15*MINUTE*(rand+1),DAY);
// Durations arrive as "593.440s"; anything unreadable counts as no wait, and one response can never silence us for more than a day.
const seconds=value=>{const m=/^(\d+(?:\.\d+)?)s$/.exec(typeof value==='string'?value:'');return m?Math.min(Math.round(Number(m[1])*1000),DAY):0;};

// URL canonicalization (developers.google.com/safe-browsing/v4/urls-hashing). Works on a byte string (every char 0-255) because the spec escapes bytes, not code points.
const toBytes=text=>text.replace(/[^\x00-\xff]+/g,m=>Buffer.from(m,'utf8').toString('latin1')),escapeBytes=text=>text.replace(/[\x00-\x20\x7f-\xff#%]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase().padStart(2,'0'));
const unescapeAll=text=>{for(let previous;previous!==text;){previous=text;text=text.replace(/%([0-9a-fA-F]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));}return text;};
const number=part=>/^0x[0-9a-f]+$/i.test(part)?parseInt(part,16):/^0[0-7]+$/.test(part)?parseInt(part,8):/^(0|[1-9][0-9]*)$/.test(part)?Number(part):NaN;
// Any legal IPv4 spelling (decimal, octal, hex, fewer than four parts) becomes four decimal parts; anything else is a name.
function ipv4(host){const parts=host.split('.');if(parts.length>4)return null;const n=parts.map(number);if(n.some(Number.isNaN))return null;const last=n.pop();if(n.some(v=>v>255)||last>=256**(4-n.length))return null;const value=n.reduce((sum,v,i)=>sum+v*256**(3-i),0)+last;return [24,16,8,0].map(s=>Math.floor(value/2**s)%256).join('.');}
function cleanPath(raw){const segments=raw.replace(/\/{2,}/g,'/').split('/'),out=[];for(let i=1;i<segments.length;i++){const s=segments[i],last=i===segments.length-1;if(s==='.'||s==='..'){if(s==='..')out.pop();if(last)out.push('');}else out.push(s);}return '/'+out.join('/');}
function parse(input){
 let s=toBytes(String(input)).replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'').replace(/[\t\r\n]/g,'');
 const hash=s.indexOf('#');if(hash>=0)s=s.slice(0,hash);
 const scheme=/^([a-z][a-z0-9+.-]*):\/\//i.exec(s);if(scheme)s=s.slice(scheme[0].length);
 s=unescapeAll(s);
 const cut=s.search(/[/?]/),authority=cut<0?s:s.slice(0,cut),rest=cut<0?'/':s.slice(cut),q=rest.indexOf('?');
 // User name, password and port never take part in the lookup.
 let host=authority.slice(authority.lastIndexOf('@')+1).replace(/:[0-9]*$/,'').replace(/^\.+|\.+$/g,'').replace(/\.{2,}/g,'.');
 host=ipv4(host)||host.replace(/[A-Z]/g,c=>c.toLowerCase());
 return {scheme:scheme?scheme[1].toLowerCase():'http',host:escapeBytes(host),path:escapeBytes(cleanPath((q<0?rest:rest.slice(0,q))||'/')),query:q<0?undefined:escapeBytes(rest.slice(q+1))};
}
const join=c=>c.scheme+'://'+c.host+c.path+(c.query===undefined?'':'?'+c.query),canonicalize=input=>join(parse(input)),isIp=host=>/^\d+\.\d+\.\d+\.\d+$/.test(host);
// Up to 5 host suffixes x 6 path prefixes: the exact host plus the last five labels shrinking (never the bare TLD), against the exact path with and without query plus up to four directory prefixes.
function expressionsOf(c){
 const labels=c.host.split('.'),hosts=[c.host];
 if(!isIp(c.host))for(let i=Math.max(1,labels.length-5);i<labels.length-1;i++)hosts.push(labels.slice(i).join('.'));
 const dirs=c.path.split('/').slice(1,-1),paths=new Set(c.query===undefined?[]:[c.path+'?'+c.query]);
 paths.add(c.path);paths.add('/');
 for(let k=1;k<=Math.min(3,dirs.length);k++)paths.add('/'+dirs.slice(0,k).join('/')+'/');
 return hosts.flatMap(h=>[...paths].map(p=>h+p));
}
const expressions=input=>expressionsOf(parse(input)),hashExpression=expression=>sha256(Buffer.from(expression,'latin1'));
// Only public http(s) sites are worth a lookup; local, private and single-label names carry no Safe Browsing data and should never leave the machine even as a prefix.
const privateIp=host=>{const m=/^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);if(!m)return false;const a=+m[1],b=+m[2];return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168);};
const localHost=host=>!host.includes('.')||host.startsWith('[')||/\.(localhost|local|internal)$/.test(host)||privateIp(host);
const target=url=>{if(typeof url!=='string'||!/^https?:\/\//i.test(url.trim()))return null;const c=parse(url);return localHost(c.host)?null:c;};

// Prefix storage: each list keeps one packed, sorted Buffer per prefix length (nearly all are 4 bytes), so a million entries cost megabytes rather than a million objects.
const EMPTY=Buffer.alloc(0),cmpAt=(a,ao,al,b,bo,bl)=>{for(let i=0,n=Math.min(al,bl);i<n;i++)if(a[ao+i]!==b[bo+i])return a[ao+i]-b[bo+i];return al-bl;};
const count=sizes=>{let n=0;for(const [k,b] of sizes)n+=b.length/k;return n;};
// Removal indices and the checksum are defined on the globally sorted list across all prefix lengths, so walk the per-length buffers in merged order.
function* walk(sizes){const ks=[...sizes.keys()],bufs=ks.map(k=>sizes.get(k)),pos=ks.map(()=>0);for(;;){let best=-1;for(let i=0;i<ks.length;i++){if(pos[i]*ks[i]>=bufs[i].length)continue;if(best<0||cmpAt(bufs[i],pos[i]*ks[i],ks[i],bufs[best],pos[best]*ks[best],ks[best])<0)best=i;}if(best<0)return;yield [ks[best],pos[best]++];}}
function flatten(sizes){if(!sizes.size)return EMPTY;if(sizes.size===1)return sizes.values().next().value;const out=Buffer.alloc([...sizes.values()].reduce((n,b)=>n+b.length,0));let o=0;for(const [k,i] of walk(sizes)){sizes.get(k).copy(out,o,i*k,i*k+k);o+=k;}return out;}
const checksumOf=sizes=>sha256(flatten(sizes));
function sortPacked(buf,k){const n=buf.length/k;let ordered=true;for(let i=1;i<n&&ordered;i++)ordered=cmpAt(buf,(i-1)*k,k,buf,i*k,k)<=0;if(ordered)return buf;const order=Uint32Array.from({length:n},(_,i)=>i).sort((a,b)=>cmpAt(buf,a*k,k,buf,b*k,k)),out=Buffer.alloc(buf.length);order.forEach((from,to)=>buf.copy(out,to*k,from*k,from*k+k));return out;}
function mergeSorted(a,b,k){if(!a.length)return b;if(!b.length)return a;const out=Buffer.alloc(a.length+b.length);let i=0,j=0,o=0;while(i<a.length&&j<b.length){if(cmpAt(a,i,k,b,j,k)<=0){a.copy(out,o,i,i+k);i+=k;}else{b.copy(out,o,j,j+k);j+=k;}o+=k;}if(i<a.length)a.copy(out,o,i);else b.copy(out,o,j);return out;}
// Only RAW is requested, so Rice-Golomb sets are refused instead of half-decoded.
function additions(sets){const out=new Map();for(const set of Array.isArray(sets)?sets:[]){const raw=set&&set.rawHashes;if(!raw||set.riceHashes)throw new Error('Unsupported prefix encoding in update.');const k=raw.prefixSize,buf=Buffer.from(String(raw.rawHashes||''),'base64');if(!Number.isInteger(k)||k<4||k>32||buf.length%k)throw new Error('Malformed prefix set in update.');if(buf.length)out.set(k,mergeSorted(out.get(k)||EMPTY,sortPacked(buf,k),k));}return out;}
function removals(sets){let out=[];for(const set of Array.isArray(sets)?sets:[]){const indices=set&&set.rawIndices&&set.rawIndices.indices;if(!Array.isArray(indices)||set.riceIndices)throw new Error('Unsupported removal encoding in update.');out=out.concat(indices);}return out;}
function removeAt(sizes,indices){
 if(!indices.length)return sizes;
 const total=count(sizes),drop=new Set(indices);
 if(indices.some(i=>!Number.isInteger(i)||i<0||i>=total))throw new Error('Removal index out of range.');
 const out=new Map([...sizes].map(([k,b])=>[k,Buffer.alloc(b.length)])),used=new Map([...sizes.keys()].map(k=>[k,0]));
 let g=0;for(const [k,i] of walk(sizes))if(!drop.has(g++)){sizes.get(k).copy(out.get(k),used.get(k),i*k,i*k+k);used.set(k,used.get(k)+k);}
 const next=new Map();for(const [k,b] of out)if(used.get(k))next.set(k,Buffer.from(b.subarray(0,used.get(k))));return next;
}
const hasPrefix=(buf,k,hash)=>{let lo=0,hi=buf.length/k-1;while(lo<=hi){const mid=(lo+hi)>>1,c=cmpAt(buf,mid*k,k,hash,0,k);if(!c)return true;if(c<0)lo=mid+1;else hi=mid-1;}return false;};

function write(file,data,mode=0o600){const temporary=file+'.'+randomUUID()+'.tmp';let fd;try{fs.mkdirSync(path.dirname(file),{recursive:true});fd=fs.openSync(temporary,'wx',mode);fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch{}}}

function createSafeBrowsing({directory,fetch=globalThis.fetch,now=Date.now,env=process.env,setTimer=setTimeout,random=Math.random,maxBytes=MAX_TOTAL,clientId='acira-browser',clientVersion='0.1.0'}={}){
 if(typeof directory!=='string'||!directory)throw new Error('Safe Browsing needs a data directory.');
 const keyPath=path.join(directory,'safe-browsing.json'),dataDir=path.join(directory,'safe-browsing'),metaPath=path.join(dataDir,'meta.json'),listFile=l=>path.join(dataDir,l.id+'.json');
 const lists=LISTS.map(d=>({...d,state:'',sizes:new Map(),checksum:'',updatedAt:0,bytes:0})),updatePace={until:0,failures:0},findPace={until:0,failures:0},positive=new Map(),negative=new Map();
 let fileKey='',started=false,timer=null,generation=0,nextAt=null,inflight=null,gate=Promise.resolve(),lastError=null,lastUpdate=0;
 try{const saved=JSON.parse(fs.readFileSync(keyPath,'utf8')).apiKey;if(validKey(saved))fileKey=saved;}catch{/* No saved key: the module stays off. */}
 // The environment variable wins so a developer can try a key without touching the saved one.
 const apiKey=()=>validKey(env&&env.ACIRA_SAFE_BROWSING_KEY)?env.ACIRA_SAFE_BROWSING_KEY:fileKey;
 // The key travels as ?key= in every request URL, so anything that can echo a URL or a message is scrubbed before it is stored or returned.
 const scrub=error=>{let text=String(error&&error.message||error||'Unknown error');if(error&&error.cause&&error.cause.code)text+=' ('+error.cause.code+')';for(const k of [env&&env.ACIRA_SAFE_BROWSING_KEY,fileKey])if(typeof k==='string'&&k.length>=8)text=text.split(k).join('[key]');return text.replace(/([?&]key=)[^&\s"']*/gi,'$1[key]').slice(0,300);};

 function serialize(l){const prefixes={};for(const [k,b] of l.sizes)prefixes[k]=b.toString('base64');return JSON.stringify({schema:1,threatType:l.threatType,platformType:l.platformType,state:l.state,checksum:l.checksum,updatedAt:l.updatedAt,prefixes});}
 // A list file is trusted only if its stored checksum matches the prefixes it holds; anything else starts that list empty so it is fetched in full.
 function loadList(l){try{const file=listFile(l),size=fs.statSync(file).size;if(size>maxBytes-lists.reduce((s,x)=>s+x.bytes,0))return;const v=JSON.parse(fs.readFileSync(file,'utf8'));
  if(v.schema!==1||v.threatType!==l.threatType||v.platformType!==l.platformType||typeof v.state!=='string'||!v.state||typeof v.checksum!=='string'||!Number.isFinite(v.updatedAt)||!v.prefixes||typeof v.prefixes!=='object')return;
  const sizes=new Map();for(const [key,text] of Object.entries(v.prefixes)){const k=Number(key),b=Buffer.from(String(text),'base64');if(!Number.isInteger(k)||k<4||k>32||!b.length||b.length%k)return;sizes.set(k,b);}
  if(!checksumOf(sizes).equals(Buffer.from(v.checksum,'base64')))return;Object.assign(l,{state:v.state,sizes,checksum:v.checksum,updatedAt:v.updatedAt,bytes:size});}catch{/* Missing or damaged file. */}}
 lists.forEach(loadList);
 try{const m=JSON.parse(fs.readFileSync(metaPath,'utf8'));if(m.schema===1){if(Number.isFinite(m.lastUpdate)&&m.lastUpdate<=now())lastUpdate=m.lastUpdate;if(Number.isFinite(m.until))updatePace.until=Math.min(Math.max(m.until,0),now()+DAY);if(Number.isInteger(m.failures)&&m.failures>=0)updatePace.failures=Math.min(m.failures,16);}}catch{/* First run. */}
 // Pacing survives restarts so quitting and reopening the browser cannot beat a minimum wait.
 const saveMeta=()=>{try{write(metaPath,JSON.stringify({schema:1,lastUpdate,until:updatePace.until,failures:updatePace.failures}));}catch{/* Pacing falls back to memory. */}};

 async function post(method,body){
  let res;try{res=await fetch(API+method+'?key='+encodeURIComponent(apiKey()),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(TIMEOUT)});}catch(error){throw new Error('Safe Browsing request failed: '+scrub(error));}
  const text=res.ok&&Number(res.headers&&res.headers.get&&res.headers.get('content-length'))>MAX_RESPONSE?'':await res.text();
  if(!res.ok){let detail='';try{detail=': '+String(JSON.parse(text).error.message).slice(0,120);}catch{}throw new Error('Safe Browsing answered HTTP '+res.status+scrub(detail)+'.');}
  if(!text||text.length>MAX_RESPONSE)throw new Error('Safe Browsing response is missing or exceeds the size limit.');
  try{return JSON.parse(text);}catch{throw new Error('Safe Browsing sent an unreadable response.');}
 }

 const requestBody=()=>({client:{clientId,clientVersion},listUpdateRequests:lists.map(l=>({threatType:l.threatType,platformType:l.platformType,threatEntryType:'URL',...(l.state?{state:l.state}:{}),constraints:{maxUpdateEntries:MAX_ENTRIES,maxDatabaseEntries:MAX_ENTRIES,supportedCompressions:['RAW']}}))});
 function applyList(l,r){
  const full=r.responseType==='FULL_UPDATE';
  if(!full&&(r.responseType!=='PARTIAL_UPDATE'||!l.state))throw new Error('Unusable update for '+l.id+'.');
  if(typeof r.newClientState!=='string'||!r.newClientState||!r.checksum||typeof r.checksum.sha256!=='string')throw new Error('Update for '+l.id+' has no state or checksum.');
  // Removals apply first (they index the list as we hold it), then additions are merged in.
  const sizes=new Map(full?[]:removeAt(l.sizes,removals(r.removals)));
  for(const [k,b] of additions(r.additions))sizes.set(k,mergeSorted(sizes.get(k)||EMPTY,b,k));
  const sum=checksumOf(sizes);return {sizes,sum,ok:sum.equals(Buffer.from(r.checksum.sha256,'base64')),state:r.newClientState};
 }
 function commit(l,next){const fields={state:next.state,sizes:next.sizes,checksum:next.sum.toString('base64'),updatedAt:now()},data=serialize({...l,...fields}),bytes=Buffer.byteLength(data);if(bytes+lists.reduce((s,x)=>s+(x===l?0:x.bytes),0)>maxBytes)throw new Error('Safe Browsing lists exceed the size limit.');write(listFile(l),data);Object.assign(l,fields,{bytes});}
 function reset(l){Object.assign(l,{state:'',sizes:new Map(),checksum:'',updatedAt:0,bytes:0});try{fs.unlinkSync(listFile(l));}catch{}}

 async function run(){
  try{
   const body=await post('threatListUpdates:fetch',requestBody()),problems=[];
   for(const r of Array.isArray(body&&body.listUpdateResponses)?body.listUpdateResponses:[]){
    const l=r&&r.threatEntryType==='URL'&&lists.find(x=>x.threatType===r.threatType&&x.platformType===r.platformType);if(!l)continue;
    let next;try{next=applyList(l,r);}catch(error){reset(l);problems.push(scrub(error));continue;}
    // A bad checksum means the local copy cannot be trusted: drop it so the next request carries no state and returns the whole list.
    if(!next.ok){reset(l);problems.push('Checksum mismatch on '+l.id+'; the list will be downloaded again.');continue;}
    try{commit(l,next);}catch(error){problems.push(scrub(error));}
   }
   const wait=seconds(body&&body.minimumWaitDuration);lastUpdate=now();lastError=problems[0]||null;updatePace.failures=0;updatePace.until=now()+wait;saveMeta();
   schedule(Math.max(wait,problems.length?5*MINUTE:UPDATE_PERIOD));return {updated:!problems.length,...(problems.length?{reason:'partial',error:problems[0]}:{})};
  }catch(error){
   lastError=scrub(error);updatePace.failures++;updatePace.until=now()+backoffMs(updatePace.failures,random());saveMeta();schedule(updatePace.until-now());return {updated:false,reason:'error',error:lastError};
  }
 }
 // Never more than one update in flight; a manual call inside the server's minimum wait (or a back-off) makes no request.
 function updateNow(){
  if(!apiKey())return Promise.resolve({updated:false,reason:'no-key'});
  if(inflight)return inflight;
  if(updatePace.until>now())return Promise.resolve({updated:false,reason:'wait',retryAt:updatePace.until});
  inflight=run().finally(()=>{inflight=null;});return inflight;
 }
 function schedule(ms){
  clearTimeout(timer);timer=null;nextAt=null;if(!started||!apiKey())return;
  const delay=Math.max(0,Math.round(ms)),mine=++generation;nextAt=now()+delay;timer=setTimer(()=>{if(mine===generation)void updateNow();},delay);if(timer&&typeof timer.unref==='function')timer.unref();
 }
 // The first request goes out at a random point within a minute of starting, as Google asks, and never inside a stored wait.
 function start(){started=true;schedule(Math.max(Math.floor(random()*MINUTE),updatePace.until-now()));return status();}
 function stop(){started=false;generation++;clearTimeout(timer);timer=null;nextAt=null;return status();}

 const remember=(map,key,value)=>{map.delete(key);map.set(key,value);if(map.size>MAX_CACHE)map.delete(map.keys().next().value);};
 function prefixesFor(hash){const out=new Map();for(const l of lists)for(const [k,b] of l.sizes)if(hasPrefix(b,k,hash))out.set(hash.toString('hex',0,k),hash.subarray(0,k));return [...out.values()];}
 const findBody=prefixes=>({client:{clientId,clientVersion},clientStates:lists.filter(l=>l.state).map(l=>l.state),threatInfo:{threatTypes:THREATS,platformTypes:PLATFORMS,threatEntryTypes:['URL'],threatEntries:prefixes.map(p=>({hash:p.toString('base64')}))}});
 // Cache rules from Google's caching page: a live positive entry means unsafe; an expired one forces a new lookup; a live negative entry on the prefix means safe.
 function decide(c){
  const t=now(),hits=[];
  for(const h of c.hashes){const prefixes=prefixesFor(h);if(prefixes.length)hits.push({key:h.toString('hex'),prefixes});}
  if(!hits.length)return {done:{safe:true,checked:true}};
  for(const x of hits){const e=positive.get(x.key);if(e&&e.expires>t)return {done:{safe:false,threat:e.threat,checked:true}};}
  const need=new Map();
  for(const x of hits){const stale=positive.has(x.key);for(const p of x.prefixes){const hex=p.toString('hex');if(stale||!(negative.get(hex)>t))need.set(hex,p);}}
  return need.size?{need,hits}:{done:{safe:true,checked:true}};
 }
 async function lookup(c){
  const d=decide(c);if(d.done)return d.done;
  if(findPace.until>now())return {safe:true,checked:false,error:'Safe Browsing asked for a pause before the next lookup.'};
  try{
   // Only the prefixes that matched locally are sent, never the URL, a host or a path.
   const body=await post('fullHashes:find',findBody([...d.need.values()])),t=now(),matched=new Map();
   for(const m of Array.isArray(body&&body.matches)?body.matches:[]){
    const full=m&&m.threat&&typeof m.threat.hash==='string'?Buffer.from(m.threat.hash,'base64'):null;if(!full||full.length!==32||!THREATS.includes(m.threatType))continue;
    const key=full.toString('hex');if(matched.has(key))continue;
    // Terms of service: never treat data older than 30 minutes as grounds for a warning, whatever cacheDuration says.
    matched.set(key,m.threatType);remember(positive,key,{threat:m.threatType,expires:t+Math.min(seconds(m.cacheDuration),POSITIVE_CAP)});
   }
   const safeUntil=t+seconds(body&&body.negativeCacheDuration);if(safeUntil>t)for(const hex of d.need.keys())remember(negative,hex,safeUntil);
   for(const x of d.hits)if(!matched.has(x.key))positive.delete(x.key);
   findPace.failures=0;findPace.until=t+seconds(body&&body.minimumWaitDuration);
   const hit=d.hits.find(x=>matched.has(x.key));return hit?{safe:false,threat:matched.get(hit.key),checked:true}:{safe:true,checked:true};
  }catch(error){findPace.failures++;findPace.until=now()+backoffMs(findPace.failures,random());return {safe:true,checked:false,error:scrub(error)};}
 }
 // Cache and local hits answer immediately; network lookups run one at a time so concurrent pages never ask for the same prefix twice. Failures never block browsing.
 function checkUrl(url){
  let c=null;try{const t=apiKey()&&lists.some(l=>l.state)?target(url):null;c=t&&{hashes:expressionsOf(t).map(hashExpression)};}catch{}
  if(!c)return Promise.resolve({safe:true,checked:false});
  try{const d=decide(c);if(d.done)return Promise.resolve(d.done);}catch(error){return Promise.resolve({safe:true,checked:false,error:scrub(error)});}
  const job=gate.then(()=>lookup(c)).catch(error=>({safe:true,checked:false,error:scrub(error)}));gate=job.then(()=>{},()=>{});return job;
 }

 function status(){
  const key=apiKey(),ready=lists.every(l=>l.state);
  return {state:!key?'off-no-key':ready?'ready':lastError?'error':'initializing',hasKey:!!key,
   lists:THREATS.map(type=>{const own=lists.filter(l=>l.threatType===type);return {type,prefixes:own.reduce((sum,l)=>sum+count(l.sizes),0),updatedAt:own.every(l=>l.state)?Math.min(...own.map(l=>l.updatedAt)):null};}),
   lastUpdate:lastUpdate||null,nextUpdate:key?nextAt:null,lastError};
 }
 function setKey(key){
  if(!validKey(key))throw new Error('That does not look like a Safe Browsing API key (30 to 60 letters, digits, - or _).');
  write(keyPath,JSON.stringify({apiKey:key}),0o600);fileKey=key;lastError=null;updatePace.until=0;updatePace.failures=0;findPace.until=0;findPace.failures=0;
  if(started)schedule(Math.floor(random()*MINUTE));return status();
 }
 function clearKey(){
  try{fs.unlinkSync(keyPath);}catch(error){if(error.code!=='ENOENT')throw new Error('Could not remove the saved Safe Browsing key.');}
  fileKey='';lastError=null;positive.clear();negative.clear();if(!apiKey())schedule(0);return status();
 }
 return {start,stop,updateNow,checkUrl,status,setKey,clearKey};
}
module.exports={createSafeBrowsing,canonicalize,expressions,hashExpression,backoffMs,validKey,LISTS};
