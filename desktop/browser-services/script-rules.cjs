'use strict';
const {parse}=require('tldts');
// Per-site script blocking (beta.11). Electron has no per-site JavaScript setting, and webPreferences.javascript is fixed when a page's renderer is made, so a
// blocked site's documents get a response header: the sandbox without allow-scripts (scripting is off for the document and <noscript> content shows, as in a
// browser with JavaScript off) plus script-src 'none' (belt and braces). Every allow-* flag but allow-scripts stays, so forms, links, pop-ups, downloads and
// the site's own origin keep working. Only HTML documents get it (a PDF in a sandboxed document would not open).
//
// Two ways a document can skip the header, both answered here (probed in Electron 44.9.3, 5 Nov 2026):
//  - a navigation answered by a service worker never reaches webRequest, so a blocked site's service workers are cleared when it becomes blocked and
//    whenever one registers on it;
//  - the back/forward cache restores an old document with no request at all. Every response the header was added to is stamped; a blocked site's page that
//    commits with no stamp is reloaded once (after its service workers are cleared).
const SANDBOX_FLAGS=['allow-same-origin','allow-forms','allow-popups','allow-popups-to-escape-sandbox','allow-modals','allow-downloads','allow-top-navigation','allow-pointer-lock','allow-presentation','allow-orientation-lock','allow-storage-access-by-user-activation'];
const SCRIPT_POLICY=`sandbox ${SANDBOX_FLAGS.join(' ')}; script-src 'none'; object-src 'none'`;
const KEY='scripts:',MODE_KEY='scripts:*',LIMIT=100;
const HTML=/^\s*(?:text\/html|application\/xhtml\+xml)\b/i;

/** The site a page belongs to: its registrable domain (private suffixes such as github.io count as one), which covers its subdomains; an IP address, localhost or a single-label host is its own site. '' for anything that is not an http(s) page address. */
function siteOfUrl(url){
 let u;try{u=new URL(String(url));}catch{return '';}
 if(u.protocol!=='http:'&&u.protocol!=='https:')return '';
 return siteOfHost(u.hostname);
}
function siteOfHost(hostname){
 const host=String(hostname||'').toLowerCase().replace(/\.$/,'');
 if(!host||host.length>253)return '';
 const parsed=parse(host,{allowPrivateDomains:true});
 if(parsed.isIp)return host;
 return parsed.domain||host;
}
/** What Settings accepts for a site: "mail.example.com", "*.example.com" or "https://example.com/inbox" all name example.com. Throws a plain message for anything else. */
function siteFromInput(text){
 const bare=String(text??'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^\*\./,'').replace(/[/?#].*$/,'').replace(/:\d+$/,'').replace(/\.$/,'');
 const labels=bare.split('.');
 const valid=bare.length>0&&bare.length<=253&&labels.every(label=>/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))&&(labels.length>1||bare==='localhost');
 if(!valid)throw new Error('Enter a site such as mail.example.com.');
 return siteOfHost(bare);
}
const withoutHash=url=>{try{const u=new URL(url);u.hash='';return u.href;}catch{return String(url||'');}};
const headerValue=(headers,name)=>{for(const key of Object.keys(headers||{}))if(key.toLowerCase()===name)return [].concat(headers[key]||[])[0]??'';return null;};

/** A header patch for onHeadersReceived: `{}` unless this is an HTML document of a blocked page, else `{responseHeaders}` with the script policy added beside the site's own. */
function scriptPolicyPatch(details,blocked){
 if(!blocked||!details||(details.resourceType!=='mainFrame'&&details.resourceType!=='subFrame'))return {};
 if(!/^https?:/i.test(String(details.url||''))||!details.responseHeaders)return {};
 const type=headerValue(details.responseHeaders,'content-type'),disposition=headerValue(details.responseHeaders,'content-disposition');
 if(type&&!HTML.test(String(type)))return {};
 if(disposition&&/^\s*attachment\b/i.test(String(disposition)))return {};
 const headers={...details.responseHeaders};
 const name=Object.keys(headers).find(key=>key.toLowerCase()==='content-security-policy')||'Content-Security-Policy';
 headers[name]=[...[].concat(headers[name]||[]),SCRIPT_POLICY];
 return {responseHeaders:headers};
}

/**
 * The rules of each session (one ordinary profile, one private tab or window). Saved in the profile's site-policy table, no migration: a row `scripts:<site>`
 * holds {scripts:'block'|'allow'} and the row `scripts:*` holds {mode:'everywhere'} while "Block scripts everywhere" is on. A private session reads its source
 * profile's rows and keeps what the person changes in memory, so a private visit never reaches the profile's list.
 */
function createScriptRules({database,getOwner=()=>true,contentsOf=()=>null,clearServiceWorkers=async()=>{}}){
 const contexts=new Map(),stamps=new Map(),repairs=new Map(),watched=new Set();
 const isTor=session=>Boolean(session&&(session.__aciraTor||session[Symbol.for('acira.tor.session')]));
 const read=(profileId,site)=>{try{return profileId?database.policy(profileId,KEY+site):null;}catch{return null;}};
 const modeOf=profileId=>{try{return profileId&&database.policy(profileId,MODE_KEY)?.mode==='everywhere'?'everywhere':'default';}catch{return 'default';}};
 const owner=context=>context.privateMode?context.sourceProfileId:context.profileId;
 /** Whether scripts are blocked on `site` in this session. */
 function blockedOn(context,site){
  if(!site||!context)return false;
  if(context.overrides.has(site))return context.overrides.get(site);
  const profile=owner(context),rule=read(profile,site)?.scripts;
  return modeOf(profile)==='everywhere'?rule!=='allow':rule==='block';
 }
 // null clears every worker of the session; anything else must be a real origin, because an address the engine cannot read as one (https://www.127.0.0.1) clears them all too (seen 5 Nov 2026).
 const validOrigin=origin=>{try{const u=new URL(origin);return u.origin!=='null'&&u.origin===origin;}catch{return false;}};
 const clear=(session,origin)=>{if(origin!==null&&!validOrigin(origin))return Promise.resolve();try{return Promise.resolve(clearServiceWorkers(session,origin)).catch(()=>{});}catch{return Promise.resolve();}};
 function attach(session,{profileId,privateMode=false,sourceProfileId}={}){
  if(contexts.has(session))return;
  const context={session,profileId,privateMode:Boolean(privateMode),sourceProfileId:sourceProfileId&&!String(sourceProfileId).startsWith('private-')?sourceProfileId:undefined,overrides:new Map()};
  contexts.set(session,context);
  // A service worker that registers on a blocked site would answer its navigations without the header.
  try{session.serviceWorkers?.on?.('registration-completed',(_event,details)=>{const scope=details?.scope;if(typeof scope!=='string'||isTor(session))return;const site=siteOfUrl(scope);if(blockedOn(context,site)){let origin='';try{origin=new URL(scope).origin;}catch{}if(origin)void clear(session,origin);}});}catch{}
 }
 /** A private session follows the script rules of the profile it was opened from (read only), once; a private profile is never a source. */
 function follow(session,sourceProfileId){const context=contexts.get(session);if(context&&context.privateMode&&!context.sourceProfileId&&typeof sourceProfileId==='string'&&sourceProfileId&&!sourceProfileId.startsWith('private-'))context.sourceProfileId=sourceProfileId;}
 function release(session){contexts.delete(session);}
 /** A response of a blocked site gets the policy; the main frame's is stamped so the commit can tell it was handled. */
 function headers(details,session){
  const context=contexts.get(session);
  if(!context||isTor(session)||!details||(details.resourceType!=='mainFrame'&&details.resourceType!=='subFrame'))return {};
  const wc=contentsOf(details);if(!wc||!getOwner(wc))return {};
  let top=details.url;
  if(details.resourceType==='subFrame'){try{top=details.frame?.top?.url||wc.getURL();}catch{top=wc.getURL();}}
  const site=siteOfUrl(top);
  if(!site||!blockedOn(context,site))return {};
  const patch=scriptPolicyPatch(details,true);
  if(patch.responseHeaders&&details.resourceType==='mainFrame')stamps.set(wc.id,withoutHash(details.url));
  return patch;
 }
 /** Reload a blocked site's page that committed without the policy (answered by a service worker, or restored from the back/forward cache), once. */
 function watch(session,wc){
  if(!wc||watched.has(wc.id))return;
  watched.add(wc.id);
  wc.on('did-navigate',(_event,url)=>{
   try{
    const context=contexts.get(session);if(!context||isTor(session)||!/^https?:/i.test(String(url||'')))return;
    const site=siteOfUrl(url);if(!site||!blockedOn(context,site)){repairs.delete(wc.id);return;}
    const page=withoutHash(url);
    if(stamps.get(wc.id)===page){repairs.delete(wc.id);return;}
    if(repairs.get(wc.id)===page){repairs.delete(wc.id);return;}
    repairs.set(wc.id,page);
    void clear(session,new URL(url).origin).then(()=>{try{if(!wc.isDestroyed()&&withoutHash(wc.getURL())===page)wc.reload();}catch{}});
   }catch{}
  });
  wc.once('destroyed',()=>{watched.delete(wc.id);stamps.delete(wc.id);repairs.delete(wc.id);});
 }
 function statusOf(session,url){
  const context=contexts.get(session),site=siteOfUrl(url);
  if(!context||isTor(session)||!site)return {supported:false,site:'',blocked:false,mode:'default',saved:false};
  const profile=owner(context);
  return {supported:true,site,blocked:blockedOn(context,site),mode:modeOf(profile),saved:!context.privateMode};
 }
 const countOf=(profileId,kind)=>{try{return database.policies(profileId).filter(row=>row.site.startsWith(KEY)&&row.site!==MODE_KEY&&row.scripts===kind).length;}catch{return 0;}};
 /** The person's choice for this page's site. Ordinary sessions save it in the profile; private ones keep it in memory for the session. */
 function set(session,url,blocked){
  const context=contexts.get(session),site=siteOfUrl(url);
  if(!context||isTor(session))throw new Error('Scripts follow the Tor security level here.');
  if(!site)throw new Error('Open a website first.');
  if(typeof blocked!=='boolean')throw new Error('Choose on or off.');
  const before=blockedOn(context,site);
  if(context.privateMode)context.overrides.set(site,blocked);
  else{
   const profile=context.profileId,everywhere=modeOf(profile)==='everywhere',rule=read(profile,site)?.scripts;
   const want=everywhere?(blocked?null:'allow'):(blocked?'block':null);
   if(want&&rule!==want){if(countOf(profile,want)>=LIMIT)throw new Error('The list is full. Remove a site to add another.');database.setPolicy(profile,KEY+site,{scripts:want});}
   else if(!want&&rule&&rule===(everywhere?'allow':'block'))database.deletePolicy(profile,KEY+site);
  }
  const after=blockedOn(context,site);
  if(after&&!before){try{void clear(session,new URL(url).origin);}catch{}}
  return statusOf(session,url);
 }
 /** The hosts a site's pages are usually served from: the site itself and, for a registered domain, its www. An IP address or a single-label host has no www. */
 const originsHosts=site=>{const parsed=parse(site,{allowPrivateDomains:true});return !parsed.isIp&&parsed.domain===site?[site,'www.'+site]:[site];};
 const ordinary=profileId=>{if(typeof profileId!=='string'||!/^[a-z0-9_-]{1,120}$/i.test(profileId)||profileId.startsWith('private-'))throw new Error('Choose an ordinary local profile.');return profileId;};
 const rows=profileId=>{try{return database.policies(profileId).filter(row=>row.site.startsWith(KEY)&&row.site!==MODE_KEY);}catch{return [];}};
 function profileStatus(profileId){
  ordinary(profileId);
  const all=rows(profileId);
  return {mode:modeOf(profileId),blocked:all.filter(row=>row.scripts==='block').map(row=>row.site.slice(KEY.length)).sort(),allowed:all.filter(row=>row.scripts==='allow').map(row=>row.site.slice(KEY.length)).sort(),limit:LIMIT};
 }
 const sessionsOf=profileId=>[...contexts.values()].filter(context=>!context.privateMode&&context.profileId===profileId&&!isTor(context.session));
 /** Settings: the mode, and the blocked or allowed list as the list editor shows it (a whole list replaces the saved one). Throws a plain message for a bad site. */
 function setProfile(profileId,patch){
  ordinary(profileId);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['mode','blocked','allowed'].includes(key)))throw new Error('Invalid script choice.');
  const before=profileStatus(profileId),stale=[];
  if(Object.hasOwn(patch,'mode')){
   if(patch.mode!=='default'&&patch.mode!=='everywhere')throw new Error('Choose how scripts are blocked.');
   if(patch.mode!==before.mode){
    if(patch.mode==='everywhere')database.setPolicy(profileId,MODE_KEY,{mode:'everywhere'});else database.deletePolicy(profileId,MODE_KEY);
    // Every site not allowed becomes blocked: a service worker could still answer its pages with scripts. They register again where scripts run.
    if(patch.mode==='everywhere')for(const context of sessionsOf(profileId))void clear(context.session,null);
   }
  }
  for(const [field,kind] of [['blocked','block'],['allowed','allow']]){
   if(!Object.hasOwn(patch,field))continue;
   const input=patch[field];
   if(!Array.isArray(input)||input.length>LIMIT*2)throw new Error('Choose up to '+LIMIT+' sites.');
   const next=[...new Set(input.map(siteFromInput))];
   if(next.length>LIMIT)throw new Error('The list is full. Remove a site to add another.');
   const current=before[field];
   for(const site of current)if(!next.includes(site))database.deletePolicy(profileId,KEY+site);
   for(const site of next)if(!current.includes(site)||read(profileId,site)?.scripts!==kind){database.setPolicy(profileId,KEY+site,{scripts:kind});if(!current.includes(site))stale.push(site);}
  }
  const now=profileStatus(profileId);
  // A site that just became blocked: clear the service workers of its usual origins (the rest follow when a page loads, see watch()).
  const newlyBlocked=now.mode==='everywhere'?before.allowed.filter(site=>!now.allowed.includes(site)):stale.filter(site=>now.blocked.includes(site));
  if(newlyBlocked.length)for(const context of sessionsOf(profileId))for(const site of newlyBlocked)for(const host of originsHosts(site))void clear(context.session,'https://'+host);
  return now;
 }
 return {attach,follow,release,headers,watch,statusOf,set,profileStatus,setProfile,blockedOn:(session,url)=>{const context=contexts.get(session);return !isTor(session)&&blockedOn(context,siteOfUrl(url));}};
}
module.exports={createScriptRules,scriptPolicyPatch,siteOfUrl,siteFromInput,SCRIPT_POLICY,SANDBOX_FLAGS,LIMIT};
