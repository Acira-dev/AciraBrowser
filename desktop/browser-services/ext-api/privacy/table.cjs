// What chrome.privacy.network.* and chrome.privacy.services.* really are in Acira (docs/launch/EXTENSION_API_COVERAGE.md has the census).
// An extension's value is kept and answered the way Chromium does it (chrome/browser/extensions/api/preference/preference_api.cc:
// SetPreferenceFunction stores any valid value as the extension's controlled pref, GetPreferenceFunction answers the effective value and the
// levelOfControl, extensions/browser/extension_pref_value_map.cc picks the winner). What Acira then APPLIES is its own:
//   webRTCIPHandlingPolicy        controllable, never looser than Acira's own floor (default_public_interface_only)
//   passwordSavingEnabled         the extension's value is kept and answered; a winning false switches Acira's own save offer off (a password
//                                 manager made the default); a true never switches the offer back on for someone who turned it off in Settings
//   autofill / address / card     Acira has no address or card autofill: the extension's value is kept and answered, and changes nothing
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
 ['services.safeBrowsingEnabled',true,'Acira checks addresses against its own threat lists; an extension cannot turn that off.'],
 ['services.safeBrowsingExtendedReportingEnabled',false,'Acira never reports pages to a Safe Browsing service.'],
 ['services.searchSuggestEnabled',false,'Acira\'s address bar suggests from tabs, bookmarks and history on this computer only.'],
 ['services.spellingServiceEnabled',false,'Acira checks spelling with dictionaries on this computer, not with a web service.'],
 ['services.translationServiceEnabled',false,'Acira has no translation service.']
];

/** Settings for a feature Acira does not have (no address or card autofill): Acira's own value is "off". An extension may hold either value, as in Chrome
 *  (Bitwarden's "default password manager" switch sets all three of address, card and password saving to false, and back to true when the person turns it
 *  off; its check reads levelOfControl controlled_by_this_extension and value false). `also`: the deprecated autofillEnabled sets the card and address
 *  prefs too (SetPreferenceFunction::Run, kAutofillEnabledDeprecated). */
const NO_FEATURE=[
 ['services.autofillEnabled','Acira has no address or card autofill.',['services.autofillCreditCardEnabled','services.autofillAddressEnabled']],
 ['services.autofillAddressEnabled','Acira has no address autofill.',[]],
 ['services.autofillCreditCardEnabled','Acira has no card autofill.',[]]
];

function definitions(){
 const out=[];
 for(const [name,,also] of NO_FEATURE)out.push({path:`privacy.${name}`,key:`privacy.${name}`,validate:boolean(name),also:also.map(item=>`privacy.${item}`),resolve:winner=>(winner===undefined?false:winner)});
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
  // The extension's value is the setting's value, as in Chrome (an extension-controlled pref outranks the person's). Acira applies only a winning
  // false (extension-chrome-settings.cjs passwordSavingOffByExtension, read by the save offer); the offer still needs the person's own switch on.
  resolve:winner=>(winner===undefined?chromeSettings.fact('passwordsEnabled')!==false:winner)
 });
 return out;
}
function baseFor(session){
 const choice=chromeSettings.hostFor(session)?.userChoice?.();
 return choice&&choice.mode==='fixed_servers'?'disable_non_proxied_udp':FLOOR;
}

module.exports={definitions,FIXED,NO_FEATURE,POLICIES,FLOOR};
