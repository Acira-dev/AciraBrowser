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
test('cookie banners are hidden by default, a saved choice wins, and one site can opt out',()=>{
 const {optional,wc}=fixture();
 assert.equal(optional.profileStatus('profile-1').profileDefaults.annoyances,true,'default is on');
 assert.equal(optional.status(wc).annoyances,true);
 optional.set(wc,{annoyances:false},'site');
 assert.equal(optional.status(wc).annoyances,false,'this site is off');
 wc.url='https://other.example/';assert.equal(optional.status(wc).annoyances,true,'other sites stay on');
 optional.setProfile('profile-1',{annoyances:false});assert.equal(optional.profileStatus('profile-1').profileDefaults.annoyances,false);
 wc.url='https://third.example/';assert.equal(optional.status(wc).annoyances,false,'profile off applies everywhere without an exception');
 optional.resetProfile('profile-1');assert.equal(optional.profileStatus('profile-1').profileDefaults.annoyances,true,'reset returns to the default');
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
test('protection summary says banners are hidden unless the profile turned them off',()=>{
 const base={network:{},filterLists:{}},row=input=>protectionSummary({...base,...input}).rows.find(r=>r.id==='cookie-banners');
 assert.equal(row({}).state,'on');assert.match(row({}).detail,/never accepts or rejects/i);
 assert.equal(row({cookieBanners:true}).state,'on');assert.equal(row({cookieBanners:false}).state,'off');
});
