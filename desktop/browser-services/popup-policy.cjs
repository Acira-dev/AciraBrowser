'use strict';
// Pop-up ads and pop-unders (R3-12).
//
// The gesture gate in desktop/popup-gate.cjs already refuses windows nobody asked for. Streaming sites get around it: the click on the play button
// IS a real click, and the page uses it to open an ad. So this module judges what a window is about to open, the way uBlock Origin ($popup, $popunder)
// and Brave do, and then watches what an allowed window does next.
//
//   1. Rules written for pop-ups ($popup / $popunder in the uBlock filters, plus a short bundled list of pop-up ad networks) are matched with the opener
//      as the source. The Ghostery engine does not read $popup, so those lines are rewritten to $subdocument and kept in their own small engine.
//      A window is asked about as a frame (not as a top-level page) because the engine only works out third-party and $domain= for frames and resources.
//   2. A window a script opened (no link under the pointer) is also matched against the normal ad and tracker rules, as a top-level address.
//   3. A second script-opened window from the same page a few seconds after the first is refused.
//   4. A window that was allowed is watched: a hop to a listed address is closed, and a window that goes to the back before anyone touched it is a pop-under and is closed.
//
// What is never judged as an ad: sign-in, payment and permission windows (known identity and payment hosts, OAuth-shaped addresses), links the person
// opened themselves with the pointer (rules written for pop-ups still apply), and sites where the person turned pop-up blocking off.
const {parse}=require('tldts');

/** Hosts whose windows are always sign-in or payment. A listed ad rule never wins over these. */
const TRUSTED_HOSTS=Object.freeze(['accounts.google.com','accounts.youtube.com','pay.google.com','login.microsoftonline.com','login.live.com','login.microsoft.com','account.live.com','appleid.apple.com','idmsa.apple.com']);
const TRUSTED_DOMAINS=Object.freeze(['paypal.com','paypalobjects.com','stripe.com','stripe.network','adyen.com','braintreepayments.com','braintreegateway.com','okta.com','oktapreview.com','auth0.com','onelogin.com','duosecurity.com','pingidentity.com','pingone.com','id.me','login.gov','klarna.com','squareup.com','authorize.net','cardinalcommerce.com','verifiedbyvisa.com']);
/** Addresses shaped like a sign-in, consent or checkout step. They skip the general ad rules and the one-at-a-time limit, not the rules written for pop-ups. */
const FLOW_PATH=/\/(?:oauth2?|openid(?:-connect)?|authori[sz]e|saml2?|sso|sign-?in|sign_in|log-?in|logon|auth|consent|checkout|payments?|3ds|3dsecure)(?:[/?#.]|$)/i;
const FLOW_QUERY=/[?&](?:client_id|redirect_uri|response_type|code_challenge)=/i;
/** Windows that open and go to the back inside this time, untouched, are pop-unders. */
const UNDER_MS=2500;
/** A second script-opened window from one page this soon after the first is refused. */
const BURST_MS=4000;

const safeURL=value=>{try{return new URL(String(value));}catch{return null;}};
const siteOf=url=>{const host=url?.hostname||'';return parse(host).domain||host;};
const sameSite=(a,b)=>!!a&&!!b&&siteOf(a)===siteOf(b);
function trustedHost(url){const host=url.hostname.toLowerCase();if(TRUSTED_HOSTS.includes(host))return true;const domain=parse(host).domain;return !!domain&&TRUSTED_DOMAINS.includes(domain);}
const flowShaped=url=>FLOW_PATH.test(url.pathname)||FLOW_QUERY.test(url.search);

/** `||example.com^$popup,third-party` becomes `||example.com^$third-party,subdocument`. Lines that are not network rules for pop-ups give null. */
function popupRule(line){
 if(typeof line!=='string')return null;
 const text=line.trim();
 if(!text||text[0]==='!'||text[0]==='['||/#[@?$%]?#/.test(text))return null;
 const exception=text.startsWith('@@'),body=exception?text.slice(2):text,at=body.lastIndexOf('$');
 if(at<0)return null;
 const options=body.slice(at+1).split(',').map(item=>item.trim()).filter(Boolean);
 if(!options.some(item=>item==='popup'||item==='popunder'))return null;
 const kept=options.filter(item=>!['popup','popunder','doc','document','all','frame','subdocument'].includes(item));
 kept.push('subdocument');
 return (exception?'@@':'')+(body.slice(0,at)||'*')+'$'+kept.join(',');
}
const popupRules=texts=>{const rules=[];for(const text of texts)if(typeof text==='string')for(const line of text.split('\n')){if(line.length<4||line.indexOf('popu')<0)continue;const rule=popupRule(line);if(rule)rules.push(rule);}return rules;};

/**
 * @param getEngine       the normal ad and tracker engine (Ghostery), or null
 * @param getTexts        the filter list texts the engine was built from
 * @param getTextsKey     changes whenever those lists change, so the pop-up rules are rebuilt
 * @param extraRules      bundled pop-up ad network rules, one per line
 */
function createPopupPolicy({getEngine=()=>null,getTexts=()=>[],getTextsKey=()=>'',extraRules='',now=Date.now,burstMs=BURST_MS}={}){
 let engine=null,engineKey=null,ruleCount=0;
 const lastOpened=new Map();
 function rulesEngine(){
  const key=String(getTextsKey());
  if(engine&&engineKey===key)return engine;
  const {FiltersEngine}=require('@ghostery/adblocker'),lines=popupRules([...getTexts(),extraRules]);
  ruleCount=lines.length;engineKey=key;
  return engine=FiltersEngine.parse(lines.join('\n'),{loadCosmeticFilters:false,loadNetworkFilters:true});
 }
 const request=(url,opener)=>require('@ghostery/adblocker').Request.fromRawDetails({url,sourceUrl:opener||'',type:'sub_frame'});
 const allow=reason=>({block:false,reason});
 /**
  * Should a window the page asked for be refused?
  * @returns {{block:boolean,reason:string,filter?:string}} reason is rule, ad-host, burst, trusted, flow, same-site or open
  */
 function check({openerUrl,targetUrl,linkClick=false,openerId}){
  const target=safeURL(targetUrl);
  if(!target||!/^https?:$/.test(target.protocol))return allow('open');
  if(trustedHost(target))return allow('trusted');
  const opener=safeURL(openerUrl),same=sameSite(opener,target),flow=flowShaped(target);
  try{
   const probe=request(target.href,opener?.href),found=rulesEngine().match(probe);
   if(found.match)return {block:true,reason:'rule',filter:found.filter?.toString()};
   if(!linkClick&&!same&&!flow){
    const general=getEngine()?.match?.(probe);
    if(general?.match)return {block:true,reason:'ad-host',filter:general.filter?.toString()};
   }
  }catch{/* A rule that cannot be read never blocks a window. */}
  if(!linkClick&&!same&&!flow&&openerId!==undefined){
   const last=lastOpened.get(openerId);
   if(last!==undefined&&now()-last<burstMs)return {block:true,reason:'burst'};
  }
  return allow(same?'same-site':flow?'flow':'open');
 }
 /** A script-opened window from another site was allowed: the next one from this page, soon after, is refused. */
 function opened({openerId,openerUrl,targetUrl,linkClick}){
  if(linkClick||openerId===undefined)return;
  const target=safeURL(targetUrl),opener=safeURL(openerUrl);
  if(!target||sameSite(opener,target)||trustedHost(target)||flowShaped(target))return;
  if(lastOpened.size>200)lastOpened.delete(lastOpened.keys().next().value);
  lastOpened.set(openerId,now());
 }
 function forget(openerId){lastOpened.delete(openerId);}
 /** Builds the pop-up rules now (they are parsed from the filter lists, about 50 ms), so the first pop-up question does not wait for it. */
 function warm(){try{rulesEngine();}catch{}}
 return {check,opened,forget,warm,stats:()=>({popupRules:ruleCount})};
}

/**
 * Watches one window that was allowed to open. Closes it when it goes to a refused address (a redirect or a script moving it) or when it sinks behind
 * the page that opened it before anybody touched it (a pop-under). `popup` is the BrowserWindow; `judge(url)` gives {block}.
 */
function watchPopup({popup,opener=null,openerUrl,trusted=false,watchUnder=true,judge,onBlocked=()=>{},now=Date.now,underMs=UNDER_MS}){
 const contents=popup.webContents,created=now();let touched=false,openerTouched=false,done=false;
 // The person clicking or typing back on the page that opened the window is how a window legitimately ends up behind; a script calling window.focus() is not.
 const openerInput=(_event,input)=>{if(now()>created&&(input?.type==='mouseDown'||input?.type==='keyDown'))openerTouched=true;};
 if(opener&&watchUnder&&!trusted){try{opener.on('before-input-event',openerInput);opener.on('before-mouse-event',openerInput);}catch{}setTimeout(()=>{try{opener.removeListener('before-input-event',openerInput);opener.removeListener('before-mouse-event',openerInput);}catch{}},underMs+250).unref?.();}
 const close=kind=>{
  if(done)return;done=true;
  try{onBlocked(kind);}catch{}
  setImmediate(()=>{try{if(!popup.isDestroyed())popup.close();}catch{}});
 };
 const touch=()=>{touched=true;};
 contents.on('before-input-event',(_event,input)=>{if(input?.type==='keyDown'||input?.type==='mouseDown')touch();});
 contents.on('before-mouse-event',(_event,input)=>{if(input?.type==='mouseDown'||input?.type==='mouseUp')touch();});
 const guard=(event,url)=>{
  if(done)return;
  if(trusted||typeof url!=='string'||!/^https?:/i.test(url))return;
  const verdict=judge(url,openerUrl);
  if(verdict?.block){try{event.preventDefault();}catch{}close('ad');}
 };
 contents.on('will-navigate',guard);
 contents.on('will-redirect',guard);
 const sunk=()=>!done&&!trusted&&!touched&&!openerTouched&&now()-created<underMs+500;
 if(watchUnder&&!trusted){
  popup.on('blur',()=>{if(sunk()&&now()-created<underMs)close('under');});
  // A window can be pushed behind before it ever had focus, so no blur event comes. A visible window that still has no focus a moment after it opened, untouched, is under the page.
  for(const delay of [700,1600])setTimeout(()=>{try{if(sunk()&&!popup.isDestroyed()&&popup.isVisible()&&!popup.isFocused())close('under');}catch{}},delay).unref?.();
 }
 return {touched:()=>touched,closed:()=>done};
}
module.exports={createPopupPolicy,watchPopup,popupRule,popupRules,trustedHost,flowShaped,sameSite,UNDER_MS,BURST_MS};
