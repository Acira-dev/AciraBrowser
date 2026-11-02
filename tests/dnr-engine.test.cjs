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
