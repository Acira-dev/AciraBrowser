'use strict';
// chrome.declarativeNetRequest enforcement. Chromium (through Electron) loads an extension's rulesets and answers testMatchOutcome, but its
// request path is Electron's own webRequest proxy, which never asks the ruleset manager. This module is the matcher; dnr-host.cjs feeds it
// each extension's rules and content-blocking.cjs calls it from the one request pipeline, after Acira's own blocker.
//
// Speed: rules are compiled into per-extension indexes (like an ad-block engine). A rule is filed under ONE key: a URL token taken from its
// urlFilter (the rarest usable one), else each of its requestDomains / the host of a `||host^` filter, else its initiator or top domains,
// else a short "generic" list. A request is tokenized once; each index then costs one Map lookup per URL token and per host label, and
// only the few candidate rules found are checked in full. urlFilter / regexFilter regular expressions are built lazily, the first time a
// rule is a candidate, so the 300,000 rules of uBlock Origin Lite cost little memory until they are needed.
//
// Semantics follow Chrome's documentation:
//  - urlFilter: `||` (domain anchor), `|` (start / end anchor), `*` (wildcard), `^` (separator: anything but a letter, digit, _ - . % —
//    or the end of the URL); case-insensitive unless isUrlFilterCaseSensitive.
//  - regexFilter: RE2 syntax, run as a JS RegExp; patterns RE2 refuses (look-around, back-references) and nested quantifiers (which could
//    backtrack without bound in JS) are rejected; URLs over 8 KB are not regex-tested.
//  - Within an extension the highest priority wins; at equal priority allow > allowAllRequests > block > upgradeScheme > redirect.
//    Across extensions block > redirect / upgradeScheme > allow, and the most recently installed extension wins a tie.
//  - modifyHeaders rules with a priority above the extension's matching allow / allowAllRequests rule apply, highest priority first,
//    most recently installed extension first; once a header was set or removed it is not changed again, once appended only appended to.
//  - With no resourceTypes / excludedResourceTypes, a rule matches every type except main_frame.
//  - A rule with a responseHeaders / excludedResponseHeaders condition (Chrome 128) is judged only once the response is in (onHeadersReceived), in
//    its own index, as Chromium files it (flat_ruleset_indexer.cc IsBeforeRequestRule / GetBuilders). There it can block, redirect / upgrade, allow,
//    allowAllRequests or modify response headers. The request phase's allow carries over: a response-phase action must beat that allow's priority
//    (composite_matcher.cc CompositeMatcher::GetAction). Rules whose condition matches header VALUES (other than the CORS-safelisted ones and
//    content-encoding) need host access to the request, or they do not match at all (request_params.cc DoEmbedderConditionsMatch).
const {getDomain}=require('tldts');

const RESOURCE_TYPES=['main_frame','sub_frame','stylesheet','script','image','font','object','xmlhttprequest','ping','csp_report','media','websocket','webtransport','webbundle','other'];
const TYPE_BIT=Object.fromEntries(RESOURCE_TYPES.map((t,i)=>[t,1<<i]));
const ALL_TYPES=(1<<RESOURCE_TYPES.length)-1,DEFAULT_TYPES=ALL_TYPES&~TYPE_BIT.main_frame,FRAME_TYPES=TYPE_BIT.main_frame|TYPE_BIT.sub_frame;
const ELECTRON_TYPES={mainFrame:'main_frame',subFrame:'sub_frame',stylesheet:'stylesheet',script:'script',image:'image',font:'font',object:'object',xhr:'xmlhttprequest',ping:'ping',cspReport:'csp_report',media:'media',webSocket:'websocket',webTransport:'webtransport',webBundle:'webbundle',other:'other'};
const METHODS=['connect','delete','get','head','options','patch','post','put','other'];
const METHOD_BIT=Object.fromEntries(METHODS.map((m,i)=>[m,1<<i]));
const ACTIONS=['block','redirect','allow','upgradeScheme','modifyHeaders','allowAllRequests'];
// Within an extension, equal priority: allow > allowAllRequests > block > upgradeScheme > redirect.
const RANK={redirect:1,upgradeScheme:2,block:3,allowAllRequests:4,allow:5};
// Chrome's limits.
const LIMITS={staticRules:330000,dynamicRules:30000,unsafeDynamicRules:5000,sessionRules:5000,unsafeSessionRules:5000,regexRules:1000,enabledRulesets:50,rulesets:100};
const APPENDABLE_REQUEST_HEADERS=new Set(['accept','accept-encoding','accept-language','access-control-request-headers','cache-control','connection','content-language','cookie','forwarded','if-match','if-none-match','keep-alive','range','te','trailer','transfer-encoding','upgrade','user-agent','via','want-digest','x-forwarded-for']);
const MAX_REGEX_URL=8192,MAX_MATCHED=1000,SEPARATOR_CLASS='[^a-z0-9_.%-]',SEPARATOR_CLASS_CS='[^a-zA-Z0-9_.%-]';
// Tokens so common that a rule filed under them would be checked on most requests; chosen only when nothing better exists.
const WEAK_TOKENS=new Set(['http','https','www','com','net','org','html','js','css','php','png','jpg','gif','svg','json','ws','wss','api','static','cdn','img','assets','min']);

const hashToken=(s,from,to)=>{let h=0x811c9dc5;for(let i=from;i<to;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193);return h>>>0;};
const tokenChar=c=>(c>=97&&c<=122)||(c>=48&&c<=57);
/** Hashes of the maximal [a-z0-9] runs of a lower-cased URL (each once). */
function urlTokens(lower){const out=[],seen=new Set();let start=-1;for(let i=0;i<=lower.length;i++){const c=i<lower.length?lower.charCodeAt(i):0;if(tokenChar(c)){if(start<0)start=i;}else if(start>=0){if(i-start>1){const h=hashToken(lower,start,i);if(!seen.has(h)){seen.add(h);out.push(h);}}start=-1;}}return out;}
/** host, then each parent domain: a.b.example.com → [a.b.example.com, b.example.com, example.com, com]. */
function hostSuffixes(host){if(!host)return [];const out=[host];for(let i=host.indexOf('.');i>=0;i=host.indexOf('.',i+1))out.push(host.slice(i+1));return out;}
const hostOf=url=>{const m=/^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?(\[[^\]]*\]|[^/?#:]*)/i.exec(url);return m?m[1].toLowerCase():'';};
const escapeRegExp=s=>s.replace(/[.*+?${}()|[\]\\/]/g,'\\$&');

// ---------- validation / compilation of one rule ----------
const isInt=v=>Number.isSafeInteger(v);
const strings=v=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const DOMAIN_RE=/^[a-z0-9.\-_[\]:]+$/;
function domainList(v,field){if(v===undefined)return null;if(!strings(v))throw new Error(field+' must be a list of strings');if(field.startsWith('excluded')?false:!v.length)throw new Error(field+' must not be empty');for(const d of v)if(!d||!DOMAIN_RE.test(d))throw new Error(field+' must hold lower-case, punycode domains');return v.length>8?new Set(v):v;}
const inList=(list,suffixes)=>{if(!list)return false;if(list instanceof Set){for(const s of suffixes)if(list.has(s))return true;return false;}for(const s of suffixes)if(list.includes(s))return true;return false;};
function typeMask(cond,actionType){
 if(cond.resourceTypes!==undefined&&cond.excludedResourceTypes!==undefined)throw new Error('Only one of resourceTypes and excludedResourceTypes may be given');
 let mask;
 if(cond.resourceTypes!==undefined){if(!strings(cond.resourceTypes)||!cond.resourceTypes.length)throw new Error('resourceTypes must not be empty');mask=0;for(const t of cond.resourceTypes){if(!(t in TYPE_BIT))throw new Error('Unknown resource type '+t);mask|=TYPE_BIT[t];}}
 else if(cond.excludedResourceTypes!==undefined){if(!strings(cond.excludedResourceTypes))throw new Error('excludedResourceTypes must be a list');mask=ALL_TYPES;for(const t of cond.excludedResourceTypes){if(!(t in TYPE_BIT))throw new Error('Unknown resource type '+t);mask&=~TYPE_BIT[t];}if(!mask)throw new Error('Every resource type is excluded');}
 else mask=actionType==='allowAllRequests'?0:DEFAULT_TYPES;
 if(actionType==='allowAllRequests'&&(!mask||(mask&~FRAME_TYPES)))throw new Error('allowAllRequests needs resourceTypes main_frame and/or sub_frame only');
 return mask;
}
function methodMask(cond){
 if(cond.requestMethods!==undefined&&cond.excludedRequestMethods!==undefined)throw new Error('Only one of requestMethods and excludedRequestMethods may be given');
 const list=cond.requestMethods??cond.excludedRequestMethods;if(list===undefined)return 0;
 if(!strings(list)||(cond.requestMethods!==undefined&&!list.length))throw new Error('requestMethods must not be empty');
 let mask=0;for(const m of list){if(!(m in METHOD_BIT))throw new Error('Unknown request method '+m);mask|=METHOD_BIT[m];}
 return cond.requestMethods!==undefined?mask:(((1<<METHODS.length)-1)&~mask);
}
/** RE2 refuses look-around and back-references; nested quantifiers are refused here because a JS RegExp could backtrack without bound. */
function safeRegex(source,caseSensitive){
 if(typeof source!=='string'||!source||source.length>2048)throw new Error('regexFilter must be a non-empty string');
 if(/\(\?[=!<]|\\[1-9]|\\k</.test(source))throw new Error('regexFilter uses syntax RE2 does not support');
 // Exponential backtracking needs a repeated group whose body ends in a repeated atom, as in (a+)+ or (\w+\s?)*. A body that ends in a
 // fixed literal, as in ([a-z0-9-]+\.)*, splits the repetitions and stays linear, so it is allowed (it is common in real rules).
 const stack=[{quantified:false,endsQuantified:false}];let inClass=false;
 const top=()=>stack[stack.length-1],isQuant=ch=>ch==='*'||ch==='+'||ch==='?'||ch==='{';
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(inClass){if(c==='\\')i++;else if(c===']'){inClass=false;top().endsQuantified=false;}continue;}
  if(c==='\\'){i++;top().endsQuantified=false;continue;}
  if(c==='['){inClass=true;continue;}
  if(c==='('){stack.push({quantified:false,endsQuantified:false});continue;}
  if(c===')'){
   const group=stack.length>1?stack.pop():{quantified:false,endsQuantified:false},next=source[i+1],repeated=next==='*'||next==='+'||next==='{';
   const ends=group.endsQuantified||!!group.alternativeEndsQuantified;
   if(repeated&&group.quantified&&ends)throw new Error('regexFilter nests quantifiers');
   top().quantified=top().quantified||group.quantified;top().endsQuantified=ends;continue;
  }
  if(isQuant(c)){if(c==='{'){const end=source.indexOf('}',i);if(end>i)i=end;}if(source[i+1]==='?')i++;top().quantified=true;top().endsQuantified=true;continue;}
  if(c==='|'){if(top().endsQuantified)top().alternativeEndsQuantified=true;top().endsQuantified=false;continue;}
  top().endsQuantified=false;
 }
 return new RegExp(source,caseSensitive?'':'i');
}
function compileUrlFilter(filter,caseSensitive){
 let s=filter,prefix='',suffix='';
 if(s.startsWith('||')){prefix='^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#@]*@)?(?:[^\\/?#:]*\\.)?';s=s.slice(2);}
 else if(s.startsWith('|')){prefix='^';s=s.slice(1);}
 if(s.endsWith('|')){suffix='$';s=s.slice(0,-1);}
 const sep=caseSensitive?SEPARATOR_CLASS_CS:SEPARATOR_CLASS;let body='';
 for(const ch of s)body+=ch==='*'?'.*':ch==='^'?'(?:'+sep+'|$)':escapeRegExp(ch);
 return new RegExp(prefix+body+suffix,caseSensitive?'':'i');
}
// urlFilter matching without regular expressions (no compile cost the first time a rule is a candidate; the RegExp form above is kept for
// tests and as the reference). A pattern is its anchors plus the literal parts between `*`; `^` inside a part is the separator class.
const separatorAt=(s,j)=>{const c=s.charCodeAt(j);return !((c>=97&&c<=122)||(c>=65&&c<=90)||(c>=48&&c<=57)||c===95||c===45||c===46||c===37);};
/** End index if `part` matches s at i, else -1. A `^` at the end of the URL matches without consuming anything. */
function partAt(s,i,part){
 let j=i;
 for(let k=0;k<part.length;k++){
  const c=part.charCodeAt(k);
  if(c===94){if(j===s.length)continue;if(!separatorAt(s,j))return -1;j++;continue;}
  if(j>=s.length||s.charCodeAt(j)!==c)return -1;j++;
 }
 return j;
}
/** Earliest i >= from where part matches; returns its end, or -1. */
function findPart(s,from,part){
 if(!part.length)return from;
 const first=part.charCodeAt(0);
 for(let i=from;i<=s.length;i++){
  if(first!==94){i=s.indexOf(part[0],i);if(i<0)return -1;}
  const end=partAt(s,i,part);if(end>=0)return end;
 }
 return -1;
}
function parseUrlFilter(filter,caseSensitive){
 let s=caseSensitive?filter:filter.toLowerCase(),anchor=0,end=false;
 if(s.startsWith('||')){anchor=2;s=s.slice(2);}else if(s.startsWith('|')){anchor=1;s=s.slice(1);}
 if(s.endsWith('|')){end=true;s=s.slice(0,-1);}
 return {anchor,end,parts:s.split('*')};
}
/** The parts after the first, each at its earliest place (enough for `*`-separated literals); the last one at the very end when end-anchored. */
function restMatches(s,from,parts,end){
 let at=from;
 for(let k=1;k<parts.length;k++){
  const part=parts[k];
  if(k===parts.length-1&&end){for(let i=s.length;i>=at;i--)if(partAt(s,i,part)===s.length)return true;return false;}
  at=findPart(s,at,part);if(at<0)return false;
 }
 return !end||parts.length>1||at===s.length;
}
function matchUrlFilter(p,s,hostStart,hostEnd){
 const parts=p.parts,first=parts[0];
 if(p.anchor===1){const e=partAt(s,0,first);return e>=0&&restMatches(s,e,parts,p.end);}
 if(p.anchor===2){
  for(let i=hostStart;i<hostEnd;i++){if(i!==hostStart&&s.charCodeAt(i-1)!==46)continue;const e=partAt(s,i,first);if(e>=0&&restMatches(s,e,parts,p.end))return true;}
  return false;
 }
 if(parts.length===1&&p.end){for(let i=Math.max(0,s.length-first.length);i<=s.length;i++)if(partAt(s,i,first)===s.length)return true;return false;}
 const e=findPart(s,0,first);return e>=0&&restMatches(s,e,parts,p.end);
}
/** Usable index tokens of a urlFilter: [a-z0-9] runs whose both ends are certain token boundaries in any URL the filter matches. */
function filterTokens(filter){
 let s=filter.toLowerCase(),leftAnchored=false,rightAnchored=false;
 if(s.startsWith('||')){s=s.slice(2);leftAnchored=true;}else if(s.startsWith('|')){s=s.slice(1);leftAnchored=true;}
 if(s.endsWith('|')){s=s.slice(0,-1);rightAnchored=true;}
 const out=[];let start=-1;
 for(let i=0;i<=s.length;i++){
  const c=i<s.length?s.charCodeAt(i):-1;
  if(c>=0&&tokenChar(c)){if(start<0)start=i;continue;}
  if(start>=0){
   const before=start===0?(leftAnchored?'|':''):s[start-1],after=i===s.length?(rightAnchored?'|':''):s[i];
   const leftOk=before!==''&&before!=='*',rightOk=after!==''&&after!=='*';
   if(leftOk&&rightOk&&i-start>1)out.push(s.slice(start,i));
   start=-1;
  }
 }
 return out;
}
/** `||host^`, `||host` + `/…`-free: a pure domain anchor. Returns the host when the domain index alone decides the urlFilter. */
function pureHostFilter(filter){const m=/^\|\|([a-z0-9-]+(?:\.[a-z0-9-]+)+)\^\|?$/i.exec(filter);return m?m[1].toLowerCase():null;}

function headerOps(list,kind,allowAppend){
 if(list===undefined)return null;
 if(!Array.isArray(list)||!list.length)throw new Error(kind+' must not be empty');
 return list.map(h=>{
  if(!h||typeof h.header!=='string'||!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(h.header))throw new Error('Invalid header name');
  const op=h.operation,name=h.header.toLowerCase();
  if(!['set','append','remove'].includes(op))throw new Error('Invalid header operation');
  if(op==='append'&&!allowAppend(name))throw new Error('append is not allowed for request header '+h.header);
  if(op==='remove'){if(h.value!==undefined)throw new Error('remove takes no value');}else if(typeof h.value!=='string'||/[\r\n\0]/.test(h.value))throw new Error(op+' needs a header value');
  return {name,header:h.header,op,value:h.value};
 });
}
function compileRedirect(r,extensionId,hasRegex){
 if(!r||typeof r!=='object')throw new Error('redirect action needs redirect');
 const keys=['url','extensionPath','transform','regexSubstitution'].filter(k=>r[k]!==undefined);
 if(keys.length!==1)throw new Error('redirect needs exactly one of url, extensionPath, transform, regexSubstitution');
 if(r.url!==undefined){let u;try{u=new URL(r.url);}catch{throw new Error('redirect url is not a valid URL');}if(/^javascript:$/i.test(u.protocol))throw new Error('javascript: redirects are not allowed');return {kind:'url',url:u.href};}
 if(r.extensionPath!==undefined){if(typeof r.extensionPath!=='string'||!r.extensionPath.startsWith('/'))throw new Error('extensionPath must start with /');return {kind:'url',url:'chrome-extension://'+extensionId+r.extensionPath};}
 if(r.regexSubstitution!==undefined){if(!hasRegex)throw new Error('regexSubstitution needs a regexFilter');if(typeof r.regexSubstitution!=='string')throw new Error('regexSubstitution must be a string');return {kind:'regex',substitution:r.regexSubstitution};}
 const t=r.transform;if(!t||typeof t!=='object')throw new Error('transform must be an object');
 if(t.scheme!==undefined&&!['http','https','ftp','chrome-extension'].includes(t.scheme))throw new Error('Invalid transform scheme');
 if(t.query!==undefined&&t.queryTransform!==undefined)throw new Error('Only one of query and queryTransform');
 if(t.query!==undefined&&t.query!==''&&!String(t.query).startsWith('?'))throw new Error('query must be empty or start with ?');
 if(t.fragment!==undefined&&t.fragment!==''&&!String(t.fragment).startsWith('#'))throw new Error('fragment must be empty or start with #');
 return {kind:'transform',transform:t};
}

// A compiled rule is kept small (300,000 of them for uBlock Origin Lite): fixed-shape objects, the rarer conditions in `cond` only when a rule
// has one, action details in `act` only for redirect / modifyHeaders, ruleset facts in one shared `set` object, and the original JSON kept
// only for dynamic and session rules (getDynamicRules / getSessionRules are answered by the engine itself; static rules are not).
/** One HeaderInfo of a rule's `responseHeaders` / `excludedResponseHeaders` condition (Chrome 128): a header name and, optionally, value patterns.
 *  A pattern covers the whole value, case-insensitively: `*` is any run of characters, `?` zero or one character, `\\*` and `\\?` the characters themselves.
 *  Chromium keeps no empty value list (flat_ruleset_indexer.cc BuildVectorOfSharedStringsImpl), so `values: []` is a presence-only condition. */
const HEADER_NAME=/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/,MAX_VALUE_WILDCARDS=24;
// Response header values a rule may match without host access (request_params / utils.cc CanMatchResponseHeaderValuesWithoutHostPermissions:
// the CORS-safelisted response headers and content-encoding).
const OPEN_RESPONSE_HEADERS=new Set(['cache-control','content-language','content-length','content-type','expires','last-modified','pragma','content-encoding']);
function headerValuePattern(source){
 if(source.length>1024)throw new Error('header value pattern is too long');
 if(/[\r\n\0]/.test(source))throw new Error('header value pattern is not a valid header value');
 let out='',wild=0,star=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(c==='\\'&&(source[i+1]==='*'||source[i+1]==='?')){out+='\\'+source[++i];star=false;continue;}
  if(c==='*'){if(!star){out+='[^]*';if(++wild>MAX_VALUE_WILDCARDS)throw new Error('header value pattern has too many wildcards');}star=true;continue;}
  star=false;
  if(c==='?'){out+='[^]?';if(++wild>MAX_VALUE_WILDCARDS)throw new Error('header value pattern has too many wildcards');continue;}
  out+=c.replace(/[.+^${}()|[\]\\]/g,'\\$&');
 }
 return new RegExp('^'+out+'$','i');
}
function headerInfoList(list,field){
 if(!Array.isArray(list)||!list.length)throw new Error(field+' must be a non-empty list');
 return list.map(info=>{
  if(!info||typeof info!=='object'||typeof info.header!=='string'||!HEADER_NAME.test(info.header))throw new Error(field+' needs a header name in every entry');
  const patterns=key=>{const value=info[key];if(value===undefined)return null;if(!Array.isArray(value)||!value.every(item=>typeof item==='string'))throw new Error(field+' '+key+' must be a list of strings');return value.length?value.map(headerValuePattern):null;};
  return {raw:info.header,name:info.header.toLowerCase(),values:patterns('values'),excluded:patterns('excludedValues')};
 });
}
/** The compiled response side of a rule's condition: {include, exclude, needsHost}. A header may not be required by `responseHeaders` and, by name only,
 *  excluded by `excludedResponseHeaders` (indexed_rule.cc ValidateResponseHeadersForMatching). needsHost: some entry matches on values of a header that is
 *  not CORS-safelisted, so the rule only matches where the extension has host access (flat_ruleset_indexer.cc HasConditionRequiringHostPermissions). */
function responseCondition(cond){
 const include=cond.responseHeaders===undefined?null:headerInfoList(cond.responseHeaders,'responseHeaders'),exclude=cond.excludedResponseHeaders===undefined?null:headerInfoList(cond.excludedResponseHeaders,'excludedResponseHeaders');
 if(include&&exclude){const named=new Set(include.map(info=>info.raw));for(const info of exclude)if(!info.values&&!info.excluded&&named.has(info.raw))throw new Error('excludedResponseHeaders names a header that responseHeaders requires');}
 const needsHost=info=>(info.values||info.excluded)&&!OPEN_RESPONSE_HEADERS.has(info.name);
 return {include,exclude,needsHost:!!((include&&include.some(needsHost))||(exclude&&exclude.some(needsHost)))};
}
/** Does the response have a header one of these HeaderInfo entries describes? Chromium's MatchesHeaderConditions (request_params.cc): the header is there
 *  (any case); with no value conditions that is enough; a value that matches `excludedValues` fails the whole entry (also when another value of the same
 *  header matches `values`); otherwise some value must match `values`. */
function hasResponseHeader(infos,headers){
 for(const info of infos){
  let values=null;
  for(const key of Object.keys(headers)){
   if(key.toLowerCase()!==info.name)continue;
   const raw=headers[key];(values||(values=[])).push(...(Array.isArray(raw)?raw:[raw]).map(String));
  }
  if(!values)continue;
  if(!info.values&&!info.excluded)return true;
  if(info.excluded&&values.some(text=>info.excluded.some(re=>re.test(text))))continue;
  if(!info.values||values.some(text=>info.values.some(re=>re.test(text))))return true;
 }
 return false;
}
/** The response side of a rule's condition: some header of `responseHeaders` is there, and none of `excludedResponseHeaders`. */
function responseMatches(resp,headers){
 if(!headers||typeof headers!=='object')return false;
 if(resp.exclude&&hasResponseHeader(resp.exclude,headers))return false;
 return !(resp.include&&!hasResponseHeader(resp.include,headers));
}
class Cond{constructor(){this.requestDomains=null;this.excludedRequestDomains=null;this.initiatorDomains=null;this.excludedInitiatorDomains=null;this.topDomains=null;this.excludedTopDomains=null;this.domainType=null;this.tabIds=null;this.excludedTabIds=null;}}
class Rule{
 constructor(id,priority,type,set){this.id=id;this.priority=priority;this.type=type;this.key=priority*8+(RANK[type]||0);this.set=set;this.types=0;this.methods=0;this.urlFilter=null;this.hostOnly=null;this.caseSensitive=false;this.regex=null;this.cond=null;this.act=null;this.compiled=null;this.viaDomains=false;this.raw=null;this.resp=null;}
 get extensionId(){return this.set.extensionId;}
 get rulesetId(){return this.set.rulesetId;}
 get source(){return this.set.source;}
}
const COND_FIELDS=[['requestDomains','requestDomains','domains'],['excludedRequestDomains','excludedRequestDomains','excludedDomains'],['initiatorDomains','initiatorDomains'],['excludedInitiatorDomains','excludedInitiatorDomains'],['topDomains','topDomains'],['excludedTopDomains','excludedTopDomains']];
/** Validates and compiles one rule. Throws an Error naming the problem (Chrome skips invalid static rules and rejects invalid dynamic ones).
 *  set: {extensionId, source: 'static'|'dynamic'|'session', rulesetId, enabled, disabled: Set of rule ids} shared by a ruleset's rules. */
function compileRule(raw,set,{allowTabIds=set.source==='session'}={}){
 if(!raw||typeof raw!=='object')throw new Error('Rule must be an object');
 if(!isInt(raw.id)||raw.id<1)throw new Error('Rule id must be an integer >= 1');
 const priority=raw.priority===undefined?1:raw.priority;if(!isInt(priority)||priority<1)throw new Error('Rule priority must be an integer >= 1');
 const action=raw.action,cond=raw.condition||{};
 if(!action||!ACTIONS.includes(action.type))throw new Error('Unknown action type');
 if(typeof cond!=='object')throw new Error('condition must be an object');
 if(cond.urlFilter!==undefined&&cond.regexFilter!==undefined)throw new Error('Only one of urlFilter and regexFilter');
 const rule=new Rule(raw.id,priority,action.type,set);
 rule.types=typeMask(cond,action.type);rule.methods=methodMask(cond);rule.caseSensitive=cond.isUrlFilterCaseSensitive===true;
 // Session rules keep their JSON (the host restores them when an extension reloads). Dynamic rules do not: Chromium stores them itself
 // (dnr-host.cjs reads that copy at load) and Privacy Badger's ~5,000 would cost ~6 MB more as parsed objects.
 if(set.source==='session')rule.raw=raw;
 let extra=null;const more=()=>extra||(extra=new Cond());
 for(const [field,name,legacy] of COND_FIELDS){const value=cond[name]??(legacy?cond[legacy]:undefined);if(value!==undefined)more()[field]=domainList(value,field);}
 if(cond.domainType!==undefined){if(cond.domainType!=='firstParty'&&cond.domainType!=='thirdParty')throw new Error('domainType must be firstParty or thirdParty');more().domainType=cond.domainType;}
 if(cond.tabIds!==undefined||cond.excludedTabIds!==undefined){
  if(!allowTabIds)throw new Error('tabIds are only allowed in session rules');
  for(const key of ['tabIds','excludedTabIds'])if(cond[key]!==undefined){if(!Array.isArray(cond[key])||!cond[key].every(isInt)||(key==='tabIds'&&!cond[key].length))throw new Error(key+' must be a list of tab ids');more()[key]=new Set(cond[key]);}
 }
 rule.cond=extra;
 // Response-header conditions (Chrome 128): the rule can only be judged once the response is in (headerRules below), never at request time.
 if(cond.responseHeaders!==undefined||cond.excludedResponseHeaders!==undefined)rule.resp=responseCondition(cond);
 if(cond.urlFilter!==undefined){
  const f=cond.urlFilter;if(typeof f!=='string'||!f.length)throw new Error('urlFilter must not be empty');if(/[^\x20-\x7e]/.test(f))throw new Error('urlFilter must be ASCII');if(f.startsWith('||*'))throw new Error('urlFilter must not start with ||*');
  rule.hostOnly=pureHostFilter(f);if(!rule.hostOnly)rule.urlFilter=f;
 }
 if(cond.regexFilter!==undefined)rule.regex=safeRegex(cond.regexFilter,rule.caseSensitive);
 if(action.type==='redirect')rule.act={redirect:compileRedirect(action.redirect,set.extensionId,!!rule.regex),requestHeaders:null,responseHeaders:null};
 if(action.type==='modifyHeaders'){
  const requestHeaders=headerOps(action.requestHeaders,'requestHeaders',name=>APPENDABLE_REQUEST_HEADERS.has(name)),responseHeaders=headerOps(action.responseHeaders,'responseHeaders',()=>true);
  if(!requestHeaders&&!responseHeaders)throw new Error('modifyHeaders needs requestHeaders or responseHeaders');
  if(requestHeaders&&rule.resp)throw new Error('a rule with a response header condition cannot modify request headers');
  rule.act={redirect:null,requestHeaders,responseHeaders};
 }
 return rule;
}
const SAFE_ACTIONS=new Set(['block','allow','allowAllRequests','upgradeScheme']);

// ---------- index ----------
function push(map,key,rule){const at=map.get(key);if(at===undefined)map.set(key,rule);else if(Array.isArray(at))at.push(rule);else map.set(key,[at,rule]);}
const bucketSize=at=>at===undefined?0:Array.isArray(at)?at.length:1;
class RuleIndex{
 constructor(){this.tokens=new Map();this.hosts=new Map();this.initiators=new Map();this.tops=new Map();this.generic=[];this.types=0;this.size=0;this.regexCount=0;}
 /** compact: the index is never rebuilt from these rules (static rulesets), so a rule filed under its requestDomains drops its own copy. */
 add(rule,compact=false){
  this.size++;this.types|=rule.types;if(rule.regex)this.regexCount++;
  const cond=rule.cond;
  if(rule.hostOnly){push(this.hosts,rule.hostOnly,rule);return;}
  if(rule.urlFilter){
   let best=null,bestScore=Infinity;
   for(const token of filterTokens(rule.urlFilter)){const h=hashToken(token,0,token.length),score=bucketSize(this.tokens.get(h))+(WEAK_TOKENS.has(token)?1e6:0)-Math.min(token.length,12)/100;if(score<bestScore){best=h;bestScore=score;}}
   if(best!==null&&(bestScore<1e6||!cond||!cond.requestDomains)){push(this.tokens,best,rule);return;}
  }
  if(rule.regex){const token=regexToken(rule.regex.source);if(token){push(this.tokens,hashToken(token,0,token.length),rule);return;}}
  if(cond){
   if(cond.requestDomains){for(const d of cond.requestDomains)push(this.hosts,d,rule);rule.viaDomains=true;if(compact)cond.requestDomains=null;return;}
   if(cond.initiatorDomains){for(const d of cond.initiatorDomains)push(this.initiators,d,rule);return;}
   if(cond.topDomains){for(const d of cond.topDomains)push(this.tops,d,rule);return;}
  }
  this.generic.push(rule);
 }
 /** Calls visit(rule, viaHost) for every candidate; visit returns nothing. */
 candidates(req,visit){
  const each=(at,via)=>{if(at===undefined)return;if(Array.isArray(at)){for(let i=0;i<at.length;i++)visit(at[i],via);}else visit(at,via);};
  if(this.tokens.size)for(const h of req.tokens)each(this.tokens.get(h),false);
  if(this.hosts.size)for(const s of req.hostSuffixes)each(this.hosts.get(s),true);
  if(this.initiators.size&&req.initiatorSuffixes)for(const s of req.initiatorSuffixes)each(this.initiators.get(s),false);
  if(this.tops.size&&req.topSuffixes)for(const s of req.topSuffixes)each(this.tops.get(s),false);
  for(let i=0;i<this.generic.length;i++)visit(this.generic[i],false);
 }
}
/** A literal [a-z0-9] run that every match of the regex must contain as a whole URL token, or null. Only top-level, alternation-free
 *  sequences count, and the run must sit between escaped/literal separators (\. / - _ = ? & : etc.). */
function regexToken(source){
 if(!source||/\|/.test(source.replace(/\\./g,'')))return null;
 const lower=source.toLowerCase();let depth=0,best=null;
 for(let i=0;i<lower.length;){
  const c=lower[i];
  if(c==='\\'){i+=2;continue;}
  if(c==='['){const end=lower.indexOf(']',i+1);if(end<0)return null;i=end+1;continue;}
  if(c==='('){depth++;i++;continue;}
  if(c===')'){depth--;i++;continue;}
  if(depth===0&&tokenChar(lower.charCodeAt(i))){
   let j=i;while(j<lower.length&&tokenChar(lower.charCodeAt(j)))j++;
   // A literal separator on both sides: escaped non-alphanumerics (\. \/ \?) or characters that are literal unescaped (/ - _ = & : ; , ~ ! @ # %).
   // An unescaped . ? + * { or ) is a metacharacter, so the run might continue or end differently in the URL.
   const literal=ch=>ch!==undefined&&/[/\-_=&:;,~!@#%]/.test(ch),escaped=ch=>ch!==undefined&&/[^a-z0-9]/.test(ch);
   const prevOk=i>=2&&lower[i-2]==='\\'&&(i<3||lower[i-3]!=='\\')?escaped(lower[i-1]):literal(lower[i-1]);
   const nextOk=lower[j]==='\\'?escaped(lower[j+1]):literal(lower[j]);
   if(prevOk&&nextOk&&j-i>1&&(!best||j-i>best.length))best=lower.slice(i,j);
   i=j;continue;
  }
  i++;
 }
 return best&&!WEAK_TOKENS.has(best)?best:null;
}

// ---------- matching ----------
function urlMatches(rule,req){
 if(rule.hostOnly)return true;
 if(rule.urlFilter){if(!rule.compiled)rule.compiled=parseUrlFilter(rule.urlFilter,rule.caseSensitive);return matchUrlFilter(rule.compiled,rule.caseSensitive?req.url:req.lower,req.hostStart,req.hostEnd);}
 if(rule.regex){if(req.url.length>MAX_REGEX_URL)return false;return rule.regex.test(req.url);}
 return true;
}
/** At request time: a rule with a response-header condition cannot be judged yet, so it never matches here (it used to match every response). */
function ruleMatches(rule,req,viaHost){return !rule.resp&&requestMatches(rule,req,viaHost);}
function requestMatches(rule,req,viaHost){
 if(!(rule.types&req.typeBit))return false;
 if(rule.methods&&!(rule.methods&req.methodBit))return false;
 const set=rule.set;if(!set.enabled||(set.disabled&&set.disabled.size&&set.disabled.has(rule.id)))return false;
 const c=rule.cond;
 if(c){
  if(c.tabIds&&!c.tabIds.has(req.tabId))return false;
  if(c.excludedTabIds&&c.excludedTabIds.has(req.tabId))return false;
  if(c.requestDomains&&!(viaHost&&rule.viaDomains)&&!inList(c.requestDomains,req.hostSuffixes))return false;
  if(c.excludedRequestDomains&&inList(c.excludedRequestDomains,req.hostSuffixes))return false;
  if(c.initiatorDomains&&!inList(c.initiatorDomains,req.initiatorSuffixes||[]))return false;
  if(c.excludedInitiatorDomains&&req.initiatorSuffixes&&inList(c.excludedInitiatorDomains,req.initiatorSuffixes))return false;
  if(c.topDomains&&!inList(c.topDomains,req.topSuffixes||[]))return false;
  if(c.excludedTopDomains&&req.topSuffixes&&inList(c.excludedTopDomains,req.topSuffixes))return false;
  if(c.domainType&&(c.domainType==='thirdParty')!==thirdParty(req))return false;
 }
 if(rule.type==='upgradeScheme'&&!/^(?:http|ws):/i.test(req.url))return false;
 return urlMatches(rule,req);
}
function thirdParty(req){
 if(req.thirdParty===undefined){
  if(!req.initiatorHost||req.type==='main_frame')req.thirdParty=false;
  else{const a=getDomain(req.host,{allowPrivateDomains:true})||req.host,b=getDomain(req.initiatorHost,{allowPrivateDomains:true})||req.initiatorHost;req.thirdParty=a!==b;}
 }
 return req.thirdParty;
}
/** One request, prepared once and shared by every extension's indexes. initiator and topUrl may be functions: they are read only when a
 *  candidate rule needs them (initiator / top domains, domainType, host access). frameKey is the frame a navigation loads into; frameKeys
 *  are the frames whose allowAllRequests decisions cover this request (a navigation's ancestors, a subresource's frame and ancestors). */
function prepareRequest({url,method='GET',type='other',tabId=-1,initiator=null,topUrl=null,frameKey=null,frameKeys=null}){
 const lower=url.toLowerCase(),host=hostOf(lower),m=String(method||'GET').toLowerCase(),scheme=lower.indexOf('://'),hostStart=host?lower.indexOf(host,scheme<0?0:scheme+3):-1;
 let initiatorValue,initiatorHost,initiatorSuffixes,topSuffixes;
 const readInitiator=()=>{if(initiatorValue===undefined){let v=null;try{v=typeof initiator==='function'?initiator():initiator;}catch{v=null;}initiatorValue=typeof v==='string'&&/^[a-z][a-z0-9+.-]*:\/\//i.test(v)?v:null;initiatorHost=initiatorValue?hostOf(initiatorValue.toLowerCase()):'';}return initiatorValue;};
 return {url,lower,type,typeBit:TYPE_BIT[type]||TYPE_BIT.other,method:m,methodBit:METHOD_BIT[m]||METHOD_BIT.other,tabId:isInt(tabId)?tabId:-1,
  host,hostStart,hostEnd:hostStart<0?-1:hostStart+host.length,hostSuffixes:hostSuffixes(host),tokens:urlTokens(lower),frameKey,frameKeys,thirdParty:undefined,
  get initiator(){return readInitiator();},
  get initiatorHost(){readInitiator();return initiatorHost;},
  get initiatorSuffixes(){if(initiatorSuffixes===undefined){readInitiator();initiatorSuffixes=initiatorHost?hostSuffixes(initiatorHost):null;}return initiatorSuffixes;},
  get topSuffixes(){if(topSuffixes===undefined){let top='';if(type==='main_frame')top=host;else{try{const v=typeof topUrl==='function'?topUrl():topUrl;top=v?hostOf(String(v).toLowerCase()):'';}catch{top='';}}topSuffixes=top?hostSuffixes(top):null;}return topSuffixes;}};
}

function applyTransform(url,t,extensionId){
 const u=new URL(url);
 if(t.scheme!==undefined){if(t.scheme==='chrome-extension'){return 'chrome-extension://'+extensionId+(t.path!==undefined?t.path||'/':u.pathname)+(t.query!==undefined?t.query:u.search)+(t.fragment!==undefined?t.fragment:u.hash);}u.protocol=t.scheme+':';}
 if(t.host!==undefined)u.hostname=t.host;
 if(t.port!==undefined)u.port=t.port;
 if(t.path!==undefined)u.pathname=t.path||'/';
 if(t.username!==undefined)u.username=t.username;
 if(t.password!==undefined)u.password=t.password;
 if(t.query!==undefined)u.search=t.query;
 else if(t.queryTransform){
  const q=t.queryTransform,parts=u.search?u.search.slice(1).split('&').filter(Boolean):[];
  const keyOf=p=>{const at=p.indexOf('=');return at<0?p:p.slice(0,at);};
  let list=Array.isArray(q.removeParams)?parts.filter(p=>!q.removeParams.includes(keyOf(p))):parts;
  const replaced=new Set();
  for(const {key,value,replaceOnly} of Array.isArray(q.addOrReplaceParams)?q.addOrReplaceParams:[]){
   const at=list.findIndex((p,i)=>!replaced.has(i)&&keyOf(p)===key);
   if(at>=0){list[at]=key+'='+value;replaced.add(at);}else if(!replaceOnly){list.push(key+'='+value);replaced.add(list.length-1);}
  }
  u.search=list.length?'?'+list.join('&'):'';
 }
 if(t.fragment!==undefined)u.hash=t.fragment;
 return u.href;
}
function redirectTarget(rule,req){
 const r=rule.act.redirect;let out;
 try{
  if(r.kind==='url')out=r.url;
  else if(r.kind==='transform')out=applyTransform(req.url,r.transform,rule.extensionId);
  else{const m=rule.regex.exec(req.url);if(!m)return null;const sub=r.substitution.replace(/\\(\\|[0-9])/g,(all,d)=>d==='\\'?'\\':(m[+d]??''));out=req.url.slice(0,m.index)+sub+req.url.slice(m.index+m[0].length);out=new URL(out).href;}
 }catch{return null;}
 return out&&out!==req.url?out:null;
}

// ---------- one extension ----------
// Static rulesets share one append-only index per extension (a ruleset switched off is skipped by a flag, never re-indexed; switched on for
// the first time, its rules are added). Dynamic and session rules have their own small index, rebuilt on each update.
// before: block / allow / allowAllRequests / redirect / upgradeScheme rules judged from the request alone; headers: modifyHeaders rules; late: the
// same actions as `before` but with a response-header condition, judged only when the response is in (Chromium's headers_received index).
const newGroup=()=>({before:new RuleIndex(),headers:new RuleIndex(),late:new RuleIndex()});
const slotOf=(group,rule)=>rule.type==='modifyHeaders'?group.headers:rule.resp?group.late:group.before;
class ExtensionRules{
 constructor(id,order){
  this.id=id;this.order=order;this.rulesets=new Map();this.dynamic=[];this.session=[];this.hostAccess=()=>true;this.needsHostAccessForAll=false;this.errors=[];this.matched=[];
  this.staticGroup=newGroup();this.liveGroup=newGroup();this.groups=[this.liveGroup,this.staticGroup];
  this.dynamicSet={extensionId:id,source:'dynamic',rulesetId:null,enabled:true,disabled:null};this.sessionSet={extensionId:id,source:'session',rulesetId:null,enabled:true,disabled:null};
 }
 get size(){return this.staticGroup.before.size+this.staticGroup.headers.size+this.staticGroup.late.size+this.liveGroup.before.size+this.liveGroup.headers.size+this.liveGroup.late.size;}
 /** Some rule here (block / redirect / allow ...) waits for the response headers. */
 get hasLate(){return this.staticGroup.late.size>0||this.liveGroup.late.size>0;}
 addStatic(rules){for(const rule of rules)slotOf(this.staticGroup,rule).add(rule,true);}
 rebuildLive(){const group=newGroup();for(const rule of [...this.session,...this.dynamic])slotOf(group,rule).add(rule);this.liveGroup=group;this.groups=[group,this.staticGroup];}
 /** Best before-request action of this extension (with any allowAllRequests inherited from the request's frames). */
 bestAction(req,frameAllows){
  let best=null,bestKey=0;
  const inherited=frameAllows&&frameAllows.get(this.id);
  if(inherited){best={type:'allowAllRequests',rule:inherited.rule,inherited:true};bestKey=inherited.rule.key;}
  const visit=(rule,viaHost)=>{if(rule.key<=bestKey)return;if(!ruleMatches(rule,req,viaHost))return;if(rule.type==='redirect'&&!redirectTarget(rule,req))return;best={type:rule.type,rule};bestKey=rule.key;};
  for(const group of this.groups){const index=group.before;if(index.size&&(index.types&req.typeBit))index.candidates(req,visit);}
  return best;
 }
 /** Highest allow / allowAllRequests priority for this request (for modifyHeaders), 0 if none. */
 allowPriority(req,frameAllows){
  let top=0;const inherited=frameAllows&&frameAllows.get(this.id);if(inherited)top=inherited.rule.priority;
  const visit=(rule,viaHost)=>{if((rule.type==='allow'||rule.type==='allowAllRequests')&&rule.priority>top&&ruleMatches(rule,req,viaHost))top=rule.priority;};
  for(const group of this.groups){const index=group.before;if(index.size&&(index.types&req.typeBit))index.candidates(req,visit);}
  return top;
 }
 /** Response phase, rules with a response-header condition. The request phase's top action stays in force when it was an allow / allowAllRequests
  *  (Chromium seeds its final action with it, composite_matcher.cc:172-183), so a response-phase action must have a higher priority key to count
  *  (:191). Returns {seed, late}: seed is that allow (or null), late the response-phase action that beats it (or null).
  *  hostOk(): does the extension have host access to the request (asked only when a rule needs it). */
 lateAction(req,frameAllows,headers,hostOk){
  const first=this.bestAction(req,frameAllows),seed=first&&(first.type==='allow'||first.type==='allowAllRequests')?first:null;
  let late=null,bestKey=seed?seed.rule.key:0;
  const visit=(rule,viaHost)=>{
   if(rule.key<=bestKey||!requestMatches(rule,req,viaHost))return;
   if(rule.resp.needsHost&&!hostOk())return;
   if(!responseMatches(rule.resp,headers))return;
   if(rule.type==='redirect'&&(req.type==='websocket'||req.type==='webtransport'||!redirectTarget(rule,req)))return;
   late={type:rule.type,rule};bestKey=rule.key;
  };
  for(const group of this.groups){const index=group.late;if(index.size&&(index.types&req.typeBit))index.candidates(req,visit);}
  return {seed,late};
 }
 /** responseHeaders: the response's headers in the 'responseHeaders' phase (rules with a response-header condition are judged against them; in the request phase they never apply). */
 headerRules(req,phase,responseHeaders=null){
  let out=null;
  const visit=(rule,viaHost)=>{if(!rule.act[phase]||(out&&out.includes(rule)))return;if(rule.resp?!(phase==='responseHeaders'&&requestMatches(rule,req,viaHost)&&responseMatches(rule.resp,responseHeaders)):!requestMatches(rule,req,viaHost))return;(out||(out=[])).push(rule);};
  for(const group of this.groups){const index=group.headers;if(index.size&&(index.types&req.typeBit))index.candidates(req,visit);}
  return out?out.sort((a,b)=>b.priority-a.priority):[];
 }
 record(rule,req){this.matched.push({rule:{ruleId:rule.id,rulesetId:rule.rulesetId??(rule.source==='session'?'_session':'_dynamic')},tabId:req.tabId,timeStamp:Date.now()});if(this.matched.length>MAX_MATCHED)this.matched.splice(0,this.matched.length-MAX_MATCHED);}
}

// ---------- engine ----------
function createDnrEngine({onMatch=null}={}){
 const extensions=new Map();let order=0,list=[];
 // allowAllRequests decided for a frame: frameKey ('wc:<id>' for a tab's main frame, 'f:<frameTreeNodeId>' for a subframe) → Map(extId → {rule}).
 const frames=new Map();
 let headerRules=false,lateRules=false;
 const refresh=()=>{list=[...extensions.values()].filter(e=>e.size>0).sort((a,b)=>b.order-a.order);headerRules=list.some(e=>e.staticGroup.headers.size||e.liveGroup.headers.size);lateRules=list.some(e=>e.hasLate);};
 const compileList=(rules,ext,set,{strict,limit,unsafeLimit})=>{
  if(!Array.isArray(rules))throw new Error('Rules must be a list');
  const out=[],ids=new Set();let regex=0,unsafe=0;
  for(const raw of rules){
   try{
    const rule=compileRule(raw,set);
    if(ids.has(rule.id))throw new Error('Duplicate rule id '+rule.id);
    if(rule.regex&&++regex>LIMITS.regexRules)throw new Error('Too many regex rules');
    if(!SAFE_ACTIONS.has(rule.type)&&unsafeLimit&&++unsafe>unsafeLimit)throw new Error('Too many unsafe rules');
    ids.add(rule.id);out.push(rule);
    if(out.length>limit)throw new Error('Rule count exceeds the limit');
   }catch(error){if(strict)throw new Error(`Rule with id ${raw&&raw.id}: ${error.message}`);if(ext.errors.length<50)ext.errors.push(`${set.rulesetId||set.source} #${raw&&raw.id}: ${error.message}`);}
  }
  return out;
 };
 const staticSet=(ext,rid,enabled,disabled)=>({extensionId:ext.id,source:'static',rulesetId:rid,enabled,disabled:new Set(disabled||[]),compiled:false,count:0});
 const compileStatic=(ext,set,rules)=>{const room=LIMITS.staticRules-staticCount(ext);if(room<=0){ext.errors.push('Static rule limit reached; '+set.rulesetId+' left out');return;}const compiled=compileList(rules.length>room?rules.slice(0,room):rules,ext,set,{strict:false,limit:LIMITS.staticRules});ext.addStatic(compiled);set.compiled=true;set.count=compiled.length;};
 const staticCount=ext=>{let n=0;for(const set of ext.rulesets.values())if(set.compiled)n+=set.count;return n;};
 const extension=id=>{let ext=extensions.get(id);if(!ext){ext=new ExtensionRules(id,++order);extensions.set(id,ext);}return ext;};
 return {
  LIMITS,RESOURCE_TYPES,
  get active(){return list.length>0;},
  /** Frames with an allowAllRequests decision (0 means no request needs its frame chain looked up). */
  get frameCount(){return frames.size;},
  /** Some extension has modifyHeaders rules (the header phases return at once otherwise). */
  get hasHeaderRules(){return headerRules;},
  /** Some extension has a rule that is judged on the response (modifyHeaders, or a rule with a response-header condition): onHeadersReceived has work. */
  get hasResponseRules(){return headerRules||lateRules;},
  /** Loads (or replaces) an extension's rules. rulesets: [{id, enabled, rules}]; disabledRules: {rulesetId: [ruleIds]}. */
  setExtension(id,{rulesets=[],dynamicRules=[],sessionRules=[],disabledRules={},hostAccess=null,withHostAccess=false}={}){
   extensions.delete(id);const ext=extension(id);
   for(const ruleset of rulesets.slice(0,LIMITS.rulesets)){
    const set=staticSet(ext,ruleset.id,!!ruleset.enabled,disabledRules[ruleset.id]);ext.rulesets.set(ruleset.id,set);
    if(set.enabled&&ruleset.rules)compileStatic(ext,set,ruleset.rules);
   }
   ext.dynamic=compileList(dynamicRules,ext,ext.dynamicSet,{strict:false,limit:LIMITS.dynamicRules,unsafeLimit:LIMITS.unsafeDynamicRules});
   ext.session=compileList(sessionRules,ext,ext.sessionSet,{strict:false,limit:LIMITS.sessionRules,unsafeLimit:LIMITS.unsafeSessionRules});
   if(hostAccess)ext.hostAccess=hostAccess;ext.needsHostAccessForAll=!!withHostAccess;
   ext.rebuildLive();refresh();return {errors:ext.errors.slice(),staticRules:staticCount(ext)};
  },
  /** Adds part of an enabled static ruleset (rulesets given to setExtension with rules: null), so a large one is compiled a slice per
   *  turn of the event loop instead of in one long main-thread task. Returns the number of rules added. */
  appendStatic(id,rulesetId,rules){
   const ext=extensions.get(id),set=ext&&ext.rulesets.get(rulesetId);if(!set)return 0;
   const before=set.count;compileStatic(ext,set,rules);set.count+=before;refresh();return set.count-before;
  },
  removeExtension(id){extensions.delete(id);for(const map of frames.values())map.delete(id);refresh();},
  has(id){return extensions.has(id);},
  /** Chrome semantics: removeRuleIds first, then addRules; the whole update fails if any added rule is invalid or a limit is passed.
   *  lenient: the update was already accepted by Chromium (forwarded by the extension's preload), so a rule only this matcher refuses
   *  (a regex that could backtrack without bound in JS) is left out and noted in errors() instead of failing the rest. */
  updateRules(id,source,{removeRuleIds=[],addRules=[]}={},{lenient=false}={}){
   const ext=extension(id),key=source==='session'?'session':'dynamic';
   const remove=new Set(Array.isArray(removeRuleIds)?removeRuleIds:[]),kept=ext[key].filter(r=>!remove.has(r.id));
   const added=compileList(addRules,ext,key==='session'?ext.sessionSet:ext.dynamicSet,{strict:!lenient,limit:Infinity});
   const ids=new Set(kept.map(r=>r.id));for(const r of added){if(ids.has(r.id))throw new Error(`Rule with id ${r.id} does not have a unique ID.`);ids.add(r.id);}
   const next=[...kept,...added],limit=key==='session'?LIMITS.sessionRules:LIMITS.dynamicRules,unsafeLimit=key==='session'?LIMITS.unsafeSessionRules:LIMITS.unsafeDynamicRules;
   if(next.length>limit)throw new Error(`${key==='session'?'Session':'Dynamic'} rule count exceeds the rule count limit.`);
   if(next.filter(r=>!SAFE_ACTIONS.has(r.type)).length>unsafeLimit)throw new Error('Unsafe rule count exceeds the rule count limit.');
   if(next.filter(r=>r.regex).length>LIMITS.regexRules)throw new Error('Regex rule count exceeds the rule count limit.');
   ext[key]=next;ext.rebuildLive();refresh();return next.length;
  },
  /** Enables / disables static rulesets. rulesFor(id) supplies a ruleset's raw rules when it was never compiled. */
  updateEnabledRulesets(id,{enableRulesetIds=[],disableRulesetIds=[]}={},rulesFor=()=>null){
   const ext=extension(id);
   for(const rid of disableRulesetIds){const set=ext.rulesets.get(rid);if(set)set.enabled=false;}
   for(const rid of enableRulesetIds){let set=ext.rulesets.get(rid);if(!set){set=staticSet(ext,rid,false);ext.rulesets.set(rid,set);}if(!set.compiled)compileStatic(ext,set,rulesFor(rid)||[]);set.enabled=true;}
   refresh();return [...ext.rulesets.values()].filter(s=>s.enabled).map(s=>s.rulesetId);
  },
  updateStaticRules(id,{rulesetId,disableRuleIds=[],enableRuleIds=[]}={}){
   const ext=extension(id),set=ext.rulesets.get(rulesetId);if(!set)throw new Error(`Invalid ruleset id: ${rulesetId}.`);
   for(const r of enableRuleIds)set.disabled.delete(r);for(const r of disableRuleIds)set.disabled.add(r);
   return [...set.disabled];
  },
  /** Session rules as the extension gave them; dynamic rules as {id, priority} (their JSON is not kept, see compileRule). */
  getRules(id,source){const ext=extensions.get(id);if(!ext)return [];return source==='session'?ext.session.map(r=>r.raw):ext.dynamic.map(r=>({id:r.id,priority:r.priority}));},
  getMatchedRules(id,{tabId,minTimeStamp}={}){const ext=extensions.get(id);if(!ext)return [];return ext.matched.filter(m=>(tabId===undefined||m.tabId===tabId)&&(minTimeStamp===undefined||m.timeStamp>=minTimeStamp)).map(m=>({rule:{...m.rule},tabId:m.tabId,timeStamp:m.timeStamp}));},
  stats(){let rules=0,staticRules=0;for(const e of extensions.values()){rules+=e.size;for(const set of e.rulesets.values())if(set.enabled&&set.compiled)staticRules+=set.count;}return {extensions:extensions.size,active:list.length,rules,staticRules,frames:frames.size};},
  errors(id){return extensions.get(id)?.errors.slice()||[];},
  prepareRequest,

  /** Before the request is sent. Returns {cancel:true} | {redirectURL} | null. */
  beforeRequest(input){
   if(!list.length)return null;
   const req=input.lower?input:prepareRequest(input);
   const frameAllows=frameAllowsFor(req);
   let block=null,redirect=null,allowAll=null;
   for(const ext of list){
    const best=ext.bestAction(req,frameAllows);
    if(!best)continue;
    if(best.type==='redirect'&&!access(ext,req))continue;
    if(ext.needsHostAccessForAll&&!access(ext,req))continue;
    if(!best.inherited){ext.record(best.rule,req);if(onMatch)onMatch(ext.id,best.rule,req,best.type);}
    if(best.type==='block'){if(!block)block=best;}
    else if(best.type==='redirect'||best.type==='upgradeScheme'){if(!redirect)redirect={...best,ext};}
    if(best.type==='allowAllRequests'&&!best.inherited&&(req.type==='main_frame'||req.type==='sub_frame'))(allowAll||(allowAll=new Map())).set(ext.id,{rule:best.rule});
   }
   if(req.type==='main_frame'||req.type==='sub_frame')noteFrame(req,allowAll);
   if(block)return {cancel:true};
   if(redirect){const url=redirect.type==='upgradeScheme'?req.url.replace(/^http:/i,'https:').replace(/^ws:/i,'wss:'):redirectTarget(redirect.rule,req);if(url&&url!==req.url)return {redirectURL:url};}
   return null;
  },
  /** Outgoing request headers ({name: value}); returns the changed object or null. */
  beforeSendHeaders(input,headers){return modify(input,headers,'requestHeaders');},
  /** Response headers ({name: [values]}); returns the changed object or null (modifyHeaders only; responseReceived has the whole response phase). */
  headersReceived(input,headers){const out=responseReceived(input,headers);return out&&out.responseHeaders||null;},
  /** The response phase (onHeadersReceived): rules with a response-header condition may block, redirect / upgrade or allow, then modifyHeaders rules
   *  change the headers. Returns {cancel:true} | {redirectURL} | {responseHeaders} | null. */
  responseReceived,
  /** The frame (main frame of tab `wc:<id>`, or subframe `f:<frameTreeNodeId>`) went away. */
  forgetFrame(key){frames.delete(key);}
 };
 function access(ext,req){try{return ext.hostAccess(req.url,req.initiatorHost?req.initiator:null)!==false;}catch{return false;}}
 function frameAllowsFor(req){
  if(!frames.size||!req.frameKeys)return null;
  let out=null;
  for(const key of req.frameKeys){const map=frames.get(key);if(!map)continue;for(const [id,value] of map){const have=out&&out.get(id);if(!have||value.rule.priority>have.rule.priority)(out||(out=new Map())).set(id,value);}}
  return out;
 }
 function noteFrame(req,allowAll){
  // A navigation starts a fresh document in its frame: only this navigation's own allowAllRequests match is kept for it (its parents' stay theirs).
  const key=req.frameKey;if(!key)return;
  if(allowAll&&allowAll.size){frames.delete(key);frames.set(key,allowAll);if(frames.size>4096)frames.delete(frames.keys().next().value);}
  else frames.delete(key);
 }
 /** The response phase of one request (see lateAction / headersReceived above). */
 function responseReceived(input,headers){
  if(!list.length||!headers)return null;
  const req=input.lower?input:prepareRequest(input);
  let block=null,redirect=null,floors=null;
  if(lateRules){
   const frameAllows=frameAllowsFor(req);
   for(const ext of list){
    if(!ext.hasLate)continue;
    let granted;const hostOk=()=>granted===undefined?(granted=access(ext,req)):granted;
    const {late}=ext.lateAction(req,frameAllows,headers,hostOk);
    if(!late)continue;
    // As in the request phase (and Chromium's CompositeMatcher::GetAction): the chosen action is dropped, masking the rules below it, when the extension
    // lacks the host access it needs (every action with declarativeNetRequestWithHostAccess; a redirect always).
    if((ext.needsHostAccessForAll||late.type==='redirect')&&!hostOk())continue;
    ext.record(late.rule,req);if(onMatch)onMatch(ext.id,late.rule,req,late.type);
    if(late.type==='block'){if(!block)block=late;}
    else if(late.type==='redirect'||late.type==='upgradeScheme'){if(!redirect)redirect={...late,ext};}
    else{
     // allow / allowAllRequests: modifyHeaders rules at or below this priority no longer apply; an allowAllRequests also covers the document's subresources.
     (floors||(floors=new Map())).set(ext.id,late.rule.priority);
     if(late.type==='allowAllRequests'&&(req.type==='main_frame'||req.type==='sub_frame'))keepFrame(req,ext,late.rule);
    }
   }
  }
  // Across extensions block beats redirect / upgrade beats allow (RulesetManager::GetAction); a blocked or redirected response changes nothing else.
  if(block)return {cancel:true};
  if(redirect){const url=redirect.type==='upgradeScheme'?req.url.replace(/^http:/i,'https:').replace(/^ws:/i,'wss:'):redirectTarget(redirect.rule,req);if(url&&url!==req.url)return {redirectURL:url};}
  const responseHeaders=modify(req,headers,'responseHeaders',floors);
  return responseHeaders?{responseHeaders}:null;
 }
 /** An allowAllRequests rule that matched the navigation's response also allowlists the frame (ruleset_matcher_base.cc OnDidFinishNavigation:305-325 takes the
  *  highest allowAllRequests action of both stages). */
 function keepFrame(req,ext,rule){
  const key=req.frameKey;if(!key)return;
  const map=frames.get(key)||new Map(),have=map.get(ext.id);
  if(!have||rule.priority>have.rule.priority)map.set(ext.id,{rule});
  frames.delete(key);frames.set(key,map);if(frames.size>4096)frames.delete(frames.keys().next().value);
 }
 function modify(input,headers,phase,floors=null){
  if(!list.length||!headers)return null;
  const req=input.lower?input:prepareRequest(input);
  const frameAllows=frameAllowsFor(req);
  const state=new Map();let out=null;
  for(const ext of list){
   const rules=ext.headerRules(req,phase,phase==='responseHeaders'?headers:null);if(!rules.length)continue;
   if(!access(ext,req))continue;
   const floor=Math.max(ext.allowPriority(req,frameAllows),floors&&floors.get(ext.id)||0);
   for(const rule of rules){
    if(rule.priority<=floor)break;
    let used=false;
    for(const op of rule.act[phase]){
     const seen=state.get(op.name);
     if(seen&&(seen!=='append'||op.op!=='append'))continue;
     if(!out)out=phase==='requestHeaders'?{...headers}:Object.fromEntries(Object.entries(headers).map(([k,v])=>[k,Array.isArray(v)?v.slice():[String(v)]]));
     const existing=Object.keys(out).filter(k=>k.toLowerCase()===op.name);
     if(op.op==='remove'){for(const k of existing)delete out[k];}
     else if(op.op==='set'){for(const k of existing)delete out[k];out[op.header]=phase==='requestHeaders'?op.value:[op.value];}
     else if(phase==='requestHeaders'){const k=existing[0];if(k)out[k]=out[k]+(op.name==='cookie'?'; ':', ')+op.value;else out[op.header]=op.value;}
     else{const k=existing[0];if(k)out[k].push(op.value);else out[op.header]=[op.value];}
     state.set(op.name,op.op);used=true;
    }
    if(used){ext.record(rule,req);if(onMatch)onMatch(ext.id,rule,req,'modifyHeaders');}
   }
  }
  return out;
 }
}

/** Electron webRequest details → the engine's request shape. getTabId(details) and getTopUrl(details) are supplied by the caller. */
function fromElectron(details,{tabId=-1,topUrl=null,initiator=null,frameKey=null,frameKeys=null}={}){
 return prepareRequest({url:details.url,method:details.method,type:ELECTRON_TYPES[details.resourceType]||'other',tabId,initiator,topUrl,frameKey,frameKeys});
}

module.exports={createDnrEngine,compileRule,compileUrlFilter,parseUrlFilter,matchUrlFilter,filterTokens,regexToken,prepareRequest,fromElectron,urlTokens,hostSuffixes,safeRegex,applyTransform,LIMITS,RESOURCE_TYPES,ELECTRON_TYPES};
