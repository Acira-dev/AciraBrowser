'use strict';
// The Windows setup is built from a prepackaged folder, where electron-builder writes no resources/app-update.yml, so an installed copy had no update feed.
// The portable package now carries the file (packaging/windows-update-config.cjs); these tests keep it right and keep the Windows build from skipping it.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {windowsUpdateConfig,serializeUpdateConfig,FILE}=require('../packaging/windows-update-config.cjs');
const {DEFAULT_FEED_URL}=require('../packaging/update-feed.cjs'),{writeMacUpdateConfig}=require('../packaging/macos/update-feed.cjs');
const {AppUpdater}=require('electron-updater/out/AppUpdater');
const read=file=>fs.readFile(path.join(__dirname,'..',file),'utf8');

test('Windows and Mac read the same public feed, and the real electron-updater loads the file',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-win-update-config-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config=windowsUpdateConfig();
 assert.deepEqual(config,{provider:'generic',url:DEFAULT_FEED_URL,updaterCacheDirName:'acira-browser-updater'});
 const windowsFile=path.join(root,'windows-app-update.yml');await fs.writeFile(windowsFile,serializeUpdateConfig(config));
 await writeMacUpdateConfig(root);
 const updater=new AppUpdater(null,{isPackaged:true,version:'0.1.0-beta.6',name:'Acira test fixture',userDataPath:root,baseCachePath:root,appUpdateConfigPath:windowsFile,whenReady:async()=>{}});
 const loaded=await updater.configOnDisk.value;
 assert.equal(loaded.provider,'generic');assert.equal(loaded.url,DEFAULT_FEED_URL);
 assert.equal(require('js-yaml').load(await fs.readFile(path.join(root,'app-update.yml'),'utf8')).url,loaded.url,'both platforms');
 assert.equal(FILE,'resources/app-update.yml');
});
test('only the public generic feed is accepted; a private or token URL is refused',()=>{
 assert.throws(()=>windowsUpdateConfig({provider:'github',owner:'a',repo:'b'}),/generic feed/);
 assert.throws(()=>windowsUpdateConfig({provider:'generic',url:'http://example.org/feed'}),/HTTPS/);
 assert.throws(()=>windowsUpdateConfig({provider:'generic',url:'https://example.org/feed?token=1'}),/HTTPS/);
});
test('the Windows packaging path writes the file into the payload and the installer build refuses a payload without it',async()=>{
 const pack=await read('scripts/release-package.mjs'),installer=await read('scripts/release-installer.mjs'),build=await read('scripts/build-windows.mjs');
 const write=pack.indexOf("'app-update.yml'"),manifest=pack.indexOf("'FILES-SHA256.json'");
 assert.ok(write>0&&manifest>write,'the file is written before the payload manifest lists the files');
 assert.match(installer,/entry\.file==='resources\/app-update\.yml'/);assert.match(installer,/could never update itself/);
 assert.match(build,/updateConfig:installer\.updateConfig/,'the build receipt that scripts/publish-update.mjs reads says so');
});
