'use strict';
// One declarativeNetRequest host per ordinary profile session: it gives dnr-engine.cjs each extension's rules and answers the parts of the
// API that depend on enforcement (getMatchedRules, onRuleMatchedDebug, setExtensionActionOptions badge counts). content-blocking.cjs calls
// its participants from the one request pipeline, after Acira's own blocker.
//
// Where the rules come from:
//  - static rulesets: the JSON files the manifest names (declarative_net_request.rule_resources), read off the main thread's critical path
//    (async reads, one ruleset per turn) when the extension loads;
//  - dynamic rules: Chromium keeps them (it validates and stores every updateDynamicRules call) in
//    <partition>/DNR Extension Rules/<id>/rules.json, which is read at load; Acira's own copy under
//    <userData>/extension-dnr/<profile>/<id>.json is the fallback;
//  - each successful update call (dynamic, session, enabled rulesets, static rule switches) is also sent here by the extension's own
//    preload (extension-apis-renderer.cjs) and applied to the engine at once; enabled rulesets and disabled static rules are kept in
//    the same per-profile file.
// Extensions without the declarativeNetRequest permission are never read, and with no rules loaded the pipeline participants return at once.
const fs=require('node:fs'),path=require('node:path');
const {createDnrEngine,fromElectron}=require('./dnr-engine.cjs');
const HOST=Symbol.for('acira.dnr-host-v1');
const failure=message=>({__acira_error:String(message)});
const declaresDnr=manifest=>{const p=Array.isArray(manifest?.permissions)?manifest.permissions:[];return p.includes('declarativeNetRequest')||p.includes('declarativeNetRequestWithHostAccess');};
const safeKey=value=>String(value||'default').replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,80);
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const MAX_RULESET_BYTES=64*1024*1024,SLICE=4000;

/** Does one of the extension's host patterns cover this URL? (redirect and modifyHeaders need host access, as in Chrome) */
function hostAccessFor(manifest){
 const patterns=[...(Array.isArray(manifest?.host_permissions)?manifest.host_permissions:[]),...(Array.isArray(manifest?.permissions)?manifest.permissions:[]).filter(p=>typeof p==='string'&&(p==='<all_urls>'||p.includes('://')))];
 if(!patterns.length)return ()=>false;
 if(patterns.includes('<all_urls>')||patterns.includes('*://*/*'))return ()=>true;
 const compiled=patterns.map(p=>{const m=/^(\*|https?|wss?|ftp):\/\/(\*|\*\.[^/]+|[^/*]+)(\/.*)$/.exec(p);if(!m)return null;return {scheme:m[1],host:m[2],path:new RegExp('^'+m[3].replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$')};}).filter(Boolean);
 const covers=url=>{let u;try{u=new URL(url);}catch{return false;}const scheme=u.protocol.slice(0,-1),host=u.hostname;return compiled.some(p=>(p.scheme===scheme||(p.scheme==='*'&&/^(?:https?|wss?)$/.test(scheme)))&&(p.host==='*'||p.host===host||(p.host.startsWith('*.')&&(host===p.host.slice(2)||host.endsWith(p.host.slice(1)))))&&p.path.test(u.pathname+u.search));};
 return (url,initiator)=>covers(url)&&(!initiator||covers(initiator));
}

function attachDnrHost({session,router,userData,storeKey='default',emit=()=>{},getExtension=()=>null,log=()=>{}}){
 if(!session)return null;
 if(session[HOST])return session[HOST];
 const extensions=session.extensions||session;
 const dir=path.join(userData||'.','extension-dnr',safeKey(storeKey));
 const states=new Map(),loads=new Map(),sessionRules=new Map(),manifests=new Map(),timings=new Map(),badges=new Map();
 const engine=createDnrEngine({onMatch});
 let feedback=new Set();

 const stateFile=id=>path.join(dir,id+'.json');
 function readState(id){try{const value=JSON.parse(fs.readFileSync(stateFile(id),'utf8'));return value&&value.version===1?value:null;}catch{return null;}}
 const writes=new Map();
 function saveState(id){
  if(writes.has(id))return;
  writes.set(id,setTimeout(()=>{writes.delete(id);const state=states.get(id);if(!state)return;try{fs.mkdirSync(dir,{recursive:true});const file=stateFile(id);fs.writeFileSync(file+'.tmp',JSON.stringify({version:1,...state}));fs.renameSync(file+'.tmp',file);}catch(error){log('dnr state not saved',error.message);}},500));
  writes.get(id).unref?.();
 }
 // Chromium's own copies (written by its declarativeNetRequest implementation for this partition).
 function nativeDynamicRules(id){try{const file=path.join(session.storagePath||'','DNR Extension Rules',id,'rules.json');const value=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(value)?value:null;}catch{return null;}}
 // Chromium keeps the enabled static rulesets by its internal number: the ruleset's place in the manifest's rule_resources, from 1.
 const nativeSettings=id=>{try{return JSON.parse(fs.readFileSync(path.join(session.storagePath||'','Preferences'),'utf8'))?.extensions?.settings?.[id]||null;}catch{return null;}};
 function nativeEnabledRulesets(settings,resources){const value=settings?.dnr_enabled_ruleset_ids;if(!Array.isArray(value))return null;const ids=value.map(v=>Number.isInteger(v)?resources[v-1]?.id:typeof v==='string'?v:null).filter(Boolean);return ids.length===value.length?ids:null;}

 async function readRuleset(extension,resource){
  const root=path.resolve(extension.path),file=path.resolve(root,String(resource.path||'').replace(/^\/+/,''));
  if(!file.startsWith(root+path.sep))throw new Error('ruleset path leaves the extension');
  const stat=await fs.promises.stat(file);if(stat.size>MAX_RULESET_BYTES)throw new Error('ruleset too large');
  const text=await fs.promises.readFile(file,'utf8');await turn();
  const rules=JSON.parse(text);if(!Array.isArray(rules))throw new Error('ruleset is not a list');
  return rules;
 }
 const resourcesOf=manifest=>{const list=manifest?.declarative_net_request?.rule_resources;return Array.isArray(list)?list.filter(r=>r&&typeof r.id==='string'&&typeof r.path==='string').slice(0,100):[];};

 function load(extension){
  const id=extension?.id,manifest=extension?.manifest;
  if(!id||!declaresDnr(manifest))return Promise.resolve(false);
  manifests.set(id,{manifest,path:extension.path});
  const permissions=Array.isArray(manifest.permissions)?manifest.permissions:[];
  if(permissions.includes('declarativeNetRequestFeedback'))feedback.add(id);else feedback.delete(id);
  const job=(async()=>{
   const started=performance.now(),saved=readState(id),resources=resourcesOf(manifest),settings=nativeSettings(id);
   const enabled=new Set(nativeEnabledRulesets(settings,resources)??saved?.enabledRulesets??resources.filter(r=>r.enabled===true).map(r=>r.id));
   // The badge-count choice an earlier setExtensionActionOptions made (Chromium keeps it; uBO Lite sets it once).
   if(settings?.dnr_use_action_count_as_badge_text===true&&!badges.has(id))badges.set(id,{enabled:true,counts:new Map()});
   const heapBefore=process.memoryUsage().heapUsed;
   // Dynamic and session rules first (small), then each enabled static ruleset: read and parsed off the critical path, compiled a slice
   // per turn so no single main-thread task runs long (uBlock Origin Lite: ~300,000 rules in six files).
   engine.setExtension(id,{rulesets:resources.map(r=>({id:r.id,enabled:enabled.has(r.id),rules:null})),dynamicRules:nativeDynamicRules(id)??[],sessionRules:sessionRules.get(id)||[],disabledRules:saved?.disabledRules||{},hostAccess:hostAccessFor(manifest),withHostAccess:!permissions.includes('declarativeNetRequest')});
   states.set(id,{enabledRulesets:resources.filter(r=>enabled.has(r.id)).map(r=>r.id),disabledRules:saved?.disabledRules||{}});
   let readMs=0,compileMs=0,longestSliceMs=0,staticRules=0;
   for(const resource of resources){
    if(!enabled.has(resource.id))continue;
    const t=performance.now();let rules=[];
    try{rules=await readRuleset(extension,resource);}catch(error){log('dnr ruleset not read',id,resource.id,error.message);}
    readMs+=performance.now()-t;
    for(let at=0;at<rules.length;at+=SLICE){
     if(manifests.get(id)?.manifest!==manifest)return false;
     const s=performance.now();staticRules+=engine.appendStatic(id,resource.id,rules.slice(at,at+SLICE));const took=performance.now()-s;compileMs+=took;longestSliceMs=Math.max(longestSliceMs,took);
     await turn();
    }
   }
   const errors=engine.errors(id);
   timings.set(id,{readMs:Math.round(readMs),compileMs:Math.round(compileMs),longestSliceMs:Math.round(longestSliceMs*10)/10,totalMs:Math.round(performance.now()-started),staticRules,heapDeltaMB:Math.round((process.memoryUsage().heapUsed-heapBefore)/1048576),errors:errors.length});
   if(errors.length)log('dnr rules skipped',id,errors.slice(0,5));
   return true;
  })().catch(error=>{log('dnr load failed',id,error.message);return false;});
  loads.set(id,job);
  return job;
 }
 function unload(id){manifests.delete(id);loads.delete(id);sessionRules.delete(id);badges.delete(id);feedback.delete(id);engine.removeExtension(id);}
 const ready=async id=>{await loads.get(id);if(!engine.has(id))throw new Error('This extension has no declarativeNetRequest rules loaded.');};

 // Sent by the extension's preload after Chromium accepted the same call.
 const recent=[];
 const note=(id,kind,result)=>{recent.push({id,kind,ok:!result.__acira_error,error:result.__acira_error,time:Date.now()});if(recent.length>50)recent.shift();return result;};
 async function sync(event,kind,options){
  const id=event?.extension?.id;if(!id||!declaresDnr(event.extension.manifest))return failure("'declarativeNetRequest' permission is required.");
  return note(id,kind,await apply(event,id,kind,options));
 }
 async function apply(event,id,kind,options){
  if(!manifests.has(id))await load(event.extension);
  try{
   await ready(id);
   const opts=options&&typeof options==='object'?options:{};
   if(kind==='dynamic'){engine.updateRules(id,'dynamic',opts,{lenient:true});saveState(id);}
   else if(kind==='session'){engine.updateRules(id,'session',opts,{lenient:true});sessionRules.set(id,engine.getRules(id,'session'));}
   else if(kind==='enabled'){
    const known=manifests.get(id),resources=resourcesOf(known?.manifest),wanted=Array.isArray(opts.enableRulesetIds)?opts.enableRulesetIds:[],loaded=new Map();
    for(const rid of wanted){const resource=resources.find(r=>r.id===rid);if(resource&&known)loaded.set(rid,await readRuleset({path:known.path},resource).catch(()=>[]));}
    const enabled=engine.updateEnabledRulesets(id,{enableRulesetIds:wanted,disableRulesetIds:Array.isArray(opts.disableRulesetIds)?opts.disableRulesetIds:[]},rid=>loaded.get(rid)||[]);
    states.set(id,{...(states.get(id)||{}),enabledRulesets:enabled});saveState(id);
   }
   else if(kind==='static'){const disabled=engine.updateStaticRules(id,opts);const state=states.get(id)||{};states.set(id,{...state,disabledRules:{...(state.disabledRules||{}),[opts.rulesetId]:disabled}});saveState(id);}
   else return failure('Unknown rule update.');
   return {__acira_value:true};
  }catch(error){return failure(error.message);}
 }

 // Badge counts (setExtensionActionOptions) and onRuleMatchedDebug.
 const badgeTimers=new Map();
 function showBadge(id,tabId){
  const key=id+'|'+tabId;if(badgeTimers.has(key))return;
  badgeTimers.set(key,setTimeout(()=>{badgeTimers.delete(key);const badge=badges.get(id);if(!badge?.enabled)return;const handler=router?.handlers?.get?.('browserAction.setBadgeText'),extension=getExtension(id);if(!handler||!extension)return;const count=badge.counts.get(tabId)||0;try{handler.callback({extension},{tabId,text:count?String(count):''});}catch{}},250));
  badgeTimers.get(key).unref?.();
 }
 function onMatch(id,rule,req,type){
  if(req.tabId>=0&&(type==='block'||type==='redirect'||type==='upgradeScheme')){const badge=badges.get(id);if(badge){badge.counts.set(req.tabId,(badge.counts.get(req.tabId)||0)+1);if(badge.enabled)showBadge(id,req.tabId);}}
  if(feedback.has(id))emit(id,'declarativeNetRequest.onRuleMatchedDebug',{request:{url:req.url,method:req.method,type:req.type,tabId:req.tabId,frameId:-1,parentFrameId:-1,requestId:String(req.requestId??''),initiator:req.initiator||undefined},rule:{ruleId:rule.id,rulesetId:rule.rulesetId??(rule.source==='session'?'_session':'_dynamic')}});
 }
 function navigated(tabId){if(tabId<0)return;for(const [id,badge] of badges)if(badge.counts.delete(tabId)&&badge.enabled)showBadge(id,tabId);}

 if(router&&typeof router.handle==='function'){
  router.handle('declarativeNetRequest.aciraSync',(event,kind,options)=>sync(event,kind,options));
  router.handle('declarativeNetRequest.getMatchedRules',async(event,filter)=>{const id=event?.extension?.id;if(!id)return failure('Unknown extension.');await loads.get(id);const f=filter&&typeof filter==='object'?filter:{};return {rulesMatchedInfo:engine.getMatchedRules(id,{tabId:Number.isInteger(f.tabId)?f.tabId:undefined,minTimeStamp:typeof f.minTimeStamp==='number'?f.minTimeStamp:undefined})};});
  router.handle('declarativeNetRequest.setExtensionActionOptions',(event,options)=>{
   const id=event?.extension?.id;if(!id)return failure('Unknown extension.');const o=options&&typeof options==='object'?options:{};
   const badge=badges.get(id)||{enabled:false,counts:new Map()};badges.set(id,badge);
   if(typeof o.displayActionCountAsBadgeText==='boolean')badge.enabled=o.displayActionCountAsBadgeText;
   if(o.tabUpdate&&Number.isInteger(o.tabUpdate.tabId)&&Number.isInteger(o.tabUpdate.increment)){const n=Math.max(0,(badge.counts.get(o.tabUpdate.tabId)||0)+o.tabUpdate.increment);badge.counts.set(o.tabUpdate.tabId,n);}
   if(badge.enabled)for(const tabId of badge.counts.keys())showBadge(id,tabId);
   return {__acira_value:undefined};
  });
 }
 try{extensions.on?.('extension-loaded',(_event,extension)=>{void load(extension);});extensions.on?.('extension-unloaded',(_event,extension)=>{if(extension?.id)unload(extension.id);});}catch{}
 try{for(const extension of extensions.getAllExtensions?.()||[])void load(extension);}catch{}

 // Request pipeline participants (content-blocking.cjs). Each returns {} at once while no extension has rules.
 const requestOf=(details,{tabId,topUrl})=>{
  const req=fromElectron(details,{tabId,topUrl,initiator:()=>{try{const frame=details.frame;if(details.resourceType==='mainFrame')return null;const parent=details.resourceType==='subFrame'?frame?.parent:frame;return parent?.origin||(details.referrer?new URL(details.referrer).origin:null);}catch{return null;}},
   frameKey:details.resourceType==='mainFrame'?'wc:'+tabId:details.resourceType==='subFrame'?frameKeyOf(details.frame):null,frameKeys:frameKeysOf(details,tabId)});
  req.requestId=details.id;return req;
 };
 const frameKeyOf=frame=>{try{return frame&&Number.isInteger(frame.frameTreeNodeId)?'f:'+frame.frameTreeNodeId:null;}catch{return null;}};
 function frameKeysOf(details,tabId){
  if(details.resourceType==='mainFrame'||tabId<0||!engine.frameCount)return null;
  const keys=[];try{let frame=details.resourceType==='subFrame'?details.frame?.parent:details.frame;for(let i=0;frame&&frame.parent&&i<32;i++){const key=frameKeyOf(frame);if(key)keys.push(key);frame=frame.parent;}}catch{}
  keys.push('wc:'+tabId);return keys;
 }
 // Chrome hides requests of other extensions, of the browser itself and of non-web schemes from declarativeNetRequest.
 const eligible=details=>/^(?:https?|wss?):/i.test(details.url);
 const samples=new Float64Array(4096);let sampleAt=0;
 const host={
  engine,
  get active(){return engine.active;},
  load,unload,
  forget(id){unload(id);try{fs.rmSync(stateFile(id),{force:true});}catch{}},
  timings:()=>Object.fromEntries(timings),
  /** The last 50 rule updates the extensions sent (extension, kind, accepted or why not). */
  recentUpdates:()=>recent.slice(),
  whenLoaded:()=>Promise.all([...loads.values()]),
  /** context: {tabId, topUrl} — tabId is -1 for requests outside a tab; topUrl may be a function. */
  before(details,context){
   if(!engine.active||!eligible(details))return null;
   const started=performance.now(),req=requestOf(details,context);
   if(details.resourceType==='mainFrame')navigated(req.tabId);
   const out=engine.beforeRequest(req);
   samples[sampleAt++%samples.length]=performance.now()-started;
   return out;
  },
  /** Time spent per request in the matcher (before-request phase, last 4,096 requests): {count, p50, p99, max} in ms. */
  resetRequestCost(){sampleAt=0;},
  /** The toolbar badge text the engine holds for this extension and tab (what setExtensionActionOptions' count produced). */
  badgeText(id,tabId){try{const handler=router?.handlers?.get?.('browserAction.getBadgeText'),extension=getExtension(id);return handler&&extension?handler.callback({extension},{tabId}):null;}catch{return null;}},
  requestCost(){const n=Math.min(sampleAt,samples.length),s=Array.from(samples.subarray(0,n)).sort((a,b)=>a-b),q=p=>n?Math.round(s[Math.min(n-1,Math.floor(p*n))]*10000)/10000:0;return {count:sampleAt,p50:q(0.5),p99:q(0.99),max:q(1)};},
  sendHeaders(details,context){if(!engine.hasHeaderRules||!eligible(details)||!details.requestHeaders)return null;return engine.beforeSendHeaders(requestOf(details,context),details.requestHeaders);},
  headers(details,context){if(!engine.hasHeaderRules||!eligible(details)||!details.responseHeaders)return null;return engine.headersReceived(requestOf(details,context),details.responseHeaders);}
 };
 Object.defineProperty(session,HOST,{value:host,configurable:true});
 return host;
}
const dnrHostFor=session=>session?.[HOST]||null;

module.exports={attachDnrHost,dnrHostFor,hostAccessFor,declaresDnr};
