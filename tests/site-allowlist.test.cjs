'use strict';
// Acira's reviewed allow-list (desktop/browser-services/site-allowlist.cjs): a host on it is never blocked as a whole host by the threat feeds (all three
// list forms) nor by the look-alike check; listed paths still block; a failed or odd fetch changes nothing; once a day; no identifier in the fetch.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createSiteAllowlist,parseAllowlist,between,MAX_HOSTS}=require('../desktop/browser-services/site-allowlist.cjs');
const {parseThreatList,packThreatListAsync,parseCompactDomains,matchEntry,createThreatLists,SOURCES}=require('../desktop/browser-services/threat-lists.cjs');
const U=address=>new URL(address),DAY=24*60*60*1000;
const answer=hosts=>JSON.stringify({schema:1,hosts});
function memoryIo(){const files=new Map();return {files,readFileSync:p=>{if(!files.has(p))throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});return files.get(p);},writeFileSync:(p,d)=>files.set(p,String(d)),renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);},mkdirSync(){}};}
const makeCompact=(extra=[],count=50100)=>Array.from({length:count},(_,i)=>`d${i}.example.test`).concat(extra).join('\n')+'\n';
const makeList=(title,lines=[],count=600)=>`! Title: ${title}\n! Updated: 2026-11-02T12:00:00Z\n${Array.from({length:count},(_,i)=>`filler-${i}.example.test`).join('\n')}\n${lines.join('\n')}\n`;
const allowlistWith=async hosts=>{const list=createSiteAllowlist({cachePath:'/a',endpoint:'https://x.supabase.co/functions/v1/allowlist',io:memoryIo(),fetchText:async()=>answer(hosts)});await list.refresh({});return list;};

test('the endpoint answer: schema 1, hosts a report could name, nothing else',()=>{
 assert.deepEqual([...parseAllowlist(answer(['nflxvideo.net','amazon.ie','nflxvideo.net']))].sort(),['amazon.ie','nflxvideo.net']);
 for(const bad of ['<html>','{}','[]',JSON.stringify({schema:2,hosts:[]}),answer(['https://amazon.ie/']),answer(['Amazon.ie']),answer(['192.168.1.1']),answer(['localhost']),answer(['abc.onion']),answer([42]),JSON.stringify({schema:1,hosts:Array(MAX_HOSTS+1).fill('a.example.org')}),'x'.repeat(600*1024)])
  assert.throws(()=>parseAllowlist(bad),bad.slice(0,40));
});

test('which hosts an allow-listed name clears: the listed entry, or the visited host and its parents up to the entry, never a listed subdomain below it',()=>{
 assert.deepEqual(between('a.b.nflxvideo.net','nflxvideo.net'),['a.b.nflxvideo.net','b.nflxvideo.net','nflxvideo.net']);
 assert.deepEqual(between('nflxvideo.net','nflxvideo.net:443'),['nflxvideo.net']);
 assert.deepEqual(between('other.org','nflxvideo.net'),[]);
});

test('an allow-listed host is not blocked as a whole host by any of the three list forms, its subdomains neither; listed paths and other hosts still block',async()=>{
 const text=['acira-video.top','acira-shop.top','evil.example.top','||acira-shop.top/fake-login^$all','acira-host.top','evil.acira-host.top'].join('\n');
 const lists={set:parseThreatList(text),packed:await packThreatListAsync(text),compact:parseCompactDomains(makeCompact(['acira-video.top','acira-shop.top','evil.example.top','acira-host.top','evil.acira-host.top']))};
 const allowlist=await allowlistWith(['acira-video.top','acira-shop.top','acira-host.top']);
 for(const [form,list] of Object.entries(lists)){
  const match=address=>{const url=U(address);return matchEntry(list,url,entry=>allowlist.covers(url.hostname,entry));};
  assert.equal(matchEntry(list,U('https://ipv4-c001.oca.acira-video.top/range/0-1')),'acira-video.top',form+': control, the feed blocks a small video host');
  for(const clean of ['https://ipv4-c001.oca.acira-video.top/range/0-1','https://acira-video.top/','https://www.acira-shop.top/','https://acira-shop.top/gp/cart'])assert.equal(match(clean),null,form+' '+clean);
  assert.equal(match('https://evil.example.top/'),'evil.example.top',form+': a host not on the allow-list still blocks');
  assert.equal(match('https://evil.acira-host.top/x'),'evil.acira-host.top',form+': allow-listing a parent never clears a listed subdomain entry');
  if(form!=='compact')assert.equal(match('https://acira-shop.top/fake-login'),'acira-shop.top/fake-login',form+': a listed path on an allow-listed host still blocks');
 }
});

test('a listed subdomain can be cleared on its own without clearing the hosting service',async()=>{
 const list=parseThreatList(['acira-host.top','evil.acira-host.top'].join('\n')),allowlist=await allowlistWith(['school.acira-host.top']);
 const match=address=>{const url=U(address);return matchEntry(list,url,entry=>allowlist.covers(url.hostname,entry));};
 assert.equal(match('https://school.acira-host.top/'),null);assert.equal(match('https://other.acira-host.top/'),'acira-host.top');assert.equal(match('https://evil.acira-host.top/'),'evil.acira-host.top');
});

test('the threat lists consult, load and refresh the allow-list: the feed entry is overridden end to end',async()=>{
 const io=memoryIo(),fetches=[];let time=5*DAY,fail=false;
 const allowlist=createSiteAllowlist({cachePath:'/c',endpoint:'https://x.supabase.co/functions/v1/allowlist',io,now:()=>time,fetchText:async(url,session)=>{fetches.push({url,session});if(fail)throw new Error('offline');return answer(['acira-video.top']);}});
 const lists=createThreatLists({cachePath:'/c',io,now:()=>time,allowlist,download:async url=>url.includes('Phishing.Database')?makeCompact(['acira-video.top','phishdb.example.top']):url.includes('phishing')?makeList(SOURCES[0].title,['phish.example.top']):makeList(SOURCES[1].title,['203.0.113.9'])});
 await lists.load();await lists.refresh({});
 assert.equal(lists.lookup('https://ipv4-c001.oca.acira-video.top/range')?.list,SOURCES[2].title,'before the first allow-list fetch the feed blocks');
 const session={id:'ordinary'};await lists.maybeRefresh(session);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(fetches,[{url:'https://x.supabase.co/functions/v1/allowlist',session}],'one plain fetch of the endpoint on the lists\' schedule');
 assert.equal(lists.lookup('https://ipv4-c001.oca.acira-video.top/range'),null,'the allow-list overrides the feed');
 assert.equal(lists.lookup('https://phishdb.example.top/')?.key,'phishdb.example.top','other entries still block');
 await lists.maybeRefresh(session);await new Promise(resolve=>setImmediate(resolve));assert.equal(fetches.length,1,'not again within a day');
 time+=DAY;fail=true;await lists.maybeRefresh(session);await new Promise(resolve=>setImmediate(resolve));assert.equal(fetches.length,2,'a day later it asks again');
 assert.equal(lists.lookup('https://ipv4-c001.oca.acira-video.top/range'),null,'a failed fetch keeps the last copy');
 const restarted=createSiteAllowlist({cachePath:'/c',endpoint:'https://x.supabase.co/functions/v1/allowlist',io,now:()=>time,fetchText:async()=>{throw new Error('offline');}});restarted.load();
 assert.equal(restarted.covers('a.acira-video.top','acira-video.top'),true,'the copy on disk is used after a restart, before any fetch');
});

test('a failed or odd fetch with no earlier copy changes nothing: blocking stays as it was',async()=>{
 for(const fetchText of [async()=>{throw new Error('HTTP 503');},async()=>'<html>maintenance</html>',async()=>answer(['https://evil/']),async()=>JSON.stringify({schema:2,hosts:['acira-shop.top']})]){
  const allowlist=createSiteAllowlist({cachePath:'/c',endpoint:'https://x.supabase.co/functions/v1/allowlist',io:memoryIo(),fetchText}),status=await allowlist.refresh({});
  assert.equal(status.entries,0);assert.ok(status.lastError);assert.equal(allowlist.covers('www.acira-shop.top','acira-shop.top'),false);assert.equal(allowlist.allows('acira-shop.top'),false);
 }
 const io=memoryIo(),good=createSiteAllowlist({cachePath:'/c',endpoint:'https://x.supabase.co/functions/v1/allowlist',io,fetchText:async()=>answer(['acira-shop.top'])});await good.refresh({});
 const broken=createSiteAllowlist({cachePath:'/c',endpoint:'https://x.supabase.co/functions/v1/allowlist',io,fetchText:async()=>'{"schema":1,"hosts":["Not a host!"]}'});broken.load();
 assert.equal((await broken.refresh({})).entries,1,'an odd answer keeps the previous copy');assert.equal(broken.covers('www.acira-shop.top','acira-shop.top'),true);
 const lists=createThreatLists({cachePath:'/d',io:memoryIo(),allowlist:createSiteAllowlist({cachePath:'/d',endpoint:'https://x.supabase.co/functions/v1/allowlist',io:memoryIo(),fetchText:async()=>{throw new Error('offline');}}),download:async url=>url.includes('Phishing.Database')?makeCompact(['acira-shop.top']):url.includes('phishing')?makeList(SOURCES[0].title):makeList(SOURCES[1].title)});
 await lists.load();await lists.refresh({});await lists.maybeRefresh({});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(lists.lookup('https://www.acira-shop.top/')?.key,'acira-shop.top','with no allow-list the feed blocks exactly as before');
 const off=createSiteAllowlist({cachePath:'/e',endpoint:'',io:memoryIo(),fetchText:async()=>{throw new Error('must not be called');}});assert.equal((await off.maybeRefresh({})).entries,0,'no endpoint: nothing fetched');
});

test('the look-alike check skips an allow-listed name and its subdomains (content-blocking.cjs)',async()=>{
 const allowlist=await allowlistWith(['telegraf.rs','wal-mart.com']);
 assert.equal(allowlist.allows('telegraf.rs'),true);assert.equal(allowlist.allows('www.wal-mart.com'),true);assert.equal(allowlist.allows('wal-mart.com.evil.top'),false);assert.equal(allowlist.allows('rs'),false);
 const source=fs.readFileSync(path.join(__dirname,'../desktop/content-blocking.cjs'),'utf8');
 assert.match(source,/createThreatLists\(\{[^}]*allowlist:siteAllowlist\}\)/,'the lists get the allow-list');
 assert.match(source,/lookalike:url=>\{if\(privacyPlus\.get\(\)\.pageWarnings===false\)return null;let host;try\{host=new URL\(url\)\.hostname;\}catch\{return null;\}if\(siteAllowlist\.allows\(host\)\)return null;/,'and the look-alike check');
});

test('the real fetch carries no identifier: GET, no cookies, no Referer, no cache, no redirects, size-capped',async()=>{
 const seen=[];const session={fetch:async(url,init)=>{seen.push({url,init});return {status:200,headers:new Headers({'content-length':'30'}),arrayBuffer:async()=>new TextEncoder().encode(answer(['amazon.ie'])).buffer};}};
 const list=createSiteAllowlist({cachePath:'/f',endpoint:'https://x.supabase.co/functions/v1/allowlist',io:memoryIo()});
 assert.equal((await list.refresh(session)).entries,1);
 assert.equal(seen[0].url,'https://x.supabase.co/functions/v1/allowlist');const {init}=seen[0];
 assert.deepEqual({method:init.method,credentials:init.credentials,cache:init.cache,redirect:init.redirect,referrerPolicy:init.referrerPolicy,headers:init.headers,body:init.body},{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:undefined,body:undefined});
 const big={fetch:async()=>({status:200,headers:new Headers({'content-length':String(10*1024*1024)}),arrayBuffer:async()=>new ArrayBuffer(0)})};
 assert.match((await createSiteAllowlist({cachePath:'/g',endpoint:'https://x.supabase.co/functions/v1/allowlist',io:memoryIo()}).refresh(big)).lastError,/too large/);
 const missing={fetch:async()=>({status:404,headers:new Headers(),arrayBuffer:async()=>new ArrayBuffer(0)})};
 assert.match((await createSiteAllowlist({cachePath:'/h',endpoint:'https://x.supabase.co/functions/v1/allowlist',io:memoryIo()}).refresh(missing)).lastError,/404/);
});
