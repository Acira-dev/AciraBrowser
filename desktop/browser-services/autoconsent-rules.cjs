'use strict';
// Rules and settings for answering cookie banners with "reject" (autoconsent-preload-entry.cjs runs them in each frame). DuckDuckGo's autoconsent rules
// (MPL-2.0, LICENSE.autoconsent.txt), read on first use. Each frame gets only the rules that can apply to it: a page's main frame the generic consent-manager
// rules plus those written for its address (about 190 KB, generic part shared), a frame the few written for consent-manager frames (Sourcepoint, TrustArc).
// Founder, 2 Nov 2026: answer reject where a known consent tool allows it, never accept, never hide; where it cannot be answered the banner is shown.
let compact=null,library=null;
const load=()=>{compact??=require('@duckduckgo/autoconsent/rules/compact-rules.json');library??=require('@duckduckgo/autoconsent');return {compact,library};};
/** Beta 14.2 page-load pass: the library's address filter, with the ~860 address patterns spared (autoconsent-prefilter.cjs; its answer is the library's own). Built once, from the rules read above; null when the library's rule format is not the one it reads, then the library's function runs as it is. */
let prefilter;
const filterRules=(url,mainFrame)=>{const {compact,library}=load();if(prefilter===undefined){try{prefilter=require('./autoconsent-prefilter.cjs').createPrefilter(compact,library);}catch{prefilter=null;}}return prefilter?prefilter.filter(url,!!mainFrame):library.filterCompactRules(compact,{url,mainFrame:!!mainFrame});};
/** Never opt in (`autoAction` null: the frame asks for opt-out itself once it has read the banner, see the preload); no rule that only hides a banner (`enableCosmeticRules`); no text-guessing (`heuristicMode`); a known banner may be held back for at most 2 s while it is answered (prehide), and comes back if the answer fails.
 *  `sourcepoint-top` is not marked cosmetic but its opt-out only hides Sourcepoint's container and releases the scroll lock (a stylesheet and a scroll helper): on a
 *  pay-or-consent wall (spiegel.de) it hid the wall unanswered. The answer is Sourcepoint's frame rule, which clicks reject inside the message; Sourcepoint then closes it. */
const HIDE_ONLY=Object.freeze(['sourcepoint-top']);
const CONFIG=Object.freeze({enabled:true,autoAction:null,disabledCmps:HIDE_ONLY,enablePrehide:true,enableCosmeticRules:false,enableGeneratedRules:true,enableHeuristicDetection:false,enablePopupMutationObserver:false,heuristicMode:'off',detectRetries:20,isMainWorld:false,prehideTimeout:2000,visualTest:false,logs:Object.freeze({lifecycle:false,rulesteps:false,detectionsteps:false,evals:false,errors:false,messages:false,waits:false})});
function createAutoconsentRules({limit=64}={}){
 const cache=new Map();
 /** The rules for one frame, as a JSON string (the frame parses it once). */
 function rulesFor(url,mainFrame){
  let key;try{const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol))return null;key=(mainFrame?'m|':'f|')+parsed.origin+parsed.pathname;}catch{return null;}
  // Site rules match on the address (some on its path), so the address without query or fragment is the cache key; working one out takes about 7 ms.
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
  const value=JSON.stringify(filterRules(url,mainFrame));
  cache.set(key,value);if(cache.size>limit)cache.delete(cache.keys().next().value);
  return value;
 }
 /** The same rules as an object, for main's own reading (autoconsent-lazy.cjs: a page's main frame is sent only what its rules look for first). Beta 14 page-load
  * pass: that reading used to go through rulesFor, so every new address of every page turned about 190 KB of rules into a string and back again (about 1.5 ms of
  * main's time while the page waited at document start), and kept one such string per address in the cache below (up to 64 x 190 KB), though no frame was sent it.
  * The library's decodeRules only reads what it is given, so the object is the same rules. Not cached: the lazy answer is. */
 function compactFor(url,mainFrame){
  try{if(!/^https?:$/.test(new URL(url).protocol))return null;}catch{return null;}
  return filterRules(url,mainFrame);
 }
 /** Beta 14 page-load pass: reads the rules and runs their address patterns once (both frame kinds), at a quiet moment after start (optional-filtering.cjs),
  * so the first page of a session does not pay for it inside its document-start question to main (measured on the first page: reading the rules 4.3 ms,
  * the first pass over their patterns 8.3 ms, while the page waited). Nothing is cached for any address. */
 function warm(){try{for(const mainFrame of [true,false])filterRules('https://warm-up.invalid/',mainFrame);return true;}catch{return false;}}
 return {rulesFor,compactFor,warm,config:()=>({...CONFIG,disabledCmps:[...CONFIG.disabledCmps],logs:{...CONFIG.logs}}),version:()=>load().compact.v};
}
module.exports={createAutoconsentRules,CONFIG,HIDE_ONLY};
