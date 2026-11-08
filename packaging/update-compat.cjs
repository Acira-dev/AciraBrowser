'use strict';
// The check scripts/publish-update.mjs runs after the payloads are verified and BEFORE it switches the feed (beta.14, item 14, "updates that always get through").
// A publish must never leave someone on an older version with no way to the new one. For every version still in use (beta.8 and later), on every platform
// this publish writes, it reads the documents exactly as that version's updater does (update-feeds.cjs readChannel: the first address, the next only when the
// first gives nothing usable) from what WILL be live: the planned documents where this publish writes them, the live documents everywhere else, and it checks
//   - the version is offered something newer than itself, and a version that can only read the frozen GitHub feed is offered a version that goes on (beta.11);
//   - the files are named the way its updater picks them (Mac: one ZIP for each architecture, Windows: one setup, Linux: one AppImage), with a SHA-512 of the right
//     shape and a size, and that every one of them (and every blockmap a document points at) is really there, with exactly that size;
//   - the host honours a single Range request (resume, the Windows differential); a host that does not is a warning, since the download then restarts;
//   - the GitHub fallback every beta.11 and later copy has answers with a channel document.
// Any problem stops the publish: the feed is not touched. Pure: the network is `fetch`, so tests run it anywhere.
const semver=require('semver');
const HOSTS=require('../desktop/browser-services/update-hosts.cjs');
const feedRules=require('../desktop/browser-services/update-feeds.cjs');
const U=require('./update-publish.cjs');

const GITHUB=HOSTS.GITHUB_FEED_URL,HOST=HOSTS.HOST_URL,ALL=['mac','windows','linux'];
/** The versions in use that are older than `version`: beta.8 to beta.10 read only the GitHub feed (Linux started with beta.10); beta.11 and later ask the host first and GitHub second. */
function versionsInUse(version){
 // The leading beta number counts, a fix number after it does not: 0.1.0-beta.13.1 is checked against beta.8 to beta.13 (the filter below drops the version itself and anything newer).
 const beta=/^0\.1\.0-beta\.(\d+)(?:\.\d+)?$/.exec(String(version)),last=beta?Math.max(13,Number(beta[1])):13,list=[
  {version:'0.1.0-beta.8',reads:[GITHUB],platforms:['mac','windows']},
  {version:'0.1.0-beta.9',reads:[GITHUB],platforms:['mac','windows']},
  {version:'0.1.0-beta.10',reads:[GITHUB],platforms:ALL},
 ];
 for(let n=11;n<=last;n++)list.push({version:'0.1.0-beta.'+n,reads:[HOST,GITHUB],platforms:ALL});
 return list.filter(item=>semver.lt(item.version,version));
}
const channelFileOf=platform=>U.feedFiles('beta',platform)[0]; // every version in use is a beta build and follows the beta channel
const SHA512=/^[A-Za-z0-9+/]{86}==$/;

/** Asks for the first byte of a file: {size, ranged} when it is there, throws with the reason. A 206 gives the size in content-range; a 200 (Range ignored) in content-length, or by counting. */
async function probe(fetch,url,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),delays=[1000,3000],limit=1024*1024*1024,timeout=30000}={}){
 let last;
 for(let attempt=0;attempt<=delays.length;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);timer.unref?.(); // a stalled connection must stop the publish with a reason, never hang it
  try{
   const response=await fetch(url,{headers:{range:'bytes=0-0'},redirect:'follow',signal:controller.signal});
   if(response.status===206){
    const match=/^bytes\s+0-0\/(\d+)$/i.exec(String(response.headers.get('content-range')||'').trim());
    await response.body?.cancel?.().catch(()=>{});
    if(!match)throw Error('answered 206 without a usable content-range');
    return {size:Number(match[1]),ranged:true};
   }
   if(!response.ok)throw Error('HTTP '+response.status);
   const length=Number(response.headers.get('content-length'));
   if(Number.isSafeInteger(length)&&length>0){await response.body?.cancel?.().catch(()=>{});return {size:length,ranged:false};}
   let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)break;}
   return {size:bytes,ranged:false};
  }catch(error){last=controller.signal.aborted?Error('no answer within '+Math.round(timeout/1000)+' s'):error;if(attempt<delays.length)await sleep(delays[attempt]);}
  finally{clearTimeout(timer);}
 }
 throw Error(String(last?.message||last));
}

/**
 * plan: {version, mode, target:{publicBase}, feeds:[{platform,file,text}]} from scripts/publish-update.mjs. fetch: the anonymous web (the same one the publish uses).
 * Resolves {ok, problems, warnings, paths:[{version,platform,reads,offers,files}], probed}.
 */
async function preflight({plan,fetch,sleep,delays,timeout,assumePlanned=false}){
 const problems=[],warnings=[],paths=[];
 // rehearsal/ and testers/ documents are read by nobody's installed app: they are not part of any update path
 const feedsLive=(plan.feeds||[]).filter(feed=>!/^(?:rehearsal|testers)\//.test(String(feed.file)));
 const planned=new Map();for(const feed of feedsLive)planned.set((plan.target?.publicBase||HOST)+feed.file,feed.text);
 const platforms=ALL.filter(platform=>feedsLive.some(feed=>feed.platform===platform));
 if(!platforms.length)return {ok:true,problems,warnings,paths,probed:0,skipped:'this publish writes no channel document'};
 // the documents as they will be live, read once each
 const documents=new Map();
 async function textOf(url){
  if(planned.has(url))return planned.get(url);
  if(!documents.has(url))documents.set(url,(async()=>{
   const response=await fetch(url,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Object.assign(Error('HTTP '+response.status),{code:'ERR_UPDATE_HTTP'});
   return response.text();
  })());
  return documents.get(url);
 }
 // assumePlanned (a dry run): the files this publish will upload are not on GitHub yet; they are taken as there, with the planned size
 const assumed=new Map(assumePlanned?(plan.releases||[]).flatMap(release=>release.assets.map(asset=>[asset.url,asset.size])):[]);
 const files=new Map(); // url -> Promise<{size,ranged}|Error>
 const there=url=>{if(!files.has(url))files.set(url,assumed.has(url)?Promise.resolve({size:assumed.get(url),ranged:true}):probe(fetch,url,{sleep,delays,timeout}).catch(error=>error));return files.get(url);};
 const checked=new Set(); // one set of file checks per (document url): versions that read the same document share it
 async function checkFiles({platform,base,file,info,files:resolved,label}){
  const key=base+'|'+file+'|'+info.version;if(checked.has(key))return resolved.length;checked.add(key);
  const here=text=>label+': '+text;
  if(!resolved.length){problems.push(here('the document offers '+info.version+' with no files.'));return 0;}
  const pick=platform==='mac'?{zip:resolved.filter(item=>/\.zip$/i.test(item.url.pathname))}:platform==='windows'?{exe:resolved.filter(item=>/\.exe$/i.test(item.url.pathname))}:{image:resolved.filter(item=>/\.AppImage$/i.test(item.url.pathname))};
  if(platform==='mac'){
   const {MacUpdater}=require('electron-updater/out/MacUpdater'),offered=pick.zip.map(item=>U.macArchOf(item.url.href));
   if(offered.includes(null))problems.push(here('a ZIP is not named AciraBrowser-<version>-mac-<arch>-update.zip, so no Mac can tell which architecture it is.'));
   for(const [isArm,arch] of [[true,'arm64'],[false,'x64']]){
    const chosen=MacUpdater.filterFilesForArch(resolved,isArm).filter(item=>/\.zip$/i.test(item.url.pathname));
    if(!offered.includes(arch))warnings.push(here('no '+arch+' Mac ZIP: '+arch+' Macs see failed update checks.'));
    else if(chosen.length!==1||!chosen[0].url.href.includes('-'+arch+'-'))problems.push(here(arch+' Macs would not be handed exactly one '+arch+' archive.'));
   }
  }else{
   const list=Object.values(pick)[0];
   if(list.length!==1)problems.push(here('expected exactly one '+(platform==='windows'?'setup (.exe)':'AppImage')+', the document names '+list.length+'.'));
  }
  const targets=[...resolved.map(item=>({url:item.url.href,info:item.info,what:'file'})),...(Array.isArray(info.previousBlockMaps)?info.previousBlockMaps.filter(entry=>typeof entry?.url==='string').map(entry=>({url:new URL(entry.url,base).href,what:'blockmap'})):[])];
  await Promise.all(targets.map(target=>there(target.url))); // all asked for at once (a dead host costs one timeout, not one for each file)
  for(const target of targets){
   if(target.what==='file'){
    const {sha512,size}=target.info;
    if(typeof sha512!=='string'||!SHA512.test(sha512))problems.push(here(target.url+' has no SHA-512 of the right shape ('+String(sha512).slice(0,20)+').'));
    if(!Number.isSafeInteger(size)||size<=0)problems.push(here(target.url+' has no size.'));
   }
   const found=await there(target.url);
   if(found instanceof Error){problems.push(here('the '+target.what+' '+target.url+' is not there ('+found.message+'): a document that names it would leave people with a failed download.'));continue;}
   if(target.what==='file'&&Number.isSafeInteger(target.info.size)&&found.size!==target.info.size)problems.push(here(target.url+' is '+found.size+' bytes there, the document says '+target.info.size+'.'));
   if(!found.ranged&&target.what==='file')warnings.push(here(target.url+' does not honour a Range request: a download that drops starts again from zero (and the Windows differential cannot run).'));
  }
  return resolved.length;
 }
 for(const item of versionsInUse(plan.version)){
  for(const platform of item.platforms.filter(name=>platforms.includes(name))){
   const file=channelFileOf(platform),label=item.version+' on '+platform;
   const feeds=item.reads.map((url,index)=>({name:index?'fallback':'primary',url}));
   let read;
   try{
    read=await feedRules.readChannel({feeds,channelFile:file,current:item.version,floor:()=>null,request:url=>textOf(url),parse:text=>U.parseFeed(text)});
   }catch(error){problems.push(label+': cannot read '+file+' the way that version does ('+String(error?.message||error).slice(0,160)+'). It has no way to update.');continue;}
   const {info,feed}=read,base=new URL(feed.url.endsWith('/')?feed.url:feed.url+'/').href;
   if(!semver.gt(info.version,item.version)){problems.push(label+': the document it reads ('+base+file+') offers '+info.version+', not newer than itself.');continue;}
   if(info.stagingPercentage!==undefined&&Number(info.stagingPercentage)===0&&info.version===plan.version){problems.push(label+': '+file+' offers '+info.version+' to nobody (halted).');continue;}
   // a version that only reads the frozen GitHub feed must be offered one that goes on to the new version
   if(item.reads.length===1&&info.version!==plan.version&&!versionsInUse(plan.version).some(other=>other.version===info.version&&other.reads.length>1))problems.push(label+': the GitHub feed offers '+info.version+', which does not read the host that carries '+plan.version+'. It would stop there.');
   let resolved;try{resolved=U.readWithUpdater(U.serializeFeed(info),{file:channelFileOf(platform).split('/').pop(),baseUrl:base}).files;}catch(error){problems.push(label+': '+file+' cannot be read by electron-updater ('+error.message+').');continue;}
   const count=await checkFiles({platform,base,file,info,files:resolved,label:label+' ('+base+file+')'});
   paths.push({version:item.version,platform,reads:base+file,offers:info.version,files:count});
  }
 }
 // the GitHub fallback of beta.11 and later answers with a channel document (it is only asked when the host gives none, and it is frozen: it must not be a trap)
 for(const platform of platforms){
  const url=new URL(channelFileOf(platform),GITHUB).href;
  try{if(!feedRules.usableDocument(U.parseFeed(await textOf(url))))warnings.push('The GitHub fallback '+url+' is not a channel document: beta.11 and later copies have no emergency path.');}
  catch(error){warnings.push('The GitHub fallback '+url+' cannot be read ('+error.message+'): beta.11 and later copies have no emergency path.');}
 }
 return {ok:problems.length===0,problems,warnings:[...new Set(warnings)],paths,probed:files.size};
}
module.exports={preflight,versionsInUse,probe,GITHUB,HOST};
