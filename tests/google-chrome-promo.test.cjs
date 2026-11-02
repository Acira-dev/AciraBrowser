'use strict';
// Google's "Choose Chrome" promo is hidden by the bundled annoyance rules (default on), and only on Google hosts.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ElectronBlocker}=require('@ghostery/adblocker-electron');
const engine=ElectronBlocker.parse(fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','helium-annoyances.txt'),'utf8'),{loadNetworkFilters:true,loadCosmeticFilters:true});
const styles=(url)=>{const u=new URL(url);return engine.getCosmeticsFilters({url,hostname:u.hostname,domain:require('tldts').getDomain(u.hostname),getBaseRules:true,getInjectionRules:false,getExtendedRules:false,getRulesFromHostname:true,getRulesFromDOM:false}).styles;};
test('the Chrome promo sheet is hidden on google.com and country domains',()=>{
 for(const url of ['https://www.google.com/','https://www.google.co.uk/search?q=x','https://www.google.com.lb/'])assert.match(styles(url),/g-bottom-sheet\[aria-labelledby="promo_label_id"\]/,url);
});
test('the rules never apply to other sites',()=>{for(const url of ['https://example.com/','https://notgoogle.com/'])assert.doesNotMatch(styles(url),/promo_label_id/,url);});

test('the frame filter applies the promo selectors on Google hosts only, while ad and tracker blocking is on (not behind the cookie-banner switch, which is off by default)',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','optional-filtering.cjs'),'utf8');
 assert.match(source,/annoyanceSelectors:adsBlocked\(wc\)\?browserPromoSelectors\(host\):\[\]/);
 const make=source.match(/const GOOGLE_HOST=.*\r?\nconst browserPromoSelectors=.*/)[0];
 const {GOOGLE_HOST,browserPromoSelectors}=new Function(make+';return {GOOGLE_HOST,browserPromoSelectors};')();
 for(const host of ['www.google.com','google.com','www.google.co.uk','www.google.com.lb','www.google.de'])assert.equal(browserPromoSelectors(host).length,2,host);
 for(const host of ['notgoogle.com','google.evil.com','accounts.google.com.evil.io','example.com'])assert.deepEqual(browserPromoSelectors(host),[],host);
});
