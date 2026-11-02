'use strict';
// Anonymous usage counts: nothing before a saved on choice, one message a day, fixed payload (schema 2: coarse closed-list facts and use buckets), no secret in the client.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMetrics,checkedEndpoint,SAMPLE_ID}=require('../desktop/browser-services/metrics.cjs');
const usage=require('../desktop/browser-services/usage-facts.cjs');

const BASE_FIELDS=['schema','event','installId','appVersion','channel','platform','arch','language','day'];
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-metrics-'));
function make(extra={}){const sent=[];let time=Date.parse('2026-10-25T12:00:00Z');
 const metrics=createMetrics({directory:extra.directory||folder(),endpoint:'https://metrics.example.org/v1/daily',appVersion:'0.9.1',platform:'win32',arch:'x64',language:'en-GB',send:async(url,body)=>{sent.push({url,body:JSON.parse(body)});return extra.status??204;},now:()=>time,...extra});
 return {metrics,sent,advance:ms=>{time+=ms;}};}

test('nothing is sent, and no id exists, before a saved on choice',async()=>{
 const {metrics,sent}=make();
 assert.equal((await metrics.status()).choice,'unset');assert.equal((await metrics.status()).enabled,false);
 assert.deepEqual(await metrics.maybeSend(),{sent:false,reason:'off'});
 await metrics.set(false);assert.deepEqual(await metrics.maybeSend(),{sent:false,reason:'off'});
 assert.equal(sent.length,0);assert.equal((await metrics.status()).payload.installId,SAMPLE_ID,'while off the preview shows a placeholder id, not a real one');assert.equal((await metrics.status()).sample,true);
});

test('new setup defaults an unset choice on once and preserves every saved choice',async()=>{
 const {metrics}=make();const initial=await metrics.set(true,{onlyIfUnset:true});
 assert.equal(initial.enabled,true);const first=initial.payload.installId;
 assert.equal((await metrics.set(true,{onlyIfUnset:true})).payload.installId,first);
 await metrics.set(false);assert.equal((await metrics.set(true,{onlyIfUnset:true})).enabled,false);
 assert.equal((await metrics.status()).payload.installId,SAMPLE_ID);
 const restarted=make({directory:folder()});await restarted.metrics.set(false);
 assert.equal((await restarted.metrics.set(true,{onlyIfUnset:true})).choice,'off');
 assert.throws(()=>metrics.set(true,{onlyIfUnset:'yes'}),/initialization/);
});

test('an in-flight successful send cannot restore an opt-out or its deleted id',async()=>{
 let complete;const {metrics}=make({send:()=>new Promise(resolve=>{complete=resolve;})});
 await metrics.set(true);const pending=metrics.maybeSend();await new Promise(resolve=>setImmediate(resolve));await metrics.set(false);complete(204);await pending;
 const status=await metrics.status();assert.equal(status.choice,'off');assert.equal(status.sample,true);
 assert.equal(status.lastSent,'');
 assert.deepEqual(await metrics.maybeSend(),{sent:false,reason:'off'});
});

test('new-setup defaults never overwrite corrupt or unrecognized existing consent',async()=>{
 for(const contents of ['{broken', '{}', '{"choice":"unknown"}']){
  const directory=folder();fs.writeFileSync(path.join(directory,'metrics.json'),contents);
  const {metrics}=make({directory});assert.equal((await metrics.set(true,{onlyIfUnset:true})).enabled,false);
  assert.equal(fs.readFileSync(path.join(directory,'metrics.json'),'utf8'),contents);
  assert.equal((await metrics.set(true)).enabled,true,'an explicit new choice can repair the file');
 }
});

test('overlapping startup/setup timers cannot submit the same daily usage twice',async()=>{
 let finish,calls=0;const {metrics}=make({send:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
 await metrics.set(true);const first=metrics.maybeSend();assert.deepEqual(await metrics.maybeSend(),{sent:false,reason:'busy'});
 await new Promise(resolve=>setImmediate(resolve));finish(204);await first;assert.equal(calls,1);assert.deepEqual(await metrics.maybeSend(),{sent:false,reason:'already sent today'});
});

const RAW={theme:'dark',finish:'Burgundy',tabLayout:'sidebar',toolbar:'automatic',animation:'fast',uiLanguage:'fr',searchEngine:'duckduckgo',aiFree:'on',vpn:'on',vpnApp:'Mullvad VPN',extensions:3,profiles:2,siteProtectionOff:1};
test('the message is small, fixed and carries nothing that identifies a person: exact field list, closed values only',async()=>{
 const {metrics,sent}=make({facts:async()=>RAW});await metrics.set(true);metrics.note('torTabs');metrics.note('torTabs');metrics.note('splitView');metrics.noteImport('chrome-default');
 const preview=(await metrics.status()).payload;
 assert.deepEqual(await metrics.maybeSend(),{sent:true});
 const body=sent[0].body;
 assert.deepEqual(Object.keys(body).sort(),[...BASE_FIELDS,...usage.FIELDS].sort(),'exactly the documented fields');
 assert.match(body.installId,/^[0-9a-f-]{36}$/);assert.notEqual(body.installId,SAMPLE_ID);assert.equal(body.language,'en','only the language, not the region');assert.equal(body.day,'2026-10-25');
 assert.deepEqual({theme:body.theme,finish:body.finish,tabLayout:body.tabLayout,toolbar:body.toolbar,animation:body.animation,uiLanguage:body.uiLanguage,searchEngine:body.searchEngine,aiFree:body.aiFree,vpn:body.vpn,vpnApp:body.vpnApp,extensions:body.extensions,profiles:body.profiles,siteProtectionOff:body.siteProtectionOff,importSource:body.importSource},
  {theme:'dark',finish:'burgundy',tabLayout:'sidebar',toolbar:'automatic',animation:'fast',uiLanguage:'fr',searchEngine:'duckduckgo',aiFree:'on',vpn:'on',vpnApp:'Mullvad VPN',extensions:'2-3',profiles:'2',siteProtectionOff:'1',importSource:'chrome'});
 assert.deepEqual([body.torTabs,body.splitView,body.torWindows,body.rewind],['1-2','1-2','0','0'],'counts are buckets, never exact numbers');
 assert.deepEqual(body,preview,'"See what\'s sent" is exactly what is sent');
 for(const field of Object.keys(usage.ENUMS))assert.ok(usage.ENUMS[field].includes(body[field]),field+' is a value from its closed list');
 for(const name of usage.USES)assert.ok(usage.COUNT_BUCKETS.includes(body[name]),name+' is a bucket');
 assert.doesNotMatch(Object.values(body).join(' '),/https?:|@|\\|\/Users|history|password/i,'no value is an address, path or account detail');
});

test('hostile or unexpected facts can only become a fallback value: no URL, site, search term, name, path or number leaks into the message',async()=>{
 const hostile={theme:'https://evil.example/?q=secret',finish:'C:\\Users\\Alice\\Desktop',tabLayout:{url:'https://x'},toolbar:'x'.repeat(5000),animation:null,uiLanguage:'fr-CA@someone.example',searchEngine:'https://my-private-search.example/?q=%s',aiFree:'maybe',vpn:42,vpnApp:'My Employer VPN (alice@corp.example)',extensions:'7',profiles:-5,siteProtectionOff:1e9,importSource:'D:\\Alice\\profile'};
 const {metrics,sent}=make({facts:async()=>hostile});await metrics.set(true);await metrics.maybeSend();
 const body=sent[0].body,text=JSON.stringify(body);
 assert.doesNotMatch(text,/evil|secret|Alice|someone|private-search|corp|employer|[A-Z]:\\/i);
 assert.deepEqual([body.theme,body.finish,body.tabLayout,body.toolbar,body.animation,body.uiLanguage,body.searchEngine,body.aiFree,body.vpn,body.vpnApp,body.extensions,body.profiles,body.siteProtectionOff,body.importSource],['system','unknown','unknown','unknown','unknown','other','other','unknown','unknown','none','0','1','6+','none']);
 assert.ok(text.length<1400,'one small message, '+text.length+' bytes');
 const broken=make({facts:async()=>{throw new Error('boom');}});await broken.metrics.set(true);assert.equal((await broken.metrics.maybeSend()).sent,true,'a failing fact source still sends the base message with fallbacks');
});

test('feature counts: only while on, only known names, bucketed, kept until a send succeeds, deleted on off',async()=>{
 const {metrics,sent,advance}=make({facts:async()=>RAW});
 metrics.note('torTabs');assert.equal((await metrics.status()).payload.torTabs,'0','nothing is counted while the choice is unset');
 await metrics.set(false);metrics.note('torTabs');metrics.noteImport('firefox');assert.equal((await metrics.status()).payload.torTabs,'0');assert.equal((await metrics.status()).payload.importSource,'none');
 await metrics.set(true);for(let i=0;i<7;i++)metrics.note('privateTabs');metrics.note('torWindows');metrics.note('not-a-feature');metrics.note('__proto__');
 let p=(await metrics.status()).payload;assert.deepEqual([p.privateTabs,p.torWindows,p.peek],['3-9','1-2','0']);
 await metrics.maybeSend();assert.equal(sent[0].body.privateTabs,'3-9');
 p=(await metrics.status()).payload;assert.equal(p.privateTabs,'0','a successful send starts the next period from zero');
 advance(24*3600*1000);metrics.note('peek');await metrics.maybeSend();assert.equal(sent[1].body.peek,'1-2');assert.equal(sent[1].body.privateTabs,'0');
 metrics.note('rewind');await metrics.set(false);await metrics.set(true);assert.equal((await metrics.status()).payload.rewind,'0','turning it off deletes the counts');
});

test('uses counted while a message is in flight are kept for the next one',async()=>{
 let complete;const bodies=[];const {metrics}=make({send:(url,body)=>new Promise(resolve=>{bodies.push(JSON.parse(body));complete=resolve;})});
 await metrics.set(true);metrics.note('splitView');const pending=metrics.maybeSend();await new Promise(resolve=>setImmediate(resolve));metrics.note('splitView');metrics.note('splitView');metrics.note('splitView');complete(204);await pending;
 assert.equal(bodies[0].splitView,'1-2');assert.equal((await metrics.status()).payload.splitView,'3-9','the three later uses are still counted');
});

test('bucket edges and the closed lists',()=>{
 assert.deepEqual([0,1,2,3,9,10,500,'x',-3,NaN].map(usage.countBucket),['0','1-2','1-2','3-9','3-9','10+','10+','0','0','0']);
 assert.deepEqual([0,1,5,6,15,16,40,41,100,101].map(usage.tabsBucket),['1-5','1-5','1-5','6-15','6-15','16-40','16-40','41-100','41-100','101+']);
 assert.deepEqual([0,1,2,3,5,6,30].map(usage.windowsBucket),['1','1','2','3-5','3-5','6+','6+']);
 assert.deepEqual([0,1,2,3,4,9].map(usage.panesBucket),['none','none','2','3','4','4']);
 assert.deepEqual([null,{total:0,done:0},{total:10,done:0},{total:10,done:3},{total:10,done:5},{total:10,done:9},{total:10,done:10},{total:4,done:99}].map(usage.signBackInBucket),['none','none','0','1-49','50-99','50-99','100','100']);
 assert.deepEqual([true,false,'on','off',undefined,'x'].map(usage.onOff),['on','off','on','off','unknown','unknown']);
 assert.deepEqual([0,1,2,3,4,6,7].map(usage.smallBucket),['0','1','2-3','2-3','4-6','4-6','7+']);
 assert.deepEqual([0,1,2,3,4,5,50].map(usage.profileBucket),['1','1','2','3-4','3-4','5+','5+']);
 assert.deepEqual([0,1,2,5,6].map(usage.siteBucket),['0','1','2-5','2-5','6+']);
 assert.equal(usage.uiLanguageOf('system','fr-CA'),'fr');assert.equal(usage.uiLanguageOf('pt-BR','en'),'pt-BR');assert.equal(usage.uiLanguageOf('zh-TW','en'),'other');assert.equal(usage.uiLanguageOf('','en-US'),'en');
 assert.deepEqual(['chrome-default','Microsoft Edge','firefox-profile','arc','html-file','weird','',undefined].map(usage.importFamily),['chrome','edge','firefox','arc','html','other','none','none']);
 assert.equal(usage.searchEngineOf('DuckDuckGo'),'duckduckgo');assert.equal(usage.searchEngineOf('https://x.example'),'other');
 assert.deepEqual(['Mullvad VPN','OpenVPN or a similar VPN','a VPN',undefined].map(usage.vpnAppOf),['Mullvad VPN','other','other','none']);
 for(const [field,list] of Object.entries(usage.ENUMS))assert.equal(new Set(list).size,list.length,field+' has no duplicate values');
});

test('at most one message a day, and a failed send is retried later, not in a loop',async()=>{
 const ok=make();await ok.metrics.set(true);assert.equal((await ok.metrics.maybeSend()).sent,true);assert.deepEqual(await ok.metrics.maybeSend(),{sent:false,reason:'already sent today'});
 ok.advance(24*3600*1000);assert.equal((await ok.metrics.maybeSend()).sent,true);assert.equal(ok.sent.length,2);
 const bad=make({status:500});await bad.metrics.set(true);assert.deepEqual(await bad.metrics.maybeSend(),{sent:false,reason:'server'});assert.equal((await bad.metrics.status()).lastSent,'');assert.equal(bad.sent.length,1,'one attempt per call');
 const down=make({send:async()=>{throw new Error('offline');}});await down.metrics.set(true);assert.deepEqual(await down.metrics.maybeSend(),{sent:false,reason:'network'});
});
test('turning it off forgets the id; turning it on again makes a new one',async()=>{
 const {metrics}=make();const first=(await metrics.set(true)).payload.installId;assert.equal((await metrics.set(true)).payload.installId,first,'on twice keeps the id');
 const off=await metrics.set(false);assert.equal(off.choice,'off');assert.equal(off.payload.installId,SAMPLE_ID);
 assert.notEqual((await metrics.set(true)).payload.installId,first);
 assert.throws(()=>metrics.set('yes'),/on or off/);
});
test('the choice survives a restart; a damaged file means off',async()=>{
 const directory=folder();await make({directory}).metrics.set(true);assert.equal((await make({directory}).metrics.status()).enabled,true);
 fs.writeFileSync(path.join(directory,'metrics.json'),'{broken');assert.equal((await make({directory}).metrics.status()).enabled,false);assert.equal((await make({directory}).metrics.status()).choice,'unset');
});
test('no endpoint, or a route that would hide nothing, sends nothing even when on',async()=>{
 const none=make({endpoint:''});await none.metrics.set(true);assert.deepEqual(await none.metrics.maybeSend(),{sent:false,reason:'no endpoint'});assert.equal((await none.metrics.status()).configured,false);
 const routed=make({routeOk:()=>false});await routed.metrics.set(true);assert.deepEqual(await routed.metrics.maybeSend(),{sent:false,reason:'route'});assert.equal(routed.sent.length,0);
});
test('only a plain https address is accepted: no credentials, query, fragment; http only for a local test server',()=>{
 assert.equal(checkedEndpoint('https://metrics.example.org/v1/daily'),'https://metrics.example.org/v1/daily');
 for(const bad of ['http://metrics.example.org/','https://user:pw@metrics.example.org/','https://metrics.example.org/?key=abc','https://metrics.example.org/#x','ftp://x/','nonsense',''])assert.equal(checkedEndpoint(bad),'',bad);
 assert.equal(checkedEndpoint('http://127.0.0.1:9/x'),'');assert.equal(checkedEndpoint('http://127.0.0.1:9/x',{allowLocal:true}),'http://127.0.0.1:9/x');assert.equal(checkedEndpoint('http://evil.example/',{allowLocal:true}),'');
});
test('the shipped client holds no key, token or secret, and the shipped endpoint is empty or a plain address',()=>{
 const files=['desktop/browser-services/metrics.cjs','desktop/browser-services/usage-facts.cjs','desktop/browser-services/metrics-config.cjs','src/features/metrics/useMetrics.ts'].map(f=>[f,fs.readFileSync(path.join(__dirname,'..',f),'utf8')]);
 const keyLike=[/AKIA[0-9A-Z]{12,}/,/\bsk-[A-Za-z0-9_-]{16,}/,/\bghp_[A-Za-z0-9]{20,}/,/\bAIza[0-9A-Za-z_-]{20,}/,/\bxox[bp]-[A-Za-z0-9-]{10,}/,/-----BEGIN [A-Z ]*PRIVATE KEY/,/\b[A-Fa-f0-9]{32,}\b/,/\b[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9])/];
 const words=/\b(api[_-]?key|secret|passw(or)?d|bearer|authorization|x-api-key|client[_-]?secret|access[_-]?token)\b/i;
 for(const [file,text] of files){for(const pattern of keyLike)assert.doesNotMatch(text,pattern,file+' '+pattern);assert.doesNotMatch(text.replace(/no key, token or secret|holds no secret|never a key|There is no key|url.password/g,''),words,file);}
 const config=require('../desktop/browser-services/metrics-config.cjs');assert.deepEqual(Object.keys(config),['endpoint'],'the config holds an address and nothing else');
 assert.ok(config.endpoint===''||checkedEndpoint(config.endpoint)===config.endpoint);
 const send=files[0][1].match(/headers:\s*\{[^}]*\}/)[0];assert.doesNotMatch(send,/authorization|cookie|x-api/i);assert.match(send,/Content-Type/);
});

test('the reported version is the app\'s own (package.json), never Electron\'s, and main.cjs uses that source',()=>{
 const {version}=require('../desktop/browser-services/app-version.cjs');
 assert.equal(version,require('../package.json').version);assert.notEqual(version,process.versions.electron);
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),line=main.split(/\r?\n/).find(item=>item.includes('createMetrics('));
 assert.ok(line.includes('app-version.cjs')&&!line.includes('app.getVersion()'),'metrics must not use app.getVersion()');
});

test('metricsService is declared at the top level of main.cjs, so the 20 second start-up timer and every service can reach it',()=>{
 // A declaration inside a function made the timer throw ReferenceError after 20 s and the app showed a modal error. Tests and short runs never waited that long.
 const ts=require('typescript'),file=path.join(__dirname,'../desktop/main.cjs'),source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 let declaration=null;const uses=[];
 (function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText()==='metricsService')declaration=node;if(ts.isIdentifier(node)&&node.text==='metricsService')uses.push(node);ts.forEachChild(node,visit);})(source);
 assert.ok(declaration,'metricsService is declared');
 assert.equal(declaration.parent.parent.parent.kind,ts.SyntaxKind.SourceFile,'declared at module level, not inside a function or block');
 assert.ok(uses.length>=4,'declaration plus the services, the timer and the protection summary');
});

test('main wires the facts and the use counters in one place each, and never passes a URL, title or setting text to the counters',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8').replace(/\r\n/g,'\n');
 assert.match(main,/facts:usageFacts/);
 const calls=[...main.matchAll(/usageNote\('([A-Za-z]+)'\)/g)].map(match=>match[1]);
 const ratingOnly=Object.keys(require('../desktop/browser-services/feature-rating.cjs').SOURCES).filter(name=>!usage.USES.includes(name));
 for(const name of calls)assert.ok(usage.USES.includes(name)||ratingOnly.includes(name),name+' is a name from the closed list');
 for(const name of usage.USES)assert.ok(calls.includes(name),name+' is counted somewhere');
 assert.doesNotMatch(main,/usageNote\([^')]/,'usageNote only takes a literal feature name');
});

test('a test profile never sends to the shipped (live) endpoint: only an address QA names itself', () => {
 const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
 assert.match(main, /endpoint:test\?\(process\.env\.ACIRA_METRICS_ENDPOINT\|\|''\):require\('\.\/browser-services\/metrics-config\.cjs'\)\.endpoint/);
});
