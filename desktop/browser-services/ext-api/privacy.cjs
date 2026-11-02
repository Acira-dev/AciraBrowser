'use strict';
// chrome.privacy for extensions (docs/launch/EXTENSION_WORK_PACKAGES.md, package P6). Essentials: privacy.network.* and privacy.services.*.
// privacy.websites.* stays Chromium's default answer ("Access to extension API denied.") until a later round.
const {installSettings}=require('./_settings.cjs');
const {definitions}=require('./privacy/table.cjs');

module.exports={
 namespaces:['privacy'],
 install(api,options){
  const settings=installSettings(api,definitions(),options);
  return {forget:id=>settings.forget(id),dispose:()=>settings.dispose()};
 }
};
