'use strict';
// Startup-only Chromium feature choices for privacy. Verified against Electron 44.9.3 / Chromium 152 in the real app:
// third-party cookies are blocked in frames, workers and requests; Topics, Protected Audience, Shared Storage and
// Attribution Reporting surfaces are absent from pages.
const AD_API_FEATURES=Object.freeze(['BrowsingTopics','BrowsingTopicsDocumentAPI','PrivacySandboxAdsAPIs','InterestGroupStorage','AdInterestGroupAPI','Fledge','FledgeBiddingAndAuctionServer','FledgeNonce','SharedStorageAPI','PrivateAggregationApi','AttributionReportingCrossAppWeb','TrustTokens','PrivateStateTokens']);
const THIRD_PARTY_COOKIE_FEATURES=Object.freeze(['ForceThirdPartyCookieBlockingEnabled','ThirdPartyStoragePartitioning']);
// Network state partitioning (Brave ships it; Tor Browser's first-party isolation does the same): sockets, TLS sessions and server
// properties are keyed by the top-level site, so two sites that embed the same third party never share a connection to it. A Tor
// window needs it for per-site circuits (tor-isolation.cjs), and it removes a cross-site link everywhere else too.
const NETWORK_PARTITION_FEATURES=Object.freeze(['PartitionConnectionsByNetworkIsolationKey','PartitionSSLSessionsByNetworkIsolationKey','PartitionHttpServerPropertiesByNetworkIsolationKey']);
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
 mergeFeatures(app,{enable:[...(block?THIRD_PARTY_COOKIE_FEATURES:['ThirdPartyStoragePartitioning']),...NETWORK_PARTITION_FEATURES],disable:[...AD_API_FEATURES,...(block?[]:['ForceThirdPartyCookieBlockingEnabled'])]});
 return {thirdPartyCookies:block?'block':'allow',adApis:'removed',scope:'application',changeRequiresRestart:true};
}
/** Read-only runtime truth: what this process was actually started with. */
function engineFeatureStatus(app){
 if(!app?.commandLine)return {thirdPartyCookies:'unknown',adApis:'unknown'};
 const enabled=app.commandLine.getSwitchValue('enable-features').split(',').map(name),disabled=app.commandLine.getSwitchValue('disable-features').split(',').map(name);
 return {thirdPartyCookies:enabled.includes('ForceThirdPartyCookieBlockingEnabled')?'block':'allow',adApis:AD_API_FEATURES.every(feature=>disabled.includes(feature))?'removed':'available'};
}
module.exports={configureEngineFeatures,engineFeatureStatus,AD_API_FEATURES,THIRD_PARTY_COOKIE_FEATURES,NETWORK_PARTITION_FEATURES};
