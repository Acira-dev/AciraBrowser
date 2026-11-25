'use strict';
// Startup-only Chromium feature choices for privacy. Verified against Electron 44.9.3 / Chromium 152 in the real app, and again on Electron 45.2.1 / Chromium 156 (qa/engine-verify.mjs, 20 Nov 2026: the same answers):
// third-party cookies are blocked in frames, workers and requests; Topics, Protected Audience, Shared Storage and
// Attribution Reporting surfaces are absent from pages.
const AD_API_FEATURES=Object.freeze(['BrowsingTopics','BrowsingTopicsDocumentAPI','PrivacySandboxAdsAPIs','InterestGroupStorage','AdInterestGroupAPI','Fledge','FledgeBiddingAndAuctionServer','FledgeNonce','SharedStorageAPI','PrivateAggregationApi','AttributionReportingCrossAppWeb','TrustTokens','PrivateStateTokens']);
// FedCM (the browser-drawn account chooser behind Google's "Continue with Google" button and One Tap) is switched off. The engine ships the
// API (window.IdentityCredential, navigator.credentials.get({identity})) but Electron has no chooser UI for it, so every request is dismissed
// at once ("NetworkError: Error retrieving a token", issue UiDismissedNoEmbargo). Google Identity Services sees the API, takes the FedCM path
// and never falls back, so the button did nothing (seen on pinterest.com, whose button asks for FedCM in 'active' mode). Without the API a page takes the
// route Firefox and Safari get: the button opens Google's own sign-in window with its opener. No cookie or storage rule changes.
const FEDCM_FEATURES=Object.freeze(['FedCm']);
const THIRD_PARTY_COOKIE_FEATURES=Object.freeze(['ForceThirdPartyCookieBlockingEnabled','ThirdPartyStoragePartitioning']);
// Network state partitioning (Brave ships it; Tor Browser's first-party isolation does the same): sockets, TLS sessions and server
// properties are keyed by the top-level site, so two sites that embed the same third party never share a connection to it. A Tor
// window needs it for per-site circuits (tor-isolation.cjs), and it removes a cross-site link everywhere else too.
const NETWORK_PARTITION_FEATURES=Object.freeze(['PartitionConnectionsByNetworkIsolationKey','PartitionSSLSessionsByNetworkIsolationKey','PartitionHttpServerPropertiesByNetworkIsolationKey']);
// Page loading (Beta 14 speed pass): Chromium's spare renderer. Every new tab and every cross-site navigation needs a renderer process for its site;
// Chrome keeps one started ahead (the "spare") so the navigation never waits for a launch, and starts the next one once it is taken. Electron turns
// the feature off in its own code (shell/browser/feature_list.cc) because a spare cannot carry a non-sandboxed page's settings; every Acira view is
// sandboxed. Measured on the bench's local pages (dev build): the first preload ran 59 ms after the response without it, 8 ms with it; cross-site
// load 93 -> 54 ms, first paint 116 -> 68 ms. A page whose renderer needs switches of its own (webPreferences.additionalArguments: Tor's Safer and
// Safest --jitless, a side-panel site's marker) never takes the spare, so it keeps them (tests/spare-renderer.test.cjs proves both in the engine).
// Price: one idle renderer for the profile that navigated last, as in Chrome (about 15-20 MB); the engine drops it under memory pressure.
// Electron re-reads the feature list after the main script, and the enable list wins over its own disable entry, so a switch set here works.
const SPEED_FEATURES=Object.freeze(['SpareRendererForSitePerProcess']);
// Hidden tabs' graphics memory (page-frames.cjs, 13.11 gpu-mem): Acira lets go of the frames of hidden tabs and relies on Chromium's FrameEvictionManager keeping only a few SAVED frames in all
// (Chromium 152: 5, i.e. the 3 locked ones and 2 unlocked). Chromium 156 switched on `ScalableFrameEviction`, which raises that to 10 (3 locked + 7 unlocked in the same rig,
// tests/fixtures/hidden-page-frames with HPF_PAGES=20), and the GPU process then holds five more page frames: +67 to +80 MB at 10 and 30 tabs in the packaged-app bench (an earlier build, engine move,
// 21 Nov 2026). Switching the feature off gives the 152 numbers back (locked 3, unlocked 2: the same rig, `--disable-features=ScalableFrameEviction`).
const RAM_FEATURES=Object.freeze(['ScalableFrameEviction']);
const name=value=>value.split(/[<:]/)[0];
function mergeFeatures(app,{enable=[],disable=[]}){
 if(app.isReady())throw new Error('Engine features are a startup choice. Restart Acira to change them.');
 const owned=new Set([...enable,...disable].map(name)),lists={'enable-features':[],'disable-features':[]};
 for(const key of Object.keys(lists))lists[key]=app.commandLine.getSwitchValue(key).split(',').map(value=>value.trim()).filter(value=>value&&!owned.has(name(value)));
 lists['enable-features'].push(...enable);lists['disable-features'].push(...disable);
 for(const key of Object.keys(lists)){const value=[...new Set(lists[key])].join(',');if(value)app.commandLine.appendSwitch(key,value);else app.commandLine.removeSwitch(key);}
}
function configureEngineFeatures({app,thirdPartyCookies='block'}){
 if(!['block','allow'].includes(thirdPartyCookies))throw new Error('Choose block or allow for third-party cookies.');
 const block=thirdPartyCookies==='block';
 mergeFeatures(app,{enable:[...(block?THIRD_PARTY_COOKIE_FEATURES:['ThirdPartyStoragePartitioning']),...NETWORK_PARTITION_FEATURES,...SPEED_FEATURES],disable:[...AD_API_FEATURES,...FEDCM_FEATURES,...RAM_FEATURES,...(block?[]:['ForceThirdPartyCookieBlockingEnabled'])]});
 return {thirdPartyCookies:block?'block':'allow',adApis:'removed',scope:'application',changeRequiresRestart:true};
}
/** Read-only runtime truth: what this process was actually started with. */
function engineFeatureStatus(app){
 if(!app?.commandLine)return {thirdPartyCookies:'unknown',adApis:'unknown'};
 const enabled=app.commandLine.getSwitchValue('enable-features').split(',').map(name),disabled=app.commandLine.getSwitchValue('disable-features').split(',').map(name);
 return {thirdPartyCookies:enabled.includes('ForceThirdPartyCookieBlockingEnabled')?'block':'allow',adApis:AD_API_FEATURES.every(feature=>disabled.includes(feature))?'removed':'available'};
}
module.exports={configureEngineFeatures,engineFeatureStatus,AD_API_FEATURES,FEDCM_FEATURES,THIRD_PARTY_COOKIE_FEATURES,NETWORK_PARTITION_FEATURES,SPEED_FEATURES,RAM_FEATURES};
