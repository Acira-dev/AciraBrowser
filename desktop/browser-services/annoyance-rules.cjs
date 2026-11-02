'use strict';
const fs=require('node:fs'),path=require('node:path'),{getDomain}=require('tldts'),{ElectronBlocker}=require('@ghostery/adblocker-electron');
/** Open lists, bundled offline. EasyList Cookie List (CC BY 3.0 / GPL-3.0), uBlock filters - Cookie Notices (GPL-3.0, uAssets), Brave Cookie-snippet list (MPL-2.0). */
const SOURCES=Object.freeze(['easylist-cookie.txt','ubo-annoyances-cookies.txt','brave-cookie-specific.txt']);
function createAnnoyanceRules({directory=path.join(__dirname,'annoyance-lists'),sources=SOURCES}={}){
 // Parsing the lists takes about 0.1 s, so it happens on first use (the first page load with banner hiding on) instead of at launch.
 let engine=null;
 const load=()=>engine||(engine=ElectronBlocker.parse(sources.map(file=>fs.readFileSync(path.join(directory,file),'utf8')).join('\n'),{loadNetworkFilters:true,loadCosmeticFilters:true}));
 // Reviewed common consent-manager tokens select maintained generic rules. This
 // avoids shipping every generic selector to every frame or classifying page text.
 const commonIds=['onetrust-banner-sdk','onetrust-consent-sdk','CybotCookiebotDialog','CybotCookiebotDialogBodyUnderlay','didomi-host','usercentrics-root','cookie-law-info-bar','cookie-law-info-again','moove_gdpr_cookie_info','cmplz-cookiebanner','truste-consent-track','gdpr-cookie-message','cookieconsent','cookieConsent','CookieConsent','cc-main','cc-window','qc-cmp2-container','cmpbox','iubenda-cs-banner'];
 const commonClasses=['cky-consent-container','cky-banner-bottom','cky-box-bottom-left','cky-box-bottom-right','cky-classic-bottom','cky-overlay','cc-banner','cc-window','cc-grower','qc-cmp2-container','cmplz-cookiebanner','osano-cm-window','osano-cm-dialog','iubenda-cs-container','truste_overlay'];
 // Sourcepoint (the consent wall on theguardian.com, spiegel.de and many publishers) builds a container whose id ends in a per-site number, so no id token above can name it and the lists only know it site by site. Reviewed here once: the prefix is Sourcepoint's own, nothing else uses it.
 const genericStyles='div[id^="sp_message_container_"]{display:none!important}';
 const normalize=value=>Array.isArray(value)?[...new Set(value.filter(v=>typeof v==='string'&&v.length>0&&v.length<=128).slice(0,2000))]:[];
 function styles(url,dom={},{domOnly=false}={}){let parsed;try{parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))return '';}catch{return '';}
  const result=load().getCosmeticsFilters({url:parsed.href,hostname:parsed.hostname,domain:getDomain(parsed.hostname,{allowPrivateDomains:true}),classes:[...(domOnly?[]:commonClasses),...normalize(dom.classes)],ids:[...(domOnly?[]:commonIds),...normalize(dom.ids)],getBaseRules:!domOnly,getInjectionRules:false,getExtendedRules:false,getRulesFromDOM:true,getRulesFromHostname:!domOnly});
  return (result.active&&result.styles.length<400000?result.styles:'')+(domOnly?'':genericStyles);
 }
 return {get engine(){return load();},styles,warm(){try{load();}catch{/* The first real use reports the problem. */}},sources:[...sources],coverage:'EasyList Cookie List, uBlock filters Cookie Notices and the Brave cookie list: network rules and site-specific or common consent-manager CSS, plus the Helium promotion rule. Never clicks, accepts or rejects. Scriptlets, text-matching and other procedural rules are not used.'};
}
module.exports={createAnnoyanceRules,SOURCES};
