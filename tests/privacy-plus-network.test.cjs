'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const filtersPath=path.join(__dirname,'..','resources','filters');
const {createDebouncer}=require('../desktop/browser-services/debounce.cjs');
const debouncer=createDebouncer({filePath:path.join(filtersPath,'debounce.json')});
test('debounce follows Brave rules to the real destination and keeps every failsafe',()=>{
 assert.ok(debouncer.rules>30,'bundled Brave rule set loads');
 assert.equal(debouncer.destination('https://go.skimresources.com/?url=https%3A%2F%2Fwww.example-shop.com%2Fitem%3Fid%3D5&xs=1'),'https://www.example-shop.com/item?id=5');
 assert.equal(debouncer.destination('https://y2u.be/dQw4w9WgXcQ'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ','regex-path-template');
 assert.equal(debouncer.destination('https://click.redditmail.com/CL0/https:%2F%2Fexample.org%2Fa/1/xyz'),'https://example.org/a','regex-path');
 assert.equal(debouncer.destination('https://example.com/?url=https://other.org/'),null,'unknown host is untouched');
 assert.equal(debouncer.destination('https://go.skimresources.com/?url=javascript:alert(1)'),null,'only http(s) destinations');
 assert.equal(debouncer.destination('https://go.skimresources.com/?url=https%3A%2F%2Fgo.skimresources.com%2Fx'),null,'never back to the same site');
 assert.equal(debouncer.destination('https://go.skimresources.com/?url=https%3A%2F%2Fgood.com%5C%40evil.com%2F'),null,'naive-host mismatch is refused');
 assert.equal(debouncer.destination('https://go.skimresources.com/?other=1'),null,'missing parameter');
 const small=createDebouncer({text:JSON.stringify([{include:['*://r.example.net/*'],exclude:['*://r.example.net/keep*'],action:'base64,redirect',param:'u'},{include:['*://p.example.net/*'],action:'redirect',param:'u',prepend_scheme:'https'},{include:['*://a.example.net/*'],action:'redirect',param:'u',pref:'brave.de_amp.enabled'},{include:['*://o.example.net/*'],action:'redirect',param:'u',pref:'brave.other.enabled'}])});
 assert.equal(small.rules,3,'de-AMP rules are kept; other pref-gated rules are dropped');
 assert.equal(small.destination('https://a.example.net/?u=https%3A%2F%2Fdest.org%2Famp'),null,'de-AMP rules wait for the de-AMP switch');
 assert.equal(small.destination('https://a.example.net/?u=https%3A%2F%2Fdest.org%2Famp',{deAmp:true}),'https://dest.org/amp','de-AMP rule with the switch on');
 assert.equal(small.destination('https://o.example.net/?u=https%3A%2F%2Fdest.org%2F',{deAmp:true}),null,'other pref-gated rules never run');
 assert.equal(small.destination('https://r.example.net/go?u='+Buffer.from('https://dest.org/x').toString('base64url')),'https://dest.org/x','base64');
 assert.equal(small.destination('https://r.example.net/keep?u='+Buffer.from('https://dest.org/x').toString('base64url')),null,'exclude wins');
 assert.equal(small.destination('https://p.example.net/?u=dest.org/y'),'https://dest.org/y','prepend_scheme');
 assert.equal(small.destination('https://p.example.net/?u=https%3A%2F%2Fdest.org%2Fy'),null,'prepend_scheme with a full URL is an erroneous rule');
});

const {createCnameUncloaker,dnsQuery,parseAnswer,eligibleHost,dohResolver}=require('../desktop/browser-services/cname-uncloak.cjs');
function dnsResponse(name,chain,withA=true){ // minimal RFC 1035 response: question + CNAME chain (+ A)
 const enc=n=>Buffer.concat([...n.split('.').map(l=>Buffer.concat([Buffer.from([l.length]),Buffer.from(l)])),Buffer.from([0])]);
 const header=Buffer.alloc(12);header.writeUInt16BE(0x8180,2);header.writeUInt16BE(1,4);header.writeUInt16BE(chain.length+(withA?1:0),6);
 const parts=[header,enc(name),Buffer.from([0,1,0,1])];
 for(const target of chain){const rd=enc(target),rr=Buffer.alloc(10);rr.writeUInt16BE(5,0);rr.writeUInt16BE(1,2);rr.writeUInt32BE(300,4);rr.writeUInt16BE(rd.length,8);parts.push(Buffer.from([0xc0,0x0c]),rr,rd);}
 if(withA){const rr=Buffer.alloc(10);rr.writeUInt16BE(1,0);rr.writeUInt16BE(1,2);rr.writeUInt32BE(60,4);rr.writeUInt16BE(4,8);parts.push(Buffer.from([0xc0,0x0c]),rr,Buffer.from([1,2,3,4]));}
 return Buffer.concat(parts);
}
test('CNAME uncloaking: DNS wire format, DoH resolver, bounded cache, fail-open',async()=>{
 const query=dnsQuery('metrics.shop.org',1);assert.equal(query.readUInt16BE(4),1);assert.equal(query.subarray(-4).toString('hex'),'00010001');
 const parsed=parseAnswer(dnsResponse('metrics.shop.org',['shop.tracker-cdn.net','edge.tracker-cdn.net']));
 assert.equal(parsed.rcode,0);assert.equal(parsed.ttl,300);
 const calls=[];const fetch=async(url,init)=>{calls.push({url,init});return{ok:true,arrayBuffer:async()=>dnsResponse('metrics.shop.org',['shop.tracker-cdn.net'])};};
 const viaGet=await dohResolver({servers:['https://dns.example/dns-query{?dns}'],fetch})('metrics.shop.org');
 assert.deepEqual(viaGet,{cname:'shop.tracker-cdn.net',ttl:300});assert.match(calls[0].url,/^https:\/\/dns\.example\/dns-query\?dns=[A-Za-z0-9_-]+$/);
 await dohResolver({servers:['https://dns.example/dns-query'],fetch})('metrics.shop.org');assert.equal(calls[1].init.method,'POST');assert.equal(calls[1].init.headers['content-type'],'application/dns-message');
 let clock=0,resolves=0;const resolve=async host=>{resolves++;if(host==='slow.shop.org')await new Promise(r=>setTimeout(r,200));if(host==='bad.shop.org')throw new Error('SERVFAIL');return{cname:host==='metrics.shop.org'?'edge.tracker-cdn.net':null,ttl:null};};
 const u=createCnameUncloaker({resolve,now:()=>clock,timeoutMs:50,max:3});
 assert.equal(u.peek('metrics.shop.org'),undefined);
 const [a,b]=await Promise.all([u.lookup('metrics.shop.org'),u.lookup('metrics.shop.org')]);assert.equal(a,'edge.tracker-cdn.net');assert.equal(b,a);assert.equal(resolves,1,'in-flight lookups are shared');
 assert.equal(u.peek('metrics.shop.org'),'edge.tracker-cdn.net');assert.equal(await u.lookup('slow.shop.org'),null,'timeout fails open');assert.equal(await u.lookup('bad.shop.org'),null,'resolver error fails open');
 await u.lookup('x.shop.org');assert.equal(u.stats().cached,3,'cache is bounded');assert.equal(u.stats().cloaked,1);
 clock+=2*60*60*1000;assert.equal(u.peek('bad.shop.org'),undefined,'entries expire');
 for(const bad of ['localhost','10.0.0.1','intranet','printer.local','::1'])assert.equal(eligibleHost(bad),false,bad);
 assert.equal(eligibleHost('metrics.shop.org','shop.org'),true);assert.equal(eligibleHost('shop.org','shop.org'),false,'apex hosts cannot be CNAMEs');
});

const {RequestPipeline}=require('../desktop/request-pipeline.cjs');
test('request pipeline accepts asynchronous handlers and keeps order and cancellation',async()=>{
 const listeners={};const fake={webRequest:{onBeforeRequest:(f,cb)=>{listeners.before=cb;},onHeadersReceived:(f,cb)=>{listeners.headers=cb;},onBeforeSendHeaders:(f,cb)=>{listeners.send=cb;}}};
 const pipeline=new RequestPipeline(fake),order=[];
 pipeline.useBefore(()=>{order.push('sync');return{};});
 pipeline.useBefore(()=>new Promise(r=>setTimeout(()=>{order.push('async');r({});},10)));
 pipeline.useBefore(details=>{order.push('last');return details.url.includes('cancel')?{cancel:true}:{};});
 const run=url=>new Promise(resolve=>listeners.before({url,id:1},resolve));
 assert.deepEqual(await run('https://a.test/'),{});assert.deepEqual(order,['sync','async','last']);
 assert.deepEqual(await run('https://a.test/cancel'),{cancel:true});
 pipeline.useBefore(()=>Promise.reject(new Error('boom')));
 const quiet=console.error;console.error=()=>{};try{assert.deepEqual(await run('https://a.test/'),{cancel:true},'a rejected handler cancels, like a thrown one');}finally{console.error=quiet;}
});
