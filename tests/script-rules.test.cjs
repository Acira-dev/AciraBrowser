'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path');
const {createScriptRules,scriptPolicyPatch,siteOfUrl,siteFromInput,SCRIPT_POLICY,SANDBOX_FLAGS,LIMIT}=require('../desktop/browser-services/script-rules.cjs');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');

// Per-site script blocking (desktop/browser-services/script-rules.cjs): which site a page is, which documents get the policy header, what is saved, how private and
// Tor sessions differ, and the two guards for a document served without the header (service workers, the back/forward cache).
function fakeDatabase(){
 const rows=new Map();
 return {rows,policy:(profile,site)=>rows.get(profile+'|'+site)||null,setPolicy:(profile,site,value)=>{rows.set(profile+'|'+site,value);},deletePolicy:(profile,site)=>{rows.delete(profile+'|'+site);},
  policies:profile=>[...rows].filter(([key])=>key.startsWith(profile+'|')).map(([key,value])=>({site:key.slice(profile.length+1),...value}))};
}
function fixture({privateMode=false,source,tor=false,profileId=privateMode?'private-tab-1':'p1'}={}){
 const database=fakeDatabase(),cleared=[];
 const rules=createScriptRules({database,getOwner:wc=>wc.tab!==false,contentsOf:details=>details.wc||null,clearServiceWorkers:async(session,origin)=>{cleared.push(origin);}});
 const session=new EventEmitter();session.serviceWorkers=new EventEmitter();if(tor)session.__aciraTor=true;
 rules.attach(session,{profileId,privateMode,sourceProfileId:source});
 return {rules,database,cleared,session};
}
const page=(url='https://www.example.com/a')=>Object.assign(new EventEmitter(),{id:7,url,getURL(){return this.url;},isDestroyed:()=>false,reloads:0,reload(){this.reloads++;}});
const response=(wc,url,extra={})=>({resourceType:'mainFrame',url,wc,responseHeaders:{'content-type':['text/html; charset=utf-8']},...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a site is its registrable domain, which covers subdomains; private suffixes, IPs and localhost stand alone; only web pages count',()=>{
 assert.equal(siteOfUrl('https://www.example.com/a?b=1#c'),'example.com');
 assert.equal(siteOfUrl('http://a.b.example.co.uk:8080/'),'example.co.uk');
 assert.equal(siteOfUrl('https://alice.github.io/page'),'alice.github.io','a github.io page is its own site');
 assert.equal(siteOfUrl('https://bob.github.io/'),'bob.github.io');
 assert.equal(siteOfUrl('http://192.168.0.5:3000/'),'192.168.0.5');
 assert.equal(siteOfUrl('http://localhost:5173/'),'localhost');
 assert.equal(siteOfUrl('http://intranet/'),'intranet');
 for(const other of ['acira://settings','file:///tmp/a.html','about:blank','chrome://gpu','data:text/html,x','not a url',''])assert.equal(siteOfUrl(other),'',other);
});

test('what Settings accepts: a host, a wildcard or an address all name the site; anything else is refused with a plain sentence',()=>{
 assert.equal(siteFromInput('mail.example.com'),'example.com');
 assert.equal(siteFromInput('  HTTPS://Mail.Example.com/inbox?x=1#y '),'example.com');
 assert.equal(siteFromInput('*.example.com'),'example.com');
 assert.equal(siteFromInput('example.com:8080/path'),'example.com');
 assert.equal(siteFromInput('localhost'),'localhost');
 assert.equal(siteFromInput('10.0.0.1'),'10.0.0.1');
 for(const bad of ['','   ','not a site!','mail','exa mple.com','-bad.example','a..b','https://','x'.repeat(260)+'.com'])assert.throws(()=>siteFromInput(bad),/Enter a site such as mail\.example\.com\./,JSON.stringify(bad));
});

test('the policy: sandbox without allow-scripts plus script-src none, added beside the site\'s own policy, on HTML documents only',()=>{
 assert.doesNotMatch(SCRIPT_POLICY,/allow-scripts/);
 assert.ok(SANDBOX_FLAGS.includes('allow-same-origin')&&SANDBOX_FLAGS.includes('allow-forms')&&SANDBOX_FLAGS.includes('allow-popups')&&SANDBOX_FLAGS.includes('allow-downloads'),'forms, links, pop-ups, downloads and the site\'s own origin keep working');
 assert.match(SCRIPT_POLICY,/; script-src 'none'; object-src 'none'$/);
 const html=scriptPolicyPatch(response(null,'https://example.com/'),true);
 assert.deepEqual(html.responseHeaders['Content-Security-Policy'],[SCRIPT_POLICY]);
 assert.equal(html.responseHeaders['content-type'][0],'text/html; charset=utf-8','the other headers stay');
 const own=scriptPolicyPatch(response(null,'https://example.com/',{responseHeaders:{'content-type':['text/html'],'content-security-policy':["default-src 'self'"]}}),true);
 assert.deepEqual(own.responseHeaders['content-security-policy'],["default-src 'self'",SCRIPT_POLICY],'added after the site\'s own policy, under its own header name');
 assert.equal(Object.keys(own.responseHeaders).filter(key=>/content-security-policy/i.test(key)).length,1);
 assert.deepEqual(scriptPolicyPatch(response(null,'https://example.com/',{resourceType:'subFrame'}),true).responseHeaders['Content-Security-Policy'],[SCRIPT_POLICY],'frames of a blocked page too');
 assert.ok(scriptPolicyPatch(response(null,'https://example.com/',{responseHeaders:{}}),true).responseHeaders,'no content type: Chromium decides, the page is treated as a document');
 assert.deepEqual(scriptPolicyPatch(response(null,'https://example.com/a.xhtml',{responseHeaders:{'Content-Type':'application/xhtml+xml'}}),true).responseHeaders['Content-Security-Policy'],[SCRIPT_POLICY]);
 for(const type of ['application/pdf','image/png','application/json','text/plain','video/mp4'])assert.deepEqual(scriptPolicyPatch(response(null,'https://example.com/x',{responseHeaders:{'content-type':[type]}}),true),{},type+' is left alone: a PDF in a sandboxed document would not open');
 assert.deepEqual(scriptPolicyPatch(response(null,'https://example.com/x',{responseHeaders:{'content-type':['text/html'],'content-disposition':['attachment; filename=a.html']}}),true),{},'a download');
 assert.deepEqual(scriptPolicyPatch(response(null,'https://example.com/',{resourceType:'script'}),true),{});
 assert.deepEqual(scriptPolicyPatch(response(null,'ftp://example.com/'),true),{});
 assert.deepEqual(scriptPolicyPatch(response(null,'https://example.com/'),false),{},'a site that is not blocked');
 assert.deepEqual(scriptPolicyPatch({resourceType:'mainFrame',url:'https://example.com/'},true),{},'no headers to add to');
});

test('default mode: the switch saves a row for the site, turning it off removes the row, other sites are untouched',()=>{
 const {rules,database,session}=fixture();
 assert.equal(rules.statusOf(session,'https://www.example.com/').blocked,false);
 const on=rules.set(session,'https://www.example.com/a',true);
 assert.deepEqual(on,{supported:true,site:'example.com',blocked:true,mode:'default',saved:true});
 assert.deepEqual(database.rows.get('p1|scripts:example.com'),{scripts:'block'});
 assert.equal(rules.statusOf(session,'https://shop.example.com/').blocked,true,'a subdomain follows the site');
 assert.equal(rules.statusOf(session,'https://example.org/').blocked,false,'another site does not');
 assert.equal(rules.statusOf(session,'http://example.com:8080/x').blocked,true,'any scheme and port');
 rules.set(session,'https://example.com/',false);
 assert.equal(database.rows.has('p1|scripts:example.com'),false,'switching off removes the row');
 assert.equal(rules.statusOf(session,'https://www.example.com/').blocked,false);
});

test('"block everywhere": blocked unless the site is allowed; the switch still means "scripts blocked here"; both lists survive a mode change',()=>{
 const {rules,database,session}=fixture();
 rules.set(session,'https://news.example.com/',true);
 rules.setProfile('p1',{mode:'everywhere'});
 assert.equal(rules.statusOf(session,'https://other.org/').blocked,true,'every site is blocked');
 assert.equal(rules.statusOf(session,'https://other.org/').mode,'everywhere');
 const allowed=rules.set(session,'https://mail.other.org/',false);
 assert.equal(allowed.blocked,false);assert.deepEqual(database.rows.get('p1|scripts:other.org'),{scripts:'allow'});
 assert.equal(rules.statusOf(session,'https://www.other.org/').blocked,false,'subdomains of an allowed site run scripts');
 assert.deepEqual(rules.profileStatus('p1'),{mode:'everywhere',blocked:['example.com'],allowed:['other.org'],limit:LIMIT},'the blocked list is kept while it does not matter');
 rules.set(session,'https://other.org/',true);
 assert.equal(database.rows.has('p1|scripts:other.org'),false,'blocking an allowed site again removes its row');
 rules.set(session,'https://other.org/',false);
 rules.setProfile('p1',{mode:'default'});
 assert.deepEqual(rules.profileStatus('p1'),{mode:'default',blocked:['example.com'],allowed:['other.org'],limit:LIMIT});
 assert.equal(rules.statusOf(session,'https://other.org/').blocked,false,'default mode: the allow row means nothing');
 assert.equal(rules.statusOf(session,'https://example.com/').blocked,true);
 assert.equal(database.rows.has('p1|scripts:*'),false,'the mode row goes when the mode is off');
});

test('Settings: a list replaces the saved one, sites are normalised and de-duplicated, a bad site refuses the whole change, the limit holds',()=>{
 const {rules,database}=fixture();
 let status=rules.setProfile('p1',{blocked:['mail.example.com','https://WWW.example.com/x','example.org']});
 assert.deepEqual(status.blocked,['example.com','example.org'],'mail.example.com and www.example.com are one site');
 status=rules.setProfile('p1',{blocked:['example.org']});
 assert.deepEqual(status.blocked,['example.org']);assert.equal(database.rows.has('p1|scripts:example.com'),false,'a removed site loses its row');
 assert.throws(()=>rules.setProfile('p1',{blocked:['example.org','not a site!']}),/Enter a site/);
 assert.deepEqual(rules.profileStatus('p1').blocked,['example.org'],'nothing changed');
 assert.throws(()=>rules.setProfile('p1',{blocked:Array.from({length:LIMIT+1},(_,i)=>`s${i}.example${i}.com`)}),/The list is full/);
 assert.throws(()=>rules.setProfile('p1',{mode:'sometimes'}),/Choose how scripts are blocked/);
 assert.throws(()=>rules.setProfile('p1',{other:1}),/Invalid script choice/);
 assert.throws(()=>rules.setProfile('p1',[]),/Invalid script choice/);
 assert.throws(()=>rules.setProfile('private-tab-1',{mode:'everywhere'}),/ordinary local profile/);
 // a site moves from the allowed list to the blocked list when it is added there
 rules.setProfile('p1',{allowed:['example.net']});
 status=rules.setProfile('p1',{blocked:['example.org','example.net']});
 assert.deepEqual(status,{mode:'default',blocked:['example.net','example.org'],allowed:[],limit:LIMIT});
});

test('the per-site switch refuses a 101st site, but a site already in the list can always change',()=>{
 const {rules,database,session}=fixture();
 for(let i=0;i<LIMIT;i++)database.setPolicy('p1','scripts:s'+i+'.example.com',{scripts:'block'});
 assert.throws(()=>rules.set(session,'https://extra.example.org/',true),/The list is full/);
 assert.doesNotThrow(()=>rules.set(session,'https://s5.example.com/',false));
});

test('profile rows stay per profile, and removing a profile\'s rows leaves another profile alone',()=>{
 const one=fixture(),database=one.database;
 one.rules.set(one.session,'https://example.com/',true);
 const second=new EventEmitter();second.serviceWorkers=new EventEmitter();
 one.rules.attach(second,{profileId:'p2'});
 assert.equal(one.rules.statusOf(second,'https://example.com/').blocked,false,'another profile has its own list');
 assert.deepEqual(one.rules.profileStatus('p2').blocked,[]);
 assert.ok(database.rows.has('p1|scripts:example.com'));
});

test('headers: a blocked site\'s main frame gets the policy and a stamp; frames follow the top page; non-tabs and open sites get nothing',()=>{
 const {rules,session}=fixture();
 const wc=page();rules.set(session,wc.url,true);
 const main=rules.headers(response(wc,'https://www.example.com/a'),session);
 assert.deepEqual(main.responseHeaders['Content-Security-Policy'],[SCRIPT_POLICY]);
 const frame=rules.headers(response(wc,'https://ads.other.net/frame',{resourceType:'subFrame',frame:{top:{url:'https://www.example.com/a'}}}),session);
 assert.deepEqual(frame.responseHeaders['Content-Security-Policy'],[SCRIPT_POLICY],'a third-party frame inside a blocked page runs no scripts either');
 const open=page('https://news.org/');
 assert.deepEqual(rules.headers(response(open,'https://news.org/'),session),{},'an open site');
 assert.deepEqual(rules.headers(response(open,'https://frames.example.net/',{resourceType:'subFrame',frame:{top:{url:'https://news.org/'}}}),session),{},'a frame of an open page');
 assert.deepEqual(rules.headers(response({...wc,tab:false},'https://www.example.com/a'),session),{},'not one of the browser\'s tabs');
 assert.deepEqual(rules.headers(response(null,'https://www.example.com/a'),session),{},'no page');
 assert.deepEqual(rules.headers({...response(wc,'https://www.example.com/a'),resourceType:'script'},session),{});
});

test('a private session reads its source profile\'s rules, keeps its own changes in memory and never writes them to the profile',()=>{
 const database=fakeDatabase();
 const rules=createScriptRules({database,contentsOf:details=>details.wc||null});
 const ordinary=new EventEmitter();ordinary.serviceWorkers=new EventEmitter();rules.attach(ordinary,{profileId:'p1'});
 rules.set(ordinary,'https://example.com/',true);
 const privateSession=new EventEmitter();privateSession.serviceWorkers=new EventEmitter();
 rules.attach(privateSession,{profileId:'private-tab-9',privateMode:true,sourceProfileId:'p1'});
 const before=JSON.stringify([...database.rows]);
 assert.equal(rules.statusOf(privateSession,'https://www.example.com/').blocked,true,'follows the profile\'s list');
 assert.equal(rules.statusOf(privateSession,'https://www.example.com/').saved,false);
 const off=rules.set(privateSession,'https://www.example.com/',false);
 assert.equal(off.blocked,false,'turned off for this private session');
 assert.equal(rules.statusOf(ordinary,'https://example.com/').blocked,true,'the profile is unchanged');
 rules.set(privateSession,'https://news.org/',true);
 assert.equal(rules.statusOf(privateSession,'https://news.org/').blocked,true);
 assert.equal(JSON.stringify([...database.rows]),before,'nothing about private browsing reaches the database');
 assert.equal(rules.statusOf(ordinary,'https://news.org/').blocked,false);
 rules.setProfile('p1',{mode:'everywhere'});
 assert.equal(rules.statusOf(privateSession,'https://other.org/').blocked,true,'follows "block everywhere" too');
 assert.throws(()=>rules.setProfile('private-tab-9',{mode:'default'}),/ordinary local profile/);
 // no source (a private window opened with no ordinary window): nothing is blocked, the switch still works for the session
 const loose=new EventEmitter();loose.serviceWorkers=new EventEmitter();rules.attach(loose,{profileId:'private-window',privateMode:true});
 assert.equal(rules.statusOf(loose,'https://example.com/').blocked,false);
 // a source that is itself private is ignored
 const odd=new EventEmitter();odd.serviceWorkers=new EventEmitter();rules.attach(odd,{profileId:'private-tab-2',privateMode:true,sourceProfileId:'private-tab-1'});
 assert.equal(rules.statusOf(odd,'https://example.com/').blocked,false);
});

test('a private session is pointed at its source profile after it is attached, once, and never at a private one',()=>{
 const database=fakeDatabase(),rules=createScriptRules({database,contentsOf:details=>details.wc||null});
 const ordinary=new EventEmitter();ordinary.serviceWorkers=new EventEmitter();rules.attach(ordinary,{profileId:'p1'});rules.set(ordinary,'https://example.com/',true);
 const priv=new EventEmitter();priv.serviceWorkers=new EventEmitter();rules.attach(priv,{profileId:'private-tab-1',privateMode:true});
 assert.equal(rules.statusOf(priv,'https://example.com/').blocked,false,'no source yet');
 rules.follow(priv,'private-tab-0');rules.follow(priv,'');rules.follow(priv,undefined);
 assert.equal(rules.statusOf(priv,'https://example.com/').blocked,false,'a private profile is no source');
 rules.follow(priv,'p1');
 assert.equal(rules.statusOf(priv,'https://example.com/').blocked,true);
 rules.follow(priv,'p2');
 assert.equal(rules.statusOf(priv,'https://example.com/').blocked,true,'the first source stays');
 rules.follow(ordinary,'p2');assert.equal(rules.statusOf(ordinary,'https://example.com/').blocked,true,'an ordinary session ignores it');
});

test('Tor keeps its own security levels: no rules, no header, no switch, whatever the profile says',()=>{
 const {rules,session}=fixture({tor:true,privateMode:true,source:'p1'});
 const wc=page();
 assert.equal(rules.statusOf(session,'https://example.com/').supported,false);
 assert.throws(()=>rules.set(session,'https://example.com/',true),/Tor security level/);
 assert.deepEqual(rules.headers(response(wc,'https://example.com/'),session),{});
 assert.equal(rules.blockedOn(session,'https://example.com/'),false);
 const flagged=fixture();flagged.session[Symbol.for('acira.tor.session')]=true;
 assert.equal(flagged.rules.statusOf(flagged.session,'https://example.com/').supported,false,'the flag Tor sets on its sessions is honoured at every call');
});

test('the status says plainly what it cannot cover: Acira pages, other schemes',()=>{
 const {rules,session}=fixture();
 for(const url of ['acira://settings','about:blank','file:///a.html'])assert.deepEqual(rules.statusOf(session,url),{supported:false,site:'',blocked:false,mode:'default',saved:false},url);
 assert.throws(()=>rules.set(session,'acira://settings',true),/Open a website first/);
 assert.throws(()=>rules.set(session,'https://example.com/','yes'),/Choose on or off/);
});

test('service workers: cleared when a site becomes blocked, when one registers on a blocked site, and for the sites a list or the mode newly blocks',async()=>{
 const {rules,cleared,session}=fixture();
 rules.set(session,'https://www.example.com/a',true);await tick();
 assert.deepEqual(cleared,['https://www.example.com'],'the page\'s own origin, when the switch goes on');
 cleared.length=0;
 rules.set(session,'https://www.example.com/a',true);await tick();
 assert.deepEqual(cleared,[],'nothing new, nothing cleared');
 session.serviceWorkers.emit('registration-completed',{},{scope:'https://app.example.com/'});await tick();
 assert.deepEqual(cleared,['https://app.example.com'],'a worker that registers on a blocked site');
 cleared.length=0;
 session.serviceWorkers.emit('registration-completed',{},{scope:'https://open.org/'});await tick();
 assert.deepEqual(cleared,[],'an open site keeps its worker');
 rules.setProfile('p1',{blocked:['example.com','news.net']});await tick();
 assert.deepEqual(cleared.sort(),['https://news.net','https://www.news.net'],'a site added in Settings: its usual origins');
 cleared.length=0;
 rules.setProfile('p1',{mode:'everywhere'});await tick();
 assert.deepEqual(cleared,[null],'every worker of the profile when "block everywhere" goes on');
 cleared.length=0;
 rules.setProfile('p1',{allowed:['news.org']});await tick();
 rules.setProfile('p1',{allowed:[]});await tick();
 assert.deepEqual(cleared,['https://news.org','https://www.news.org'],'an allowed site that loses its allowance is blocked again');
 const priv=fixture({privateMode:true,source:'p1'});
 priv.rules.set(priv.session,'https://private.example.net/',true);await tick();
 assert.deepEqual(priv.cleared,['https://private.example.net'],'a private session clears its own workers');
});

test('an address that is not a real origin is never handed to the engine (it would clear every service worker), and IPs and single-label hosts get no www',async()=>{
 const {rules,cleared}=fixture();
 rules.setProfile('p1',{blocked:['127.0.0.1','localhost','example.com']});await tick();
 assert.deepEqual(cleared.sort(),['https://127.0.0.1','https://example.com','https://localhost','https://www.example.com'].sort(),'www. only for a registered domain, never for an IP address or localhost');
 for(const origin of cleared)assert.ok(origin===new URL(origin).origin,origin+' is a plain origin');
 const odd=fixture();odd.rules.setProfile('p1',{blocked:['127.0.0.1']});await tick();
 assert.ok(!odd.cleared.includes('https://www.127.0.0.1'));
});

test('a page that commits without the header (service worker, back/forward cache) is reloaded once; a handled one, an open site and a second look are left alone',async()=>{
 const {rules,cleared,session}=fixture();
 const wc=page('https://www.example.com/a');rules.set(session,wc.url,true);await tick();cleared.length=0;
 rules.watch(session,wc);rules.watch(session,wc);
 assert.equal(wc.listenerCount('did-navigate'),1,'watched once');
 // handled: the header was added to this response, then the page commits
 rules.headers(response(wc,'https://www.example.com/a'),session);
 wc.emit('did-navigate',{}, 'https://www.example.com/a#top');await tick();
 assert.equal(wc.reloads,0);
 // served with no header: Back to a page of the cache, or a worker's answer
 wc.url='https://www.example.com/b';wc.emit('did-navigate',{}, wc.url);await tick();await tick();
 assert.deepEqual(cleared,['https://www.example.com'],'its workers are cleared first');
 assert.equal(wc.reloads,1,'then the page loads again through the network, with the header');
 // the reload that follows is handled
 rules.headers(response(wc,wc.url),session);wc.emit('did-navigate',{},wc.url);await tick();
 assert.equal(wc.reloads,1);
 // if the reload comes back without the header too, it stops there
 wc.url='https://www.example.com/c';wc.emit('did-navigate',{},wc.url);await tick();await tick();
 assert.equal(wc.reloads,2);
 wc.emit('did-navigate',{},wc.url);await tick();await tick();
 assert.equal(wc.reloads,2,'one reload for a page, never a loop');
 // an open site and a page that is not a website
 wc.url='https://news.org/';wc.emit('did-navigate',{},wc.url);wc.url='acira://settings';wc.emit('did-navigate',{},wc.url);await tick();
 assert.equal(wc.reloads,2);
 // closing the page forgets it
 wc.emit('destroyed');
 const again=page();rules.watch(session,again);assert.equal(again.listenerCount('did-navigate'),1);
});

test('a page that moved on before the repair does not get reloaded',async()=>{
 const {rules,session}=fixture();
 const wc=page('https://www.example.com/a');rules.set(session,wc.url,true);rules.watch(session,wc);
 wc.emit('did-navigate',{},wc.url);wc.url='https://elsewhere.org/';await tick();await tick();
 assert.equal(wc.reloads,0);
});

test('the real database keeps and removes script rows beside the other site choices',()=>{
 const {BrowserDatabase}=require('../desktop/database.cjs'),os=require('node:os');
 const base=path.join('/tmp/acira-qa/script-blocking','db-'+process.pid);fs.mkdirSync(base,{recursive:true});
 const db=new BrowserDatabase(path.join(base,'browser.sqlite'));
 try{
  db.setPolicy('p1','https://example.com',{blocking:false});
  const rules=createScriptRules({database:db,contentsOf:details=>details.wc||null});
  const session=new EventEmitter();session.serviceWorkers=new EventEmitter();rules.attach(session,{profileId:'p1'});
  rules.set(session,'https://example.com/',true);rules.set(session,'https://other.org/',true);
  rules.setProfile('p1',{mode:'everywhere'});
  assert.deepEqual(rules.profileStatus('p1'),{mode:'everywhere',blocked:['example.com','other.org'],allowed:[],limit:LIMIT});
  assert.deepEqual(db.policy('p1','scripts:example.com'),{scripts:'block'});
  assert.deepEqual(db.policy('p1','https://example.com'),{blocking:false},'the origin\'s protection choice is untouched');
  rules.setProfile('p1',{mode:'default',blocked:[]});
  assert.equal(db.policy('p1','scripts:example.com'),null,'deleted, not left empty');
  assert.equal(db.policy('p1','scripts:*'),null);
  assert.deepEqual(db.policies('p1').map(row=>row.site),['https://example.com']);
  db.removeProfile('p1');
  assert.deepEqual(db.policies('p1'),[]);
 }finally{db.close();fs.rmSync(base,{recursive:true,force:true});}
});

test('wiring: the header hook, the service requests, the private source and the Tor guard are in place',()=>{
 const blocking=read('desktop/content-blocking.cjs'),main=read('desktop/main.cjs'),database=read('desktop/database.cjs');
 assert.match(blocking,/require\('\.\/browser-services\/script-rules\.cjs'\)/);
 assert.match(blocking,/function attach\(session,profileId,privateMode\)\{/,'attach keeps its signature');
 assert.match(blocking,/scriptRules\.attach\(session,\{profileId,privateMode\}\);/);
 assert.match(blocking,/scripts:\{follow:\(session,sourceProfileId\)=>scriptRules\.follow\(session,sourceProfileId\)/);
 assert.match(blocking,/pipeline\.useHeaders\(details=>scriptRules\.headers\(details,session\)\);/);
 assert.match(blocking,/scriptRules\.watch\(session,wc\)/,'every tab is watched for a page that arrives without the header');
 assert.match(blocking,/contexts\.delete\(session\);scriptRules\.release\(session\);/);
 assert.match(blocking,/clearStorageData\(origin\?\{origin,storages:\['serviceworkers'\]\}:\{storages:\['serviceworkers'\]\}\)/);
 assert.match(blocking,/scripts:\{follow:[^}]*\}?[^]*?,status:wc=>/);
 assert.match(database,/deletePolicy\(profile,site\)\{this\.db\.prepare\('DELETE FROM policies WHERE profile_id=\? AND site=\?'\)/);
 for(const type of ['scripts.status','scripts.set','scripts.profile-status','scripts.profile-set'])assert.match(main,new RegExp(`case '${type.replace('.','\\.')}'`),type);
 assert.match(main,/torMode\|\|tab\.privacy==='tor'\)return \{scripts:\{supported:false/,'Tor tabs answer "not supported" and nothing is saved');
 assert.match(main,/if\(privateMode\|\|torMode\|\|!profile\|\|profile\.private\)throw new Error\('Open a regular profile to change script choices'\)/);
 assert.match(main,/languageOptions\.inheritProfileId&&!String\(languageOptions\.inheritProfileId\)\.startsWith\('private-'\)/,'a private tab follows the profile it was opened from');
 assert.match(main,/contentBlocking\.attach\(ses,profileId,profileId\.startsWith\('private-'\)\);contentBlocking\.scripts\.follow\(ses,scriptSource\);/);
 assert.match(main,/c\.emitBrowser\(\{type:'filters-changed',profileId:profile\.id\}\);return \{scriptRules:scripts\}/,'open Settings pages refresh');
});

test('the media menu items of a blocked page do nothing instead of showing the engine\'s error',()=>{
 assert.match(read('desktop/browser-services/context-commands.cjs'),/changed:tr\('pagemenu\.mediaChanged'\)\}\),true\)\.catch\(\(\)=>undefined\);/);
});
