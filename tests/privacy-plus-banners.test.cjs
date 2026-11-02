'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createOptionalFiltering}=require('../desktop/browser-services/optional-filtering.cjs'),{createAnnoyanceRules,SOURCES}=require('../desktop/browser-services/annoyance-rules.cjs');
const {protectionSummary}=require('../desktop/browser-services/protection-summary.cjs');
function fixture(){
 const policies=new Map(),database={policy:(profile,site)=>policies.get(profile+'|'+site),setPolicy:(profile,site,value)=>{policies.set(profile+'|'+site,value);},policies:profile=>[...policies].filter(([key])=>key.startsWith(profile+'|')).map(([key,value])=>({site:key.split('|')[1],...value}))};
 const session={registerPreloadScript(){}},wc={id:1,session,url:'https://news.example/a',getURL(){return this.url;},mainFrame:{send(){},isDestroyed:()=>false,url:'https://news.example/a'},on(){},once(){}};
 const optional=createOptionalFiltering({ipcMain:{handle(){},on(){}},database,getOwner:()=>({}),resolveContents:()=>wc});
 optional.attach(session,'profile-1',false,{useBefore(){}});return {optional,wc,database};
}
test('cookie banners are shown by default (hiding is opt-in), a saved choice wins, one site can opt in or out, and an existing profile that never chose follows the default',()=>{
 const {optional,wc,database}=fixture();
 assert.equal(optional.profileStatus('profile-1').profileDefaults.annoyances,false,'default is off: banners show and can be answered');
 assert.equal(optional.status(wc).annoyances,false);
 optional.set(wc,{annoyances:true},'site');
 assert.equal(optional.status(wc).annoyances,true,'this site hides banners');
 wc.url='https://other.example/';assert.equal(optional.status(wc).annoyances,false,'other sites still show them');
 optional.setProfile('profile-1',{annoyances:true});assert.equal(optional.profileStatus('profile-1').profileDefaults.annoyances,true);
 wc.url='https://third.example/';assert.equal(optional.status(wc).annoyances,true,'profile on applies everywhere without an exception');
 optional.set(wc,{annoyances:false},'site');assert.equal(optional.status(wc).annoyances,false,'one site can still opt out');
 optional.resetProfile('profile-1');assert.equal(optional.profileStatus('profile-1').profileDefaults.annoyances,false,'reset returns to the default');
 database.setPolicy('profile-2','*',{blocking:true,aiContent:true});assert.equal(optional.profileStatus('profile-2').profileDefaults.annoyances,false,'a profile saved before this change, which never chose, now shows banners');
});
test('pop-up ad blocking is on by default, one site can allow pop-ups, a profile can too, and reset brings it back',()=>{
 const {optional,wc}=fixture();
 assert.equal(optional.profileStatus('profile-1').profileDefaults.popupAds,true,'default is on');
 assert.equal(optional.status(wc).popupAds,true);assert.equal(optional.popupAds(wc),true);
 optional.set(wc,{popupAds:false},'site');
 assert.equal(optional.status(wc).popupAds,false);assert.equal(optional.popupAds(wc),false,'this site allows pop-ups');
 wc.url='https://other.example/';assert.equal(optional.popupAds(wc),true,'other sites stay protected');
 assert.throws(()=>optional.set(wc,{popupAds:'no'},'site'),/on or off/);
 optional.setProfile('profile-1',{popupAds:false});wc.url='https://third.example/';assert.equal(optional.popupAds(wc),false,'profile off applies everywhere without an exception');
 optional.resetProfile('profile-1');assert.equal(optional.profileStatus('profile-1').profileDefaults.popupAds,true);
});
test('cookie lists: three open sources, lazy compile, banner CSS for real consent managers',()=>{
 assert.deepEqual([...SOURCES],['easylist-cookie.txt','ubo-annoyances-cookies.txt','brave-cookie-specific.txt']);
 const rules=createAnnoyanceRules();
 const only=createAnnoyanceRules({sources:['easylist-cookie.txt']});
 assert.ok(rules.engine.getFilters().cosmeticFilters.length>only.engine.getFilters().cosmeticFilters.length,'uBO and Brave lists add rules on top of EasyList Cookie');
 const css=rules.styles('https://ordinary.example/',{ids:['onetrust-banner-sdk'],classes:['cky-consent-container']});
 assert.match(css,/onetrust-banner-sdk/);assert.ok(css.length>0&&css.length<400000);
 assert.equal(rules.styles('file:///etc/passwd'),'','only websites');
 assert.match(rules.coverage,/Never clicks, accepts or rejects/);
});
test('protection summary: banners are answered "reject" by default; with answering off they are shown, or hidden if the profile turned hiding on',()=>{
 const base={network:{},filterLists:{}},row=input=>protectionSummary({...base,...input}).rows.find(r=>r.id==='cookie-banners');
 assert.equal(row({}).state,'on','unknown means the default: answered');assert.match(row({}).detail,/Reject/);assert.match(row({}).detail,/Never Accept/);
 assert.equal(row({cookieAnswers:false}).state,'off');assert.match(row({cookieAnswers:false}).detail,/You answer them yourself/);
 assert.equal(row({cookieAnswers:false,cookieBanners:true}).state,'on');assert.match(row({cookieAnswers:false,cookieBanners:true}).detail,/never accepts or rejects/i);
});
test('a consent page (the consent step itself) gets no banner hiding and no cookie-list blocking, while the setting stays on',async()=>{
 const {consentPage}=require('../desktop/browser-services/annoyance-rules.cjs');
 for(const url of ['https://www.derstandard.at/consent/tcf/','https://myprivacy.dpgmedia.nl/consent?siteKey=x','https://consent.google.com/m?continue=x','https://consent.youtube.com/m','https://guce.yahoo.com/consent?brandType=nonEu'])assert.equal(consentPage(url),true,url);
 for(const url of ['https://www.derstandard.at/','https://www.spiegel.de/','https://www.example.com/news/consent-laws','https://cmp2.bild.de/index.html','file:///consent/'])assert.equal(consentPage(url),false,url);
 const handlers={},policies=new Map(),database={policy:(profile,site)=>policies.get(profile+'|'+site),setPolicy:(profile,site,value)=>{policies.set(profile+'|'+site,value);},policies:()=>[]};
 const session={registerPreloadScript(){}},participants=[],wc={id:7,session,url:'https://www.derstandard.at/consent/tcf/',getURL(){return this.url;},isDestroyed:()=>false,mainFrame:{send(){},isDestroyed:()=>false},on(){},once(){}};
 const optional=createOptionalFiltering({ipcMain:{handle(name,fn){handlers[name]=fn;},on(){}},database,getOwner:()=>({}),resolveContents:()=>wc});
 optional.attach(session,'profile-1',false,{useBefore(fn){participants.push(fn);}});
 const ask=url=>handlers['acira:content-filter-options']({sender:wc,senderFrame:{url,isDestroyed:()=>false}});
 optional.setProfile('profile-1',{annoyances:true});
 const consent=await ask(wc.url);assert.equal(consent.annoyanceStyles,'');assert.equal(consent.cookieHints,false);
 assert.equal(await handlers['acira:content-filter-dom']({sender:wc,senderFrame:{url:wc.url,isDestroyed:()=>false}},{classes:['grecaptcha-badge'],ids:[]}),'');
 assert.equal(optional.status(wc).annoyances,true,'the person\'s setting is unchanged');
 const sourcepoint={url:'https://cdn.privacy-mgmt.com/wrapperMessagingWithoutDetection.js',resourceType:'script',webContents:wc,referrer:wc.url},blocked=details=>participants.reduce((out,fn)=>out.cancel?out:fn(details),{});
 wc.url='https://www.derstandard.at/';const page=await ask(wc.url);assert.ok(page.annoyanceStyles.includes('sp_message_container_'),'an ordinary page still hides banners');assert.equal(page.cookieHints,true);
 const iubenda={url:'https://cdn.iubenda.com/cs/iubenda_cs.js',resourceType:'script',webContents:wc,referrer:wc.url};
 assert.equal(blocked(iubenda).cancel,true,'the cookie lists block a consent manager on an ordinary page');
 wc.url='https://www.derstandard.at/consent/tcf/';assert.notEqual(blocked(iubenda).cancel,true,'but not on the consent page');assert.notEqual(blocked(sourcepoint).cancel,true);
});
