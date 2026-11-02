'use strict';
// chrome.userScripts, the part that needs no Electron: match patterns and globs, validation of register/update input the way Chrome checks it,
// the per-extension registry (with its world configurations), and picking the scripts for one frame. extension-apis.cjs wires it to the
// engine's router; user-scripts-preload.cjs runs the picked scripts in the page before (or after) its own scripts.
const crypto=require('node:crypto');
const {globMatch:linearGlob}=require('./glob-match.cjs');

const RUN_AT=['document_start','document_end','document_idle'],WORLDS=['MAIN','USER_SCRIPT'];
const MAX_SCRIPTS=2000,MAX_CODE=32*1024*1024,MAX_PATTERNS=200;
const SCHEMES=['http','https','file','ftp','ws','wss'];

function escapeRegExp(text){return text.replace(/[.+^${}()|[\]\\]/g,'\\$&');}
/** A glob with * (any run) and ? (one character), matched against the whole text (Chrome's include_globs/exclude_globs). */
function globMatch(glob,text){
 if(typeof glob!=='string'||typeof text!=='string')return false;
 return linearGlob(glob,text,{single:true});   // not a regular expression: a glob with many stars must not take the n-th power of the text
}

/** Parses a Chrome match pattern; null when it is not one. */
function parsePattern(pattern){
 if(typeof pattern!=='string'||pattern.length>2048)return null;
 if(pattern==='<all_urls>')return {all:true};
 const m=/^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i.exec(pattern);if(!m)return null;
 const scheme=m[1].toLowerCase();let host=m[2].toLowerCase();const path=m[3];
 if(scheme!=='*'&&!SCHEMES.includes(scheme))return null;
 if(scheme==='file'){if(host!=='')return null;return {scheme,host:'',port:null,path};}
 if(!host)return null;
 let port=null;const hostPort=/^(.*?)(?::(\*|\d{1,5}))?$/.exec(host);host=hostPort[1];if(hostPort[2])port=hostPort[2];
 if(host!=='*'&&host.includes('*')&&!(host.startsWith('*.')&&!host.slice(2).includes('*')))return null;
 return {scheme,host,port,path};
}

/** Chrome's match pattern semantics: scheme * is http/https (and ws/wss), host *.a.com is a.com and its subdomains, the path is a glob over
 * path and query. */
function matchesPattern(pattern,url){
 const parsed=typeof pattern==='string'?parsePattern(pattern):pattern;if(!parsed)return false;
 let target;try{target=new URL(url);}catch{return false;}
 const scheme=target.protocol.slice(0,-1);
 if(parsed.all)return SCHEMES.includes(scheme);
 if(parsed.scheme==='*'?!['http','https','ws','wss'].includes(scheme):parsed.scheme!==scheme)return false;
 if(scheme!=='file'){
  const host=target.hostname.toLowerCase();
  if(parsed.host!=='*'){
   if(parsed.host.startsWith('*.')){const base=parsed.host.slice(2);if(host!==base&&!host.endsWith('.'+base))return false;}
   else if(host!==parsed.host)return false;
  }
  if(parsed.port&&parsed.port!=='*'){const port=target.port||(scheme==='https'||scheme==='wss'?'443':'80');if(port!==parsed.port)return false;}
 }
 return globMatch(parsed.path,target.pathname+target.search);
}

const fail=message=>{const error=new Error(message);error.userScripts=true;throw error;};
const stringList=(value,label,id)=>{if(value===undefined)return undefined;if(!Array.isArray(value)||value.length>MAX_PATTERNS||value.some(v=>typeof v!=='string'))fail(`Script with ID '${id}' has an invalid ${label}.`);return value.slice();};

/** Validates one UserScript the way chrome.userScripts.register/update does. `previous` is the stored script for update. readFile(relative) returns
 * the text of an extension file or throws. */
function normalizeScript(input,{previous,readFile}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid user script.');
 const id=input.id;
 if(typeof id!=='string'||!id)fail('Script must have a non-empty ID.');
 if(id.startsWith('_'))fail(`Script's ID '${id}' must not start with '_'.`);
 if(id.length>1024)fail('Script ID is too long.');
 const out={...(previous||{}),id};
 for(const [key,label] of [['matches','matches'],['excludeMatches','excludeMatches'],['includeGlobs','includeGlobs'],['excludeGlobs','excludeGlobs']]){
  const list=stringList(input[key],label,id);if(list===undefined)continue;
  if(key==='matches'||key==='excludeMatches')list.forEach((pattern,index)=>{if(!parsePattern(pattern))fail(`Script with ID '${id}' has invalid value for ${key}[${index}]: Invalid match pattern '${pattern}'.`);});
  out[key]=list;
 }
 if(input.js!==undefined){
  if(!Array.isArray(input.js)||input.js.length>500)fail(`Script with ID '${id}' has an invalid js list.`);
  out.js=input.js.map(source=>{
   if(source&&typeof source.code==='string'&&source.file===undefined)return {code:source.code};
   if(source&&typeof source.file==='string'&&source.code===undefined){if(!readFile)fail(`Could not load file '${source.file}' for script '${id}'.`);let code;try{code=readFile(source.file);}catch{fail(`Could not load file '${source.file}' for script '${id}'.`);}return {file:source.file,code};}
   return fail(`Script with ID '${id}' must specify exactly one of code or file for each js source.`);
  });
 }
 if(input.runAt!==undefined){if(!RUN_AT.includes(input.runAt))fail(`Script with ID '${id}' has an invalid runAt.`);out.runAt=input.runAt;}
 if(input.world!==undefined){if(!WORLDS.includes(input.world))fail(`Script with ID '${id}' has an invalid world.`);out.world=input.world;}
 if(input.worldId!==undefined){if(typeof input.worldId!=='string'||input.worldId.startsWith('_')||input.worldId.length>256)fail(`Script with ID '${id}' has an invalid worldId.`);out.worldId=input.worldId;}
 if(input.allFrames!==undefined){if(typeof input.allFrames!=='boolean')fail(`Script with ID '${id}' has an invalid allFrames.`);out.allFrames=input.allFrames;}
 out.runAt??='document_idle';out.world??='USER_SCRIPT';out.allFrames??=false;
 if(!out.js?.length)fail(`User script with ID '${id}' must specify at least one js source.`);
 if(!out.matches?.length&&!out.includeGlobs?.length)fail(`User script with ID '${id}' must specify at least one match.`);
 if(out.world==='MAIN')delete out.worldId;
 return out;
}

/** The public shape getScripts returns (no resolved file text). */
function publicScript(script){
 const out={id:script.id,matches:script.matches||[],js:script.js.map(source=>source.file!==undefined?{file:source.file}:{code:source.code}),runAt:script.runAt,world:script.world,allFrames:script.allFrames};
 for(const key of ['excludeMatches','includeGlobs','excludeGlobs'])if(script[key])out[key]=script[key];
 if(script.worldId!==undefined)out.worldId=script.worldId;
 return out;
}

/** A stable Electron isolated-world number for (extension, worldId), far from the engine's content-script worlds and Electron's 999. */
function worldNumber(extensionId,worldId=''){const hash=crypto.createHash('sha256').update(extensionId+'|'+worldId).digest();return 0x40000+(hash.readUInt32BE(0)%0x10000);}

function createUserScriptRegistry({load=()=>({}),save=()=>{}}={}){
 // extensionId -> {scripts: Map(id -> script), worlds: Map(worldId|'' -> {csp, messaging})}
 const byExtension=new Map();
 try{const saved=load()||{};for(const [extensionId,entry] of Object.entries(saved)){if(!/^[a-p]{32}$/.test(extensionId)||!entry)continue;byExtension.set(extensionId,{scripts:new Map((entry.scripts||[]).filter(s=>s&&typeof s.id==='string'&&Array.isArray(s.js)).map(s=>[s.id,s])),worlds:new Map(Object.entries(entry.worlds||{}))});}}catch{}
 const of=id=>{let entry=byExtension.get(id);if(!entry){entry={scripts:new Map(),worlds:new Map()};byExtension.set(id,entry);}return entry;};
 const persist=()=>{try{save(Object.fromEntries([...byExtension].filter(([,e])=>e.scripts.size||e.worlds.size).map(([id,e])=>[id,{scripts:[...e.scripts.values()],worlds:Object.fromEntries(e.worlds)}])));}catch{}};
 const codeSize=entry=>[...entry.scripts.values()].reduce((sum,s)=>sum+s.js.reduce((n,j)=>n+(j.code?.length||0),0),0);
 const filterIds=(entry,filter)=>{const ids=filter&&Array.isArray(filter.ids)?new Set(filter.ids):null;return [...entry.scripts.values()].filter(s=>!ids||ids.has(s.id));};
 return {
  register(extensionId,scripts,{readFile}={}){
   if(!Array.isArray(scripts))fail('Invalid user scripts.');const entry=of(extensionId),seen=new Set(),next=[];
   for(const input of scripts){const script=normalizeScript(input,{readFile});if(seen.has(script.id)||entry.scripts.has(script.id))fail(`Duplicate script ID '${script.id}'`);seen.add(script.id);next.push(script);}
   if(entry.scripts.size+next.length>MAX_SCRIPTS)fail('Too many user scripts.');
   const size=codeSize(entry)+next.reduce((sum,s)=>sum+s.js.reduce((n,j)=>n+j.code.length,0),0);if(size>MAX_CODE)fail('User scripts are too large.');
   for(const script of next)entry.scripts.set(script.id,script);persist();
  },
  update(extensionId,scripts,{readFile}={}){
   if(!Array.isArray(scripts))fail('Invalid user scripts.');const entry=of(extensionId),next=[];
   for(const input of scripts){const previous=entry.scripts.get(input?.id);if(!previous)fail(`Script with ID '${input?.id}' does not exist.`);next.push(normalizeScript(input,{previous,readFile}));}
   for(const script of next)entry.scripts.set(script.id,script);persist();
  },
  unregister(extensionId,filter){const entry=of(extensionId);if(filter?.ids)for(const id of filter.ids)if(!entry.scripts.has(id))fail(`Nonexistent script ID '${id}'`);for(const script of filterIds(entry,filter))entry.scripts.delete(script.id);persist();},
  getScripts(extensionId,filter){return filterIds(of(extensionId),filter).map(publicScript);},
  configureWorld(extensionId,config){
   if(!config||typeof config!=='object')fail('Invalid world configuration.');const key=config.worldId===undefined?'':config.worldId;
   if(typeof key!=='string'||key.startsWith('_'))fail('Invalid worldId.');if(config.csp!==undefined&&typeof config.csp!=='string')fail('Invalid csp.');if(config.messaging!==undefined&&typeof config.messaging!=='boolean')fail('Invalid messaging.');
   const entry=of(extensionId);if(key&&!entry.worlds.has(key)&&entry.worlds.size>=100)fail('Too many world configurations.');
   entry.worlds.set(key,{...(config.csp!==undefined?{csp:config.csp}:{}),messaging:!!config.messaging});persist();
  },
  getWorldConfigurations(extensionId){return [...of(extensionId).worlds].map(([worldId,config])=>({...(worldId?{worldId}:{}),...config}));},
  resetWorldConfiguration(extensionId,worldId){of(extensionId).worlds.delete(typeof worldId==='string'?worldId:'');persist();},
  worldConfig(extensionId,worldId=''){const worlds=of(extensionId).worlds;return worlds.get(worldId)||(worldId?worlds.get(''):undefined)||{messaging:false};},
  forget(extensionId){byExtension.delete(extensionId);persist();},
  /** Scripts to run in one frame: extensions filtered by `allowed`, then matches/excludeMatches/includeGlobs/excludeGlobs, allFrames. */
  scriptsFor(url,{mainFrame=true,allowed=()=>false}={}){
   const out=[];
   for(const [extensionId,entry] of byExtension){
    if(!allowed(extensionId))continue;
    for(const script of entry.scripts.values()){
     if(!mainFrame&&!script.allFrames)continue;
     const matched=(script.matches||[]).some(p=>matchesPattern(p,url));const globbed=(script.includeGlobs||[]).some(g=>globMatch(g,url));
     if(!(matched||(!script.matches?.length&&globbed)))continue;
     if(script.matches?.length&&script.includeGlobs?.length&&!globbed)continue;
     if((script.excludeMatches||[]).some(p=>matchesPattern(p,url))||(script.excludeGlobs||[]).some(g=>globMatch(g,url)))continue;
     const worldId=script.world==='MAIN'?undefined:(script.worldId||''),config=script.world==='MAIN'?{}:this.worldConfig(extensionId,worldId);
     out.push({extensionId,id:script.id,runAt:script.runAt,world:script.world,worldId,worldNumber:script.world==='MAIN'?0:worldNumber(extensionId,worldId),messaging:!!config.messaging,csp:config.csp,code:script.js.map(j=>j.code).join('\n;\n')});
    }
   }
   return out;
  },
  hasMessagingScript(extensionId,url){return this.scriptsFor(url,{mainFrame:true,allowed:id=>id===extensionId}).some(s=>s.messaging)||this.scriptsFor(url,{mainFrame:false,allowed:id=>id===extensionId}).some(s=>s.messaging);}
 };
}

module.exports={createUserScriptRegistry,normalizeScript,publicScript,matchesPattern,parsePattern,globMatch,worldNumber,RUN_AT,WORLDS};
