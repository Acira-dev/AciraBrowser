'use strict';
// Public metadata only. Application source and build outputs stay separate.
const DEFAULT_FEED_URL='https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/';
const UPDATE_REPOSITORY='Acira-dev/AciraBrowserUpdates';
// No release or download is represented by this sentinel. Downgrades stay off.
const STANDBY_UPDATE=Object.freeze({version:'0.0.0',files:Object.freeze([]),releaseNotes:'Public update feed ready; no application payloads published.'});
function publicFeedConfig(value=DEFAULT_FEED_URL){
 let url;try{url=new URL(value);}catch{throw Error('The update feed must be a public HTTPS URL.');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('The update feed must use HTTPS without credentials, tokens or query parameters.');
 if(!url.pathname.endsWith('/'))url.pathname+='/';
 return {provider:'generic',url:url.href};
}
module.exports={DEFAULT_FEED_URL,UPDATE_REPOSITORY,STANDBY_UPDATE,publicFeedConfig};
