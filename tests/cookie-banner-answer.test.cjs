'use strict';
// Answering cookie banners (founder, 2 Nov 2026): where a known consent tool offers it, Acira answers "reject" (or necessary only) and the banner goes; it never
// accepts, never hides a banner it cannot answer, and leaves a banner that offers a paid subscription instead of a reject as the site drew it.
// Runs the real answering preload with DuckDuckGo's real rules (tests/fixtures/cookie-banners/answer.cjs) against OneTrust-shaped banners, plus the main-process side.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const root=path.join(__dirname,'..'),built=path.join(root,'desktop','browser-services','autoconsent-preload.cjs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const {createAutoconsentRules,CONFIG,HIDE_ONLY}=require('../desktop/browser-services/autoconsent-rules.cjs');
const {createOptionalFiltering}=require('../desktop/browser-services/optional-filtering.cjs');
const CASES=[
 {name:'reject',case:'onetrust',steps:[{at:7000,name:'after'}]},
 {name:'pay',case:'onetrust-pay',steps:[{at:1000,name:'early'},{at:7000,name:'after'}]}
];
let results=null,problem=null;
if(electron){
 if(!fs.existsSync(built))spawnSync(process.execPath,[path.join(root,'scripts','build-ui-preload.mjs')],{cwd:root,encoding:'utf8'});
 const env={...process.env,ELECTRON_ENABLE_LOGGING:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','cookie-banners','answer.cjs'),JSON.stringify(CASES)],{encoding:'utf8',timeout:90000,env});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line)results=Object.fromEntries(JSON.parse(line.slice(7)).map(item=>[item.name,item]));else problem=((run.stdout||'')+(run.stderr||'')).split(/\r?\n/).filter(text=>!/^\[\d+:/.test(text)).join('\n').slice(0,600)||'electron produced no result';
}
const skip=!electron?'electron binary not available':false;
test('fixture run finished',{skip},()=>{assert.ok(results,problem);});
test('a OneTrust banner with a reject choice is answered "Reject all" and goes away; Accept is never clicked',{skip},()=>{
 const {steps:{after},events}=results.reject;
 assert.deepEqual(after.clicked,['onetrust-reject-all-handler'],'events: '+events.join(', '));assert.equal(after.banner,false);
 assert.ok(events.includes('popupFound:Onetrust'),events.join(', '));
});
test('a banner that offers a paid subscription instead of a reject is left as the site drew it: nothing clicked, shown again at once',{skip},()=>{
 const {steps:{after},events}=results.pay;
 assert.deepEqual(after.clicked,[],'nothing clicked');assert.equal(after.banner,true,'the banner is shown');
 assert.ok(!events.some(event=>event.startsWith('optOutResult')),'no opt-out ran: '+events.join(', '));
});
test('the settings handed to every frame never opt in, run no hide-only rule and guess nothing from text',()=>{
 const rules=createAutoconsentRules(),config=rules.config();
 assert.equal(config.autoAction,null,'the frame asks for opt-out itself, after reading the banner');assert.equal(config.enableCosmeticRules,false);assert.equal(config.heuristicMode,'off');assert.equal(config.enableHeuristicDetection,false);
 assert.deepEqual(config.disabledCmps,['sourcepoint-top']);assert.deepEqual([...HIDE_ONLY],['sourcepoint-top']);assert.equal(CONFIG.prehideTimeout,2000);
 const source=fs.readFileSync(path.join(root,'desktop','browser-services','autoconsent-preload-entry.cjs'),'utf8');
 assert.doesNotMatch(source,/optIn/,'the preload never sends opt-in');assert.match(source,/receiveMessageCallback\(\{type:'optOut'\}\)/);
 const main=JSON.parse(rules.rulesFor('https://www.theguardian.com/international',true)),frame=JSON.parse(rules.rulesFor('https://sp-spiegel-de.spiegel.de/index.html',false));
 assert.ok(main.r.length>100,'a page gets the generic consent-manager rules: '+main.r.length);assert.ok(frame.r.length<20,'a frame only the frame rules: '+frame.r.length);
 assert.equal(rules.rulesFor('file:///etc/hosts',true),null);
});
test('answering is on by default, can be turned off for the profile or one site, and records what happened per tab; a page left locked after a reject reloads once a minute at most',()=>{
 const on={},handlers={},policies=new Map(),database={policy:(profile,site)=>policies.get(profile+'|'+site),setPolicy:(profile,site,value)=>{policies.set(profile+'|'+site,value);},policies:()=>[]};
 let reloaded=0;const session={registerPreloadScript(){}},main={isDestroyed:()=>false},wc={id:3,session,url:'https://news.example/a',getURL(){return this.url;},isDestroyed:()=>false,reload(){reloaded++;},mainFrame:main,on(name,fn){on[name]=fn;},once(){}};
 const optional=createOptionalFiltering({ipcMain:{handle(name,fn){handlers[name]=fn;},on(name,fn){handlers[name]=fn;}},database,getOwner:()=>({}),resolveContents:()=>wc});
 optional.attach(session,'profile-1',false,{useBefore(){}});
 const frame=url=>({url,isDestroyed:()=>false}),setup=(url,top=true)=>{const event={sender:wc,senderFrame:top?Object.assign(main,frame(url)):frame(url)};handlers['acira:autoconsent-setup'](event);return event.returnValue;};
 assert.equal(optional.status(wc).rejectCookies,true,'on by default');
 const got=setup(wc.url);assert.equal(got.config.autoAction,null);assert.ok(got.rules.length>1000);
 optional.set(wc,{rejectCookies:false},'site');assert.equal(setup(wc.url),null,'off for this site');
 wc.url='https://other.example/';assert.ok(setup(wc.url),'still on elsewhere');
 optional.setProfile('profile-1',{rejectCookies:false});wc.url='https://third.example/';assert.equal(setup(wc.url),null,'off for the profile');
 optional.setProfile('profile-1',{rejectCookies:true});
 const send=message=>handlers['acira:autoconsent-event']({sender:wc,senderFrame:main},message);
 send({type:'popupFound',cmp:'Onetrust'});assert.deepEqual(optional.status(wc).cookieAnswer,{cmp:'Onetrust',state:'found'});
 send({type:'optOutResult',cmp:'Onetrust',result:true});assert.deepEqual(optional.status(wc).cookieAnswer,{cmp:'Onetrust',state:'answered'});
 send({type:'payOrConsent',cmp:'Onetrust'});assert.equal(optional.status(wc).cookieAnswer.state,'answered','an answer is not taken back');
 on['did-start-navigation']({isMainFrame:true,isSameDocument:false});assert.equal(optional.status(wc).cookieAnswer,null,'a new page starts fresh');
 send({type:'payOrConsent',cmp:'didomi'});assert.deepEqual(optional.status(wc).cookieAnswer,{cmp:'didomi',state:'pay-or-consent'});
 send({type:'stillLocked'});send({type:'stillLocked'});
 return new Promise(resolve=>setTimeout(()=>{assert.equal(reloaded,1,'one reload, not a loop');resolve();},120));
});
