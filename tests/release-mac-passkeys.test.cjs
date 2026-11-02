'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {CAPABILITY,validateProfile,preparePasskeySigning,signedEntitlements,verifySignedPasskeys,configureBuilderPasskeys}=require('../packaging/macos/passkeys.cjs');
const {signingPolicy,signOptions,resealArguments}=require('../packaging/macos/signing.cjs');
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
// The Widevine packager (scripts/package-mac-widevine.mjs) is what ships the Mac beta. Until 2 Nov it re-signed the browser root with the
// plain entitlements and never embedded a profile, so even an approved profile could not have turned passkeys on.
test('after the final seal, a passkey build is checked for the managed entitlement on the root and the embedded profile',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-passkey-verify-'));
 try{
  const application=path.join(root,'Acira Browser.app'),prepared={applicationIdentifier:team+'.'+appId};await fs.mkdir(path.join(application,'Contents'),{recursive:true});
  const signed={[CAPABILITY]:true,'com.apple.application-identifier':team+'.'+appId};
  await assert.rejects(()=>verifySignedPasskeys(application,prepared,{read:async()=>signed}),/no embedded passkey provisioning profile/);
  await fs.writeFile(path.join(application,'Contents/embedded.provisionprofile'),'synthetic profile bytes');
  assert.equal(await verifySignedPasskeys(application,prepared,{read:async()=>signed}),true);
  for(const wrong of [{},{'com.apple.security.cs.allow-jit':true},{...signed,[CAPABILITY]:false},{...signed,'com.apple.application-identifier':team+'.other.app'}])await assert.rejects(()=>verifySignedPasskeys(application,prepared,{read:async()=>wrong}),/does not carry the approved passkey entitlement/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('the signed-entitlement reader parses what codesign reports for a real (ad-hoc, never launched) bundle',{skip:process.platform!=='darwin'&&'macOS codesign only'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-passkey-codesign-'));
 try{
  const application=path.join(root,'Probe.app'),macos=path.join(application,'Contents/MacOS');await fs.mkdir(macos,{recursive:true});
  await fs.copyFile('/usr/bin/true',path.join(macos,'Probe'));
  await fs.writeFile(path.join(application,'Contents/Info.plist'),require('plist').build({CFBundleExecutable:'Probe',CFBundleIdentifier:'computer.acira.passkey-probe',CFBundlePackageType:'APPL'}));
  const entitlements=path.join(root,'entitlements.plist');await fs.writeFile(entitlements,require('plist').build({'com.apple.security.cs.allow-jit':true,[CAPABILITY]:true,'com.apple.application-identifier':team+'.'+appId}));
  // Ad-hoc ('-'): no certificate or Keychain is involved, and the probe is never run.
  require('node:child_process').execFileSync('/usr/bin/codesign',['--force','--sign','-','--entitlements',entitlements,application],{stdio:'ignore'});
  const signed=await signedEntitlements(application);
  assert.equal(signed[CAPABILITY],true);assert.equal(signed['com.apple.application-identifier'],team+'.'+appId);assert.equal(signed['com.apple.security.cs.allow-jit'],true);
  await fs.writeFile(path.join(application,'Contents/embedded.provisionprofile'),'synthetic profile bytes');
  assert.equal(await verifySignedPasskeys(application,{applicationIdentifier:team+'.'+appId}),true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('the Widevine Mac packager embeds an approved profile, puts the managed entitlement on the browser root only and checks it after sealing',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'../scripts/package-mac-widevine.mjs'),'utf8');
 assert.match(source,/browserPasskeyProfile=process\.env\.ACIRA_MAC_BROWSER_PASSKEY_PROFILE/,'the same switch as package-mac.mjs and electron-builder');
 assert.match(source,/await fs\.rm\(path\.join\(contents,'embedded\.provisionprofile'\),\{force:true\}\);[\s\S]*const passkeys=await preparePasskeySigning\(\{application:appBundle,work:passkeyWork,profilePath:browserPasskeyProfile,policy\}\)/,'a template profile never ships by itself; an approved one is validated and embedded');
 assert.match(source,/iCloudPasskeysEnabled:Boolean\(passkeys\)/);
 assert.match(source,/entitlements:path\.resolve\(file\)===appBundle\?\(passkeys\?\.entitlements\|\|path\.join\(repo,'packaging\/mac\/entitlements\.mac\.plist'\)\):path\.join\(repo,'packaging\/mac\/entitlements\.mac\.inherit\.plist'\)/,'helpers and frameworks keep the inherit entitlements');
 const order=['const passkeys=await preparePasskeySigning','await signAsync(','resealArguments(appBundle,policy)','if(passkeys){await verifySignedPasskeys(appBundle,passkeys)','appleSubmission.browser=await notarizeBundle'].map(text=>source.indexOf(text));
 assert.ok(order.every(index=>index>0),JSON.stringify(order));assert.deepEqual([...order].sort((a,b)=>a-b),order,'prepare, sign, reseal, verify, then notarize');
 assert.match(source,/browserPasskeys:passkeys\?\{capability:passkeys\.capability,applicationIdentifier:passkeys\.applicationIdentifier,requiresNewSignedBuild:true,realAccountAuthenticationVerified:false\}:null/);
 // The final seal after the Tor manifest keeps whatever entitlements the root was signed with.
 assert.ok(resealArguments('/A.app',signingPolicy(identity,true)).includes('--preserve-metadata=entitlements'));
});
