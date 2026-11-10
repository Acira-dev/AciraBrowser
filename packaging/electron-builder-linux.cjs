'use strict';
const base=require('./electron-builder.json'),{DEFAULT_FEED_URL,publicFeedConfig}=require('./update-feed.cjs');
const config=structuredClone(base),qa=process.env.ACIRA_BUILD_IDENTITY==='qa';
delete config.win;delete config.mac;delete config.nsis;delete config.dmg;
config.appId=qa?'computer.acira.browser.qa':'computer.acira.browser';
config.productName=qa?'Acira Browser QA':'Acira Browser';
config.executableName=qa?'AciraBrowserQA':'AciraBrowser';
config.directories.output='release/linux-'+(qa?'qa':'normal');
config.compression='normal';
config.extraResources=[{from:'desktop/browser-services/tor-engine/linux-x64',to:'tor'}];
config.publish=[{...publicFeedConfig(process.env.ACIRA_UPDATE_FEED_URL||DEFAULT_FEED_URL+'linux/'),channel:'latest'}];
config.generateUpdatesFilesForAllChannels=true;
config.extraMetadata={...config.extraMetadata,desktopName:qa?'acira-browser-qa.desktop':'acira-browser.desktop',...(qa?{name:'acira-browser-qa',productName:config.productName,aciraIdentity:'qa'}:{})};
if(qa&&process.env.ACIRA_LINUX_QA_VERSION){if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(process.env.ACIRA_LINUX_QA_VERSION))throw Error('Invalid QA package version.');config.extraMetadata.version=process.env.ACIRA_LINUX_QA_VERSION;}
/* 13.6: launcher actions in the AppImage's own .desktop file (New window, New private window): each starts Acira with a flag (desktop/os-new-window.cjs). The installer script (packaging/linux/install-acira-linux.py) writes the same two actions into the entry it installs. Names are the app's own translations. */
const LOCALES=['en','es','fr','de','pt-BR','it','ja','zh-CN','ar','tr','ru','ko','hi'],actionNames=id=>Object.fromEntries(LOCALES.map(code=>[code==='en'?'Name':'Name['+code.replace('-','_')+']',require('../src/i18n/'+code+'.json')[id]]));
/* the AppImage's own entry starts `AppRun --no-sandbox %U` (electron-builder's AppImage default); a desktop integrator replaces the AppRun part with the AppImage's path */const APP_RUN='AppRun --no-sandbox';
const desktopActions={NewWindow:{...actionNames('browsermenu.newWindow'),Exec:APP_RUN+' --acira-new-window'},NewPrivateWindow:{...actionNames('browsermenu.newPrivateWindow'),Exec:APP_RUN+' --acira-new-private-window'}};
config.linux={target:[{target:'AppImage',arch:['x64']}],syncDesktopName:true,category:'Network',icon:'packaging/acira-icon-512.png',artifactName:(qa?'AciraBrowserQA':'AciraBrowser')+'-${version}-linux-${arch}.${ext}',executableName:config.executableName,mimeTypes:['text/html','x-scheme-handler/http','x-scheme-handler/https'],desktop:{entry:{Actions:'NewWindow;NewPrivateWindow;'},desktopActions}};
config.files.push('!desktop/native/build/**','!desktop/browser-services/tor-engine/darwin-*/**','!desktop/browser-services/tor-engine/linux-*/**','!resources/tor/**');
if(qa){config.extraMetadata.main='qa/linux-update-entry.cjs';config.files.push('qa/linux-update-entry.cjs');}
config.electronFuses={runAsNode:false,enableCookieEncryption:true,enableNodeOptionsEnvironmentVariable:false,enableNodeCliInspectArguments:false,enableEmbeddedAsarIntegrityValidation:false,onlyLoadAppFromAsar:true,loadBrowserProcessSpecificV8Snapshot:false,grantFileProtocolExtraPrivileges:true};
module.exports=config;
