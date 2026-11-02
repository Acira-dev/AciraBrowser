'use strict';
// "Report a problem with this site" (desktop/browser-services/site-reports.cjs): exactly what is sent, host only, nothing from Tor, the endpoints a
// test profile may reach, and the wiring in main.cjs (Tor checked there too). The interface: tests/site-report-ui.test.cjs.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {reportHost,cleanNote,buildReport,endpoints,createSiteReports,electronSend,KINDS,LISTS,NOTE_MAX}=require('../desktop/browser-services/site-reports.cjs');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const ENDPOINT='https://reports.example.org/functions/v1/report';
const make=(options={})=>{const calls=[];const reports=createSiteReports({endpoint:ENDPOINT,appVersion:'0.1.0-beta.8',platform:'darwin',send:async(url,body,session)=>{calls.push({url,body,session});return options.status??204;},...options});return {reports,calls};};

test('the payload is exactly seven fields, and the site is its host only: never the path, query, fragment, port or sign-in name',()=>{
 const payload=buildReport({address:'https://user:secret@Shop.Example.COM.:8443/account/orders?id=42&email=a%40b.c#top',kind:'blocked',list:'phishing-db',note:'  Netflix video stops.\r\nSecond line  ',appVersion:'0.1.0-beta.8',platform:'darwin'});
 assert.deepEqual(payload,{schema:1,host:'shop.example.com',kind:'blocked',list:'phishing-db',appVersion:'0.1.0-beta.8',platform:'darwin',note:'Netflix video stops.\nSecond line'});
 assert.deepEqual(Object.keys(payload),['schema','host','kind','list','appVersion','platform','note']);
 const text=JSON.stringify(payload);for(const secret of ['user','secret','8443','account','orders','42','email','top"'])assert.ok(!text.includes(secret),secret);
 assert.equal(buildReport({address:'https://münchen.example.de/',kind:'other',appVersion:'1.0.0',platform:'win32'}).host,'xn--mnchen-3ya.example.de','an international name is sent in its ASCII form');
 assert.equal(buildReport({address:'https://a.example.org/',kind:'broken',list:'made-up',appVersion:'1.0.0',platform:'linux'}).list,null,'an unknown list is never sent');
 assert.equal(buildReport({address:'https://a.example.org/',kind:'broken',appVersion:'1.0.0',platform:'linux'}).note,'','no note is an empty string (stored as NULL)');
});

test('only public websites can be reported: no IP address, local name, .onion, file or Acira page',()=>{
 for(const address of ['http://192.168.1.1/','http://10.0.0.8:8080/x','http://[::1]/','http://localhost:3000/','http://router/','http://printer.local/','https://intranet.internal/','http://abc.onion/','https://shop.test/','https://a.example/','file:///Users/me/a.html','acira://settings','chrome://gpu','about:blank','not a url','https://x.y/'])
  assert.equal(reportHost(address),'',address);
 assert.throws(()=>buildReport({address:'http://192.168.1.1/',kind:'blocked',appVersion:'1.0.0',platform:'darwin'}));
 assert.throws(()=>buildReport({address:'https://a.example.org/',kind:'spam',appVersion:'1.0.0',platform:'darwin'}),/Choose/);
});

test('the note: trimmed, control characters dropped, 500 characters at most (counted as characters, emoji included)',()=>{
 assert.equal(cleanNote('a\u0000b\u0007c\u2028d\te'),'abc\nd\te');
 assert.equal(cleanNote('x'.repeat(NOTE_MAX)).length,NOTE_MAX);
 assert.equal([...cleanNote('😀'.repeat(NOTE_MAX))].length,NOTE_MAX);
 assert.throws(()=>cleanNote('x'.repeat(NOTE_MAX+1)),/500/);
 assert.throws(()=>cleanNote(42));
 assert.equal(cleanNote('\uD800 lone'),'lone','a lone surrogate is dropped, never sent as broken text');
});

test('preview shows the same payload send sends, byte for byte, through the session it is given',async()=>{
 const {reports,calls}=make(),session={id:'tab-session'};
 const input={address:'https://www.netflix.com/watch/81?trackId=1',kind:'blocked',list:'phishing-db',note:'Video does not play'};
 const shown=reports.preview(input);assert.equal(shown.available,true);
 const result=await reports.send(input,session);
 assert.equal(calls.length,1);assert.equal(calls[0].url,ENDPOINT);assert.equal(calls[0].session,session);
 assert.equal(calls[0].body,JSON.stringify(shown.payload));assert.deepEqual(result,{sent:true,payload:shown.payload});
 assert.deepEqual(JSON.parse(calls[0].body),{schema:1,host:'www.netflix.com',kind:'blocked',list:'phishing-db',appVersion:'0.1.0-beta.8',platform:'darwin',note:'Video does not play'});
 assert.deepEqual(reports.preview({address:input.address,kind:''}),{available:true,payload:null},'no payload until a problem is chosen');
});

test('nothing is ever sent from Tor, even when the panel asks',async()=>{
 const {reports,calls}=make();
 assert.deepEqual(reports.preview({address:'https://example.org/',kind:'blocked',tor:true}),{available:false,reason:'tor'});
 await assert.rejects(reports.send({address:'https://example.org/',kind:'blocked',tor:true},{}),/Tor/);
 assert.equal(calls.length,0);
 const main=read('desktop/main.cjs');
 assert.match(main,/case 'site-report\.preview':case 'site-report\.send':\{[^]*?tor:torMode\|\|tab\.privacy==='tor'/,'main judges Tor from the window and the tab itself');
 assert.match(main,/case 'site-report\.preview'[^]*?const threat=\/BLOCKED_BY_CLIENT\/\.test\(tab\.error\|\|''\)\?contentBlocking\.threats\.status\(live\.id,tab\.url\):null;/,'a list is named only while the tab shows its warning (seen in the real app: bbc.com reported as listed right after a blocked page in the same tab)');
});

test('no endpoint, no report: the row is hidden and nothing is sent; failures, 429 and the hourly cap are errors, not silence',async()=>{
 const none=make({endpoint:''});assert.equal(none.reports.available(),false);assert.equal(none.reports.preview({address:'https://example.org/',kind:'other'}).available,false);
 await assert.rejects(none.reports.send({address:'https://example.org/',kind:'other'},{}));assert.equal(none.calls.length,0);
 await assert.rejects(make({status:500}).reports.send({address:'https://example.org/',kind:'other'},{}),/could not be sent/);
 await assert.rejects(make({status:429}).reports.send({address:'https://example.org/',kind:'other'},{}),/Too many/);
 await assert.rejects(make({send:async()=>{throw new Error('offline');}}).reports.send({address:'https://example.org/',kind:'other'},{}),/could not be sent/);
 let time=0;const {reports,calls}=make({now:()=>time});
 for(let i=0;i<10;i++)await reports.send({address:`https://s${i}.example.org/`,kind:'broken'},{});
 await assert.rejects(reports.send({address:'https://s10.example.org/',kind:'broken'},{}),/last hour/);
 time+=61*60*1000;await reports.send({address:'https://s10.example.org/',kind:'broken'},{});assert.equal(calls.length,11);
});

test('a test profile only reaches addresses QA names, never the shipped project; plain http only on 127.0.0.1',()=>{
 assert.deepEqual(endpoints({ACIRA_BROWSER_TEST_DATA:'/tmp/acira-agents/x'}),{report:'',allowlist:''});
 assert.deepEqual(endpoints({ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SITE_REPORT_ENDPOINT:'http://127.0.0.1:54321/functions/v1/report',ACIRA_SITE_ALLOWLIST_ENDPOINT:'http://127.0.0.1:54321/functions/v1/allowlist'}),{report:'http://127.0.0.1:54321/functions/v1/report',allowlist:'http://127.0.0.1:54321/functions/v1/allowlist'});
 assert.deepEqual(endpoints({ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SITE_REPORT_ENDPOINT:'http://evil.example.org/r',ACIRA_SITE_ALLOWLIST_ENDPOINT:'https://a.example.org/x?id=1'}),{report:'',allowlist:''},'no plain http elsewhere, no query string');
 const config=require('../desktop/browser-services/site-reports-config.cjs');
 assert.deepEqual(Object.keys(config).sort(),['allowlistEndpoint','reportEndpoint']);
 for(const value of Object.values(config))assert.ok(value===''||/^https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/(report|allowlist)$/.test(value),value);
 assert.deepEqual(endpoints({ACIRA_SITE_REPORT_ENDPOINT:'http://127.0.0.1:1/r'}),{report:config.reportEndpoint,allowlist:config.allowlistEndpoint},'outside a test profile the environment is ignored');
});

test('the transport: POST on the tab session, JSON, no cookies, no Referer, no cache, no redirects',async()=>{
 const seen=[];const session={fetch:async(url,init)=>{seen.push({url,init});return {status:204};}};
 assert.equal(await electronSend('Acira/0.1.0')(ENDPOINT,'{"schema":1}',session),204);
 const {init}=seen[0];assert.equal(seen[0].url,ENDPOINT);
 assert.deepEqual({method:init.method,body:init.body,credentials:init.credentials,cache:init.cache,redirect:init.redirect,referrerPolicy:init.referrerPolicy,headers:init.headers},{method:'POST',body:'{"schema":1}',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json','User-Agent':'Acira/0.1.0'}});
});

test('the closed lists: every threat list can be named in a report',()=>{
 assert.deepEqual(KINDS,['blocked','broken','banner','other']);assert.deepEqual(LISTS,['phishing','malware','phishing-db','lookalike','ad-blocking','cookie-banners']);
 const {SOURCES}=require('../desktop/browser-services/threat-lists.cjs');for(const source of SOURCES)assert.ok(LISTS.includes(source.id),source.id+' can be named in a report');
});

test('the app and the report function agree on every field: what the app builds, the function stores; what it refuses, the app never sends',async()=>{
 const server=await import('../supabase/functions/report/handler.mjs');
 for(const host of ['example.com','a.b.example.co.uk','xn--mnchen-3ya.example.de','www.netflix.com','x.y','localhost','printer.local','abc.onion','192.168.1.1','a.example','shop.test','a_b.example.org','-a.example.org','a'.repeat(64)+'.example.org','UPPER.example.org'])
  assert.equal(reportHost('https://'+host+'/')===host,server.validHost(host),host);
 assert.deepEqual([...KINDS],[...server.KINDS]);assert.deepEqual([...LISTS],[...server.LISTS]);assert.equal(NOTE_MAX,server.NOTE_MAX);
 for(const input of [{address:'https://www.example.org/a?b',kind:'blocked',list:'phishing-db',note:'Netflix video 😀 stops\nhere'},{address:'https://a.example.org/',kind:'other',note:''},{address:'https://a.example.org/',kind:'banner',list:'cookie-banners',note:'é'.repeat(NOTE_MAX)}]){
  const payload=buildReport({...input,appVersion:'0.1.0-beta.8',platform:'win32'});
  assert.deepEqual(server.validate(JSON.parse(JSON.stringify(payload))),{host:payload.host,kind:payload.kind,list:payload.list,app_version:'0.1.0-beta.8',platform:'win32',note:payload.note||null});
 }
});
