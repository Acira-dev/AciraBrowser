'use strict';
// Beta.11 and later ask update.acirabrowser.com first and the frozen GitHub feed only when the first gives no usable answer (update-hosts.cjs).
// The rules, written down once (docs/launch/UPDATE_HOST.md, "What beta.11's updater does"):
//   1. The first address is asked first, at every check. Only when it gives NO USABLE DOCUMENT is the next one asked: a connection, DNS or TLS error, no
//      answer within PRIMARY_WITHIN, an HTTP 4xx or 5xx (404 included), a body that is not a channel document, or one without a valid version.
//   2. A usable document from the first address is final, whatever it says: "nothing new", a halt, an older version. The next address is not asked.
//   3. An answer from a later address (the frozen GitHub feed) counts only if it offers a version STRICTLY NEWER than the running one and than any update
//      already found or downloaded. Anything else is "the first address was down and nothing new was found": the check fails like an offline one (the
//      retry ladder runs), and it can never pull a downloaded update, switch the app to "up to date" or look like a halt. Once GitHub is frozen it says
//      beta.11, so for beta.11 and later it can only help in an emergency (a one-off newer build written there, docs/launch/UPDATE_HOST.md).
//   4. Nothing is remembered: every check starts with the first address. A file is downloaded from the address its own document names.
// This module is pure (no electron-updater import at load); createFeedProviderClass builds the electron-updater provider that applies the rules.
const PRIMARY_WITHIN=15*1000,FALLBACK_WITHIN=30*1000; // the whole look is given up after 60 s (app-updater.cjs CHECK_WITHIN)
const VERSION=/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** True when version a is lower than b in semver order, as electron-updater compares them (a release is above its pre-releases, numeric
 *  pre-release fields compare as numbers: beta.9 < beta.10, beta.11 < beta.11.1 < beta.12); false when either is not a version. */
function lowerThan(a,b){
 const parse=value=>{const m=VERSION.exec(String(value??'').trim());return m?{core:[+m[1],+m[2],+m[3]],pre:m[4]?m[4].split('.'):[]}:null;};
 const x=parse(a),y=parse(b);if(!x||!y)return false;
 for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]<y.core[i];
 if(!x.pre.length||!y.pre.length)return x.pre.length>0&&!y.pre.length;
 for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
  const p=x.pre[i],q=y.pre[i];
  if(p===undefined)return true;if(q===undefined)return false;if(p===q)continue;
  const pn=/^\d+$/.test(p),qn=/^\d+$/.test(q);
  return pn&&qn?Number(p)<Number(q):pn!==qn?pn:p<q; // numeric fields sort below alphanumeric ones
 }
 return false;
}
const isVersion=value=>typeof value==='string'&&VERSION.test(value.trim());
/** The higher of two versions (either may be null/invalid); null when neither is a version. */
function highestOf(a,b){
 if(!isVersion(a))return isVersion(b)?b:null;
 if(!isVersion(b))return a;
 return lowerThan(a,b)?b:a;
}
/** A channel document is usable when it is an object with a valid version and either a files list or a path (the placeholder 0.0.0 with no files is usable: it offers nothing). */
function usableDocument(doc){
 if(!doc||typeof doc!=='object'||Array.isArray(doc))return false;
 if(!isVersion(doc.version))return false;
 return Array.isArray(doc.files)||typeof doc.path==='string';
}
const coded=(code,message)=>Object.assign(new Error(message),{code});
/** Runs run(token) and gives up after ms (the token is cancelled so the request is aborted; a late answer is ignored). */
function within(run,ms,makeToken){
 return new Promise((resolve,reject)=>{
  const token=makeToken?makeToken():null;let done=false;
  const timer=setTimeout(()=>{if(done)return;done=true;try{token?.cancel?.();}catch{/* already over */}reject(coded('ERR_UPDATE_CHECK_TIMEOUT','The update server did not answer in '+Math.round(ms/1000)+' s.'));},ms);
  timer.unref?.();
  Promise.resolve().then(()=>run(token)).then(value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);},error=>{if(done)return;done=true;clearTimeout(timer);reject(error);});
 });
}
const channelUrl=(feedUrl,channelFile)=>new URL(channelFile,feedUrl.endsWith('/')?feedUrl:feedUrl+'/').href;

/**
 * Reads one channel document by the rules above. feeds: [{name,url}], in order. request(url, token) resolves the body text (or throws); parse(text, file, url)
 * returns the document (electron-updater's parseUpdateInfo, or JSON.parse). current: the running version; floor(): the version of any update already found or
 * downloaded (or null). Resolves {info, feed, failures}; throws one error when no address gave a usable, acceptable answer (code ERR_UPDATE_FEEDS_UNAVAILABLE
 * when there was more than one address, otherwise the address's own error).
 */
async function readChannel({feeds,channelFile,request,parse,current,floor=()=>null,primaryWithin=PRIMARY_WITHIN,fallbackWithin=FALLBACK_WITHIN,makeToken=null}){
 const failures=[];
 for(let index=0;index<feeds.length;index++){
  const feed=feeds[index],url=channelUrl(feed.url,channelFile);
  try{
   const text=await within(token=>request(url,token),index===0?primaryWithin:fallbackWithin,makeToken);
   const info=parse(text,channelFile,url);
   if(!usableDocument(info))throw coded('ERR_UPDATER_INVALID_UPDATE_INFO',url+' is not a channel document.');
   if(index>0){ // rule 3
    const known=highestOf(current,floor?.());
    if(!lowerThan(known,info.version))throw coded('ERR_UPDATE_FEED_NOT_NEWER',url+' offers '+info.version+', which is not newer than '+known+'.');
   }
   return {info,feed,failures};
  }catch(error){failures.push({feed:feed.name,url,error});}
 }
 if(failures.length===1)throw failures[0].error;
 const first=failures[0].error;
 throw Object.assign(new Error(String(first?.message||first).replace(/\s+/g,' ').slice(0,160)+' (nothing newer was found on the older address either)'),{code:'ERR_UPDATE_FEEDS_UNAVAILABLE',failures});
}
/** The request headers without the install's staging id: electron-updater sends it on every check, but a static feed has no use for it (the share is
 *  decided on this computer from .updaterId), so the host never learns a stable id for this install. */
function withoutStagingId(headers){
 if(!headers||typeof headers!=='object')return headers;
 const kept={};for(const [key,value] of Object.entries(headers))if(key.toLowerCase()!=='x-user-staging-id')kept[key]=value;
 return Object.keys(kept).length?kept:null;
}
/**
 * The electron-updater provider that applies the rules: a GenericProvider whose getLatestVersion walks the feeds. Built on first use so that this module
 * can be required where electron-updater is not (tests pass what it would import). setFeedURL({provider:'custom', updateProvider: <this class>, feeds,
 * floor, primaryWithin, fallbackWithin}).
 */
function createFeedProviderClass(deps={}){
 const {GenericProvider}=deps.GenericProvider?deps:require('electron-updater/out/providers/GenericProvider');
 const parseUpdateInfo=deps.parseUpdateInfo||require('electron-updater/out/providers/Provider').parseUpdateInfo;
 const {getChannelFilename,newBaseUrl}=deps.util||require('electron-updater/out/util');
 const CancellationToken=deps.CancellationToken||(()=>{try{return require('builder-util-runtime').CancellationToken;}catch{return null;}})();
 return class AciraFeedProvider extends GenericProvider{
  constructor(options,updater,runtimeOptions){
   const feeds=(options?.feeds||[]).filter(feed=>feed&&typeof feed.url==='string');
   if(!feeds.length)throw new Error('The update feed list is empty.');
   // GitHub's CDN answers a multi-range request with 501, so electron-updater is told not to send one
   super({provider:'generic',url:feeds[0].url},updater,{...runtimeOptions,isUseMultipleRangeRequest:false});
   this.options=options;this.feeds=feeds;this.answeredBy=null;
  }
  setRequestHeaders(value){super.setRequestHeaders(withoutStagingId(value));}
  async getLatestVersion(){
   const channelFile=getChannelFilename(this.channel);
   const current=this.updater?.currentVersion?.version||this.options.current||null;
   const {info,feed}=await readChannel({
    feeds:this.feeds,channelFile,current,floor:this.options.floor,
    request:(url,token)=>this.httpRequest(new URL(url),undefined,token),
    parse:(text,file,url)=>parseUpdateInfo(text,file,url),
    primaryWithin:this.options.primaryWithin,fallbackWithin:this.options.fallbackWithin,
    makeToken:CancellationToken?()=>new CancellationToken():null,
   });
   this.baseUrl=newBaseUrl(feed.url);this.answeredBy=feed.name; // relative file names in the document are the answering address's
   return info;
  }
 };
}
module.exports={PRIMARY_WITHIN,FALLBACK_WITHIN,lowerThan,isVersion,highestOf,usableDocument,readChannel,withoutStagingId,createFeedProviderClass};
