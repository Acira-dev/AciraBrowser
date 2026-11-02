'use strict';
// Builds a declarativeNetRequest "extension" from Acira's bundled filter lists (EasyList, EasyPrivacy, uBlock filters), converted the way
// uBlock Origin Lite compiles network filters (host anchors, wildcards, separators, $domain / $third-party / type options, exceptions,
// regex filters), for qa/dnr-bench.cjs when a store copy of uBO Lite is not at hand.
//   node qa/dnr-synth.cjs <out dir> [copies]   (copies > 1 repeats the rule set with renamed hosts, to reach uBO Lite's ~300,000 rules)
const fs=require('node:fs'),path=require('node:path');
const out=process.argv[2];if(!out)throw new Error('usage: node qa/dnr-synth.cjs <out dir> [copies]');
const copies=Math.max(1,+(process.argv[3]||1));
const TYPES={script:'script',image:'image',stylesheet:'stylesheet',css:'stylesheet',xmlhttprequest:'xmlhttprequest',xhr:'xmlhttprequest',subdocument:'sub_frame',frame:'sub_frame',document:'main_frame',doc:'main_frame',ping:'ping',media:'media',font:'font',object:'object',websocket:'websocket',other:'other'};
function convert(line){
 if(!line||line.startsWith('!')||line.startsWith('[')||/#[@?$%]?#|#\+js/.test(line))return null;
 let allow=false;if(line.startsWith('@@')){allow=true;line=line.slice(2);}
 let pattern=line,options='';const dollar=line.lastIndexOf('$');
 if(dollar>0&&!/^\/.*\/$/.test(line)){pattern=line.slice(0,dollar);options=line.slice(dollar+1);}
 const condition={},types=[],excluded=[];let priority=1;
 for(const opt of options?options.split(','):[]){
  const [name,value]=opt.split('=');const neg=name.startsWith('~'),key=neg?name.slice(1):name;
  if(key==='domain'||key==='from'){const inc=[],exc=[];for(const d of (value||'').split('|')){if(!d||d.includes('*')||d.startsWith('/'))return null;(d.startsWith('~')?exc:inc).push(d.replace(/^~/,'').toLowerCase());}if(inc.length)condition.initiatorDomains=inc;if(exc.length)condition.excludedInitiatorDomains=exc;}
  else if(key==='third-party'||key==='3p')condition.domainType=neg?'firstParty':'thirdParty';
  else if(key==='first-party'||key==='1p')condition.domainType=neg?'thirdParty':'firstParty';
  else if(TYPES[key])(neg?excluded:types).push(TYPES[key]);
  else if(key==='match-case')condition.isUrlFilterCaseSensitive=true;
  else if(key==='important')priority=30;
  else if(key==='all'||key==='popup')continue;
  else return null;
 }
 if(types.length)condition.resourceTypes=[...new Set(types)];else if(excluded.length)condition.excludedResourceTypes=[...new Set(excluded)];
 if(/^\/.+\/$/.test(pattern)){const source=pattern.slice(1,-1);try{new RegExp(source);}catch{return null;}condition.regexFilter=source;}
 else{if(!pattern||pattern==='*'||/[^\x20-\x7e]/.test(pattern))return null;if(pattern.startsWith('||*'))pattern=pattern.slice(2);condition.urlFilter=pattern;}
 return {priority:allow?priority+1:priority,action:{type:allow?'allow':'block'},condition};
}
const lists=['easylist.txt','easyprivacy.txt','ubo-filters.txt','unbreak.txt'].map(f=>path.join(__dirname,'..','resources','filters',f));
const base=[];let regex=0;
for(const file of lists)for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){const rule=convert(raw.trim());if(!rule)continue;if(rule.condition.regexFilter&&++regex>900)continue;base.push(rule);}
fs.mkdirSync(out,{recursive:true});
const resources=[];let id=0;
for(let c=0;c<copies;c++){
 const rules=base.map(r=>{const copy=JSON.parse(JSON.stringify(r));copy.id=++id;if(c>0){if(copy.condition.regexFilter)return null;if(copy.condition.urlFilter)copy.condition.urlFilter=copy.condition.urlFilter.replace(/([a-z0-9-]+)\.([a-z]{2,})/i,`$1c${c}.$2`);}return copy;}).filter(Boolean);
 fs.writeFileSync(path.join(out,`set${c}.json`),JSON.stringify(rules));resources.push({id:'set'+c,enabled:true,path:`set${c}.json`});
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({name:'Synthetic uBO-Lite-like',version:'1',manifest_version:3,permissions:['declarativeNetRequest'],declarative_net_request:{rule_resources:resources}}));
console.log(JSON.stringify({rulesPerCopy:base.length,copies,total:id,regex:Math.min(regex,900)}));
