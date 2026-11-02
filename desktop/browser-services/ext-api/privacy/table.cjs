'use strict';
// What chrome.privacy.network.* and chrome.privacy.services.* really are in Acira (docs/launch/EXTENSION_API_COVERAGE.md has the census).
// An extension can take control of a setting only where Acira has the setting AND the extension's value does not weaken a default:
//   webRTCIPHandlingPolicy        controllable, never looser than Acira's own floor (default_public_interface_only)
//   passwordSavingEnabled         controllable towards "off" (a password manager extension switches the built-in offer off)
// Everything else Acira does not have, or fixes, so Chrome's answer is "not_controllable" with the value Acira really has. Nothing is
// pretended: an extension that sets one of those gets a successful call and no effect, and get() says why (levelOfControl).
const chromeSettings=require('../../extension-chrome-settings.cjs');
const {pushWebRtcPolicy}=require('../_settings.cjs');

const POLICIES=['default','default_public_and_private_interfaces','default_public_interface_only','disable_non_proxied_udp'];
const FLOOR='default_public_interface_only';
const rank=policy=>POLICIES.indexOf(policy);

function boolean(path){return value=>{if(typeof value!=='boolean')throw new Error(`Invalid value for ${path}: a boolean is required.`);return value;};}

/** Settings Acira fixes: [path inside chrome.privacy, the value Acira really has, why]. */
const FIXED=[
 ['network.networkPredictionEnabled',false,'Acira has no network prediction: DNS prefetching is off and there is no Chromium address bar to preconnect from.'],
 ['services.alternateErrorPagesEnabled',false,'Acira never sends a failed address to a suggestion service.'],
 ['services.autofillEnabled',false,'Acira has no address or card autofill.'],
 ['services.autofillAddressEnabled',false,'Acira has no address autofill.'],
 ['services.autofillCreditCardEnabled',false,'Acira has no card autofill.'],
 ['services.safeBrowsingEnabled',true,'Acira checks addresses against its own threat lists; an extension cannot turn that off.'],
 ['services.safeBrowsingExtendedReportingEnabled',false,'Acira never reports pages to a Safe Browsing service.'],
 ['services.searchSuggestEnabled',false,'Acira\'s address bar suggests from tabs, bookmarks and history on this computer only.'],
 ['services.spellingServiceEnabled',false,'Acira checks spelling with dictionaries on this computer, not with a web service.'],
 ['services.translationServiceEnabled',false,'Acira has no translation service.']
];

function definitions(){
 const out=[];
 for(const [name,value] of FIXED)out.push({path:`privacy.${name}`,key:`privacy.${name}`,validate:boolean(name),fixed:true,resolve:()=>value});
 out.push({
  path:'privacy.network.webRTCIPHandlingPolicy',key:'privacy.network.webRTCIPHandlingPolicy',
  validate(value){if(!POLICIES.includes(value))throw new Error(`Invalid value for webRTCIPHandlingPolicy: expected one of ${POLICIES.map(item=>`"${item}"`).join(', ')}.`);return value;},
  accept:value=>rank(value)>=rank(FLOOR),
  resolve:(winner,ctx)=>chromeSettings.webRtcPolicy(ctx.session,baseFor(ctx.session)),
  signature:ctx=>chromeSettings.webRtcPolicy(ctx.session,baseFor(ctx.session)),
  apply:ctx=>{pushWebRtcPolicy(ctx.session,{contents:ctx.options.contents});}
 });
 out.push({
  path:'privacy.services.passwordSavingEnabled',key:'privacy.services.passwordSavingEnabled',
  validate:boolean('passwordSavingEnabled'),
  // "off" is honoured; "on" means "as the person set it" (an extension cannot turn the offer back on for someone who switched it off)
  accept:value=>value===false||chromeSettings.fact('passwordsEnabled')!==false,
  resolve:winner=>(winner===false?false:chromeSettings.fact('passwordsEnabled')!==false)
 });
 return out;
}
function baseFor(session){
 const choice=chromeSettings.hostFor(session)?.userChoice?.();
 return choice&&choice.mode==='fixed_servers'?'disable_non_proxied_udp':FLOOR;
}

module.exports={definitions,FIXED,POLICIES,FLOOR};
