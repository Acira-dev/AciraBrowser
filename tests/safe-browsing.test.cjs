'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {createSafeBrowsing,canonicalize,expressions,hashExpression,backoffMs,validKey,LISTS}=require('../desktop/browser-services/safe-browsing.cjs');
const KEY='AIzaSyDtestKEY_0123456789-abcdefghijklm',API='https://safebrowsing.googleapis.com/v4/';
const sha=data=>createHash('sha256').update(data).digest(),b64=data=>Buffer.from(data).toString('base64'),bytes=(...values)=>Buffer.from(values);
const all=list=>Buffer.concat([...list].sort(Buffer.compare)),prefix=(expression,n=4)=>hashExpression(expression).subarray(0,n),tick=()=>new Promise(resolve=>setImmediate(resolve));
// Rebuilds what Google sends: one RAW set per prefix length, each sorted.
const sets=list=>[...new Set(list.map(b=>b.length))].map(k=>({compressionType:'RAW',rawHashes:{prefixSize:k,rawHashes:b64(all(list.filter(b=>b.length===k)))}}));
// cfg maps "THREAT/PLATFORM" to {all: final sorted list, partial, add, remove, state, badChecksum}; lists not named get an empty full update.
function updateReply(req,cfg={},wait='1800s'){
 return {minimumWaitDuration:wait,listUpdateResponses:req.listUpdateRequests.map(r=>{
  const c=cfg[r.threatType+'/'+r.platformType]||{},full=c.all||[],add=c.add||(c.partial?[]:full);
  return {threatType:r.threatType,platformType:r.platformType,threatEntryType:'URL',responseType:c.partial?'PARTIAL_UPDATE':'FULL_UPDATE',additions:add.length?sets(add):[],removals:c.remove?[{compressionType:'RAW',rawIndices:{indices:c.remove}}]:[],newClientState:c.state||'state-'+r.threatType+'-'+r.platformType,checksum:{sha256:b64(sha(c.badChecksum?Buffer.from('wrong'):all(full)))}};
 })};
}
function harness(options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'acira-sb-')),net={calls:[],update:null,find:null},clock={t:1_800_000_000_000},timers=[];
 const fetch=async(url,init)=>{const body=JSON.parse(init.body),kind=String(url).includes('threatListUpdates:fetch')?'update':'find';net.calls.push({kind,url:String(url),body,raw:init.body});if(!net[kind])throw new Error('unexpected '+kind+' request');const out=await net[kind](body,net.calls.filter(c=>c.kind===kind).length);return out instanceof Response?out:new Response(JSON.stringify(out),{status:200});};
 const setTimer=(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer;};
 const config={directory,fetch,now:()=>clock.t,env:{ACIRA_SAFE_BROWSING_KEY:KEY},setTimer,random:()=>0.5,...options};
 return {directory,net,clock,timers,fetch,config,sb:createSafeBrowsing(config),calls:kind=>net.calls.filter(c=>c.kind===kind),cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
// Loads the MALWARE/WINDOWS list so URL checks have something local to compare against.
async function primed(h,list,extra={}){h.net.update=req=>updateReply(req,{'MALWARE/WINDOWS':{all:list,state:'m1'},...extra});assert.deepEqual(await h.sb.updateNow(),{updated:true});}
const match=(expression,threat='SOCIAL_ENGINEERING',cache='300s')=>({threatType:threat,platformType:'WINDOWS',threatEntryType:'URL',threat:{hash:b64(hashExpression(expression))},cacheDuration:cache});

test('without a key the module is off and never touches the network',async t=>{
 const h=harness({env:{}});t.after(h.cleanup);
 h.sb.start();assert.equal(h.timers.length,0);
 assert.deepEqual(await h.sb.updateNow(),{updated:false,reason:'no-key'});
 assert.deepEqual(await h.sb.checkUrl('http://phish.example.com/login'),{safe:true,checked:false});
 assert.equal(h.net.calls.length,0);
 const status=h.sb.status();assert.equal(status.state,'off-no-key');assert.equal(status.hasKey,false);assert.equal(status.nextUpdate,null);
});

test('keys are validated, saved owner-only, restored after a restart and cleared',t=>{
 const h=harness({env:{}});t.after(h.cleanup);
 for(const bad of ['','short','a'.repeat(61),'has space '.repeat(4),'AIza'+'!'.repeat(30),null,42])assert.throws(()=>h.sb.setKey(bad),/API key/);
 assert.equal(h.sb.status().hasKey,false);
 assert.equal(h.sb.setKey(KEY).state,'initializing');
 const file=path.join(h.directory,'safe-browsing.json');
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{apiKey:KEY});
 if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.equal(createSafeBrowsing({...h.config,env:{}}).status().hasKey,true,'the saved key is read back after a restart');
 assert.equal(createSafeBrowsing({...h.config,env:{ACIRA_SAFE_BROWSING_KEY:'bad'}}).status().hasKey,true,'a malformed env key is ignored and the saved key is used');
 assert.equal(h.sb.clearKey().state,'off-no-key');assert.equal(fs.existsSync(file),false);assert.equal(h.sb.clearKey().hasKey,false);
 assert.equal(createSafeBrowsing({...h.config,env:{ACIRA_SAFE_BROWSING_KEY:'bad'}}).status().hasKey,false);
 assert.equal(validKey(KEY),true);assert.equal(validKey('a'.repeat(29)),false);assert.equal(validKey('a'.repeat(60)),true);
});

test('update requests ask for RAW lists on WINDOWS and ANY_PLATFORM, then full update, then partial update with removals across prefix lengths',async t=>{
 const h=harness();t.after(h.cleanup);
 // The 6-byte entry sorts between the two 4-byte ones, so removal indices only work on the merged order.
 const first=[bytes(0,0,0,1),bytes(0,0,0,2),bytes(0,0,0,2,255,255),bytes(0,0,0,3)];
 h.net.update=req=>updateReply(req,{'MALWARE/WINDOWS':{all:first,state:'m1'}});
 assert.deepEqual(await h.sb.updateNow(),{updated:true});
 const call=h.calls('update')[0];
 assert.ok(call.url.startsWith(API+'threatListUpdates:fetch?key='));
 assert.deepEqual(call.body.client,{clientId:'acira-browser',clientVersion:'0.1.0'});
 assert.deepEqual(call.body.listUpdateRequests.map(r=>r.threatType+'/'+r.platformType).sort(),LISTS.map(l=>l.threatType+'/'+l.platformType).sort());
 assert.equal(call.body.listUpdateRequests.length,6);
 for(const r of call.body.listUpdateRequests){assert.equal(r.threatEntryType,'URL');assert.equal('state' in r,false);assert.deepEqual(r.constraints.supportedCompressions,['RAW']);}
 let status=h.sb.status();assert.equal(status.state,'ready');assert.equal(status.lastUpdate,h.clock.t);assert.deepEqual(status.lists.map(l=>[l.type,l.prefixes]),[['MALWARE',4],['SOCIAL_ENGINEERING',0],['UNWANTED_SOFTWARE',0]]);
 h.clock.t+=1_900_000;
 const final=[bytes(0,0,0,1),bytes(0,0,0,3),bytes(0,0,0,4,0),bytes(0,0,0,5)];
 h.net.update=req=>updateReply(req,{'MALWARE/WINDOWS':{partial:true,add:[bytes(0,0,0,5),bytes(0,0,0,4,0)],remove:[1,2],all:final,state:'m2'}});
 assert.deepEqual(await h.sb.updateNow(),{updated:true});
 const second=h.calls('update')[1].body.listUpdateRequests;
 assert.equal(second.find(r=>r.threatType==='MALWARE'&&r.platformType==='WINDOWS').state,'m1');
 assert.equal(second.find(r=>r.threatType==='SOCIAL_ENGINEERING'&&r.platformType==='ANY_PLATFORM').state,'state-SOCIAL_ENGINEERING-ANY_PLATFORM');
 const saved=JSON.parse(fs.readFileSync(path.join(h.directory,'safe-browsing','MALWARE_WINDOWS.json'),'utf8'));
 assert.equal(saved.state,'m2');assert.equal(saved.checksum,b64(sha(all(final))));
 assert.deepEqual(Object.keys(saved.prefixes).sort(),['4','5']);
 assert.equal(saved.prefixes['4'],b64(Buffer.concat([bytes(0,0,0,1),bytes(0,0,0,3),bytes(0,0,0,5)])));assert.equal(saved.prefixes['5'],b64(bytes(0,0,0,4,0)));
 status=h.sb.status();assert.equal(status.lists[0].prefixes,4);assert.equal(status.lastError,null);
});

test('updateNow honours minimumWaitDuration and never runs two updates at once',async t=>{
 const h=harness();t.after(h.cleanup);
 let release;h.net.update=req=>new Promise(resolve=>{release=()=>resolve(updateReply(req,{},'7200s'));});
 const a=h.sb.updateNow(),b=h.sb.updateNow();assert.equal(a,b);await tick();release();assert.deepEqual(await a,{updated:true});
 assert.equal(h.calls('update').length,1);
 assert.deepEqual(await h.sb.updateNow(),{updated:false,reason:'wait',retryAt:h.clock.t+7_200_000});
 h.clock.t+=7_199_999;assert.equal((await h.sb.updateNow()).reason,'wait');assert.equal(h.calls('update').length,1);
 h.net.update=req=>updateReply(req,{},'7200s');h.clock.t+=1;assert.deepEqual(await h.sb.updateNow(),{updated:true});assert.equal(h.calls('update').length,2);
});

test('scheduler: random first delay, exponential back-off with jitter on errors, minimum wait on success, stop cancels',async t=>{
 const h=harness();t.after(h.cleanup);
 h.net.update=()=>new Response('{"error":{"message":"try later"}}',{status:503});
 h.sb.start();assert.equal(h.timers.length,1);assert.equal(h.timers[0].ms,30_000,'first request lands within the first minute');
 const fire=async()=>{h.timers.at(-1).fn();return h.sb.updateNow();};
 assert.equal((await fire()).reason,'error');
 const delays=[h.timers.at(-1).ms];assert.equal(delays[0],backoffMs(1,0.5));
 h.clock.t+=delays[0];assert.equal((await fire()).reason,'error');delays.push(h.timers.at(-1).ms);
 h.clock.t+=delays[1];assert.equal((await fire()).reason,'error');delays.push(h.timers.at(-1).ms);
 assert.ok(delays[0]<delays[1]&&delays[1]<delays[2],'back-off grows: '+delays);
 assert.equal(delays[1],backoffMs(2,0.5));
 let status=h.sb.status();assert.equal(status.state,'error');assert.match(status.lastError,/HTTP 503: try later/);assert.equal(status.nextUpdate,h.clock.t+delays[2]);
 assert.equal((await h.sb.updateNow()).reason,'wait','a manual update cannot skip a back-off');
 h.clock.t+=delays[2];h.net.update=req=>updateReply(req,{},'593.440s');
 assert.equal((await fire()).updated,true);
 assert.equal(h.timers.at(-1).ms,30*60_000,'the 30 minute cadence applies when it is longer than the server minimum');
 status=h.sb.status();assert.equal(status.state,'ready');assert.equal(status.lastError,null);
 h.clock.t+=30*60_000;h.net.update=req=>updateReply(req,{},'7200s');assert.equal((await fire()).updated,true);
 assert.equal(h.timers.at(-1).ms,7_200_000,'minimumWaitDuration longer than the cadence wins');
 // A restart inside the wait must not beat it.
 const again=createSafeBrowsing({...h.config});again.start();assert.equal(h.timers.at(-1).ms,7_200_000);
 const before=h.calls('update').length;again.stop();h.timers.at(-1).fn();await tick();assert.equal(h.calls('update').length,before,'a stopped scheduler ignores its old timer');
 assert.equal(backoffMs(1,0),15*60_000);assert.equal(backoffMs(2,0),45*60_000);assert.equal(backoffMs(3,1),7*15*60_000*2);assert.equal(backoffMs(30,0.9),24*3_600_000);
});

test('a checksum mismatch discards that list and the next request asks for a full update',async t=>{
 const h=harness();t.after(h.cleanup);
 await primed(h,[bytes(0,0,0,1)]);
 const file=path.join(h.directory,'safe-browsing','MALWARE_WINDOWS.json');assert.ok(fs.existsSync(file));
 h.clock.t+=1_900_000;h.net.update=req=>updateReply(req,{'MALWARE/WINDOWS':{partial:true,add:[bytes(0,0,0,2)],all:[bytes(0,0,0,1),bytes(0,0,0,2)],state:'m2',badChecksum:true}});
 const result=await h.sb.updateNow();assert.equal(result.updated,false);assert.match(result.error,/Checksum mismatch on MALWARE_WINDOWS/);
 const status=h.sb.status();assert.equal(status.lists[0].prefixes,0);assert.equal(status.state,'error');assert.equal(fs.existsSync(file),false);
 h.clock.t+=1_900_000;h.net.update=req=>updateReply(req,{'MALWARE/WINDOWS':{all:[bytes(0,0,0,9)],state:'m3'}});
 assert.deepEqual(await h.sb.updateNow(),{updated:true});
 const requests=h.calls('update')[2].body.listUpdateRequests;
 assert.equal('state' in requests.find(r=>r.threatType==='MALWARE'&&r.platformType==='WINDOWS'),false,'the damaged list is re-requested from scratch');
 assert.equal(requests.find(r=>r.threatType==='UNWANTED_SOFTWARE'&&r.platformType==='WINDOWS').state,'state-UNWANTED_SOFTWARE-WINDOWS','healthy lists keep their state');
 assert.equal(h.sb.status().lists[0].prefixes,1);assert.equal(h.sb.status().state,'ready');
});

test('unsupported encodings and bad removal indices are refused, not half-applied',async t=>{
 const h=harness();t.after(h.cleanup);
 await primed(h,[bytes(0,0,0,1),bytes(0,0,0,2)]);
 h.clock.t+=1_900_000;
 h.net.update=req=>{const out=updateReply(req,{'MALWARE/WINDOWS':{partial:true,add:[],remove:[7],all:[bytes(0,0,0,1)],state:'m2'}});return out;};
 assert.match((await h.sb.updateNow()).error,/Removal index out of range/);assert.equal(h.sb.status().lists[0].prefixes,0);
 h.clock.t+=1_900_000;
 h.net.update=req=>{const out=updateReply(req,{'MALWARE/WINDOWS':{all:[bytes(0,0,0,1)]}});out.listUpdateResponses[0].additions=[{compressionType:'RICE',riceHashes:{firstValue:'1',riceParameter:2,numEntries:1,encodedData:'AA=='}}];return out;};
 assert.match((await h.sb.updateNow()).error,/Unsupported prefix encoding/);assert.equal(h.sb.status().lists[0].prefixes,0);
});

test('canonicalization matches every example on the Safe Browsing urls-hashing page',()=>{
 const cases=[
  ['http://host/%25%32%35','http://host/%25'],['http://host/%25%32%35%25%32%35','http://host/%25%25'],['http://host/%2525252525252525','http://host/%25'],['http://host/asdf%25%32%35asd','http://host/asdf%25asd'],['http://host/%%%25%32%35asd%%','http://host/%25%25%25asd%25%25'],
  ['http://www.google.com/','http://www.google.com/'],
  ['http://%31%36%38%2e%31%38%38%2e%39%39%2e%32%36/%2E%73%65%63%75%72%65/%77%77%77%2E%65%62%61%79%2E%63%6F%6D/','http://168.188.99.26/.secure/www.ebay.com/'],
  ['http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/','http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/'],
  ['http://host%23.com/%257Ea%2521b%2540c%2523d%2524e%25f%255E00%252611%252A22%252833%252944_55%252B','http://host%23.com/~a!b@c%23d$e%25f^00&11*22(33)44_55+'],
  ['http://3279880203/blah','http://195.127.0.11/blah'],['http://www.google.com/blah/..','http://www.google.com/'],['www.google.com/','http://www.google.com/'],['www.google.com','http://www.google.com/'],
  ['http://www.evil.com/blah#frag','http://www.evil.com/blah'],['http://www.GOOgle.com/','http://www.google.com/'],['http://www.google.com.../','http://www.google.com/'],['http://www.google.com/foo\tbar\rbaz\n2','http://www.google.com/foobarbaz2'],
  ['http://www.google.com/q?','http://www.google.com/q?'],['http://www.google.com/q?r?','http://www.google.com/q?r?'],['http://www.google.com/q?r?s','http://www.google.com/q?r?s'],
  ['http://evil.com/foo#bar#baz','http://evil.com/foo'],['http://evil.com/foo;','http://evil.com/foo;'],['http://evil.com/foo?bar;','http://evil.com/foo?bar;'],['http://\x01\x80.com/','http://%01%80.com/'],
  ['http://notrailingslash.com','http://notrailingslash.com/'],['http://www.gotaport.com:1234/','http://www.gotaport.com/'],['  http://www.google.com/  ','http://www.google.com/'],
  ['http:// leadingspace.com/','http://%20leadingspace.com/'],['http://%20leadingspace.com/','http://%20leadingspace.com/'],['%20leadingspace.com/','http://%20leadingspace.com/'],
  ['https://www.securesite.com/','https://www.securesite.com/'],['http://host.com/ab%23cd','http://host.com/ab%23cd'],['http://host.com//twoslashes?more//slashes','http://host.com/twoslashes?more//slashes'],
  // Beyond the page: other legal IPv4 spellings, dot segments, user info and ports together.
  ['http://0xC37F000B/blah','http://195.127.0.11/blah'],['http://0303.0177.0.013/','http://195.127.0.11/'],['http://195.8323083/','http://195.127.0.11/'],['http://a:b@Example.COM:8080/x/./y/../z','http://example.com/x/z']
 ];
 for(const [input,expected] of cases)assert.equal(canonicalize(input),expected,input);
});

test('suffix/prefix expressions follow the documented host and path rules',()=>{
 assert.deepEqual(expressions('http://a.b.c/1/2.html?param=1'),['a.b.c/1/2.html?param=1','a.b.c/1/2.html','a.b.c/','a.b.c/1/','b.c/1/2.html?param=1','b.c/1/2.html','b.c/','b.c/1/']);
 assert.deepEqual(expressions('http://a.b.c.d.e.f.g/1.html'),['a.b.c.d.e.f.g/1.html','a.b.c.d.e.f.g/','c.d.e.f.g/1.html','c.d.e.f.g/','d.e.f.g/1.html','d.e.f.g/','e.f.g/1.html','e.f.g/','f.g/1.html','f.g/']);
 assert.deepEqual(expressions('http://1.2.3.4/1/'),['1.2.3.4/1/','1.2.3.4/']);
 const hosts=['a.b.c.d.e.f.g','c.d.e.f.g','d.e.f.g','e.f.g','f.g'],paths=['/1/2.html?param=1','/1/2.html','/','/1/'];
 assert.deepEqual(expressions('http://a.b.c.d.e.f.g/1/2.html?param=1'),hosts.flatMap(host=>paths.map(p=>host+p)));
 const widest=expressions('http://a.b.c.d.e.f.g/1/2/3/4/5.html?x=1');assert.equal(widest.length,30,'5 hosts x 6 paths is the ceiling');assert.equal(new Set(widest).size,30);
 assert.deepEqual(widest.slice(0,6),['a.b.c.d.e.f.g/1/2/3/4/5.html?x=1','a.b.c.d.e.f.g/1/2/3/4/5.html','a.b.c.d.e.f.g/','a.b.c.d.e.f.g/1/','a.b.c.d.e.f.g/1/2/','a.b.c.d.e.f.g/1/2/3/']);
 assert.deepEqual(expressions('http://example.com'),['example.com/'],'a bare TLD is never an expression');
});

test('expressions are hashed with plain SHA-256 (FIPS 180-2 vector from the hashing page)',()=>{
 assert.equal(hashExpression('abc').toString('hex'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.equal(hashExpression('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq').subarray(0,6).toString('hex'),'248d6a61d206');
});

test('checkUrl: a local miss never reaches the network; a prefix hit sends only the prefix, never the URL',async t=>{
 const h=harness();t.after(h.cleanup);
 const url='http://phish.example.com/login?next=/home',bad='phish.example.com/';
 await primed(h,[prefix(bad)]);
 assert.deepEqual(await h.sb.checkUrl('http://good.example.org/page?x=1'),{safe:true,checked:true});
 assert.equal(h.calls('find').length,0);
 h.net.find=()=>({matches:[match(bad)],negativeCacheDuration:'3600s'});
 assert.deepEqual(await h.sb.checkUrl(url),{safe:false,threat:'SOCIAL_ENGINEERING',checked:true});
 const [call,...rest]=h.calls('find');assert.equal(rest.length,0);
 assert.ok(call.url.startsWith(API+'fullHashes:find?key='));
 assert.deepEqual(call.body.threatInfo.threatEntries,[{hash:b64(prefix(bad))}],'exactly the one prefix that hit locally');
 assert.deepEqual(call.body.threatInfo.platformTypes,['WINDOWS','ANY_PLATFORM']);assert.deepEqual(call.body.threatInfo.threatEntryTypes,['URL']);
 assert.deepEqual(call.body.threatInfo.threatTypes,['MALWARE','SOCIAL_ENGINEERING','UNWANTED_SOFTWARE']);
 assert.equal(call.body.clientStates.length,6);assert.ok(call.body.clientStates.includes('m1'));
 for(const secret of ['phish','example','login','next=','home','http',b64(hashExpression(bad)),hashExpression(bad).toString('hex')])assert.equal(call.raw.includes(secret),false,'request leaks '+secret);
});

test('full-hash cache: positive entries expire with cacheDuration, negative entries cover the prefix',async t=>{
 const h=harness();t.after(h.cleanup);
 const bad='phish.example.com/';await primed(h,[prefix(bad)]);
 h.net.find=(_,n)=>n===1?{matches:[match(bad,'MALWARE','300s')],negativeCacheDuration:'3600s'}:{negativeCacheDuration:'3600s'};
 assert.equal((await h.sb.checkUrl('http://phish.example.com/a')).safe,false);
 assert.equal((await h.sb.checkUrl('http://phish.example.com/b')).threat,'MALWARE','another page on the same host reuses the cached verdict');
 assert.equal(h.calls('find').length,1);
 h.clock.t+=299_000;assert.equal((await h.sb.checkUrl('http://phish.example.com/')).safe,false);assert.equal(h.calls('find').length,1);
 h.clock.t+=2_000;assert.deepEqual(await h.sb.checkUrl('http://phish.example.com/'),{safe:true,checked:true},'expired positive entry is re-verified and the server no longer lists it');
 assert.equal(h.calls('find').length,2);
 assert.deepEqual(await h.sb.checkUrl('http://phish.example.com/again'),{safe:true,checked:true});assert.equal(h.calls('find').length,2,'now the negative cache answers');
});

test('negative cache: a safe URL that collides with a listed prefix is looked up once per negativeCacheDuration',async t=>{
 const h=harness();t.after(h.cleanup);
 await primed(h,[prefix('collide.example.net/')]);
 h.net.find=()=>({negativeCacheDuration:'600s'});
 for(let i=0;i<3;i++)assert.deepEqual(await h.sb.checkUrl('http://collide.example.net/p'+i),{safe:true,checked:true});
 assert.equal(h.calls('find').length,1);
 h.clock.t+=601_000;assert.deepEqual(await h.sb.checkUrl('http://collide.example.net/'),{safe:true,checked:true});assert.equal(h.calls('find').length,2);
});

test('a verdict never outlives 30 minutes even if the server offers a longer cacheDuration',async t=>{
 const h=harness();t.after(h.cleanup);
 const bad='old.example.com/';await primed(h,[prefix(bad)]);
 h.net.find=()=>({matches:[match(bad,'UNWANTED_SOFTWARE','86400s')]});
 assert.equal((await h.sb.checkUrl('http://old.example.com/')).threat,'UNWANTED_SOFTWARE');
 h.clock.t+=29*60_000;await h.sb.checkUrl('http://old.example.com/');assert.equal(h.calls('find').length,1);
 h.clock.t+=2*60_000;await h.sb.checkUrl('http://old.example.com/');assert.equal(h.calls('find').length,2);
});

test('concurrent checks of the same site share one lookup',async t=>{
 const h=harness();t.after(h.cleanup);
 const bad='twice.example.com/';await primed(h,[prefix(bad)]);
 h.net.find=async()=>{await tick();return {matches:[match(bad)],negativeCacheDuration:'60s'};};
 const results=await Promise.all([h.sb.checkUrl('http://twice.example.com/x'),h.sb.checkUrl('http://twice.example.com/y'),h.sb.checkUrl('http://twice.example.com/z')]);
 assert.deepEqual(results.map(r=>r.safe),[false,false,false]);assert.equal(h.calls('find').length,1);
});

test('network errors during a lookup fail open, back off, and never leak the key',async t=>{
 const h=harness();t.after(h.cleanup);
 const bad='flaky.example.com/';await primed(h,[prefix(bad)]);
 h.net.find=()=>{throw new Error('connect ECONNRESET '+API+'fullHashes:find?key='+KEY);};
 const url='http://flaky.example.com/';
 const first=await h.sb.checkUrl(url);assert.equal(first.safe,true);assert.equal(first.checked,false);assert.equal(typeof first.error,'string');
 assert.equal(JSON.stringify(first).includes(KEY),false);assert.equal(first.error.includes('key='+KEY),false);
 assert.equal(h.calls('find').length,1);
 const blocked=await h.sb.checkUrl(url);assert.equal(blocked.safe,true);assert.equal(blocked.checked,false);assert.equal(h.calls('find').length,1,'back-off: no request inside the wait');
 h.clock.t+=backoffMs(1,0.5)-1;await h.sb.checkUrl(url);assert.equal(h.calls('find').length,1);
 h.clock.t+=1;assert.equal((await h.sb.checkUrl(url)).checked,false);assert.equal(h.calls('find').length,2);
 h.clock.t+=backoffMs(1,0.5)+1;await h.sb.checkUrl(url);assert.equal(h.calls('find').length,2,'the second failure waits longer than the first');
 h.clock.t+=backoffMs(2,0.5);h.net.find=()=>({matches:[match(bad)]});
 assert.equal((await h.sb.checkUrl(url)).safe,false,'lookups recover once the wait is over');
});

test('a fullHashes minimumWaitDuration pauses lookups, failing open meanwhile',async t=>{
 const h=harness();t.after(h.cleanup);
 await primed(h,[prefix('one.example.com/'),prefix('two.example.com/')]);
 h.net.find=()=>({negativeCacheDuration:'60s',minimumWaitDuration:'600s'});
 assert.equal((await h.sb.checkUrl('http://one.example.com/')).checked,true);
 const paused=await h.sb.checkUrl('http://two.example.com/');assert.equal(paused.safe,true);assert.equal(paused.checked,false);assert.match(paused.error,/pause/);
 assert.equal(h.calls('find').length,1);
 h.clock.t+=600_000;assert.equal((await h.sb.checkUrl('http://two.example.com/')).checked,true);assert.equal(h.calls('find').length,2);
});

test('only public http(s) sites are checked; local, private and non-web addresses are skipped',async t=>{
 const h=harness();t.after(h.cleanup);
 const hits=['localhost/','192.168.1.10/','10.0.0.5/','172.20.1.1/','printer.local/','nas.internal/','dev.localhost/','intranet/'];
 await primed(h,hits.map(e=>prefix(e)));
 h.net.find=()=>{throw new Error('must not be called');};
 for(const url of ['http://localhost/','http://192.168.1.10/','http://10.0.0.5/x','http://172.20.1.1/','https://printer.local/','http://nas.internal/','http://dev.localhost:3000/','http://intranet/','http://127.0.0.1:8080/','http://[2001:db8::1]/','ftp://phish.example.com/','file:///C:/x','chrome://settings/','about:blank','',null,undefined,42])
  assert.deepEqual(await h.sb.checkUrl(url),{safe:true,checked:false},String(url));
 assert.equal(h.calls('find').length,0);
 assert.deepEqual(await h.sb.checkUrl('http://195.127.0.11/x'),{safe:true,checked:true},'public IP literals are checked');
});

test('while the first download is pending nothing can be checked and nothing is sent',async t=>{
 const h=harness();t.after(h.cleanup);
 assert.equal(h.sb.status().state,'initializing');
 assert.deepEqual(await h.sb.checkUrl('http://phish.example.com/'),{safe:true,checked:false});assert.equal(h.net.calls.length,0);
});

test('lists survive a restart; corrupt, tampered or oversized files start that list empty',async t=>{
 const h=harness();t.after(h.cleanup);
 const malware=[bytes(0,0,0,1),bytes(0,0,0,2)],social=[bytes(0,0,0,3)];
 h.net.update=req=>updateReply(req,{'MALWARE/WINDOWS':{all:malware,state:'m1'},'SOCIAL_ENGINEERING/WINDOWS':{all:social,state:'s1'}},'60s');
 await h.sb.updateNow();
 assert.deepEqual(createSafeBrowsing({...h.config}).status().lists.map(l=>l.prefixes),[2,1,0]);
 const dir=path.join(h.directory,'safe-browsing');
 fs.writeFileSync(path.join(dir,'MALWARE_WINDOWS.json'),'{ this is not json');
 const tampered=JSON.parse(fs.readFileSync(path.join(dir,'SOCIAL_ENGINEERING_WINDOWS.json'),'utf8'));tampered.prefixes['4']=b64(bytes(9,9,9,9));fs.writeFileSync(path.join(dir,'SOCIAL_ENGINEERING_WINDOWS.json'),JSON.stringify(tampered));
 fs.writeFileSync(path.join(dir,'meta.json'),'garbage');fs.writeFileSync(path.join(h.directory,'safe-browsing.json'),'not json either');
 const reborn=createSafeBrowsing({...h.config});
 assert.deepEqual(reborn.status().lists.map(l=>l.prefixes),[0,0,0]);assert.equal(reborn.status().state,'initializing');assert.equal(reborn.status().lastError,null);
 h.net.update=req=>updateReply(req,{'MALWARE/WINDOWS':{all:malware,state:'m9'}});
 assert.equal((await reborn.updateNow()).updated,true);
 const requests=h.calls('update').at(-1).body.listUpdateRequests;
 for(const id of ['MALWARE/WINDOWS','SOCIAL_ENGINEERING/WINDOWS'])assert.equal('state' in requests.find(r=>r.threatType+'/'+r.platformType===id),false,id+' asks for a full update');
 assert.equal(requests.find(r=>r.threatType==='MALWARE'&&r.platformType==='ANY_PLATFORM').state,'state-MALWARE-ANY_PLATFORM','intact lists keep their state');
 const limited=createSafeBrowsing({...h.config,maxBytes:100});assert.deepEqual(limited.status().lists.map(l=>l.prefixes),[0,0,0],'files above the size cap are ignored');
});

test('the total size cap rejects an oversized list and keeps the previous one',async t=>{
 const h=harness({maxBytes:3000});t.after(h.cleanup);
 await primed(h,[bytes(0,0,0,1),bytes(0,0,0,2)]);
 h.clock.t+=1_900_000;
 const big=Array.from({length:600},(_,i)=>bytes(0,0,i>>8,i&255));
 h.net.update=req=>updateReply(req,{'MALWARE/WINDOWS':{all:big,state:'big'}});
 const result=await h.sb.updateNow();assert.match(result.error,/size limit/);
 assert.equal(h.sb.status().lists[0].prefixes,2);
 h.clock.t+=1_900_000;h.net.update=req=>updateReply(req,{'MALWARE/WINDOWS':{all:[bytes(0,0,0,1),bytes(0,0,0,2)],state:'m1'}});
 await h.sb.updateNow();assert.equal(h.calls('update').at(-1).body.listUpdateRequests.find(r=>r.threatType==='MALWARE'&&r.platformType==='WINDOWS').state,'m1','the rejected state token was never adopted');
});

test('status is plain data and never contains the key, even after errors that echo it',async t=>{
 const h=harness();t.after(h.cleanup);
 h.net.update=()=>new Response(JSON.stringify({error:{message:'API key '+KEY+' not valid. See '+API+'x?key='+KEY}}),{status:400});
 const result=await h.sb.updateNow();
 assert.equal(result.reason,'error');assert.equal(JSON.stringify(result).includes(KEY),false);
 h.sb.start();
 const status=h.sb.status(),text=JSON.stringify(status);
 assert.deepEqual(Object.keys(status).sort(),['hasKey','lastError','lastUpdate','lists','nextUpdate','state']);
 assert.equal(text.includes(KEY),false);assert.equal(text.includes('AIzaSy'),false);assert.match(status.lastError,/HTTP 400/);assert.deepEqual(JSON.parse(text),status);
 assert.deepEqual(Object.keys(status.lists[0]).sort(),['prefixes','type','updatedAt']);
 h.net.update=()=>{throw new Error('socket hang up '+API+'threatListUpdates:fetch?key='+KEY);};
 h.clock.t+=24*3_600_000;await h.sb.updateNow();assert.equal(JSON.stringify(h.sb.status()).includes(KEY),false);assert.match(h.sb.status().lastError,/\[key\]/);
 assert.throws(()=>h.sb.setKey(KEY+'!'),err=>!String(err.message).includes(KEY));
});
