'use strict';
// electron-builder entry point. Unsigned by default; signing switches on from environment variables only, so no
// secret ever lives in the repository. See docs/launch/CODE_SIGNING.md.
//   Azure Trusted Signing : ACIRA_SIGN=azure  + AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
//                           + ACIRA_AZURE_ENDPOINT / ACIRA_AZURE_ACCOUNT / ACIRA_AZURE_PROFILE / ACIRA_PUBLISHER_NAME
//   Certificate file (PFX): CSC_LINK (path or base64) + CSC_KEY_PASSWORD + ACIRA_PUBLISHER_NAME (certificate CN)
//   Cloud HSM / token     : ACIRA_SIGN_COMMAND=<path to a signing script electron-builder calls per file>
//                           + ACIRA_PUBLISHER_NAME
const base=require('./electron-builder.json');
const {applyReleaseTarget,loadReleaseTarget}=require('./release-target.cjs'); // "publish" (where the installed app looks for updates) comes from packaging/release-target.json
function signingMode(env){
 if(env.ACIRA_SIGN==='azure')return 'azure';
 if(env.ACIRA_SIGN_COMMAND)return 'command';
 if(env.CSC_LINK)return 'pfx';
 return 'none';
}
function requireEnv(env,names,mode){
 const missing=names.filter(name=>!env[name]);
 if(missing.length)throw new Error(`Code signing (${mode}) needs these environment variables: ${missing.join(', ')}.`);
}
// QA identity (ACIRA_BUILD_IDENTITY=qa, set by `node scripts/release.mjs --qa-identity`): the same app and installer under names that
// share nothing Windows can see with the real Acira, so QA installs and uninstalls on a PC that also has the real one never touch it:
// app id (and with it the installer/uninstall GUID and the one-installer mutex), product and Start-menu name, default install folder
// (%LOCALAPPDATA%\Programs\<name>), registry keys, URL ProgID and registration (acira-installer-qa.nsh), data folder and taskbar id
// (desktop/build-identity.cjs via the packaged package.json). Never published (release.mjs refuses --qa-identity with --publish).
const QA_IDENTITY=Object.freeze({appId:'computer.acira.browser.qa',productName:'Acira Browser QA',executableName:'AciraBrowserQA',guid:'7c3f8a1e-5b2d-5e94-a6c0-3d1e9f4b2a87',name:'acira-browser-qa',include:'packaging/acira-installer-qa.nsh'});
function applyIdentity(config,env){
 if(env.ACIRA_BUILD_IDENTITY!=='qa')return config;
 config.appId=QA_IDENTITY.appId;config.productName=QA_IDENTITY.productName;config.executableName=QA_IDENTITY.executableName;
 config.nsis.guid=QA_IDENTITY.guid;config.nsis.shortcutName=QA_IDENTITY.productName;config.nsis.include=QA_IDENTITY.include;
 config.extraMetadata={...config.extraMetadata,name:QA_IDENTITY.name,productName:QA_IDENTITY.productName,aciraIdentity:'qa'};
 config.win.artifactName=config.win.artifactName.replace(/^AciraBrowser/,'AciraBrowserQA');config.nsis.artifactName=config.nsis.artifactName.replace(/^AciraBrowser/,'AciraBrowserQA'); // AciraBrowserQASetup.exe, AciraBrowserQA-portable.zip
 return config;
}
function createConfig(env=process.env,releaseTarget=loadReleaseTarget()){
 const config=applyReleaseTarget(structuredClone(base),releaseTarget),mode=signingMode(env);
 applyIdentity(config,env);
 config.electronFuses={...require('./fuses.cjs').WINDOWS}; // this config builds Windows only (scripts/release.mjs --win); electron-builder burns them right before signing. Mac packaging sets its own (packaging/macos/widevine.cjs)
 if(env.ACIRA_MAC_BROWSER_PASSKEY_PROFILE)require('./macos/passkeys.cjs').configureBuilderPasskeys(config,env); // Mac only; loaded on demand so a Windows build never needs its plist module
 // Both platforms read updates from the public metadata feed (packaging/update-feed.cjs). Windows follows the release target above
 // (packaging/release-target.json, the same feed); ACIRA_UPDATE_FEED_URL overrides it at build time. Mac: ACIRA_MAC_UPDATE_FEED_URL,
 // else ACIRA_UPDATE_FEED_URL, else the default feed.
 const {publicFeedConfig}=require('./update-feed.cjs');
 if(env.ACIRA_UPDATE_FEED_URL)config.publish=[{...publicFeedConfig(env.ACIRA_UPDATE_FEED_URL),channel:'latest'}];
 config.mac.publish=[publicFeedConfig(env.ACIRA_MAC_UPDATE_FEED_URL||env.ACIRA_UPDATE_FEED_URL||undefined)];
 if(mode==='none')return config;
 requireEnv(env,['ACIRA_PUBLISHER_NAME'],mode);
 const publisher=env.ACIRA_PUBLISHER_NAME;
 config.forceCodeSigning=true;config.win.signAndEditExecutable=true;config.win.signDlls=true; // every exe and dll in the app, not only the main program
 delete config.win.signExecutable;config.win.verifyUpdateCodeSignature=true;
 if(mode==='azure'){
  requireEnv(env,['AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET','ACIRA_AZURE_ENDPOINT','ACIRA_AZURE_ACCOUNT','ACIRA_AZURE_PROFILE'],mode);
  config.win.azureSignOptions={publisherName:publisher,endpoint:env.ACIRA_AZURE_ENDPOINT,codeSigningAccountName:env.ACIRA_AZURE_ACCOUNT,certificateProfileName:env.ACIRA_AZURE_PROFILE};
 }else if(mode==='command'){
  config.win.signtoolOptions={publisherName:[publisher],sign:env.ACIRA_SIGN_COMMAND};
 }else{
  requireEnv(env,['CSC_KEY_PASSWORD'],mode);
  config.win.signtoolOptions={publisherName:[publisher],signingHashAlgorithms:['sha256'],rfc3161TimeStampServer:env.ACIRA_TIMESTAMP_URL||'http://timestamp.digicert.com'};
 }
 return config;
}
module.exports={createConfig,signingMode,QA_IDENTITY};
