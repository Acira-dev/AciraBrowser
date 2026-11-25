'use strict';
// ACIRA-BUILD.json (inside the app) and ACIRA-INSTALLER-BUILD.json (inside Install Acira.app) are sealed by the signature before Apple notarizes the
// bundle, so they cannot know the outcome: they say whether notarization was requested. The receipt beside the app (mac-widevine-package.json) is
// written after stapling and records what Apple, stapler and Gatekeeper actually reported. The 0.1.0-beta.6.local.4 build said notarized:false inside
// an app that spctl and stapler accept as notarized; these tests keep that from coming back.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {notarizationPolicy,notarizeBundle,sealedNotarization,notarizationOutcome}=require('../packaging/macos/notarization.cjs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('a sealed build file says whether notarization was requested, never a result it cannot know yet',()=>{
 assert.equal(sealedNotarization(notarizationPolicy(true,'acira-release')),'requested');
 assert.equal(sealedNotarization(notarizationPolicy(false)),'none');
});

test('the receipt takes notarized and stapled from what Apple and the tools reported',async()=>{
 const id=crypto.randomUUID(),accepted=async(file,args)=>({stdout:args[0]==='notarytool'?JSON.stringify({status:'Accepted',id}):''});
 const submission=await notarizeBundle({bundle:'/owned/Acira Browser.app',work:'/owned',policy:notarizationPolicy(true,'acira-release'),run:accepted});
 assert.deepEqual(notarizationOutcome(submission),{notarized:true,stapled:true,gatekeeperAccepted:true});
 assert.deepEqual(notarizationOutcome(null),{notarized:false,stapled:false,gatekeeperAccepted:false},'not sent to Apple');
 assert.deepEqual(notarizationOutcome({status:'Invalid',stapled:true,gatekeeperAccepted:true}),{notarized:false,stapled:false,gatekeeperAccepted:false},'a rejected submission is never reported as notarized');
 assert.deepEqual(notarizationOutcome({status:'Accepted',id}),{notarized:true,stapled:false,gatekeeperAccepted:false},'accepted but the staple was never confirmed');
});

test('the packagers write no notarization result into a sealed file, and the receipt is measured after stapling',()=>{
 const widevine=read('scripts/package-mac-widevine.mjs'),installer=read('scripts/package-mac-beta-installer.mjs');
 const build=widevine.match(/const build=\{[^\n]*\};/)?.[0];assert(build,'the ACIRA-BUILD.json object is where it was');
 assert.match(build,/notarization:sealedNotarization\(notary\)/);assert.doesNotMatch(build,/notarized:|stapled:/);
 const receipt=widevine.match(/const receipt=\{[^\n]*\};/)?.[0];assert(receipt);
 assert.match(receipt,/\.\.\.notarizationOutcome\(appleSubmission\?\.browser\)/);assert.doesNotMatch(receipt,/notarized:notary\.enabled|stapled:notary\.enabled/);
 assert(widevine.indexOf('appleSubmission.browser=await notarizeBundle')<widevine.indexOf('const receipt='),'the receipt is written after the app was notarized and stapled');
 assert.match(widevine,/receipt\.installerNotarized=outcome\.notarized/,'the installer outcome replaces the "not notarized" the installer packager returned');
 const sealed=installer.match(/ACIRA-INSTALLER-BUILD\.json'\),JSON\.stringify\(\{[^}]*\}/)?.[0];assert(sealed);
 assert.match(sealed,/notarization,/);assert.doesNotMatch(sealed,/notarized:|stapled:/);
 assert.match(installer,/notarized:payloadNotarized/,'payload.json says whether the archived browser was already notarized');
});

test('the Mac disk image is lzma (ULMO): the installer is a second Electron and zlib left 42.5 MB of the download on the table (14.0)',()=>{
 const widevine=read('scripts/package-mac-widevine.mjs');
 const create=widevine.match(/hdiutil',\['create'[^\]]*\]/)?.[0];assert(create,'the packager still builds its disk image with hdiutil create');
 assert.match(create,/'-format','ULMO'/);assert.doesNotMatch(create,/UDZO/);
 assert.match(widevine,/hdiutil',\['verify',diskImage\]/,'the image is still verified after it is signed');
});

// D142 (22 Nov 2026): two of the sentences macOS shows in its own permission questions were still the engine's ("This app needs access to audio
// capture", "... Bluetooth"), kept by the build template. All five come from packaging/macos/permission-texts.cjs.
test('the sentences in macOS\'s permission questions are Acira\'s own, written by both packagers, and the installer carries none',()=>{
 const {macPermissionTexts}=require('../packaging/macos/permission-texts.cjs'),texts=macPermissionTexts();
 assert.deepEqual(Object.keys(texts).sort(),['NSAudioCaptureUsageDescription','NSBluetoothAlwaysUsageDescription','NSBluetoothPeripheralUsageDescription','NSCameraUsageDescription','NSMicrophoneUsageDescription']);
 for(const [key,text] of Object.entries(texts)){
  assert.match(text,/^Allow a website you choose to .+ in Acira\.$/,key+': the same shape as the camera line');
  assert.doesNotMatch(text,/This app|Electron/i,key);assert.ok(text.length<=80,key+' stays one short line in the system\'s box');
 }
 assert.equal(texts.NSCameraUsageDescription,'Allow a website you choose to use the camera in Acira.');
 assert.equal(texts.NSMicrophoneUsageDescription,'Allow a website you choose to use the microphone in Acira.');
 assert.equal(texts.NSBluetoothAlwaysUsageDescription,texts.NSBluetoothPeripheralUsageDescription,'macOS\'s two Bluetooth keys say the same');
 assert.notDeepEqual(macPermissionTexts(),null);assert.notEqual(macPermissionTexts(),macPermissionTexts(),'a fresh object each time: a packager may add to its copy');
 const widevine=read('scripts/package-mac-widevine.mjs'),installer=read('scripts/package-mac-beta-installer.mjs'),plain=read('scripts/package-mac.mjs');
 const edit=widevine.indexOf("Object.assign(info,require('../packaging/macos/permission-texts.cjs').macPermissionTexts())");
 assert.ok(edit>0&&edit<widevine.indexOf('await fs.writeFile(infoFile,plist.build(info))'),'the release writes them into the bundle\'s Info.plist, over the template\'s');
 assert.ok(plain.includes("Object.assign(info,require('../packaging/macos/permission-texts.cjs').macPermissionTexts())"));
 assert.doesNotMatch(plain+widevine,/info\.NS\w+UsageDescription=/,'no sentence is written anywhere else');
 assert.match(installer,/\.\.\.Object\.keys\(require\('\.\.\/packaging\/macos\/permission-texts\.cjs'\)\.macPermissionTexts\(\)\),'ElectronAsarIntegrity'\]\)delete info\[key\];/,'the installer asks for nothing: every key goes');
 for(const text of [widevine,installer,plain])assert.ok(text.includes("'packaging/macos/permission-texts.cjs'"),'recorded among the build\'s inputs');
});
