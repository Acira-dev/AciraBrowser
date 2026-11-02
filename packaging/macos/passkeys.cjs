'use strict';
// Opt-in packaging for an Apple-issued browser passkey provisioning profile.
// A normal build never adds the managed entitlement or accesses a profile.
const fs=require('node:fs/promises'),path=require('node:path');
const {promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
const plist=require('plist');
const CAPABILITY='com.apple.developer.web-browser.public-key-credential';
function validateProfile(profile,{team,appId,now=Date.now()}){
 const identifier=team+'.'+appId,entitlements=profile?.Entitlements;
 if(!/^[A-Z0-9]{10}$/.test(team||'')||!/^[-a-zA-Z0-9.]+$/.test(appId||''))throw Error('Passkey signing requires the exact team and application identifier.');
 if(entitlements?.[CAPABILITY]!==true||entitlements['com.apple.application-identifier']!==identifier||!profile.TeamIdentifier?.includes(team))throw Error('The provisioning profile does not authorize browser passkeys for '+identifier+'.');
 if(!Number.isFinite(new Date(profile.ExpirationDate).getTime())||new Date(profile.ExpirationDate).getTime()<=now)throw Error('The browser passkey provisioning profile is expired.');
 if(profile.ProvisionsAllDevices!==true)throw Error('Use a Developer ID provisioning profile for distribution to arbitrary Macs.');
 return {[CAPABILITY]:true,'com.apple.application-identifier':identifier,'com.apple.developer.team-identifier':team};
}
async function decodeProfile(file){
 const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)throw Error('Use a local Apple-issued provisioning profile file.');
 // CMS decoding reads the signed profile, not a password or private signing key.
 const result=await exec('/usr/bin/security',['cms','-D','-i',file],{timeout:15000,maxBuffer:2*1024*1024});
 return plist.parse(result.stdout);
}
async function preparePasskeySigning({application,work,profilePath,policy,appId='computer.acira.browser',readProfile=decodeProfile}){
 if(!profilePath)return null;
 if(!policy.distribution||!policy.team)throw Error('Browser passkey packaging requires Developer ID signing and an approved provisioning profile.');
 const file=path.resolve(profilePath),managed=validateProfile(await readProfile(file),{team:policy.team,appId});
 const template=plist.parse(await fs.readFile(path.join(__dirname,'..','mac','entitlements.mac.plist'),'utf8'));
 const entitlements=path.join(work,'browser-passkey-entitlements.plist');
 await fs.mkdir(work,{recursive:true});await fs.writeFile(entitlements,plist.build({...template,...managed}));
 await fs.copyFile(file,path.join(application,'Contents','embedded.provisionprofile'));
 return {entitlements,applicationIdentifier:managed['com.apple.application-identifier'],capability:CAPABILITY,requiresNewSignedBuild:true};
}
// After the final seal: the browser root really carries the managed entitlement for this app identifier, beside the embedded profile.
// (A re-sign without --preserve-metadata=entitlements, or a root signed with the plain template, silently ships without passkeys.)
async function signedEntitlements(application){
 const result=await exec('/usr/bin/codesign',['--display','--entitlements','-','--xml',application],{timeout:15000,maxBuffer:2*1024*1024});
 return plist.parse(result.stdout);
}
async function verifySignedPasskeys(application,prepared,{read=signedEntitlements}={}){
 const signed=await read(application);
 if(signed?.[CAPABILITY]!==true||signed['com.apple.application-identifier']!==prepared.applicationIdentifier)throw Error('The signed browser does not carry the approved passkey entitlement for '+prepared.applicationIdentifier+'.');
 const profile=await fs.lstat(path.join(application,'Contents','embedded.provisionprofile')).catch(()=>null);
 if(!profile?.isFile())throw Error('The signed browser has no embedded passkey provisioning profile.');
 return true;
}
function configureBuilderPasskeys(config,env){
 const profilePath=env.ACIRA_MAC_BROWSER_PASSKEY_PROFILE;
 if(!profilePath)return config;
 const policy=require('./signing.cjs').signingPolicy(env.ACIRA_MAC_SIGN_IDENTITY,true);
 config.mac.identity=policy.identity;
 const prior=config.afterPack;
 config.afterPack=async context=>{
  if(prior)await prior(context);
  if(context.electronPlatformName!=='darwin')return;
  const application=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app');
  const prepared=await preparePasskeySigning({application,work:path.join(context.appOutDir,'passkey-signing-inputs'),profilePath,policy,appId:config.appId});
  context.packager.platformSpecificBuildOptions.entitlements=prepared.entitlements;
  context.packager.platformSpecificBuildOptions.provisioningProfile=path.resolve(profilePath);
 };
 return config;
}
module.exports={CAPABILITY,validateProfile,decodeProfile,preparePasskeySigning,signedEntitlements,verifySignedPasskeys,configureBuilderPasskeys};
