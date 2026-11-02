'use strict';
const {publicFeedConfig}=require('./update-feed.cjs');
function windowsUpdateConfig({feed=process.env.ACIRA_UPDATE_FEED_URL,qa=false}={}){
 return {...publicFeedConfig(feed),updaterCacheDirName:qa?'acira-browser-qa-updater':'acira-browser-updater'};
}
module.exports={windowsUpdateConfig};
