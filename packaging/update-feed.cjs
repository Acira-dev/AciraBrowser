'use strict';
// Public metadata only. Application source and build outputs stay separate.
// DEFAULT_FEED_URL is what a NEW build's app-update.yml names (beta.11 and later: update.acirabrowser.com). LEGACY_FEED_URL is the GitHub raw feed that every build
// up to beta.10 reads and that beta.11 and later fall back to; beta.11 is the last release written there, then it is frozen (docs/launch/UPDATE_HOST.md).
// Both live in desktop/browser-services/update-hosts.cjs, which the app itself uses.
const {HOST_URL,GITHUB_FEED_URL}=require('../desktop/browser-services/update-hosts.cjs');
const DEFAULT_FEED_URL=HOST_URL;
const LEGACY_FEED_URL=GITHUB_FEED_URL;
const UPDATE_REPOSITORY='Acira-dev/AciraBrowserUpdates';
// No release or download is represented by this sentinel. Downgrades stay off.
const STANDBY_UPDATE=Object.freeze({version:'0.0.0',files:Object.freeze([]),releaseNotes:'Public update feed ready; no application payloads published.'});
function publicFeedConfig(value=DEFAULT_FEED_URL){
 let url;try{url=new URL(value);}catch{throw Error('The update feed must be a public HTTPS URL.');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('The update feed must use HTTPS without credentials, tokens or query parameters.');
 if(!url.pathname.endsWith('/'))url.pathname+='/';
 return {provider:'generic',url:url.href};
}
module.exports={DEFAULT_FEED_URL,LEGACY_FEED_URL,UPDATE_REPOSITORY,STANDBY_UPDATE,publicFeedConfig};
