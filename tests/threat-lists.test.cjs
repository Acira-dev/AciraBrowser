'use strict';
// Phishing and malware lists: parsing, matching, the download/refresh state machine, the request gate, and a real Electron navigation to a listed local host.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {parseThreatList,listMatches,validate,createThreatLists,SOURCES}=require('../desktop/browser-services/threat-lists.cjs'),{createThreatGate}=require('../desktop/browser-services/threat-gate.cjs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const U=address=>new URL(address);
const makeList=(title,lines=[],count=600)=>`! Title: ${title}\n! Updated: 2026-10-24T12:00:00Z\n! Expires: 12 hours (update frequency)\n${Array.from({length:count},(_,i)=>`filler-${i}.example.test`).join('\n')}\n${lines.join('\n')}\n`;
const PHISH=SOURCES[0],MAL=SOURCES[1],DB=SOURCES[2];
const makeCompact=(extra=[],count=50100)=>Array.from({length:count},(_,i)=>`d${i}.example.test`).concat(extra).join('\n')+'\n';

test('parser reads host lines, URL lines and IP forms, and ignores everything else',()=>{
 const parsed=parseThreatList(['! comment','[Adblock Plus 2.0]','','Evil.Example.TOP','203.0.113.7','203.0.113.8:8080','[::ffff:b2a2:ecde]','||url.example.net/login^$all','||url.example.net^$all','||pathy.example.org/a/b?x=1&y=2^$all',
  '||third.example.org/x^$third-party','||wild*.example.org/x^$all','|http://old.example.org/x','   ','||sp ace.example.org/x^$all','#hash comment'].join('\n'));
 assert.deepEqual([...parsed.hosts].sort(),['203.0.113.7','203.0.113.8:8080','[::ffff:b2a2:ecde]','evil.example.top','url.example.net']);
 assert.deepEqual([...parsed.paths.entries()],[['url.example.net',['/login']],['pathy.example.org',['/a/b?x=1&y=2']]]);
 assert.equal(parsed.entries,7);
});
test('matching: exact host, parent domains, IPs without suffix walking, path prefixes with a boundary, ports',()=>{
 const list=parseThreatList(['evil.example.top','203.0.113.7','203.0.113.8:8080','||url.example.net/phish^$all','||q.example.net/a?id=7^$all','||dir.example.net/kit/^$all','[::ffff:b2a2:ecde]'].join('\n'));
 for(const hit of ['https://evil.example.top/','http://evil.example.top/any/path?x=1','https://a.b.evil.example.top/','http://203.0.113.7/x','http://203.0.113.8:8080/y','https://url.example.net/phish','https://url.example.net/phish/login','https://url.example.net/phish?x=1',
   'https://q.example.net/a?id=7','https://q.example.net/a?id=7&b=2','https://dir.example.net/kit/index.php','http://[::ffff:b2a2:ecde]/'])assert.equal(listMatches(list,U(hit)),true,hit);
 for(const miss of ['https://top/','https://example.top/','https://notevil.example.top/','http://203.0.113.70/x','http://203.0.113.8:9090/y','http://203.0.113.8/y','https://url.example.net/phishing','https://url.example.net/phish2','https://url.example.net/phish.html','https://url.example.net/','https://q.example.net/a?id=8','https://dir.example.net/kit','https://evil.example.top.example.com/'])assert.equal(listMatches(list,U(miss)),false,miss);
 assert.equal(listMatches(parseThreatList('3.3.3.3'),U('http://1.3.3.3/')),false,'IPs never match by suffix');
});
test('shared publishing hosts listed as whole hosts do not block their legitimate pages and images (Gravatar avatars, Google Sites)',async()=>{
 const {parseCompactDomains,packThreatListAsync}=require('../desktop/browser-services/threat-lists.cjs');
 const text=['gravatar.com','sites.google.com','pastebin.com','firebasestorage.googleapis.com','evil.example.top','||sites.google.com/view/phish^$all'].join('\n');
 const lists={set:parseThreatList(text),packed:await packThreatListAsync(text),compact:parseCompactDomains(makeCompact(['gravatar.com','sites.google.com','pastebin.com','firebasestorage.googleapis.com','evil.example.top']))};
 for(const [form,list] of Object.entries(lists)){
  for(const clean of ['https://www.gravatar.com/avatar/cc2372591e00f2ab504b59b4f7cbed43?s=64&d=identicon','https://gravatar.com/avatar/x','https://sites.google.com/new','https://sites.google.com/view/my-school-site','https://pastebin.com/raw/abc123','https://firebasestorage.googleapis.com/v0/b/app/o/pic.png?alt=media'])assert.equal(listMatches(list,U(clean)),false,form+' '+clean);
  assert.equal(listMatches(list,U('https://evil.example.top/')),true,form+' still blocks an ordinary listed host');assert.equal(listMatches(list,U('https://a.evil.example.top/x')),true,form+' and its subdomains');
 }
 for(const form of ['set','packed'])assert.equal(listMatches(lists[form],U('https://sites.google.com/view/phish')),true,form+' an entry that names a path on a shared host still matches');
});
test('the publishing services the websites hunt found listed as whole hosts (IPFS gateway, bio.link, Telegraph, paste.ee, Angelfire, Zoho Forms) block only their listed pages',async()=>{
 const {parseCompactDomains,packThreatListAsync}=require('../desktop/browser-services/threat-lists.cjs');
 const hosts=['cloudflare-ipfs.com','bio.link','telegra.ph','paste.ee','angelfire.com','forms.zohopublic.com'];
 const text=[...hosts,'evil.example.top','||telegra.ph/Bank-Login-11-02^$all','||forms.zohopublic.com/phisher/form/Verify^$all'].join('\n');
 const lists={set:parseThreatList(text),packed:await packThreatListAsync(text),compact:parseCompactDomains(makeCompact([...hosts,'evil.example.top']))};
 for(const [form,list] of Object.entries(lists)){
  for(const clean of ['https://cloudflare-ipfs.com/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi','https://bio.link/someartist','https://telegra.ph/My-Trip-Notes-10-30','https://paste.ee/p/AbC12','https://www.angelfire.com/band/fan/','https://forms.zohopublic.com/school/form/Signup/formperma/x'])assert.equal(listMatches(list,U(clean)),false,form+' '+clean);
  assert.equal(listMatches(list,U('https://evil.example.top/')),true,form+' still blocks an ordinary listed host');
 }
 for(const form of ['set','packed']){assert.equal(listMatches(lists[form],U('https://telegra.ph/Bank-Login-11-02')),true,form+' a listed page on Telegraph');assert.equal(listMatches(lists[form],U('https://forms.zohopublic.com/phisher/form/Verify')),true,form+' a listed Zoho form');}
});
test('the release check flags whole-host entries that are top sites, and services under a top site, but not users\' subdomains on hosting services',()=>{
 const {topSiteEntries,SHARED_HOSTS}=require('../desktop/browser-services/threat-lists.cjs');
 for(const host of ['gravatar.com','sites.google.com','pastebin.com','firebasestorage.googleapis.com','cloudflare-ipfs.com','bio.link','telegra.ph','paste.ee','angelfire.com','forms.zohopublic.com'])assert.ok(SHARED_HOSTS.has(host),host);
 const rank=new Map([['video.example',3],['shop.example',40],['portal.example',7],['hosting.example',12],['gravatar.com',167]]);
 const domainOf=host=>host.split('.').slice(-2).join('.');
 const compact=['video.example','evil.example.top','gravatar.com','app.portal.example',...Array.from({length:6},(_,i)=>`user${i}.hosting.example`),'203.0.113.7'].join('\n');
 const urls=makeList(PHISH.title,['||shop.example^$all','||shop.example/login^$all','||help.portal.example^$all','||user9.hosting.example^$all']);
 const found=topSiteEntries([{source:DB,text:compact},{source:PHISH,text:urls}],{rank,domainOf});
 assert.deepEqual(found.exact,[{host:'video.example',rank:3,lists:[DB.title]},{host:'shop.example',rank:40,lists:[PHISH.title]}],'a shared host (gravatar.com) is not flagged; a path entry is not a whole host');
 assert.deepEqual(found.services.map(item=>[item.host,item.domain,item.rank,item.lists]),[['app.portal.example','portal.example',7,[DB.title]],['help.portal.example','portal.example',7,[PHISH.title]]],'seven listed hosts under hosting.example are its users\' sites');
 assert.deepEqual(topSiteEntries([{source:DB,text:compact}],{rank,domainOf,servicesWithin:5}).services,[],'services only under the top N');
});
test('Phishing.Database never blocks a well-known site as a whole host (Netflix video, amazon.ie, a bank, AMP); typosquats, hosting users and the curated feeds still block',async()=>{
 const {parseCompactDomains,packThreatListAsync,knownSite,KNOWN_SITES,topSiteEntries}=require('../desktop/browser-services/threat-lists.cjs'),top=require('../desktop/browser-services/top-sites.cjs');
 assert.ok(top.entries>=9000&&top.top===10000&&/^[A-Z0-9]+$/.test(top.list),'the shipped top 10,000 (Tranco '+top.list+')');
 for(const host of ['google.com','nflxvideo.net','amazon.ie','mercadolibre.com.ar','yotpo.com','filesusr.com','banrisul.com.br','cdn.ampproject.org','app.primevideo.com'])assert.equal(knownSite(host),true,host);
 for(const host of ['googll.store','werefilledwit.org','evil.example.top','000000login.weebly.com'])assert.equal(knownSite(host),false,host+' (googll.store is a top-10,000 look-alike, left out)');
 const listed=['nflxvideo.net','amazon.ie','banrisul.com.br','cdn.ampproject.org','googll.store','werefilledwit.org','000000login.weebly.com','evil.example.top'];
 const compact=parseCompactDomains(makeCompact(listed));
 for(const clean of ['https://ipv4-c001-bey001-ix.1.oca.nflxvideo.net/range/0-1000?o=1','https://www.amazon.ie/','https://www.banrisul.com.br/','https://cdn.ampproject.org/v0.js'])assert.equal(listMatches(compact,U(clean)),false,clean);
 for(const listedHost of ['https://googll.store/','https://werefilledwit.org/','https://000000login.weebly.com/','https://a.evil.example.top/'])assert.equal(listMatches(compact,U(listedHost)),true,listedHost);
 const curated=[parseThreatList(listed.join('\n')),await packThreatListAsync(listed.join('\n'))];
 for(const list of curated)assert.equal(listMatches(list,U('https://www.amazon.ie/')),true,'the curated feeds are not changed');
 assert.ok(KNOWN_SITES.size<=80,'the hand-kept list stays small');
 const report=topSiteEntries([{source:DB,text:listed.join('\n')}],{rank:new Map([['amazon.ie',4837],['googll.store',3322]]),domainOf:host=>host.split('.').slice(-2).join('.')});
 assert.deepEqual(report.exact.map(item=>item.host),['googll.store'],'the release check lists what the app still blocks');assert.ok(report.allowed.some(item=>item.host==='amazon.ie'));
});
test('a whole-host entry that is a public suffix (a storage region, a platform) blocks nothing; matching never walks above an address\'s registrable domain',async()=>{
 const {parseCompactDomains,packThreatListAsync,isPublicSuffix,topSiteEntries}=require('../desktop/browser-services/threat-lists.cjs');
 const suffixes=['nyc3.digitaloceanspaces.com','s3.us-west-2.amazonaws.com','blob.core.windows.net','github.io','netlify.app','r2.dev','ec2-3-82-145-88.compute-1.amazonaws.com'];
 for(const name of suffixes)assert.equal(isPublicSuffix(name),true,name);for(const name of ['jw-assets.nyc3.digitaloceanspaces.com','evil.example.top','gravatar.com','203.0.113.7'])assert.equal(isPublicSuffix(name),false,name);
 const buckets=['at4etrg-aaa3-0or.nyc3.digitaloceanspaces.com','evilbucket.s3.us-west-2.amazonaws.com','phisher.github.io'];
 const text=[...suffixes,...buckets,'evil.example.top','||s3.us-west-2.amazonaws.com/evilbucket/^$all','||nyc3.digitaloceanspaces.com/scam/^$all'].join('\n');
 const lists={set:parseThreatList(text),packed:await packThreatListAsync(text),compact:parseCompactDomains(makeCompact([...suffixes,...buckets,'evil.example.top']))};
 for(const [form,list] of Object.entries(lists)){
  for(const clean of ['https://jw-assets.nyc3.digitaloceanspaces.com/dda/content/questions/XcB3HWATjAobqijam2OKPukJF4N5spMJnQzNj63K.jpg','https://nyc3.digitaloceanspaces.com/jw-assets/a.png','https://assets.s3.us-west-2.amazonaws.com/logo.png','https://s3.us-west-2.amazonaws.com/assets/logo.png','https://mystorage.blob.core.windows.net/c/x.png','https://someone.github.io/','https://docs.netlify.app/','https://pub-123.r2.dev/x.png'])assert.equal(listMatches(list,U(clean)),false,form+' '+clean);
  for(const listed of ['https://at4etrg-aaa3-0or.nyc3.digitaloceanspaces.com/index.html','https://evilbucket.s3.us-west-2.amazonaws.com/login.html','https://phisher.github.io/x','https://a.evil.example.top/'])assert.equal(listMatches(list,U(listed)),true,form+' '+listed);
 }
 for(const form of ['set','packed']){assert.equal(listMatches(lists[form],U('https://s3.us-west-2.amazonaws.com/evilbucket/login.html')),true,form+' a listed path on a storage endpoint still matches');assert.equal(listMatches(lists[form],U('https://nyc3.digitaloceanspaces.com/scam/x')),true);}
 const report=topSiteEntries([{source:DB,text:suffixes.join('\n')}],{rank:new Map(),domainOf:()=>null});assert.deepEqual(report.suffixes.map(item=>item.host),[...suffixes].sort(),'the release check lists them apart: they never block');
});
test('validation rejects a wrong header, HTML, control bytes and a list that is too short',()=>{
 assert.doesNotThrow(()=>validate(makeList(PHISH.title),PHISH));
 assert.throws(()=>validate(makeList(MAL.title),PHISH),/Unexpected/);assert.throws(()=>validate('<html>'+makeList(PHISH.title),PHISH),/Invalid/);assert.throws(()=>validate(makeList(PHISH.title)+'\u0001',PHISH),/Invalid/);
 assert.throws(()=>validate(makeList(PHISH.title,[],10),PHISH),/too few/);assert.throws(()=>validate(undefined,PHISH),/Invalid/);
});

function memoryIo(){
 const files=new Map();return {files,readFileSync:p=>{if(!files.has(p))throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});return files.get(p);},writeFileSync:(p,d)=>files.set(p,String(d)),renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);},mkdirSync(){}};
}
const delay=()=>new Promise(resolve=>setImmediate(resolve));
test('lists: nothing blocks before the first download, the first refresh activates both, a disabled switch blocks nothing',async()=>{
 const io=memoryIo();let time=1000;const calls=[],lists=createThreatLists({cachePath:'/c',io,now:()=>time,download:async url=>{calls.push(url);return url.includes('Phishing.Database')?makeCompact(['phishdb.example.top']):url.includes('phishing')?makeList(PHISH.title,['||bad.example.org/login^$all','phish.example.top']):makeList(MAL.title,['203.0.113.9','||drop.example.org/a.exe^$all']);}});
 assert.equal(lists.status().state,'loading');await lists.load();assert.equal(lists.status().state,'downloading');assert.equal(lists.lookup('https://phish.example.top/'),null);
 const status=await lists.refresh({});assert.equal(status.state,'active');assert.deepEqual(status.lists.map(item=>item.entries>600),[true,true,true]);assert.equal(calls.length,3,'one request per list');
 assert.deepEqual(lists.lookup('https://phish.example.top/x'),{kind:'phishing',list:PHISH.title,host:'phish.example.top',key:'phish.example.top'});assert.deepEqual(lists.lookup('https://a.phish.example.top/x'),{kind:'phishing',list:PHISH.title,host:'a.phish.example.top',key:'phish.example.top'},'a subdomain is judged by the listed parent');assert.deepEqual(lists.lookup('https://bad.example.org/login?x'),{kind:'phishing',list:PHISH.title,host:'bad.example.org',key:'bad.example.org/login'});
 assert.deepEqual(lists.lookup('http://203.0.113.9/anything'),{kind:'malware',list:MAL.title,host:'203.0.113.9',key:'203.0.113.9'});assert.equal(lists.lookup('https://drop.example.org/a.exe').kind,'malware');
 assert.deepEqual(lists.lookup('https://login.phishdb.example.top/x'),{kind:'phishing',list:DB.title,host:'login.phishdb.example.top',key:'phishdb.example.top'},'the compact feed matches the domain and its subdomains');assert.equal(lists.lookup('https://notphishdb.example.top/'),null);assert.equal(lists.lookup('https://example.com/'),null);assert.equal(lists.lookup('ftp://phish.example.top/'),null);assert.equal(lists.lookup('not a url'),null);assert.equal(lists.lookup('chrome://settings'),null);
 lists.setEnabled(false);assert.equal(lists.lookup('https://phish.example.top/'),null);assert.equal(lists.status().state,'off');lists.setEnabled(true);assert.ok(lists.lookup('https://phish.example.top/'));
});
test('lists: cached copies load without a network, refresh waits a day, a failed list keeps the old one, the mirror is tried, old lists are called stale',async()=>{
 const io=memoryIo();let time=Date.UTC(2026,9,24);let fail=false,primaryDown=false;const calls=[];
 const make=()=>createThreatLists({cachePath:'/c',io,now:()=>time,download:async url=>{calls.push(url);if(fail)throw new Error('offline');if(primaryDown&&url.includes('gitlab.io'))throw new Error('HTTP 503');return url.includes('Phishing.Database')?makeCompact(['phishdb.example.top']):url.includes('phishing')?makeList(PHISH.title,['phish.example.top']):makeList(MAL.title,['203.0.113.9']);}});
 const first=make();await first.refresh({});calls.length=0;
 const second=make();await second.load();assert.equal(second.status().state,'active');assert.ok(second.lookup('https://phish.example.top/'),'works from the cache before any download');
 await second.maybeRefresh({});assert.equal(calls.length,0,'fresh enough: no request');
 time+=25*3600*1000;fail=true;const failed=await second.maybeRefresh({});assert.equal(calls.length,5,'the two malware-filter lists on both mirrors, and the one-source feed');assert.ok(failed.lastError);assert.ok(second.lookup('https://phish.example.top/'),'the old list keeps protecting');assert.equal(failed.state,'active');
 fail=false;primaryDown=true;calls.length=0;await second.refresh({});assert.ok(calls.some(url=>url.includes('curbengh.github.io')),'mirror used');assert.equal(second.status().lastError,null);
 time+=9*24*3600*1000;fail=true;await second.refresh({}).catch(()=>{});assert.equal(second.status().state,'stale');
});
test('compact feed: hashed domains, subdomain walk, IPs never match, a short or wrong file is refused',()=>{
 const {parseCompactDomains,validate}=require('../desktop/browser-services/threat-lists.cjs');
 const parsed=parseCompactDomains('# c\nbad.example.top\nBAD2.example.top\n1.2.3.4\nnot a domain\nlocalhost\n');assert.equal(parsed.entries,3,'domains with a dot, lower-cased; IPs are dropped by lookup, not here');
 assert.doesNotThrow(()=>validate(makeCompact(),DB));assert.throws(()=>validate(makeCompact([],100),DB),/too few/);assert.throws(()=>validate('<html>'+makeCompact(),DB),/Invalid/);
});
test('lists: a damaged or wrong cached file is ignored, not trusted',async()=>{
 const io=memoryIo();io.files.set(path.join('/c','phishing.txt'),'<html>captive portal</html>');io.files.set(path.join('/c','malware.txt'),makeList(MAL.title,['203.0.113.9']));
 const lists=createThreatLists({cachePath:'/c',io,download:async()=>{throw new Error('offline');}});await lists.load();
 assert.equal(lists.lookup('http://203.0.113.9/').kind,'malware','the good cached list loads');assert.equal(lists.status().lists[0].entries,0,'the damaged one is dropped');
});
test('lists: concurrent refreshes share one run',async()=>{
 const io=memoryIo();let calls=0;const lists=createThreatLists({cachePath:'/c',io,download:async url=>{calls++;await delay();return url.includes('Phishing.Database')?makeCompact(['phishdb.example.top']):url.includes('phishing')?makeList(PHISH.title):makeList(MAL.title);}});
 await Promise.all([lists.refresh({}),lists.refresh({}),lists.maybeRefresh({})]);assert.equal(calls,3);
});

const fakeLists=map=>({lookup:address=>{for(const [prefix,hit] of Object.entries(map))if(address.startsWith(prefix)){const host=new URL(address).hostname;return {...hit,host,key:hit.key||host};}return null;}});
test('gate: a listed top-level navigation is cancelled and explained; resources are cancelled quietly; continue is per site, per profile, bound to the blocked address',()=>{
 let clock=1000;const gate=createThreatGate({now:()=>clock,lists:fakeLists({'https://phish.example.top/':{kind:'phishing',list:'Phishing URL Blocklist'},'https://drop.example.org/':{kind:'malware',list:'Online Malicious URL Blocklist'}})}),wc={id:7};
 assert.deepEqual(gate.check({url:'https://example.com/',resourceType:'mainFrame'},wc,'p1'),{});assert.deepEqual(gate.check({url:'ftp://phish.example.top/',resourceType:'mainFrame'},wc,'p1'),{});
 assert.deepEqual(gate.check({url:'https://phish.example.top/login',resourceType:'mainFrame',method:'GET'},wc,'p1'),{cancel:true});
 const status=gate.status(7,'https://phish.example.top/login');assert.equal(status.kind,'phishing');assert.equal(status.host,'phish.example.top');assert.match(status.title,/Acira blocked a dangerous page/);assert.match(status.cause,/phishing/);
 assert.equal(gate.status(7,'https://short.example/redirect').host,'phish.example.top','a redirect that led to the block is still explained, shortly after');
 clock+=3*60*1000;assert.equal(gate.status(7,'https://short.example/redirect'),null,'but not once the block is old');assert.equal(gate.status(7,'https://phish.example.top/login').kind,'phishing','the same address always is');assert.equal(gate.status(8,'https://phish.example.top/login'),null,'and another tab never is');
 assert.equal(gate.allow(8,'https://phish.example.top/login','p1'),false);assert.equal(gate.allow(7,'https://elsewhere.example/','p1'),false,'an old block cannot clear a different address');assert.equal(gate.isAllowed('p1','phish.example.top'),false);
 assert.deepEqual(gate.check({url:'https://phish.example.top/login',resourceType:'image'},wc,'p1'),{cancel:true},'resources are blocked regardless');
 assert.equal(gate.allow(7,'https://phish.example.top/login','p1'),true);
 assert.deepEqual(gate.check({url:'https://phish.example.top/anything',resourceType:'mainFrame'},wc,'p1'),{},'the site now passes for this profile');
 assert.deepEqual(gate.check({url:'https://phish.example.top/anything',resourceType:'mainFrame'},{id:9},'p2'),{cancel:true},'but not in another profile');
 assert.deepEqual(gate.check({url:'https://drop.example.org/a.exe',resourceType:'mainFrame'},wc,'p1'),{cancel:true},'nor another listed site');
 assert.equal(gate.isAllowed('p1','phish.example.top'),true);assert.equal(gate.isAllowed('p1','drop.example.org'),false);
 assert.deepEqual(gate.check({url:'https://drop.example.org/a.js',resourceType:'script'},wc,'p1'),{cancel:true});assert.deepEqual(gate.stats(),{warned:3,blocked:2});
});

test('gate: a page resource blocked by a list is never silent: the first block of each host goes to the local log with the list, never for a private window',()=>{
 const lines=[],lists={lookup:address=>{const host=new URL(address).hostname;return host.endsWith('nflxvideo.example')?{kind:'phishing',list:'Phishing.Database active domains',host,key:'nflxvideo.example'}:null;}};
 const gate=createThreatGate({lists,log:line=>lines.push(line)});
 const request=(url,type='media')=>gate.check({url,resourceType:type},null,'p1');
 for(let i=0;i<5;i++)assert.deepEqual(request('https://a.nflxvideo.example/range/'+i),{cancel:true});
 request('https://b.nflxvideo.example/x','xhr');request('https://clean.example/x');
 assert.equal(lines.length,2,'once per host');assert.match(lines[0],/a\.nflxvideo\.example \(media\): listed in Phishing\.Database active domains as nflxvideo\.example/);assert.doesNotMatch(lines.join(''),/range\//,'no address path');
 gate.check({url:'https://c.nflxvideo.example/',resourceType:'image'},null,'private-1',{quiet:true});assert.equal(lines.length,2,'never for a private window');
 gate.check({url:'https://d.nflxvideo.example/',resourceType:'mainFrame'},null,'p1');assert.equal(lines.length,2,'a page gets the warning page, not a log line');
 const {createMainLog}=require('../desktop/browser-services/main-log.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-main-log-'));
 try{const log=createMainLog({directory:path.join(dir,'logs'),maxBytes:400,echo(){},now:()=>new Date('2026-11-02T12:00:00Z')});for(let i=0;i<20;i++)log('line '+i+' x\ny');
  const text=fs.readFileSync(path.join(dir,'logs','main.log'),'utf8');assert.ok(text.length<=400,'bounded');assert.match(text,/2026-11-02T12:00:00\.000Z line 19 x y\n$/);assert.doesNotMatch(text,/^line 0 /m);
  assert.doesNotThrow(()=>createMainLog({directory:'/nonexistent/forbidden',io:{mkdirSync(){throw new Error('read-only');}},echo(){}})('x'));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('gate: ending a private profile forgets its warnings and exceptions while another profile keeps its choices',()=>{
 const url='https://owned.example.test/login',key='owned.example.test';
 const gate=createThreatGate({lists:fakeLists({'https://owned.example.test/':{kind:'phishing',list:'Owned fixture'}})});
 gate.check({url,resourceType:'mainFrame'},{id:10},'private-owned');
 assert.equal(gate.allow(10,url,'private-owned'),true);
 gate.check({url,resourceType:'mainFrame'},{id:11},'private-owned');
 gate.check({url,resourceType:'mainFrame'},{id:12},'ordinary-owned');
 assert.equal(gate.allow(12,url,'ordinary-owned'),true);
 // Another private profile keeps its own outstanding warning.
 gate.check({url,resourceType:'mainFrame'},{id:13},'private-other');
 assert.ok(gate.status(13,url));
 gate.forgetProfile('private-owned');
 assert.equal(gate.isAllowed('private-owned',key),false);
 assert.equal(gate.isAllowed('ordinary-owned',key),true);
 assert.ok(gate.status(13,url));
 gate.forgetProfile('private-other');
 assert.equal(gate.status(13,url),null);
});

let result=null,problem=null;
if(electron){
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','threat-gate','run.cjs')],{encoding:'utf8',timeout:120000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line)result=JSON.parse(line.slice(7));else problem=((run.stdout||'')+(run.stderr||'')).split(/\r?\n/).filter(text=>!/^\[\d+:/.test(text)).join('\n').slice(0,600)||'electron produced no result';
}
const skip=!electron?'electron binary not available':false;
test('electron: a listed local host fails the navigation with ERR_BLOCKED_BY_CLIENT and an explanation, the rest of the site loads, continue lets it through',{skip},()=>{
 assert.ok(result,problem);
 assert.equal(result.phishNavigation.errorCode,-20,'cancelled by the client');assert.equal(result.phishNavigation.status.kind,'phishing');assert.equal(result.phishNavigation.status.host,'127.0.0.1');
 assert.equal(result.okPage.title,'ok page');assert.equal(result.okPage.payloadRan,false,'the listed script was blocked quietly');assert.equal(result.okPage.cleanScriptRan,true,'an unlisted script still ran');
 assert.equal(result.boundary.title,'phishing2 page','/phishing2 is not under /phish');
 assert.equal(result.afterContinue.title,'phish page','after continue the site loads');
 assert.equal(result.malware.errorCode,-20);assert.equal(result.malware.status.kind,'malware');
 assert.ok(result.stats.warned>=2&&result.stats.blocked>=1);
});
