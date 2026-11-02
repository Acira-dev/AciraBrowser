'use strict';
// One honest, structured answer to "what protects me and what does not", built from what this process is really running.
const {t,number}=require('./tx.cjs');
const date=ms=>ms?new Date(ms).toISOString().slice(0,10):null;
function protectionSummary({network,filterLists,antiTracking,safeBrowsing,cookieBanners,aiContent,metrics}){
 const engine=network.engine||{},current=network.current||{},dns=current.dns?.mode==='off'?t('protection.dns.off'):current.dns?.mode==='secure'?t('protection.dns.secure',{servers:(current.dns?.servers||[]).join(', ')}):t('protection.dns.system');
 const refreshed=filterLists.updatedAt?t('protection.ads.refreshed',{date:date(filterLists.updatedAt)}):t('protection.ads.bundled'),updating=filterLists.automatic?t('protection.ads.refreshEvery'):t('protection.ads.refreshOff');
 const rows=[
  {id:'ads-trackers',title:t('protection.ads.title'),state:'on',detail:t('protection.ads.detail',{lists:refreshed,refresh:updating})},
  {id:'third-party-cookies',title:t('protection.cookies.title'),state:engine.thirdPartyCookies==='allow'?'off':'on',detail:engine.thirdPartyCookies==='allow'?t('protection.cookies.allowed'):t('protection.cookies.blocked')},
  ...(antiTracking?.rows||[]),
  cookieBannerRow(cookieBanners),
  aiAnswerRow(aiContent),
  {id:'advertising-apis',title:t('protection.adApis.title'),state:engine.adApis==='available'?'off':'on',detail:t('protection.adApis.detail')},
  {id:'speculative-loading',title:t('protection.prefetch.title'),state:'on',detail:t('protection.prefetch.detail')},
  {id:'webrtc',title:t('protection.webrtc.title'),state:'on',detail:t('protection.webrtc.detail')},
  {id:'gpc',title:t('protection.gpc.title'),state:current.gpc?'on':'off',detail:current.gpc?t('protection.gpc.on'):t('protection.gpc.off')},
  {id:'dns',title:t('protection.dns.title'),state:current.dns?.mode==='secure'?'on':'system',detail:t('protection.dns.detail',{dns})},
  {id:'telemetry',title:t('protection.telemetry.title'),state:'on',detail:metrics?.enabled?(metrics.configured===false?t('usage.notConfigured')+' '+t('protection.telemetry.off'):t('protection.telemetry.on')):t('protection.telemetry.off')},
  phishingRow(safeBrowsing,antiTracking)
 ];
 return {rows,scope:t('protection.scope')};
}
/** Honest by construction: on only while a list is really loaded; "preparing" (Getting ready…) while the first lists download; off (and saying why) without a key. */
function phishingRow(status,antiTracking){
 const lists=antiTracking?.stats?.threats,base={id:'phishing-malware',title:t('protection.phishing.title')},unknown=()=>t('protection.phishing.unknownError');
 if(!lists&&!status)return {...base,state:'unavailable',detail:t('protection.phishing.unavailable')};
 if(lists&&antiTracking.settings?.phishingLists!==false){
  const total=lists.lists.reduce((sum,item)=>sum+item.entries,0),google=status?.state==='ready'?t('protection.phishing.google'):'';
  if(['active','partial','updating'].includes(lists.state)&&total)return {...base,state:'on',detail:t('protection.phishing.lists',{count:number(total),google})};
  if(lists.state==='stale')return {...base,state:'on',detail:t('protection.phishing.stale')+(lists.lastError?' '+lists.lastError:'')};
  if(lists.state==='error')return {...base,state:'off',detail:t('protection.phishing.error',{error:lists.lastError||unknown()})};
  return {...base,state:'preparing',detail:t('protection.phishing.downloading')};
 }
 if(lists&&status?.state!=='ready')return {...base,state:'off',detail:t('protection.phishing.offSettings')};
 if(!status)return {...base,state:'off',detail:t('protection.phishing.off')};
 if(status.state==='off-no-key')return {...base,state:'optional',detail:t('protection.phishing.needKey')};
 if(status.state==='ready')return {...base,state:'on',detail:t('protection.phishing.ready')};
 return {...base,state:status.state==='error'?'off':'preparing',detail:status.state==='error'?t('protection.phishing.listError',{error:status.lastError||unknown()}):t('protection.phishing.listDownloading')};
}
/** Banner hiding is on by default; the row follows the profile's saved choice and says it can be turned off per site. */
function cookieBannerRow(enabled){
 if(enabled===false)return {id:'cookie-banners',title:t('protection.cookieBanners.title'),state:'off',detail:t('protection.cookieBanners.off')};
 return {id:'cookie-banners',title:t('protection.cookieBanners.title'),state:'on',detail:t('protection.cookieBanners.on')};
}
/** AI answers are hidden by default on the big search engines; the row follows the profile's saved choice. */
function aiAnswerRow(enabled){
 if(enabled!==true)return {id:'ai-content',title:t('protection.ai.title'),state:'off',detail:t('protection.ai.off')};
 return {id:'ai-content',title:t('protection.ai.title'),state:'on',detail:t('protection.ai.on')};
}
module.exports={protectionSummary};
