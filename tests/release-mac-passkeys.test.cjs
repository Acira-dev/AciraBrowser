'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {CAPABILITY,validateProfile,preparePasskeySigning,configureBuilderPasskeys}=require('../packaging/macos/passkeys.cjs');
const {signingPolicy,signOptions}=require('../packaging/macos/signing.cjs');
const team='2MGLP3QV9X',appId='computer.acira.browser',identity='Developer ID Application: Khaled Kaed Beyh (2MGLP3QV9X)';
const profile=()=>({TeamIdentifier:[team],ProvisionsAllDevices:true,ExpirationDate:new Date(Date.now()+86400000),Entitlements:{[CAPABILITY]:true,'com.apple.application-identifier':team+'.'+appId}});
test('activation requires the exact managed entitlement, team, app identifier and unexpired Developer ID profile',()=>{
 assert.equal(validateProfile(profile(),{team,appId})[CAPABILITY],true);
 for(const change of [{TeamIdentifier:['A1B2C3D4E5']},{ProvisionsAllDevices:false},{ExpirationDate:new Date(0)},{Entitlements:{[CAPABILITY]:false,'com.apple.application-identifier':team+'.'+appId}},{Entitlements:{[CAPABILITY]:true,'com.apple.application-identifier':team+'.other.app'}}])assert.throws(()=>validateProfile({...profile(),...change},{team,appId}));
});
test('without an explicit approved profile packaging has no entitlement/profile side effects',async()=>{
 let reads=0;assert.equal(await preparePasskeySigning({readProfile:()=>{reads++;}}),null);assert.equal(reads,0);
 const config={mac:{}};assert.equal(configureBuilderPasskeys(config,{}),config);assert.equal(config.afterPack,undefined);
 assert.throws(()=>configureBuilderPasskeys({mac:{}},{ACIRA_MAC_BROWSER_PASSKEY_PROFILE:'/some/profile'}),/requires an explicit Developer ID/);
});
test('approved-profile packaging embeds the provided profile and applies managed entitlements only to the browser root',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-passkey-signing-'));
 try{
  const application=path.join(root,'Acira Browser.app'),work=path.join(root,'work'),file=path.join(root,'fixture.provisionprofile');await fs.mkdir(path.join(application,'Contents'),{recursive:true});await fs.writeFile(file,'synthetic profile bytes; not an Apple authorization');
  const policy=signingPolicy(identity,true),prepared=await preparePasskeySigning({application,work,profilePath:file,policy,readProfile:async()=>profile()});
  assert.equal(await fs.readFile(path.join(application,'Contents/embedded.provisionprofile'),'utf8'),await fs.readFile(file,'utf8'));
  const entitlements=require('plist').parse(await fs.readFile(prepared.entitlements,'utf8'));assert.equal(entitlements[CAPABILITY],true);assert.equal(entitlements['com.apple.application-identifier'],team+'.'+appId);
  const options=signOptions(application,policy,prepared);assert.equal(options.optionsForFile(application).entitlements,prepared.entitlements);assert.equal(options.optionsForFile(path.join(application,'Contents/Frameworks/Helper.app')).entitlements,undefined);
  await assert.rejects(()=>preparePasskeySigning({application,work,profilePath:file,policy:signingPolicy(),readProfile:async()=>profile()}),/requires Developer ID/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
