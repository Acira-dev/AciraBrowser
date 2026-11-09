'use strict';
// declarativeNetRequest matcher (desktop/browser-services/dnr-engine.cjs). The urlFilter, priority, allowAllRequests, modifyHeaders and redirect
// cases are the examples from Chrome's chrome.declarativeNetRequest reference.
const test=require('node:test'),assert=require('node:assert/strict');
const {createDnrEngine,compileRule,compileUrlFilter,filterTokens,regexToken,applyTransform,prepareRequest}=require('../desktop/browser-services/dnr-engine.cjs');

const EXT='a'.repeat(32),EXT2='b'.repeat(32);
const engineWith=(rules,opts={})=>{const e=createDnrEngine();e.setExtension(EXT,{rulesets:[{id:'r',enabled:true,rules}],...opts});return e;};
const block=(urlFilter,extra={})=>({id:extra.id||1,priority:extra.priority||1,action:{type:'block'},condition:{urlFilter,resourceTypes:['main_frame','sub_frame','script','image','xmlhttprequest','other'],...extra.condition}});
const blocked=(e,url,more={})=>!!e.beforeRequest({url,type:'script',...more})?.cancel;

test('urlFilter examples from the Chrome reference',()=>{
 const cases=[
  ['abc',['https://abcd.com','https://example.com/abcd'],['https://ab.com']],
  ['abc*d',['https://abcd.com','https://example.com/abcxyzd'],['https://abc.com']],
  ['||a.example.com',['https://a.example.com/','https://b.a.example.com/xyz','https://a.example.company'],['https://example.com/']],
  ['|https*',['https://example.com'],['http://example.com/','http://https.com']],
  ['example*^123|',['https://example.com/123','http://abc.com/example?123'],['https://example.com/1234','https://abc.com/example0123']]
 ];
 for(const [filter,yes,no] of cases){
  const e=engineWith([block(filter)]);
  for(const url of yes)assert.equal(blocked(e,url),true,`${filter} should match ${url}`);
  for(const url of no)assert.equal(blocked(e,url),false,`${filter} should not match ${url}`);
  const re=compileUrlFilter(filter,false);
  for(const url of yes)assert.ok(re.test(url),`${filter} regex ${url}`);
 }
});

test('the regex-free urlFilter matcher agrees with the RegExp form on every pattern × URL pair',()=>{
 const patterns=['abc','abc*d','||a.example.com','|https*','example*^123|','||ads.example.com^','/ads/*banner','^ad^','-ad-','||x.org/a*b|','.js|','|http://*.gif^','*track*','||example.com^*/p?x=','^','pixel.gif^','||cdn.net/lib','a^^b','/b/s/beacon','=awq9r1rnl*apikey='];
 const urls=['https://abcd.com','https://example.com/abcd','https://ab.com','https://example.com/abcxyzd','https://a.example.com/','https://b.a.example.com/xyz','https://a.example.company','http://example.com/','http://https.com','https://example.com/123','http://abc.com/example?123','https://example.com/1234','https://abc.com/example0123',
  'https://ads.example.com','https://ads.example.com:8080/x','https://x.ads.example.com/a','https://ads.example.com.evil.net/','https://evil.net/?u=https://ads.example.com/','https://site.com/ads/top-banner.png','https://site.com/x/ad/y','https://s.com/a-ad-b','https://x.org/aqqb','https://x.org/a/b?c','https://h.com/app.js','http://img.host/p.gif','http://img.host/p.gif?x','https://t.com/track/1','https://example.com/a/p?x=1','https://example.com/','https://example.com','https://h/pixel.gif','https://h/pixel.gif?x=1','https://cdn.net/lib.js','https://h/a//b','https://h/b/s/beacon?x','https://h/s.js?=awq9r1rnl&q&apikey=1'];
 const {parseUrlFilter,matchUrlFilter}=require('../desktop/browser-services/dnr-engine.cjs');
 for(const filter of patterns)for(const url of urls){
  const req=prepareRequest({url,type:'script'}),expected=compileUrlFilter(filter,false).test(url);
  assert.equal(matchUrlFilter(parseUrlFilter(filter,false),req.lower,req.hostStart,req.hostEnd),expected,`${filter} on ${url}`);
 }
});

test('urlFilter is case-insensitive unless isUrlFilterCaseSensitive',()=>{
 assert.equal(blocked(engineWith([block('/ADS/')]),'https://x.com/ads/a.js'),true);
 assert.equal(blocked(engineWith([block('/ADS/',{condition:{isUrlFilterCaseSensitive:true}})]),'https://x.com/ads/a.js'),false);
 assert.equal(blocked(engineWith([block('/ADS/',{condition:{isUrlFilterCaseSensitive:true}})]),'https://x.com/ADS/a.js'),true);
});

test('separator ^ matches the end of the URL and never a letter, digit, _ - . %',()=>{
 const e=engineWith([block('||ads.example.com^')]);
 assert.equal(blocked(e,'https://ads.example.com'),true);
 assert.equal(blocked(e,'https://ads.example.com:8080/x'),true);
 assert.equal(blocked(e,'https://x.ads.example.com/a'),true);
 assert.equal(blocked(e,'https://ads.example.com.evil.net/'),false);
 assert.equal(blocked(e,'https://ads.example.co/'),false);
 assert.equal(blocked(e,'https://evil.net/?u=https://ads.example.com/'),false,'|| anchors in the host only');
});

test('index tokens are only taken where a URL token must start and end',()=>{
 assert.deepEqual(filterTokens('abc'),[]);
 assert.deepEqual(filterTokens('||example.com/ads/*'),['example','com','ads']);
 assert.deepEqual(filterTokens('/banner'),[]);
 assert.deepEqual(filterTokens('-ad-'),['ad']);
 assert.deepEqual(filterTokens('|https://x.org^'),['https','x','org'].filter(t=>t.length>1));
 assert.equal(regexToken('^https?://[^/]+\\.example\\.com/ads/'),'example');
 assert.equal(regexToken('.example.'),null,'an unescaped dot is any character');
 assert.equal(regexToken('(a|b)ads/'),null);
});

test('resource types: default is everything but main_frame; excludedResourceTypes; both is an error',()=>{
 const e=engineWith([{id:1,action:{type:'block'},condition:{urlFilter:'tracker'}}]);
 assert.equal(!!e.beforeRequest({url:'https://tracker.com/',type:'main_frame'}),false);
 assert.equal(!!e.beforeRequest({url:'https://tracker.com/',type:'image'}),true);
 const f=engineWith([{id:1,action:{type:'block'},condition:{urlFilter:'tracker',excludedResourceTypes:['image']}}]);
 assert.equal(!!f.beforeRequest({url:'https://tracker.com/',type:'image'}),false);
 assert.equal(!!f.beforeRequest({url:'https://tracker.com/',type:'main_frame'}),true);
 assert.throws(()=>compileRule({id:1,action:{type:'block'},condition:{resourceTypes:['image'],excludedResourceTypes:['script']}},{extensionId:EXT,source:"dynamic"}));
});

test('domains: request, initiator, top, excluded, domainType',()=>{
 const e=engineWith([
  {id:1,action:{type:'block'},condition:{requestDomains:['tracker.com'],excludedRequestDomains:['ok.tracker.com'],resourceTypes:['script']}},
  {id:2,action:{type:'block'},condition:{urlFilter:'/pixel',initiatorDomains:['news.com'],resourceTypes:['image']}},
  {id:3,action:{type:'block'},condition:{urlFilter:'||cdn.net/lib',domainType:'thirdParty',resourceTypes:['script']}},
  {id:4,action:{type:'block'},condition:{requestDomains:['ads.org'],excludedTopDomains:['partner.com'],resourceTypes:['script']}}
 ]);
 assert.equal(blocked(e,'https://a.tracker.com/x.js'),true);
 assert.equal(blocked(e,'https://ok.tracker.com/x.js'),false);
 assert.equal(!!e.beforeRequest({url:'https://img.com/pixel?1',type:'image',initiator:'https://www.news.com'}),true);
 assert.equal(!!e.beforeRequest({url:'https://img.com/pixel?1',type:'image',initiator:'https://other.com'}),false);
 assert.equal(!!e.beforeRequest({url:'https://img.com/pixel?1',type:'image'}),false,'no initiator never matches initiatorDomains');
 assert.equal(blocked(e,'https://cdn.net/lib.js',{initiator:'https://site.com'}),true);
 assert.equal(blocked(e,'https://cdn.net/lib.js',{initiator:'https://www.cdn.net'}),false,'same site is first party');
 assert.equal(blocked(e,'https://x.ads.org/a.js',{topUrl:'https://news.com/'}),true);
 assert.equal(blocked(e,'https://x.ads.org/a.js',{topUrl:()=>'https://www.partner.com/'}),false);
});

test('methods and tab ids (session rules only)',()=>{
 const e=createDnrEngine();
 e.setExtension(EXT,{sessionRules:[{id:1,action:{type:'block'},condition:{urlFilter:'api',requestMethods:['post'],tabIds:[7],resourceTypes:['xmlhttprequest']}}]});
 assert.equal(!!e.beforeRequest({url:'https://x.com/api/',type:'xmlhttprequest',method:'POST',tabId:7}),true);
 assert.equal(!!e.beforeRequest({url:'https://x.com/api/',type:'xmlhttprequest',method:'GET',tabId:7}),false);
 assert.equal(!!e.beforeRequest({url:'https://x.com/api/',type:'xmlhttprequest',method:'POST',tabId:8}),false);
 assert.throws(()=>e.updateRules(EXT,'dynamic',{addRules:[{id:2,action:{type:'block'},condition:{tabIds:[1]}}]}),/tabIds/);
});

test('priority and action precedence (Chrome reference example)',()=>{
 // Reference: rules 1 (allow, priority 1), 2 (block, priority 1), 3 (redirect, priority 5), 4 (allow, priority 6 on another host)…
 const rules=[
  {id:1,priority:1,action:{type:'allow'},condition:{urlFilter:'google.com',resourceTypes:['main_frame']}},
  {id:2,priority:1,action:{type:'block'},condition:{urlFilter:'||google.com',resourceTypes:['main_frame']}},
  {id:3,priority:2,action:{type:'redirect',redirect:{url:'https://example.com'}},condition:{urlFilter:'||google.com/abc',resourceTypes:['main_frame']}},
  {id:4,priority:3,action:{type:'block'},condition:{urlFilter:'||google.com/xyz',resourceTypes:['main_frame']}},
  {id:5,priority:4,action:{type:'allow'},condition:{urlFilter:'||google.com/xyz/allowed',resourceTypes:['main_frame']}}
 ];
 const e=engineWith(rules);
 const nav=url=>e.beforeRequest({url,type:'main_frame'});
 assert.equal(nav('https://google.com/'),null,'allow beats block at equal priority');
 assert.deepEqual(nav('https://google.com/abc'),{redirectURL:'https://example.com/'});
 assert.deepEqual(nav('https://google.com/xyz/1'),{cancel:true});
 assert.equal(nav('https://google.com/xyz/allowed'),null);
 assert.deepEqual(e.getMatchedRules(EXT).map(m=>m.rule.ruleId),[1,3,4,5]);
});

test('across extensions: block wins, then the most recently installed redirect',()=>{
 const e=createDnrEngine();
 e.setExtension(EXT,{dynamicRules:[{id:1,priority:9,action:{type:'allow'},condition:{urlFilter:'||x.com^'}}]});
 e.setExtension(EXT2,{dynamicRules:[{id:1,action:{type:'block'},condition:{urlFilter:'||x.com^'}}]});
 assert.deepEqual(e.beforeRequest({url:'https://x.com/a.js',type:'script'}),{cancel:true});
 const r=createDnrEngine();
 r.setExtension(EXT,{dynamicRules:[{id:1,action:{type:'redirect',redirect:{url:'https://one.example/'}},condition:{urlFilter:'||x.com^'}}]});
 r.setExtension(EXT2,{dynamicRules:[{id:1,action:{type:'redirect',redirect:{url:'https://two.example/'}},condition:{urlFilter:'||x.com^'}}]});
 assert.deepEqual(r.beforeRequest({url:'https://x.com/a.js',type:'script'}),{redirectURL:'https://two.example/'});
});

test('allowAllRequests on a main frame allows its subresources up to that priority',()=>{
 const e=engineWith([
  {id:1,priority:2,action:{type:'allowAllRequests'},condition:{urlFilter:'||trusted.com^',resourceTypes:['main_frame']}},
  {id:2,priority:1,action:{type:'block'},condition:{urlFilter:'||ads.net^'}},
  {id:3,priority:5,action:{type:'block'},condition:{urlFilter:'||malware.net^'}}
 ]);
 assert.equal(e.beforeRequest({url:'https://trusted.com/',type:'main_frame',tabId:1,frameKey:'wc:1'}),null);
 const sub=url=>e.beforeRequest({url,type:'script',tabId:1,frameKeys:['wc:1']});
 assert.equal(sub('https://ads.net/a.js'),null);
 assert.deepEqual(sub('https://malware.net/a.js'),{cancel:true},'a higher-priority block still applies');
 e.beforeRequest({url:'https://other.com/',type:'main_frame',tabId:1,frameKey:'wc:1'});
 assert.deepEqual(sub('https://ads.net/a.js'),{cancel:true},'the next document starts fresh');
 assert.throws(()=>compileRule({id:9,action:{type:'allowAllRequests'},condition:{resourceTypes:['script']}},{extensionId:EXT,source:"dynamic"}));
});

test('upgradeScheme only applies to http and ws',()=>{
 const e=engineWith([{id:1,action:{type:'upgradeScheme'},condition:{requestDomains:['plain.org'],resourceTypes:['main_frame','websocket']}}]);
 assert.deepEqual(e.beforeRequest({url:'http://plain.org/a',type:'main_frame'}),{redirectURL:'https://plain.org/a'});
 assert.deepEqual(e.beforeRequest({url:'ws://plain.org/s',type:'websocket'}),{redirectURL:'wss://plain.org/s'});
 assert.equal(e.beforeRequest({url:'https://plain.org/a',type:'main_frame'}),null);
});

test('redirect: extensionPath, transform with queryTransform, regexSubstitution',()=>{
 const e=engineWith([
  {id:1,action:{type:'redirect',redirect:{extensionPath:'/web_accessible_resources/noop.js'}},condition:{urlFilter:'||ads.com/lib.js',resourceTypes:['script']}},
  {id:2,action:{type:'redirect',redirect:{transform:{scheme:'https',host:'new.example.com'}}},condition:{urlFilter:'||old.example.com^',resourceTypes:['main_frame']}},
  {id:3,action:{type:'redirect',redirect:{transform:{queryTransform:{removeParams:['utm_source','utm_medium'],addOrReplaceParams:[{key:'ref',value:'acira'}]}}}},condition:{urlFilter:'utm_source=',resourceTypes:['main_frame']}},
  {id:4,action:{type:'redirect',redirect:{regexSubstitution:'chrome-extension://'+EXT+'/ask.html?url=\\0'}},condition:{regexFilter:'^https?://.*\\.user\\.js(\\?.*)?$',resourceTypes:['main_frame']}}
 ]);
 assert.deepEqual(e.beforeRequest({url:'https://ads.com/lib.js',type:'script'}),{redirectURL:`chrome-extension://${EXT}/web_accessible_resources/noop.js`});
 assert.deepEqual(e.beforeRequest({url:'http://old.example.com/path?q=1#f',type:'main_frame'}),{redirectURL:'https://new.example.com/path?q=1#f'});
 assert.deepEqual(e.beforeRequest({url:'https://shop.com/?id=1&utm_source=x&utm_medium=y',type:'main_frame'}),{redirectURL:'https://shop.com/?id=1&ref=acira'});
 assert.deepEqual(e.beforeRequest({url:'http://127.0.0.1:8080/hello.user.js',type:'main_frame'}),{redirectURL:`chrome-extension://${EXT}/ask.html?url=http://127.0.0.1:8080/hello.user.js`});
 assert.equal(applyTransform('https://a.com/x?b=1',{queryTransform:{addOrReplaceParams:[{key:'b',value:'2',replaceOnly:true},{key:'c',value:'3',replaceOnly:true}]}},EXT),'https://a.com/x?b=2');
});

test('modifyHeaders: priority order, set/remove are final, append accumulates; allow above suppresses',()=>{
 const e=engineWith([
  {id:1,priority:3,action:{type:'modifyHeaders',requestHeaders:[{header:'DNT',operation:'set',value:'1'}],responseHeaders:[{header:'set-cookie',operation:'remove'}]},condition:{urlFilter:'||site.com^',resourceTypes:['main_frame','script']}},
  {id:2,priority:2,action:{type:'modifyHeaders',requestHeaders:[{header:'dnt',operation:'set',value:'0'}],responseHeaders:[{header:'X-Frame-Options',operation:'append',value:'DENY'}]},condition:{urlFilter:'||site.com^',resourceTypes:['main_frame','script']}},
  {id:3,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'x-frame-options',operation:'append',value:'SAMEORIGIN'}]},condition:{urlFilter:'||site.com^',resourceTypes:['main_frame','script']}},
  {id:4,priority:2,action:{type:'allow'},condition:{urlFilter:'||site.com/free',resourceTypes:['script']}}
 ]);
 const req={url:'https://site.com/',type:'main_frame'};
 assert.deepEqual(e.beforeSendHeaders(req,{'User-Agent':'x'}),{'User-Agent':'x',DNT:'1'});
 assert.deepEqual(e.headersReceived(req,{'Set-Cookie':['a=1'],'Content-Type':['text/html']}),{'Content-Type':['text/html'],'X-Frame-Options':['DENY','SAMEORIGIN']});
 // allow at priority 2 suppresses modifyHeaders at priority <= 2; rule 1 (priority 3) still applies.
 assert.deepEqual(e.beforeSendHeaders({url:'https://site.com/free.js',type:'script'},{}),{DNT:'1'});
 assert.throws(()=>compileRule({id:1,action:{type:'modifyHeaders',requestHeaders:[{header:'x-custom',operation:'append',value:'1'}]}},{extensionId:EXT,source:"dynamic"}),/append/);
});

test('dynamic / session updates: remove first, unique ids, limits, all-or-nothing',()=>{
 const e=createDnrEngine();
 e.setExtension(EXT,{});
 e.updateRules(EXT,'dynamic',{addRules:[{id:1,action:{type:'block'},condition:{urlFilter:'||a.com^'}}]});
 assert.throws(()=>e.updateRules(EXT,'dynamic',{addRules:[{id:1,action:{type:'block'},condition:{urlFilter:'||b.com^'}}]}),/unique/);
 e.updateRules(EXT,'dynamic',{removeRuleIds:[1],addRules:[{id:1,action:{type:'block'},condition:{urlFilter:'||b.com^'}}]});
 assert.equal(blocked(e,'https://a.com/x.js'),false);
 assert.equal(blocked(e,'https://b.com/x.js'),true);
 assert.throws(()=>e.updateRules(EXT,'dynamic',{addRules:[{id:2,action:{type:'block'},condition:{urlFilter:''}}]}));
 assert.equal(e.getRules(EXT,'dynamic').length,1,'a failed update changes nothing');
 const many=Array.from({length:5001},(_,i)=>({id:i+1,action:{type:'block'},condition:{urlFilter:'||s'+i+'.com^'}}));
 assert.throws(()=>e.updateRules(EXT,'session',{addRules:many}),/limit/);
 const redirects=Array.from({length:5001},(_,i)=>({id:i+10,action:{type:'redirect',redirect:{url:'https://x.org/'}},condition:{urlFilter:'||r'+i+'.com^'}}));
 assert.throws(()=>e.updateRules(EXT,'dynamic',{addRules:redirects}),/limit/);
});

test('an update Chromium already accepted keeps every rule but one this matcher cannot run safely',()=>{
 const e=createDnrEngine();
 const rules=[
  {id:7,priority:3,action:{type:'redirect',redirect:{regexSubstitution:'https://www.tampermonkey.net/script_installation.php#url=\\0'}},condition:{requestMethods:['get'],excludedRequestDomains:['tampermonkey.net'],regexFilter:'^(?:https?|ftp)://[^\\#\\?]+/[^\\#\\?]+\\.(?:user|tamper)\\.js[^/]*$',resourceTypes:['main_frame']}},
  {id:8,priority:3,action:{type:'redirect',redirect:{regexSubstitution:'https://www.tampermonkey.net/script_installation.php#url=\\0'}},condition:{requestDomains:['openuserjs.org'],regexFilter:'^https?://openuserjs\\.org/install/([^/]+)+/(.+?)(?:\\.min)?\\.user\\.js(?:$|\\?|\\#)',resourceTypes:['main_frame']}}
 ];
 assert.throws(()=>e.updateRules(EXT,'session',{addRules:rules}),/nests quantifiers/);
 e.updateRules(EXT,'session',{addRules:rules},{lenient:true});
 assert.deepEqual(e.getRules(EXT,'session').map(r=>r.id),[7]);
 assert.match(e.errors(EXT)[0],/#8: regexFilter nests quantifiers/);
 assert.deepEqual(e.beforeRequest({url:'https://site.test:8443/hello.user.js',type:'main_frame'}),{redirectURL:'https://www.tampermonkey.net/script_installation.php#url=https://site.test:8443/hello.user.js'});
 assert.equal(e.beforeRequest({url:'https://site.test/hello.user.js',type:'main_frame',method:'POST'}),null);
});

test('enable / disable rulesets and individual static rules',()=>{
 const e=createDnrEngine(),sets={easylist:[block('||ads.com^')],extra:[block('||more.com^',{id:7})]};
 e.setExtension(EXT,{rulesets:[{id:'easylist',enabled:true,rules:sets.easylist},{id:'extra',enabled:false}]});
 assert.equal(blocked(e,'https://more.com/a.js'),false);
 assert.deepEqual(e.updateEnabledRulesets(EXT,{enableRulesetIds:['extra'],disableRulesetIds:['easylist']},id=>sets[id]),['extra']);
 assert.equal(blocked(e,'https://more.com/a.js'),true);
 assert.equal(blocked(e,'https://ads.com/a.js'),false);
 e.updateStaticRules(EXT,{rulesetId:'extra',disableRuleIds:[7]});
 assert.equal(blocked(e,'https://more.com/a.js'),false);
});

test('regexFilter: RE2-only syntax and nested quantifiers are refused',()=>{
 const make=regexFilter=>compileRule({id:1,action:{type:'block'},condition:{regexFilter}},{extensionId:EXT,source:"dynamic"});
 assert.throws(()=>make('(?<=a)b'));
 assert.throws(()=>make('(a)\\1'));
 assert.throws(()=>make('(a+)+$'));
 assert.throws(()=>make('(x*)*'));
 assert.throws(()=>make('(\\w+\\s?)*$'));
 assert.throws(()=>make('(a+|b)+'));
 make('^https?://([a-z0-9-]+\\.)*example\\.com/');
 make('^https?://[^/]+/(?:[a-z]{2,8}/)?ads?/');
 const e=engineWith([{id:1,action:{type:'block'},condition:{regexFilter:'/ad[0-9]+\\.js$'}}]);
 assert.equal(blocked(e,'https://x.com/ad12.js'),true);
 assert.equal(blocked(e,'https://x.com/add.js'),false);
});

test('invalid static rules are skipped, not fatal; nothing runs without rules',()=>{
 const e=createDnrEngine();
 assert.equal(e.active,false);
 assert.equal(e.beforeRequest({url:'https://x.com/',type:'script'}),null);
 const out=e.setExtension(EXT,{rulesets:[{id:'r',enabled:true,rules:[{id:1,action:{type:'nope'}},block('||ok.com^',{id:2})]}]});
 assert.equal(out.errors.length,1);
 assert.equal(e.active,true);
 assert.equal(blocked(e,'https://ok.com/a.js'),true);
 e.removeExtension(EXT);
 assert.equal(e.active,false);
});

test('a prepared request is shared and lazy',()=>{
 let reads=0;
 const req=prepareRequest({url:'https://A.example.com/Path?x',type:'script',initiator:()=>{reads++;return 'https://site.org';}});
 assert.deepEqual(req.hostSuffixes,['a.example.com','example.com','com']);
 assert.equal(reads,0);
 assert.equal(req.initiatorHost,'site.org');
 assert.equal(req.initiatorHost,'site.org');
 assert.equal(reads,1);
});

// A rule's `responseHeaders` / `excludedResponseHeaders` conditions (Chrome 128, HeaderInfo: header, values, excludedValues) are matched against the
// response. Mister Download Manager 0.5.0 sets Content-Disposition: attachment this way for the files "the browser would open itself" (PDF, MP3 ...); the engine
// ignored the condition, so every main-frame page of a profile with it became a download (a Windows tester's "loading search (1).htm", 8 Nov 2026).
test('responseHeaders condition: a modifyHeaders rule applies only to a response whose header matches (Mister Download Manager)',()=>{
 const MDM={id:1,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'content-disposition',operation:'set',value:'attachment'}]},
  condition:{resourceTypes:['main_frame'],responseHeaders:[{header:'content-type',values:['application/pdf*','audio/mpeg*','video/mp4*']}]}};
 const e=engineWith([MDM]);
 const page={url:'https://www.google.com/search?q=hello',type:'main_frame'};
 // the page stays a page: no header change at all
 assert.equal(e.headersReceived(page,{'Content-Type':['text/html; charset=UTF-8']}),null);
 assert.equal(e.headersReceived(page,{'content-type':['image/webp']}),null);
 assert.equal(e.headersReceived(page,{'Content-Length':['10']}),null,'no Content-Type: no match');
 // the file types it names are made downloads, whatever the header's case or parameters
 assert.deepEqual(e.headersReceived({url:'https://x.test/a.pdf',type:'main_frame'},{'Content-Type':['application/pdf']}),{'Content-Type':['application/pdf'],'content-disposition':['attachment']});
 assert.deepEqual(e.headersReceived({url:'https://x.test/a',type:'main_frame'},{'content-type':['Audio/MPEG; x=1']}),{'content-type':['Audio/MPEG; x=1'],'content-disposition':['attachment']});
 // a condition that names a header the response lacks does not match
 assert.equal(e.headersReceived({url:'https://x.test/a.mp4',type:'main_frame'},{'Content-Length':['5']}),null);
});

test('responseHeaders condition: header presence, values wildcards, excludedValues and excludedResponseHeaders',()=>{
 // every rule sets a header of its own, so which rules matched can be read off the result
 const modify=(id,condition)=>({id,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'x-hit-'+id,operation:'set',value:'1'}]},condition:{resourceTypes:['main_frame'],...condition}});
 const e=engineWith([
  modify(1,{responseHeaders:[{header:'X-Marker'}]}),                                                    // present, any value
  modify(2,{responseHeaders:[{header:'content-type',values:['text/*'],excludedValues:['text/plain*']}]}), // * and excludedValues
  modify(3,{excludedResponseHeaders:[{header:'content-type',values:['text/html*']}]}),                    // not for HTML
  modify(4,{responseHeaders:[{header:'content-type',values:['image/???p']}]}),                            // ? is zero or one character
  modify(5,{responseHeaders:[{header:'x-note',values:['50\\* off*']}]})                                    // \* is a star
 ]);
 const req={url:'https://site.test/',type:'main_frame'};
 const hit=headers=>{const out=e.headersReceived(req,headers)||{};return Object.keys(out).filter(k=>/^x-hit-/.test(k)).map(k=>k.slice(6)).sort().join(',');};
 assert.equal(hit({'X-Marker':['']}),'1,3','present with any value; no Content-Type, so rule 3 (not HTML) applies too');
 assert.equal(hit({'Content-Type':['text/css']}),'2,3');
 assert.equal(hit({'Content-Type':['TEXT/PLAIN; charset=utf-8']}),'3','excludedValues keeps rule 2 off');
 assert.equal(hit({'Content-Type':['text/html; charset=utf-8']}),'2','excludedResponseHeaders keeps rule 3 off');
 assert.equal(hit({'Content-Type':['image/webp']}),'3,4','three ? take three characters');
 assert.equal(hit({'content-type':['image/ebp']}),'3,4','a ? may take none');
 assert.equal(hit({'content-type':['image/p']}),'3,4');
 assert.equal(hit({'content-type':['image/xxxxp']}),'3','four characters are too many');
 assert.equal(hit({'X-Note':['50* off today']}),'3,5','an escaped star is a star');
 assert.equal(hit({'X-Note':['50 off today']}),'3','and not a wildcard');
 assert.equal(hit({'content-type':['text/html'],'X-Marker':['x']}),'1,2');
 assert.equal(hit({'Content-Type':['text/css','text/html']}),'2','a header repeated: one matching instance is enough for rule 2, and the text/html instance keeps rule 3 off');
});

test('responseHeaders condition: rules that need the response never act before it arrives, and bad conditions are rejected',()=>{
 const set={extensionId:EXT,source:'dynamic'};
 // a block rule with a response condition cannot block at request time (it would block every page)
 const e=engineWith([{id:1,priority:1,action:{type:'block'},condition:{urlFilter:'||site.test^',resourceTypes:['main_frame'],responseHeaders:[{header:'content-type',values:['application/pdf*']}]}}]);
 assert.equal(!!e.beforeRequest({url:'https://site.test/page.html',type:'main_frame'})?.cancel,false);
 assert.equal(!!e.beforeRequest({url:'https://site.test/a.pdf',type:'main_frame'})?.cancel,false);
 // a request-header rule with a response condition has nothing to test yet: Chromium refuses it (the request is long gone when the response comes)
 const f=engineWith([{id:1,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'x-a',operation:'set',value:'1'}]},condition:{resourceTypes:['main_frame'],responseHeaders:[{header:'content-type'}]}}]);
 assert.equal(f.beforeSendHeaders({url:'https://site.test/',type:'main_frame'},{}),null);
 assert.match(f.errors(EXT).join('\n'),/request headers/);
 for(const bad of [[],'content-type',[{}],[{header:''}],[{header:'content-type',values:'x'}],[{header:'content-type',excludedValues:[1]}],[{header:'bad name'}]])
  assert.throws(()=>compileRule({id:1,action:{type:'modifyHeaders',responseHeaders:[{header:'a',operation:'remove'}]},condition:{responseHeaders:bad}},set),/responseHeaders|header/i,JSON.stringify(bad));
 assert.throws(()=>compileRule({id:1,action:{type:'modifyHeaders',responseHeaders:[{header:'a',operation:'remove'}]},condition:{excludedResponseHeaders:[{values:['x']}]}},set),/excludedResponseHeaders|header/i);
});

// ---- 13.3: rules with response-header conditions, every action (Chromium: a rule with responseHeaders / excludedResponseHeaders is filed in the
// headers_received index and judged in onHeadersReceived — flat_ruleset_indexer.cc IsBeforeRequestRule, ruleset_manager.cc EvaluateRequestWithHeaders;
// the request phase's allow carries over, composite_matcher.cc GetAction lines 172-203). 13.2 only honoured the condition for modifyHeaders.
const PDF=[{header:'content-type',values:['application/pdf*']}],HTML=[{header:'content-type',values:['text/html*']}];
const late=(id,priority,action,more={})=>({id,priority,action,condition:{resourceTypes:['main_frame'],responseHeaders:PDF,...more}});
const PDF_HEADERS={'Content-Type':['application/pdf']},HTML_HEADERS={'Content-Type':['text/html; charset=utf-8']};
const nav=(url,more={})=>({url,type:'main_frame',...more});

test('response phase, block: a rule with a response-header condition blocks the response, never the request',()=>{
 const e=engineWith([late(1,1,{type:'block'},{urlFilter:'||site.test^'})]);
 const page=nav('https://site.test/a.pdf');
 assert.equal(e.beforeRequest(page),null,'nothing to judge before the response');
 assert.deepEqual(e.responseReceived(page,PDF_HEADERS),{cancel:true});
 assert.equal(e.responseReceived(page,HTML_HEADERS),null,'the header does not match: the response is let through');
 assert.equal(e.responseReceived(page,{}),null,'a response without the header does not match');
 assert.equal(e.responseReceived(nav('https://other.test/a.pdf'),PDF_HEADERS),null,'the URL condition still applies');
 assert.equal(e.responseReceived({url:'https://site.test/a.pdf',type:'script'},PDF_HEADERS),null,'and the resource types');
 assert.deepEqual(e.getMatchedRules(EXT).map(m=>m.rule.ruleId),[1],'the block is recorded as a matched rule');
 assert.equal(e.headersReceived(page,PDF_HEADERS),null,'headersReceived stays the header-rewriting entry point');
 assert.equal(e.hasResponseRules,true);assert.equal(e.hasHeaderRules,false);
 // a blocked response changes nothing else (ruleset_manager.cc: "If the request is blocked/redirected, no further modifications can happen")
 const both=engineWith([late(1,1,{type:'block'},{urlFilter:'||site.test^'}),{id:2,priority:9,action:{type:'modifyHeaders',responseHeaders:[{header:'x-m',operation:'set',value:'1'}]},condition:{urlFilter:'||site.test^',resourceTypes:['main_frame']}}]);
 assert.deepEqual(both.responseReceived(page,PDF_HEADERS),{cancel:true});
 assert.deepEqual(Object.keys(both.responseReceived(page,HTML_HEADERS).responseHeaders),['Content-Type','x-m'],'and where it does not match, the header rule applies');
});

test('response phase, redirect and upgradeScheme: the response is sent to another URL',()=>{
 const e=engineWith([
  late(1,1,{type:'redirect',redirect:{url:'https://viewer.example/open'}},{urlFilter:'||site.test/doc'}),
  late(2,1,{type:'redirect',redirect:{transform:{host:'mirror.test',queryTransform:{addOrReplaceParams:[{key:'via',value:'dnr'}]}}}},{urlFilter:'||site.test/move'}),
  late(3,1,{type:'redirect',redirect:{url:'https://site.test/same'}},{urlFilter:'||site.test/same'}),
  late(4,1,{type:'upgradeScheme'},{urlFilter:'||plain.test^',responseHeaders:HTML})
 ]);
 assert.deepEqual(e.responseReceived(nav('https://site.test/doc.pdf'),PDF_HEADERS),{redirectURL:'https://viewer.example/open'});
 assert.deepEqual(e.responseReceived(nav('https://site.test/move?x=1'),PDF_HEADERS),{redirectURL:'https://mirror.test/move?x=1&via=dnr'});
 assert.equal(e.responseReceived(nav('https://site.test/same'),PDF_HEADERS),null,'a redirect to the URL it came from is not a redirect');
 assert.deepEqual(e.responseReceived(nav('http://plain.test/a'),HTML_HEADERS),{redirectURL:'https://plain.test/a'});
 assert.equal(e.responseReceived(nav('https://plain.test/a'),HTML_HEADERS),null,'upgradeScheme only upgrades http');
 assert.equal(e.responseReceived(nav('http://plain.test/a'),PDF_HEADERS),null);
 assert.equal(e.beforeRequest(nav('http://plain.test/a')),null,'neither acts before the response');
 // Chrome never redirects a WebSocket handshake (ruleset_matcher_base.cc CreateRedirectAction)
 const ws=engineWith([late(1,1,{type:'redirect',redirect:{url:'https://x.example/'}},{resourceTypes:['websocket'],responseHeaders:[{header:'upgrade'}]})]);
 assert.equal(ws.responseReceived({url:'wss://site.test/socket',type:'websocket'},{Upgrade:['websocket']}),null);
});

test('response phase, allow: it lifts lower response-phase rules, and modifyHeaders rules at or below its priority',()=>{
 const e=engineWith([
  late(1,2,{type:'allow'},{urlFilter:'||site.test/keep'}),
  late(2,1,{type:'block'},{urlFilter:'||site.test^'}),
  late(3,2,{type:'block'},{urlFilter:'||tie.test^'}),
  late(4,2,{type:'allow'},{urlFilter:'||tie.test^'}),
  late(5,3,{type:'block'},{urlFilter:'||loud.test^'}),
  late(6,2,{type:'allow'},{urlFilter:'||loud.test^'})
 ]);
 assert.deepEqual(e.responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),{cancel:true});
 assert.equal(e.responseReceived(nav('https://site.test/keep/a.pdf'),PDF_HEADERS),null,'a higher allow beats the block');
 assert.equal(e.responseReceived(nav('https://tie.test/a.pdf'),PDF_HEADERS),null,'at equal priority allow beats block');
 assert.deepEqual(e.responseReceived(nav('https://loud.test/a.pdf'),PDF_HEADERS),{cancel:true},'a higher block beats the allow');
 assert.deepEqual(e.getMatchedRules(EXT).map(m=>m.rule.ruleId),[2,1,4,5],'each winning action is recorded, the losing ones are not');
 // the allow also removes the modifyHeaders rules of the request phase that it outranks (web_request_api: EraseOutprioritizedDNRActions)
 const m=(id,priority,more={})=>({id,priority,action:{type:'modifyHeaders',responseHeaders:[{header:'x-m'+id,operation:'set',value:'1'}]},condition:{resourceTypes:['main_frame'],urlFilter:'||m.test^',...more}});
 const f=engineWith([m(1,1),m(2,2),m(3,3),late(4,2,{type:'allow'},{urlFilter:'||m.test^'})]);
 assert.deepEqual(Object.keys(f.headersReceived(nav('https://m.test/a.pdf'),PDF_HEADERS)).sort(),['Content-Type','x-m3'],'priorities 1 and 2 are lifted, 3 stays');
 assert.deepEqual(Object.keys(f.headersReceived(nav('https://m.test/a.html'),HTML_HEADERS)).sort(),['Content-Type','x-m1','x-m2','x-m3'],'on a response the allow does not match, all three apply');
});

test('response phase, allowAllRequests: an allowed navigation response allowlists its document, up to its priority',()=>{
 const e=engineWith([
  late(1,2,{type:'allowAllRequests'},{urlFilter:'||trusted.test^',responseHeaders:HTML}),
  {id:2,priority:1,action:{type:'block'},condition:{urlFilter:'||ads.net^'}},
  {id:3,priority:5,action:{type:'block'},condition:{urlFilter:'||malware.net^'}}
 ]);
 const page=nav('https://trusted.test/',{tabId:1,frameKey:'wc:1'}),sub=url=>e.beforeRequest({url,type:'script',tabId:1,frameKeys:['wc:1']});
 assert.equal(e.beforeRequest(page),null);
 assert.deepEqual(sub('https://ads.net/a.js'),{cancel:true},'before the response nothing is allowed yet');
 assert.equal(e.responseReceived(page,HTML_HEADERS),null);
 assert.equal(sub('https://ads.net/a.js'),null,'after the matching response the document is allowed');
 assert.deepEqual(sub('https://malware.net/a.js'),{cancel:true},'a higher-priority block still applies');
 e.beforeRequest(nav('https://trusted.test/',{tabId:1,frameKey:'wc:1'}));
 e.responseReceived(nav('https://trusted.test/',{tabId:1,frameKey:'wc:1'}),PDF_HEADERS);
 assert.deepEqual(sub('https://ads.net/a.js'),{cancel:true},'a response without the header allows nothing');
 e.beforeRequest(nav('https://trusted.test/',{tabId:1,frameKey:'wc:1'}));e.responseReceived(nav('https://trusted.test/',{tabId:1,frameKey:'wc:1'}),HTML_HEADERS);
 e.beforeRequest(nav('https://elsewhere.test/',{tabId:1,frameKey:'wc:1'}));
 assert.deepEqual(sub('https://ads.net/a.js'),{cancel:true},'the next document starts fresh');
});

test('priority across the phases: a request-phase allow against a response-phase block, and the reverse',()=>{
 // Chrome: the request phase's allow stays in force and a response-phase action must have a HIGHER priority to count; a block in the request phase
 // ends the request before the response is ever judged, so a response-phase allow cannot rescue it.
 const e=engineWith([
  {id:1,priority:2,action:{type:'allow'},condition:{urlFilter:'||site.test/ok',resourceTypes:['main_frame']}},
  late(2,1,{type:'block'},{urlFilter:'||site.test^'}),
  late(3,3,{type:'block'},{urlFilter:'||site.test/loud'}),
  {id:4,priority:2,action:{type:'allow'},condition:{urlFilter:'||site.test/loud',resourceTypes:['main_frame']}},
  {id:5,priority:2,action:{type:'allow'},condition:{urlFilter:'||site.test/tie',resourceTypes:['main_frame']}},
  late(6,2,{type:'block'},{urlFilter:'||site.test/tie'})
 ]);
 const ruling=(path,headers=PDF_HEADERS)=>{const r=nav('https://site.test'+path);return e.beforeRequest(r)||e.responseReceived(r,headers);};
 assert.deepEqual(ruling('/a.pdf'),{cancel:true},'no allow: the response is blocked');
 assert.equal(ruling('/ok/a.pdf'),null,'request allow (2) beats response block (1)');
 assert.equal(ruling('/tie/a.pdf'),null,'at equal priority the request allow wins');
 assert.deepEqual(ruling('/loud/a.pdf'),{cancel:true},'a response block above the allow (3 > 2) wins');
 // the reverse: request-phase block against a response-phase allow
 const r=engineWith([
  {id:1,priority:1,action:{type:'block'},condition:{urlFilter:'||site.test^',resourceTypes:['main_frame']}},
  late(2,5,{type:'allow'},{urlFilter:'||site.test^'}),
  {id:3,priority:3,action:{type:'block'},condition:{urlFilter:'||x.test^',resourceTypes:['main_frame']}},
  late(4,3,{type:'allow'},{urlFilter:'||x.test^'})
 ]);
 assert.deepEqual(r.beforeRequest(nav('https://site.test/a.pdf')),{cancel:true},'the request is already blocked; the response never arrives');
 assert.deepEqual(r.beforeRequest(nav('https://x.test/a.pdf')),{cancel:true},'also at equal priority');
 // a response-phase redirect against a request-phase allow
 const t=engineWith([
  {id:1,priority:2,action:{type:'allow'},condition:{urlFilter:'||site.test/ok',resourceTypes:['main_frame']}},
  late(2,2,{type:'redirect',redirect:{url:'https://viewer.example/'}},{urlFilter:'||site.test^'}),
  late(3,3,{type:'redirect',redirect:{url:'https://viewer.example/hot'}},{urlFilter:'||site.test/ok/hot'})
 ]);
 assert.deepEqual(t.responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),{redirectURL:'https://viewer.example/'});
 assert.equal(t.responseReceived(nav('https://site.test/ok/a.pdf'),PDF_HEADERS),null,'the request-phase allow holds against the redirect');
 assert.deepEqual(t.responseReceived(nav('https://site.test/ok/hot.pdf'),PDF_HEADERS),{redirectURL:'https://viewer.example/hot'},'unless the redirect outranks it');
});

test('priority across the phases: a document allowAllRequests set at the request phase also covers response-phase rules of its subresources',()=>{
 const e=engineWith([
  {id:1,priority:4,action:{type:'allowAllRequests'},condition:{urlFilter:'||trusted.test^',resourceTypes:['main_frame']}},
  {id:2,priority:2,action:{type:'block'},condition:{urlFilter:'||files.test^',resourceTypes:['xmlhttprequest'],responseHeaders:PDF}},
  {id:3,priority:5,action:{type:'block'},condition:{urlFilter:'||strict.test^',resourceTypes:['xmlhttprequest'],responseHeaders:PDF}}
 ]);
 e.beforeRequest(nav('https://trusted.test/',{tabId:1,frameKey:'wc:1'}));
 const xhr=url=>({url,type:'xmlhttprequest',tabId:1,frameKeys:['wc:1']});
 assert.equal(e.responseReceived(xhr('https://files.test/a.pdf'),PDF_HEADERS),null,'allowAllRequests (4) outranks the response block (2)');
 assert.deepEqual(e.responseReceived(xhr('https://strict.test/a.pdf'),PDF_HEADERS),{cancel:true},'a response block at 5 outranks it');
 e.beforeRequest(nav('https://other.test/',{tabId:1,frameKey:'wc:1'}));
 assert.deepEqual(e.responseReceived(xhr('https://files.test/a.pdf'),PDF_HEADERS),{cancel:true},'another document is not covered');
});

test('priority across the phases: a response-phase allow outranks a request-phase modifyHeaders rule, whose request-header half was already sent',()=>{
 const mod=(priority)=>({id:priority,priority,action:{type:'modifyHeaders',requestHeaders:[{header:'x-asked-'+priority,operation:'set',value:'1'}],responseHeaders:[{header:'x-answer-'+priority,operation:'set',value:'1'}]},condition:{urlFilter:'||site.test^',resourceTypes:['main_frame']}});
 const e=engineWith([mod(1),mod(2),mod(3),late(10,2,{type:'allow'},{urlFilter:'||site.test^'})]);
 const r=nav('https://site.test/a.pdf');
 assert.deepEqual(Object.keys(e.beforeSendHeaders(r,{})).sort(),['x-asked-1','x-asked-2','x-asked-3'],'the request goes out before the response can say anything');
 assert.deepEqual(Object.keys(e.headersReceived(r,PDF_HEADERS)).sort(),['Content-Type','x-answer-3']);
 assert.deepEqual(Object.keys(e.headersReceived(r,HTML_HEADERS)).sort(),['Content-Type','x-answer-1','x-answer-2','x-answer-3'],'a response the allow does not match is modified by all');
});

test('response phase, allow: an allow that only repeats the request phase\'s is not recorded as a match (web_request: ShouldRecordMatchedAllowRuleInOnHeadersReceived)',()=>{
 const e=engineWith([{id:1,priority:2,action:{type:'allow'},condition:{urlFilter:'||site.test^',resourceTypes:['main_frame']}},late(2,2,{type:'allow'},{urlFilter:'||site.test^'}),late(3,3,{type:'allow'},{urlFilter:'||site.test/more'})]);
 const page=nav('https://site.test/a.pdf');
 assert.equal(e.beforeRequest(page),null);assert.equal(e.responseReceived(page,PDF_HEADERS),null);
 assert.deepEqual(e.getMatchedRules(EXT).map(m=>m.rule.ruleId),[1],'the response-phase allow at the same priority adds nothing');
 const more=nav('https://site.test/more/a.pdf');e.beforeRequest(more);e.responseReceived(more,PDF_HEADERS);
 assert.deepEqual(e.getMatchedRules(EXT).map(m=>m.rule.ruleId),[1,1,3],'one at a higher priority does');
});

test('response phase across extensions: block beats redirect beats allow, the newest extension wins a tie, an allow stays inside its own extension',()=>{
 const url='https://site.test/a.pdf',rule=(id,priority,action)=>({id,priority,action,condition:{urlFilter:'||site.test^',resourceTypes:['main_frame'],responseHeaders:PDF}});
 const build=(a,b)=>{const e=createDnrEngine();e.setExtension(EXT,{dynamicRules:a});e.setExtension(EXT2,{dynamicRules:b});return e;};
 assert.deepEqual(build([rule(1,9,{type:'allow'})],[rule(1,1,{type:'block'})]).responseReceived(nav(url),PDF_HEADERS),{cancel:true},'another extension\'s allow cannot lift a block');
 assert.deepEqual(build([rule(1,1,{type:'block'})],[rule(1,9,{type:'redirect',redirect:{url:'https://r.example/'}})]).responseReceived(nav(url),PDF_HEADERS),{cancel:true},'block beats redirect whatever the priorities');
 assert.deepEqual(build([rule(1,1,{type:'redirect',redirect:{url:'https://one.example/'}})],[rule(1,1,{type:'redirect',redirect:{url:'https://two.example/'}})]).responseReceived(nav(url),PDF_HEADERS),{redirectURL:'https://two.example/'},'the most recently installed extension wins');
 assert.deepEqual(build([rule(1,1,{type:'redirect',redirect:{url:'https://one.example/'}})],[rule(1,9,{type:'allow'})]).responseReceived(nav(url),PDF_HEADERS),{redirectURL:'https://one.example/'},'an allow in the newer extension does not stop the older one\'s redirect');
 // a modifyHeaders rule is lifted only by an allow of its own extension
 const modify={id:2,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'x-m',operation:'set',value:'1'}]},condition:{urlFilter:'||site.test^',resourceTypes:['main_frame']}};
 const own=createDnrEngine();own.setExtension(EXT,{dynamicRules:[modify,rule(1,5,{type:'allow'})]});
 assert.equal(own.headersReceived(nav(url),PDF_HEADERS),null);
 const other=createDnrEngine();other.setExtension(EXT,{dynamicRules:[modify]});other.setExtension(EXT2,{dynamicRules:[rule(1,5,{type:'allow'})]});
 assert.deepEqual(Object.keys(other.headersReceived(nav(url),PDF_HEADERS)),['Content-Type','x-m']);
});

test('response phase: static, dynamic and session rules all take part, and updates take effect at once',()=>{
 const rule=(id,priority,action,more={})=>late(id,priority,action,{urlFilter:'||site.test^',...more});
 const via={
  static:r=>{const e=createDnrEngine();e.setExtension(EXT,{rulesets:[{id:'r',enabled:true,rules:r}]});return e;},
  dynamic:r=>{const e=createDnrEngine();e.setExtension(EXT,{dynamicRules:r});return e;},
  session:r=>{const e=createDnrEngine();e.setExtension(EXT,{sessionRules:r});return e;}
 };
 for(const [name,make] of Object.entries(via)){
  assert.deepEqual(make([rule(1,1,{type:'block'})]).responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),{cancel:true},name+' block');
  assert.deepEqual(make([rule(1,1,{type:'redirect',redirect:{url:'https://r.example/'}})]).responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),{redirectURL:'https://r.example/'},name+' redirect');
  assert.equal(make([rule(1,1,{type:'block'})]).beforeRequest(nav('https://site.test/a.pdf')),null,name+': nothing at the request phase');
 }
 // the three kinds are one rule set for the priorities: a static allow and a session block, and the reverse
 const mixed=createDnrEngine();
 mixed.setExtension(EXT,{rulesets:[{id:'r',enabled:true,rules:[rule(1,2,{type:'allow'},{urlFilter:'||site.test/ok'}),rule(2,5,{type:'block'},{urlFilter:'||site.test/loud'})]}],
  dynamicRules:[rule(1,1,{type:'block'})],sessionRules:[rule(2,3,{type:'allow'},{urlFilter:'||site.test/session'})]});
 const ruling=path=>mixed.responseReceived(nav('https://site.test'+path),PDF_HEADERS);
 assert.deepEqual(ruling('/a.pdf'),{cancel:true},'dynamic block');
 assert.equal(ruling('/ok/a.pdf'),null,'static allow (2) beats dynamic block (1)');
 assert.equal(ruling('/session/a.pdf'),null,'session allow (3) beats dynamic block (1)');
 assert.deepEqual(ruling('/loud/a.pdf'),{cancel:true},'static block (5)');
 // updateRules (the extension calls chrome.declarativeNetRequest.updateSessionRules while the browser runs)
 const live=createDnrEngine();live.setExtension(EXT,{});
 assert.equal(live.hasResponseRules,false);assert.equal(live.responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),null);
 live.updateRules(EXT,'session',{addRules:[rule(7,1,{type:'block'})]});
 assert.equal(live.hasResponseRules,true);assert.deepEqual(live.responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),{cancel:true});
 live.updateRules(EXT,'session',{removeRuleIds:[7]});
 assert.equal(live.hasResponseRules,false);assert.equal(live.responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),null);
 // a static rule switched off by updateStaticRules, and a whole ruleset switched off
 const st=createDnrEngine();st.setExtension(EXT,{rulesets:[{id:'r',enabled:true,rules:[rule(1,1,{type:'block'})]}]});
 st.updateStaticRules(EXT,{rulesetId:'r',disableRuleIds:[1]});assert.equal(st.responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),null);
 st.updateStaticRules(EXT,{rulesetId:'r',enableRuleIds:[1]});assert.deepEqual(st.responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),{cancel:true});
 st.updateEnabledRulesets(EXT,{disableRulesetIds:['r']});assert.equal(st.responseReceived(nav('https://site.test/a.pdf'),PDF_HEADERS),null);
});

test('response phase and host access: value conditions on private headers need it, safelisted ones and presence do not; a redirect always does',()=>{
 const rule=(id,priority,action,responseHeaders)=>({id,priority,action,condition:{urlFilter:'||site.test^',resourceTypes:['main_frame'],responseHeaders}});
 const none={hostAccess:()=>false},all={hostAccess:()=>true};
 const csp=[{header:'x-frame-options',values:['deny']}],ctype=[{header:'content-type',values:['text/html*']}],present=[{header:'x-frame-options'}],gone=[{header:'content-type'}];
 const headers={'X-Frame-Options':['DENY'],'Content-Type':['text/html']};
 const verdict=(rules,access)=>{const e=engineWith(rules,access);return e.responseReceived(nav('https://site.test/a'),headers);};
 assert.equal(verdict([rule(1,1,{type:'block'},csp)],none),null,'the value of X-Frame-Options is private to an extension without host access');
 assert.deepEqual(verdict([rule(1,1,{type:'block'},csp)],all),{cancel:true});
 assert.deepEqual(verdict([rule(1,1,{type:'block'},ctype)],none),{cancel:true},'Content-Type values are CORS-safelisted');
 assert.deepEqual(verdict([rule(1,1,{type:'block'},present)],none),{cancel:true},'that a header exists is not private');
 assert.deepEqual(verdict([rule(1,1,{type:'block'},[{header:'content-encoding',values:['gzip']}])],none),null,'no Content-Encoding on this response');
 assert.deepEqual(verdict([rule(1,1,{type:'block'},[{header:'x-frame-options',excludedValues:['sameorigin']}])],none),null,'excludedValues is a value condition too');
 // a rule that cannot match is skipped, it does not mask the rules below it
 assert.deepEqual(verdict([rule(1,9,{type:'allow'},csp),rule(2,1,{type:'block'},ctype)],none),{cancel:true},'the unmatched allow (9) lifts nothing');
 assert.equal(verdict([rule(1,9,{type:'allow'},csp),rule(2,1,{type:'block'},ctype)],all),null,'with access it does');
 // a redirect needs host access to act; chosen without it, it is dropped and still masks the rules below it (CompositeMatcher::GetAction)
 const redirect=rule(1,5,{type:'redirect',redirect:{url:'https://r.example/'}},ctype),lower=rule(2,1,{type:'block'},ctype);
 assert.deepEqual(verdict([redirect,lower],all),{redirectURL:'https://r.example/'});
 assert.equal(verdict([redirect,lower],none),null);
 assert.deepEqual(verdict([rule(1,5,{type:'upgradeScheme'},ctype)],none),null,'(this response is https: nothing to upgrade)');
 const upgrade=engineWith([rule(1,5,{type:'upgradeScheme'},ctype)],none);
 assert.deepEqual(upgrade.responseReceived(nav('http://site.test/a'),headers),{redirectURL:'https://site.test/a'},'upgradeScheme needs no host access');
 // declarativeNetRequestWithHostAccess: every action needs it
 const strict=(access)=>{const e=engineWith([rule(1,1,{type:'block'},ctype)],{withHostAccess:true,hostAccess:()=>access});return e.responseReceived(nav('https://site.test/a'),headers);};
 assert.equal(strict(false),null);assert.deepEqual(strict(true),{cancel:true});
});

test('response header conditions follow Chromium: every value of a header counts, an empty value list is a presence test, bad rules are refused',()=>{
 const hit=(condition,headers)=>!!engineWith([{id:1,priority:1,action:{type:'block'},condition:{resourceTypes:['main_frame'],...condition}}]).responseReceived(nav('https://site.test/'),headers);
 // MatchesHeaderConditions (request_params.cc:98-146): one excluded value fails the entry whatever the other values say
 const both={'Set-Test':['a','b']};
 assert.equal(hit({responseHeaders:[{header:'set-test',values:['a']}]},both),true);
 assert.equal(hit({responseHeaders:[{header:'set-test',values:['a'],excludedValues:['b']}]},both),false,'b is excluded, so a header that carries b never matches');
 assert.equal(hit({responseHeaders:[{header:'set-test',excludedValues:['b']}]},both),false);
 assert.equal(hit({responseHeaders:[{header:'set-test',excludedValues:['c']}]},both),true,'only excludedValues given: any header without those values');
 assert.equal(hit({responseHeaders:[{header:'set-test',values:['c']},{header:'set-test',values:['b']}]},both),true,'the entries are alternatives');
 assert.equal(hit({responseHeaders:[{header:'set-test',values:[]}]},both),true,'an empty values list is not stored by Chromium: presence only');
 assert.equal(hit({responseHeaders:[{header:'set-test',values:[]}]},{}),false);
 assert.equal(hit({excludedResponseHeaders:[{header:'set-test'}]},both),false);
 assert.equal(hit({excludedResponseHeaders:[{header:'set-test',values:['c']}]},both),true);
 assert.equal(hit({responseHeaders:[{header:'x-a'}],excludedResponseHeaders:[{header:'x-b'}]},{'X-A':['1'],'X-B':['1']}),false,'excludedResponseHeaders takes precedence');
 const set={extensionId:EXT,source:'dynamic'},block={type:'block'};
 // indexed_rule.cc ValidateResponseHeadersForMatching
 assert.throws(()=>compileRule({id:1,action:block,condition:{responseHeaders:[{header:'x-a'}],excludedResponseHeaders:[{header:'x-a'}]}},set),/excludedResponseHeaders/,'required and excluded by name');
 assert.throws(()=>compileRule({id:1,action:block,condition:{responseHeaders:[{header:'x-a',values:['1']}],excludedResponseHeaders:[{header:'x-a'}]}},set),/excludedResponseHeaders/,'Chromium records every required name, with or without values');
 assert.doesNotThrow(()=>compileRule({id:1,action:block,condition:{responseHeaders:[{header:'x-a'}],excludedResponseHeaders:[{header:'x-a',values:['2']}]}},set),'an exclusion with values is a different condition');
 assert.throws(()=>compileRule({id:1,action:block,condition:{responseHeaders:[{header:'x-a',values:['a\nb']}]}},set),/header value/);
 // indexed_rule.cc:914-919 ERROR_RESPONSE_HEADER_RULE_CANNOT_MODIFY_REQUEST_HEADERS
 assert.throws(()=>compileRule({id:1,action:{type:'modifyHeaders',requestHeaders:[{header:'x-a',operation:'set',value:'1'}]},condition:{responseHeaders:[{header:'x-a'}]}},set),/request headers/);
 assert.doesNotThrow(()=>compileRule({id:1,action:{type:'modifyHeaders',responseHeaders:[{header:'x-a',operation:'set',value:'1'}]},condition:{responseHeaders:[{header:'x-a'}]}},set));
});

// Mister Download Manager 0.5.0 (background.js syncOpenedRule), as it installs it: session rules, declarativeNetRequestWithHostAccess + <all_urls>.
// Rule 1 makes the listed file types attachments; ids 2.. are `allow` rules (priority 2) for the sites the user excluded; `*.example.com` entries
// become excludedRequestDomains. 13.2 fixed the rule hitting every page; 13.3 moved the response-header rules into their own index, so it must not change.
const MDM_TYPES=['application/pdf','audio/mpeg','audio/mp3','video/mp4','audio/mp4','audio/x-m4a','video/x-m4v','audio/ogg','video/ogg','audio/wav','audio/x-wav','audio/wave','audio/aac','video/quicktime','image/tiff','audio/x-ms-wma','video/x-ms-wmv','video/x-msvideo','video/avi','video/x-matroska'];
const mdmRules=({wide=[],exact=[]}={})=>[
 {id:1,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'content-disposition',operation:'set',value:'attachment'}]},
  condition:{resourceTypes:['main_frame'],responseHeaders:[{header:'content-type',values:MDM_TYPES.map(m=>m+'*')}],...(wide.length?{excludedRequestDomains:wide}:{})}},
 ...exact.map((host,i)=>({id:2+i,priority:2,action:{type:'allow'},condition:{resourceTypes:['main_frame'],regexFilter:'^[a-z]+://'+host.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(:[0-9]+)?/'}}))
];
const mdmEngine=(opts)=>{const e=createDnrEngine();e.setExtension(EXT,{sessionRules:mdmRules(opts),withHostAccess:true,hostAccess:()=>true});return e;};

test('regression guard: Mister Download Manager\'s real rule set only ever touches the files it names',()=>{
 const e=mdmEngine({wide:['cdn.example.org'],exact:['docs.example.com']});
 assert.deepEqual(e.getRules(EXT,'session').map(r=>r.id),[1,2],'both session rules compiled');
 assert.deepEqual(e.errors(EXT),[]);
 const page=url=>nav(url);
 // every page a browser opens stays a page, at both phases
 for(const [url,headers] of [['https://www.google.com/search?q=hello',{'content-type':['text/html; charset=UTF-8']}],['https://x.test/logo.webp',{'content-type':['image/webp']}],['https://x.test/app',{'content-type':['application/json']}],['https://x.test/empty',{}],['https://x.test/a.svg',{'Content-Type':['image/svg+xml']}]]){
  assert.equal(e.beforeRequest(page(url)),null,url);
  assert.equal(e.responseReceived(page(url),headers),null,url);
  assert.equal(e.beforeSendHeaders(page(url),{Accept:'*/*'}),null,url);
 }
 // the listed types become attachments, whatever the case or parameters, and nothing else changes
 for(const type of MDM_TYPES){
  const out=e.responseReceived(page('https://files.example.net/f'),{'Content-Type':[type.toUpperCase()+'; x=1'],Server:['s']});
  assert.deepEqual(out,{responseHeaders:{'Content-Type':[type.toUpperCase()+'; x=1'],Server:['s'],'content-disposition':['attachment']}},type);
 }
 // a main-frame rule: the same PDF as a script or image is not touched
 assert.equal(e.responseReceived({url:'https://files.example.net/f.pdf',type:'image'},PDF_HEADERS),null);
 // the user's excluded sites keep opening in the browser: a wide entry through excludedRequestDomains, an exact one through the priority-2 allow
 assert.equal(e.responseReceived(page('https://cdn.example.org/f.pdf'),PDF_HEADERS),null,'excluded domain');
 assert.equal(e.responseReceived(page('https://eu.cdn.example.org/f.pdf'),PDF_HEADERS),null,'and its subdomains');
 assert.equal(e.responseReceived(page('https://docs.example.com/f.pdf'),PDF_HEADERS),null,'excluded host (allow beats modifyHeaders)');
 assert.equal(e.responseReceived(page('https://docs.example.com:8443/f.pdf'),PDF_HEADERS),null,'with a port');
 assert.deepEqual(Object.keys(e.responseReceived(page('https://www.example.com/f.pdf'),PDF_HEADERS).responseHeaders),['Content-Type','content-disposition'],'another host on the same domain is not excluded');
 // never a block, a redirect or a cancel
 for(const url of ['https://files.example.net/f','https://docs.example.com/f','https://cdn.example.org/f'])for(const headers of [PDF_HEADERS,HTML_HEADERS,{}])
  assert.ok(!('cancel' in (e.responseReceived(page(url),headers)||{}))&&!('redirectURL' in (e.responseReceived(page(url),headers)||{})));
 // without host access the extension changes nothing (declarativeNetRequestWithHostAccess)
 const locked=createDnrEngine();locked.setExtension(EXT,{sessionRules:mdmRules(),withHostAccess:true,hostAccess:()=>false});
 assert.equal(locked.responseReceived(page('https://files.example.net/f'),PDF_HEADERS),null);
 // the rule set it removes when the user pauses it (updateSessionRules with an empty list) stops acting at once
 e.updateRules(EXT,'session',{removeRuleIds:[1,2]});
 assert.equal(e.responseReceived(page('https://files.example.net/f'),PDF_HEADERS),null);
 assert.equal(e.hasResponseRules,false);
});
