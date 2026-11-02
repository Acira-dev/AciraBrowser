'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {AppUpdater}=require('electron-updater/out/AppUpdater');
const {NodeHttpExecutor}=require('builder-util/out/nodeHttpExecutor');
const {validateConfiguration}=require('app-builder-lib/out/util/config/config');
const {createConfig}=require('../packaging/signing-config.cjs');
const {DEFAULT_FEED_URL,publicFeedConfig,STANDBY_UPDATE}=require('../packaging/update-feed.cjs');
const {writeMacUpdateConfig}=require('../packaging/macos/update-feed.cjs');
test('Mac packages embed the public feed without private-repository credentials; Windows keeps the release target',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-public-config-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config=createConfig({}),{loadReleaseTarget,publishBlock}=require('../packaging/release-target.cjs');
 assert.deepEqual(config.publish,publishBlock(loadReleaseTarget()),'Windows follows packaging/release-target.json');assert.deepEqual(config.mac.publish,[publicFeedConfig()]);
 assert.deepEqual(config.publish,[{...publicFeedConfig(),url:DEFAULT_FEED_URL.replace(/\/$/,''),channel:'latest'}],'the committed Windows target is the same public feed Mac uses, never the private source repository');
 await validateConfiguration(config,{isEnabled:false});
 await writeMacUpdateConfig(root);const text=await fs.readFile(path.join(root,'app-update.yml'),'utf8'),mac=require('js-yaml').load(text);
 assert.equal(mac.provider,'generic');assert.equal(mac.url,DEFAULT_FEED_URL);assert.doesNotMatch(text,/AciraBrowserNoAI|token|password|secret/);
 const shared=createConfig({ACIRA_UPDATE_FEED_URL:'https://updates.example.org/shared'});
 assert.equal(shared.mac.publish[0].url,'https://updates.example.org/shared/');assert.deepEqual(shared.publish,[{provider:'generic',url:'https://updates.example.org/shared/',channel:'latest'}],'ACIRA_UPDATE_FEED_URL moves both platforms');
 const separate=createConfig({ACIRA_MAC_UPDATE_FEED_URL:'https://updates.example.org/mac'});
 assert.deepEqual(separate.publish,config.publish);assert.equal(separate.mac.publish[0].url,'https://updates.example.org/mac/');
 for(const value of ['','http://example.org','https://name:password@example.org/','https://example.org/?token=private','https://example.org/#fragment'])assert.throws(()=>publicFeedConfig(value));
});
test('the real updater reads all four standby channels without offering a download, downgrading or needing authentication',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-standby-check-')),requests=[];
 const server=http.createServer((req,res)=>{requests.push({url:new URL(req.url,'http://localhost').pathname,authorization:req.headers.authorization});res.setHeader('content-type','text/yaml');res.end(JSON.stringify(STANDBY_UPDATE));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 const feedURL='http://127.0.0.1:'+server.address().port+'/feed/';
 for(const platform of ['darwin','win32'])for(const channel of ['beta','latest']){
  const userDataPath=path.join(root,platform+'-'+channel);await fs.mkdir(userDataPath);
  const appUpdateConfigPath=path.join(userDataPath,'app-update.yml');await fs.writeFile(appUpdateConfigPath,JSON.stringify({provider:'generic',url:feedURL}));
  const updater=new AppUpdater(null,{isPackaged:true,version:'0.1.0-beta.1',name:'Acira test fixture',userDataPath,baseCachePath:userDataPath,appUpdateConfigPath,whenReady:async()=>{}});
  updater.httpExecutor=new NodeHttpExecutor();updater._testOnlyOptions={platform};updater.channel=channel;updater.allowDowngrade=false;updater.logger=null;
  let current=0;updater.on('update-not-available',()=>current++);updater.downloadUpdate=()=>{assert.fail('A standby feed must never download.');};
  const result=await updater.checkForUpdates();assert.equal(result.isUpdateAvailable,false);assert.equal(current,1);assert.deepEqual(result.updateInfo.files,[]);
 }
 assert.deepEqual(requests.map(x=>x.url).sort(),['/feed/beta-mac.yml','/feed/beta.yml','/feed/latest-mac.yml','/feed/latest.yml'].sort());
 assert.ok(requests.every(x=>x.authorization===undefined));
});
