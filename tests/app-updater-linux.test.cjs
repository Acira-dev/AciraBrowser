'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAppUpdater,updateFile}=require('../desktop/browser-services/app-updater.cjs');
const make=extra=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-linux-update-'));return createAppUpdater({app:{isPackaged:true,getVersion:()=> '0.1.0-beta.10',getPath:()=>dir},dir,platform:'linux',env:{APPIMAGE:'/home/example/AciraBrowser.AppImage'},qaBuild:false,schedule:()=>null,every:()=>null,...extra});};
test('packaged Linux AppImage offers updates without a Windows uninstaller',()=>assert.equal(make({uninstallerPresent:()=>false}).status().supported,true));
test('unpacked Linux build explains AppImage installation requirement',()=>{const s=make({env:{}}).status();assert.equal(s.supported,false);assert.match(s.reason,/AppImage/);});
test('QA identity cannot accidentally update to the normal Linux release',()=>assert.equal(make({qaBuild:true}).status().supported,false));
test('test profiles keep update checks disabled outside the explicit update rig',()=>assert.equal(make({env:{APPIMAGE:'/tmp/Acira.AppImage',ACIRA_BROWSER_TEST_DATA:'/tmp/test'}}).status().supported,false));
test('Linux resumable download selects AppImage and excludes Windows setup files',()=>{
 const files=[{url:new URL('https://example.invalid/setup.exe'),info:{url:'setup.exe',size:10,sha512:'windows'}},{url:new URL('https://example.invalid/Acira.AppImage'),info:{url:'Acira.AppImage',size:12,sha512:'linux'}}];
 const selected=updateFile({updateInfoAndProvider:{info:{version:'0.1.0-beta.11'},provider:{resolveFiles:()=>files}}},{platform:'linux',arm64:()=>false});
 assert.equal(selected.name,'Acira.AppImage');assert.equal(selected.sha512,'linux');
});
test('Linux update payload without a checksum never enters the resumable cache',()=>assert.equal(updateFile({updateInfoAndProvider:{info:{version:'0.1.0-beta.11'},provider:{resolveFiles:()=>[{url:new URL('https://example.invalid/Acira.AppImage'),info:{size:12}}]}}},{platform:'linux',arm64:()=>false}),null));
