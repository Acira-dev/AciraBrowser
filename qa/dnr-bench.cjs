'use strict';
// declarativeNetRequest matcher cost on real extension rules: cold compile time, heap, per-request overhead (p50 / p99 / max).
//   node --expose-gc qa/dnr-bench.cjs <unpacked extension dir> [more dirs…]   env: ALL=1 (every ruleset, not just the default ones), DYNAMIC=<rules.json> (dynamic rules of the first),
//   REQUESTS (20000), OUT (json path)
// Requests: a fixed-seed mix of first-party page loads and subresources on ordinary sites, plus third-party URLs built from the rules' own
// domains (so a good share of them match), as script / image / xhr / sub_frame.
const fs=require('node:fs'),path=require('node:path');
const {createDnrEngine,prepareRequest}=require('../desktop/browser-services/dnr-engine.cjs');

const dirs=process.argv.slice(2);if(!dirs.length)throw new Error('usage: node --expose-gc qa/dnr-bench.cjs <extension dir>…');
const gc=()=>{if(global.gc){global.gc();global.gc();}};
const mb=n=>Math.round(n/1048576*10)/10;
let seed=7;const rand=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};const pick=a=>a[Math.floor(rand()*a.length)];

const manifests=dirs.map(dir=>JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')));
const isOn=r=>process.env.ALL==='1'||r.enabled;
const enabledFiles=(dir,manifest)=>(manifest.declarative_net_request?.rule_resources||[]).filter(isOn).map(r=>path.join(dir,r.path));
// Request corpus first (from the rules' own domains and URL pieces), so the measured heap is the engine's alone.
const domains=[],urlBits=[];
for(const [n,dir] of dirs.entries())for(const file of [...enabledFiles(dir,manifests[n]),...(n===0&&process.env.DYNAMIC?[process.env.DYNAMIC]:[])]){
 for(const r of JSON.parse(fs.readFileSync(file,'utf8'))){const c=r.condition||{};if(domains.length<50000){if(c.requestDomains)for(const d of c.requestDomains.slice(0,20))domains.push(d);const m=/^\|\|([a-z0-9.-]+)\^/.exec(c.urlFilter||'');if(m)domains.push(m[1]);}
  const f=c.urlFilter;if(urlBits.length<20000&&f&&!f.startsWith('||')&&f.length<60&&/^[a-z0-9/._=?&-]+$/i.test(f.replace(/[\^*|]/g,'')))urlBits.push(f.replace(/[\^*|]/g,''));}
}
gc();const heap0=process.memoryUsage().heapUsed,rss0=process.memoryUsage().rss;
const engine=createDnrEngine();const report={node:process.versions.node,electron:process.versions.electron||null,extensions:[]};
let t=performance.now();
for(const [n,dir] of dirs.entries()){
 const manifest=manifests[n],resources=manifest.declarative_net_request?.rule_resources||[];
 const t0=performance.now(),rulesets=[];let count=0;
 for(const r of resources){const rules=isOn(r)?JSON.parse(fs.readFileSync(path.join(dir,r.path),'utf8')):null;if(rules)count+=rules.length;rulesets.push({id:r.id,enabled:isOn(r),rules});}
 const dynamicRules=n===0&&process.env.DYNAMIC?JSON.parse(fs.readFileSync(process.env.DYNAMIC,'utf8')):[];
 const parsed=performance.now();
 const result=engine.setExtension(manifest.name+'#'+n,{rulesets,dynamicRules,hostAccess:()=>true});
 const done=performance.now();
 report.extensions.push({name:manifest.name,version:manifest.version,rulesets:resources.length,enabled:resources.filter(isOn).map(r=>r.id),staticRules:count,dynamicRules:dynamicRules.length,readParseMs:Math.round(parsed-t0),compileMs:Math.round(done-parsed),skipped:result.errors.length,skippedSample:result.errors.slice(0,3)});
}
report.coldTotalMs=Math.round(performance.now()-t);
gc();
const heap1=process.memoryUsage().heapUsed,rss1=process.memoryUsage().rss;
report.heapDeltaMB=mb(heap1-heap0);report.rssDeltaMB=mb(rss1-rss0);report.engine=engine.stats();

const sites=['news.example.com','www.wikipedia.org','github.com','www.nytimes.com','www.reddit.com','www.amazon.com','docs.python.org','www.bbc.co.uk','stackoverflow.com','www.youtube.com','twitter.com','www.theguardian.com','medium.com','www.ebay.com','www.imdb.com'];
const words=['static','js','assets','img','api','v1','v2','min','bundle','main','app','vendor','logo','banner','track','pixel','analytics','ads','ad','cdn','cache','fonts','css','image','thumb','video','embed','widget','comments','share'];
const pathOf=()=>'/'+Array.from({length:1+Math.floor(rand()*4)},()=>pick(words)+(rand()<0.3?Math.floor(rand()*1000):'')).join('/')+pick(['.js','.png','.css','','?id='+Math.floor(rand()*1e6),'.json?v=3','.gif?cb='+Math.floor(rand()*1e9)]);
const types=['script','image','xmlhttprequest','sub_frame','stylesheet','image','script','ping','media','font'];
const N=+(process.env.REQUESTS||20000),requests=[];
for(let i=0;i<N;i++){
 const site=pick(sites),r=rand();let url,type,initiator='https://'+site;
 if(r<0.05){url='https://'+site+pathOf();type='main_frame';initiator=null;}
 else if(r<0.5){url='https://'+site+pathOf();type=pick(types);}
 else if(r<0.85&&domains.length){url='https://'+(rand()<0.3?'cdn.':'')+pick(domains)+pathOf();type=pick(types);}
 else if(urlBits.length){url='https://'+pick(['cdn.example.net','static.site.org','img.host.io'])+'/'+pick(urlBits).replace(/^\/+/,'')+(rand()<0.5?'?x=1':'');type=pick(types);}
 else{url='https://x.example/'+pathOf();type=pick(types);}
 requests.push({url,type,method:'GET',tabId:1,initiator,topUrl:'https://'+site+'/',frameKeys:['wc:1']});
}
const time=(fn)=>{const out=new Float64Array(requests.length);for(let i=0;i<requests.length;i++){const s=performance.now();fn(requests[i]);out[i]=performance.now()-s;}return out;};
// Warm up (lazy regex compiles, JIT), then measure.
// Cold: the first pass (lazy urlFilter compiles, JIT). Then one more warm-up pass, then the measured pass.
const cold=time(r=>engine.beforeRequest(prepareRequest(r)));time(r=>engine.beforeRequest(prepareRequest(r)));
const before=time(r=>engine.beforeRequest(prepareRequest(r)));
const headers=time(r=>engine.beforeSendHeaders(prepareRequest(r),{'User-Agent':'x',Accept:'*/*'}));
const stats=a=>{const s=Array.from(a).sort((x,y)=>x-y),q=p=>Math.round(s[Math.min(s.length-1,Math.floor(p*s.length))]*1000)/1000;return {p50:q(0.5),p90:q(0.9),p99:q(0.99),max:q(1),meanUs:Math.round(s.reduce((x,y)=>x+y,0)/s.length*1000*10)/10};};
let blocked=0,redirected=0;for(const r of requests){const out=engine.beforeRequest(prepareRequest(r));if(out?.cancel)blocked++;else if(out?.redirectURL)redirected++;}
report.requests={count:N,blocked,redirected,coldBeforeRequestMs:stats(cold),beforeRequestMs:stats(before),sendHeadersMs:stats(headers)};
gc();report.heapAfterRequestsMB=mb(process.memoryUsage().heapUsed-heap0);
console.log(JSON.stringify(report,null,1));
if(process.env.OUT)fs.writeFileSync(process.env.OUT,JSON.stringify(report,null,1));
