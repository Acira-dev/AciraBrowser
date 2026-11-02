'use strict';
// The installed Windows app finds its update feed in resources/app-update.yml (electron-updater reads it from process.resourcesPath). electron-builder writes that
// file only when it packs the app itself; scripts/release-installer.mjs gives it a prepackaged folder (--prepackaged), where electron-builder skips that step, so
// the setup built that way carried no feed and no installed copy could ever update. The portable package (scripts/release-package.mjs) now contains this file,
// built from the same release target (packaging/release-target.json) as before, so it is part of the signed-off payload manifest and of the setup.
const {loadReleaseTarget}=require('./release-target.cjs');
const {publicFeedConfig}=require('./update-feed.cjs');
const FILE='resources/app-update.yml';
function windowsUpdateConfig(target=loadReleaseTarget()){
 if(target.provider!=='generic')throw Error('The Windows update feed is the public generic feed (packaging/release-target.json); got provider '+target.provider+'.');
 return {...publicFeedConfig(target.url),updaterCacheDirName:'acira-browser-updater'}; // the same cache folder name the Mac app uses
}
// JSON strings are valid YAML scalars, like the Mac writer (packaging/macos/update-feed.cjs).
const serializeUpdateConfig=config=>Object.entries(config).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')+'\n';
module.exports={FILE,windowsUpdateConfig,serializeUpdateConfig};
