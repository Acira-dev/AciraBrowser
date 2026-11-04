'use strict';
// "Report a problem" (desktop/browser-services/site-reports.cjs): exactly what is sent, host only (or no site at all, about Acira), nothing from
// Tor, the endpoints a test profile may reach, and the wiring in main.cjs (Tor checked there too). The interface: tests/site-report-ui.test.cjs.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {reportHost,cleanNote,buildReport,endpoints,createSiteReports,electronSend,KINDS,SITE_KINDS,APP_KINDS,LISTS,NOTE_MAX}=require('../desktop/browser-services/site-reports.cjs');
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

test('a report about Acira itself: the same seven fields, no site and no list whatever the tab shows, and a note it cannot go without',async()=>{
 const {reports,calls}=make(),session={id:'profile-session'};
 const input={subject:'app',address:'https://www.netflix.com/watch/81?trackId=1',kind:'app-crash',list:'phishing-db',note:'  Froze when I opened Settings.  '};
 const shown=reports.preview(input);
 assert.deepEqual(shown,{available:true,payload:{schema:1,host:null,kind:'app-crash',list:null,appVersion:'0.1.0-beta.8',platform:'darwin',note:'Froze when I opened Settings.'}});
 const result=await reports.send(input,session);
 assert.equal(calls[0].body,JSON.stringify(shown.payload),'what is shown is what is sent');assert.equal(calls[0].session,session);
 assert.deepEqual(Object.keys(JSON.parse(calls[0].body)),['schema','host','kind','list','appVersion','platform','note']);
 for(const secret of ['netflix','watch','trackId','phishing'])assert.ok(!calls[0].body.includes(secret),secret);
 assert.deepEqual(result,{sent:true,payload:shown.payload});
 // The preview shows the message while the note is still empty; Send refuses it, so nothing goes.
 assert.deepEqual(reports.preview({subject:'app',kind:'app-idea',note:'  '}).payload,{schema:1,host:null,kind:'app-idea',list:null,appVersion:'0.1.0-beta.8',platform:'darwin',note:''});
 await assert.rejects(reports.send({subject:'app',kind:'app-idea',note:' \n '},session),/Write what happened/);
 assert.equal(calls.length,1);
 // On an Acira page there is no site: the app subject still works, the site subject does not.
 assert.equal(reports.preview({subject:'app',address:'acira://settings',kind:'app-looks',note:'x'}).payload.host,null);
 assert.deepEqual(reports.preview({subject:'site',address:'acira://settings',kind:'blocked'}),{available:false,reason:'not-a-website'});
 // A problem from the other subject's list is never built.
 assert.deepEqual(reports.preview({subject:'site',address:'https://a.example.org/',kind:'app-crash',note:'x'}),{available:true,payload:null});
 assert.deepEqual(reports.preview({subject:'app',kind:'blocked',note:'x'}),{available:true,payload:null});
 await assert.rejects(reports.send({subject:'site',address:'https://a.example.org/',kind:'app-crash',note:'x'},session),/Choose/);
 await assert.rejects(reports.send({subject:'app',kind:'other',note:'x'},session),/Choose/);
 assert.equal(calls.length,1);
 // Tor: refused before anything else, about Acira too.
 assert.deepEqual(reports.preview({subject:'app',kind:'app-crash',note:'x',tor:true}),{available:false,reason:'tor'});
 await assert.rejects(reports.send({subject:'app',kind:'app-crash',note:'x',tor:true},session),/Tor/);
 assert.equal(calls.length,1);
});

test('main: an app report is judged for Tor from the window and the tab, and goes out only on a session whose proxy is set up',()=>{
 const main=read('desktop/main.cjs');
 assert.match(main,/shape\(\['tabId','subject','kind','note'\]\)/);
 assert.match(main,/if\(request\.subject==='app'\)\{const reports=siteReportsService\(\),input=\{subject:'app',address:null,kind:request\.kind,note:request\.note,list:null,tor:torMode\|\|tab\?\.privacy==='tor'\};/,'no address and no list leave main for a report about Acira');
 assert.match(main,/ses=live\?\.session\|\|\(profile\?require\('electron'\)\.session\.fromPartition\(profile\.partition\):null\),routed=\(\(\)=>\{try\{const route=contentBlocking\.proxy\.status\(ses\);return !route\.error&&route\.applied!==false&&!route\.busy;\}catch\{return false;\}\}\)\(\);if\(!ses\|\|!routed\)throw/,'a proxy the person chose is never bypassed');
 assert.match(main,/const input=\{subject:'site',address:tab\.url,/,'a site report says so');
 assert.match(main,/siteReports:siteReportsService\(\)\.available\(\)\}/,'every window learns whether reports can be sent');
 assert.match(read('src/runtime/core.ts'),/delete s\.siteReports;/,'and never saves it');
 assert.match(main,/case 'report':[^\n]*?if\(!siteReportsService\(\)\.available\(\)\)break;if\(torMode\|\|active\.privacy==='tor'\)\{dispatch\(\{type:'toast',text:tm\('report\.unavailable'\),tone:'info'\}\);break;\}/,'Help > Report a Problem says so in Tor instead of opening anything (an info toast, not a check mark)');
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

test('no endpoint, no report: the row is hidden and nothing is sent; failures, 429 and the hourly cap are said, not silence',async()=>{
 const none=make({endpoint:''});assert.equal(none.reports.available(),false);assert.equal(none.reports.preview({address:'https://example.org/',kind:'other'}).available,false);
 await assert.rejects(none.reports.send({address:'https://example.org/',kind:'other'},{}));assert.equal(none.calls.length,0);
 // beta.10: what the form says depends on why. No answer at all: the connection. An answer that refused it (429 the server's limits, 503 its
 // storage, any other status) or the app's own hourly cap: later. A 429 used to say "Check your connection" although the connection worked.
 const site={address:'https://example.org/',kind:'other'};
 assert.deepEqual(await make({status:429}).reports.send(site,{}),{sent:false,failure:'later'});
 assert.deepEqual(await make({status:503}).reports.send(site,{}),{sent:false,failure:'later'});
 assert.deepEqual(await make({status:500}).reports.send(site,{}),{sent:false,failure:'later'});
 assert.deepEqual(await make({send:async()=>{throw new Error('offline');}}).reports.send(site,{}),{sent:false,failure:'offline'});
 assert.deepEqual(await make({send:async()=>{throw new DOMException('timed out','TimeoutError');}}).reports.send(site,{}),{sent:false,failure:'offline'});
 let time=0;const {reports,calls}=make({now:()=>time});
 for(let i=0;i<10;i++)assert.equal((await reports.send({address:`https://s${i}.example.org/`,kind:'broken'},{})).sent,true);
 assert.deepEqual(await reports.send({address:'https://s10.example.org/',kind:'broken'},{}),{sent:false,failure:'later'});assert.equal(calls.length,10,'the hourly cap sends nothing');
 time+=61*60*1000;assert.equal((await reports.send({address:'https://s10.example.org/',kind:'broken'},{})).sent,true);assert.equal(calls.length,11);
 // a refused or failed report doesn't count towards the cap
 const refused=make({status:429});for(let i=0;i<12;i++)await refused.reports.send(site,{});assert.equal(refused.calls.length,12);
 // main passes the answer through as it is: the form reads siteReport.failure
 assert.match(read('desktop/main.cjs'),/return \{siteReport:\{available:true,\.\.\.\(await reports\.send\(input,live\.session\)\)\}\};/);
 assert.match(read('desktop/main.cjs'),/return \{siteReport:\{available:true,\.\.\.\(await reports\.send\(input,ses\)\)\}\};/);
});

test('a test profile only reaches addresses QA names, never the shipped project; plain http only on 127.0.0.1',()=>{
 assert.deepEqual(endpoints({ACIRA_BROWSER_TEST_DATA:'/tmp/acira-qa/x'}),{report:'',allowlist:''});
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
 assert.deepEqual(SITE_KINDS,['blocked','broken','banner','other']);assert.deepEqual(APP_KINDS,['app-broken','app-looks','app-crash','app-idea']);assert.deepEqual(KINDS,[...SITE_KINDS,...APP_KINDS]);assert.deepEqual(LISTS,['phishing','malware','phishing-db','lookalike','ad-blocking','cookie-banners']);
 const {SOURCES}=require('../desktop/browser-services/threat-lists.cjs');for(const source of SOURCES)assert.ok(LISTS.includes(source.id),source.id+' can be named in a report');
});

test('the app and the report function agree on every field: what the app builds, the function stores; what it refuses, the app never sends',async()=>{
 const server=await import('../supabase/functions/report/handler.mjs');
 for(const host of ['example.com','a.b.example.co.uk','xn--mnchen-3ya.example.de','www.netflix.com','x.y','localhost','printer.local','abc.onion','192.168.1.1','a.example','shop.test','a_b.example.org','-a.example.org','a'.repeat(64)+'.example.org','UPPER.example.org'])
  assert.equal(reportHost('https://'+host+'/')===host,server.validHost(host),host);
 assert.deepEqual([...KINDS],[...server.KINDS]);assert.deepEqual([...SITE_KINDS],[...server.SITE_KINDS]);assert.deepEqual([...APP_KINDS],[...server.APP_KINDS]);assert.deepEqual([...LISTS],[...server.LISTS]);assert.equal(NOTE_MAX,server.NOTE_MAX);
 for(const input of [{address:'https://www.example.org/a?b',kind:'blocked',list:'phishing-db',note:'Netflix video 😀 stops\nhere'},{address:'https://a.example.org/',kind:'other',note:''},{address:'https://a.example.org/',kind:'banner',list:'cookie-banners',note:'é'.repeat(NOTE_MAX)}]){
  const payload=buildReport({...input,appVersion:'0.1.0-beta.8',platform:'win32'});
  assert.deepEqual(server.validate(JSON.parse(JSON.stringify(payload))),{host:payload.host,kind:payload.kind,list:payload.list,app_version:'0.1.0-beta.8',platform:'win32',note:payload.note||null});
 }
 for(const kind of APP_KINDS){
  const payload=buildReport({address:'https://www.example.org/a',kind,list:'phishing',note:'It happened again 😀',appVersion:'0.1.0-beta.8',platform:'darwin'});
  assert.deepEqual(server.validate(JSON.parse(JSON.stringify(payload))),{host:null,kind,list:null,app_version:'0.1.0-beta.8',platform:'darwin',note:'It happened again 😀'},kind);
  const draft=buildReport({kind,note:'',appVersion:'0.1.0-beta.8',platform:'darwin'},{draft:true});
  assert.equal(server.validate(JSON.parse(JSON.stringify(draft))),null,'the empty-note preview is exactly what the function refuses, so Send stays off');
 }
});
