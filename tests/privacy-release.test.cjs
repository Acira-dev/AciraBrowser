'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {configureEngineFeatures,engineFeatureStatus,AD_API_FEATURES}=require('../desktop/browser-services/engine-features.cjs');
const {validate,CAPABILITIES}=require('../desktop/browser-services/clear-browsing-data.cjs');
const {protectionSummary}=require('../desktop/browser-services/protection-summary.cjs');
const {choice}=require('../desktop/native-network-preferences.cjs');
const {SOURCES,validateList}=require('../desktop/browser-services/filter-updates.cjs');

function fakeApp(initial={}){const switches=new Map(Object.entries(initial));return {isReady:()=>false,commandLine:{getSwitchValue:name=>switches.get(name)||'',appendSwitch:(name,value)=>switches.set(name,value),removeSwitch:name=>switches.delete(name)},switches};}

test('third-party cookie blocking and ad-API removal are applied by default and keep unrelated features',()=>{
  const app=fakeApp({'enable-features':'SomethingElse','disable-features':'Other'});
  configureEngineFeatures({app});
  const enabled=app.switches.get('enable-features').split(','),disabled=app.switches.get('disable-features').split(',');
  assert.ok(enabled.includes('ForceThirdPartyCookieBlockingEnabled')&&enabled.includes('SomethingElse'));
  for(const feature of AD_API_FEATURES)assert.ok(disabled.includes(feature),feature);
  assert.ok(disabled.includes('Other'));
  assert.deepEqual(engineFeatureStatus(app),{thirdPartyCookies:'block',adApis:'removed'});
});

test('allowing third-party cookies removes the forced blocking feature',()=>{
  const app=fakeApp();configureEngineFeatures({app,thirdPartyCookies:'block'});configureEngineFeatures({app,thirdPartyCookies:'allow'});
  assert.equal(engineFeatureStatus(app).thirdPartyCookies,'allow');
  assert.throws(()=>configureEngineFeatures({app,thirdPartyCookies:'maybe'}));
});

test('engine features refuse to change after the app is ready',()=>{
  const app=fakeApp();app.isReady=()=>true;
  assert.throws(()=>configureEngineFeatures({app}),/startup choice/);
});

test('network preferences accept the legacy two-key file and default cookies to block',()=>{
  assert.equal(choice({gpc:false,dns:{mode:'system',servers:[]}}).cookies,'block');
  assert.equal(choice({gpc:true,dns:{mode:'system',servers:[]},cookies:'allow'}).cookies,'allow');
  assert.throws(()=>choice({gpc:false,dns:{mode:'system',servers:[]},cookies:'sometimes'}));
  assert.throws(()=>choice({gpc:false,dns:{mode:'system',servers:[]},extra:1}));
});

test('clear browsing data only honours time ranges for history and download records',()=>{
  assert.deepEqual(validate({categories:['history','downloads'],range:'hour'}),{categories:['history','downloads'],range:'hour'});
  assert.deepEqual(validate({categories:['cookies','storage','cache'],range:'all'}).range,'all');
  for(const category of ['cookies','storage','cache'])assert.throws(()=>validate({categories:[category],range:'day'}),/all time/);
  assert.throws(()=>validate({categories:[],range:'all'}));
  assert.throws(()=>validate({categories:['bookmarks'],range:'all'}));
  assert.throws(()=>validate({categories:['history'],range:'forever'}));
  assert.deepEqual(CAPABILITIES.cookies,['all']);
});

test('protection summary is honest about phishing protection and reflects the running engine',()=>{
  const lists={updatedAt:null,automatic:true,refreshIntervalDays:4};
  const rows=protectionSummary({network:{engine:{thirdPartyCookies:'block',adApis:'removed'},current:{gpc:false,dns:{mode:'system',servers:[]}}},filterLists:lists}).rows,by=id=>rows.find(row=>row.id===id);
  assert.equal(by('phishing-malware').state,'unavailable');
  assert.equal(by('third-party-cookies').state,'on');
  assert.equal(by('ads-trackers').state,'on');
  const allowed=protectionSummary({network:{engine:{thirdPartyCookies:'allow',adApis:'removed'},current:{gpc:true,dns:{mode:'secure',servers:['https://dns.example/dns-query']}}},filterLists:{...lists,automatic:false}}).rows;
  assert.equal(allowed.find(row=>row.id==='third-party-cookies').state,'off');
  assert.equal(allowed.find(row=>row.id==='gpc').state,'on');
});

test('phishing row says "preparing" (Getting ready…) until a list is really loaded, never "on" while pages are not checked',()=>{
 const lists={updatedAt:null,automatic:true,refreshIntervalDays:4},network={engine:{},current:{gpc:false,dns:{mode:'system',servers:[]}}};
 const row=(threats,safeBrowsing,settings={})=>protectionSummary({network,filterLists:lists,antiTracking:threats?{rows:[],settings,stats:{threats}}:undefined,safeBrowsing}).rows.find(item=>item.id==='phishing-malware');
 for(const state of ['idle','downloading','updating','pending']){const got=row({state,lists:[{entries:0}]});assert.equal(got.state,'preparing',state+' with no entries yet');assert.match(got.detail,/not checked yet/);}
 assert.equal(row({state:'updating',lists:[{entries:2400},{entries:100}]}).state,'on','a loaded list that refreshes is on');
 assert.equal(row({state:'active',lists:[{entries:5}]}).state,'on');assert.equal(row({state:'partial',lists:[{entries:5}]}).state,'on');
 assert.equal(row({state:'stale',lists:[{entries:5}]}).state,'on','old but loaded lists still check pages');
 assert.equal(row({state:'error',lists:[{entries:0}],lastError:'offline'}).state,'off');
 assert.equal(row({state:'downloading',lists:[{entries:0}]},undefined,{phishingLists:false}).state,'off','switched off by the person');
 assert.equal(row(undefined,{state:'ready'}).state,'on');assert.equal(row(undefined,{state:'downloading'}).state,'preparing','Safe Browsing lists still downloading');
 assert.equal(row(undefined,{state:'error',lastError:'x'}).state,'off');assert.equal(row(undefined,{state:'off-no-key'}).state,'optional');
});

test('bundled baseline lists pass the same validation as downloaded lists',()=>{
  const fs=require('node:fs'),path=require('node:path');
  for(const source of SOURCES)assert.ok(validateList(fs.readFileSync(path.join(__dirname,'..','resources','filters',source.id),'utf8'),source).sha256);
  assert.throws(()=>validateList('<html>not a list</html>'.repeat(200),SOURCES[0]),/Invalid/);
});

test('app updater: unsupported outside an installed build',()=>{
  const {createAppUpdater}=require('../desktop/browser-services/app-updater.cjs'),os=require('node:os');
  const base={getVersion:()=>'0.1.0',getPath:()=>os.tmpdir()};
  assert.equal(createAppUpdater({app:{...base,isPackaged:false},dir:os.tmpdir()}).status().status,'unsupported');
  const portable=createAppUpdater({app:{...base,isPackaged:true},dir:os.tmpdir(),platform:'win32',env:{},uninstallerPresent:()=>false}).status();
  assert.equal(portable.supported,false);assert.match(portable.reason,/portable/);
  assert.match(createAppUpdater({app:{...base,isPackaged:true},dir:os.tmpdir(),platform:'win32',env:{ACIRA_BROWSER_TEST_DATA:'x'},uninstallerPresent:()=>true}).status().reason,/test profile/);
});

test('app updater: states follow updater events, ready is announced to the interface (pill + menu row), preference persists',async()=>{
  const {createAppUpdater}=require('../desktop/browser-services/app-updater.cjs'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-upd-')),messages=[];
  const fake=Object.assign(new EventEmitter(),{checkForUpdates:async()=>{fake.emit('checking-for-update');fake.emit('update-available',{version:'0.2.0'});fake.emit('download-progress',{percent:50});fake.emit('update-downloaded',{version:'0.2.0'});},quitAndInstall:(...args)=>{fake.args=args;}});
  const make=()=>createAppUpdater({app:{isPackaged:true,getVersion:()=>'0.1.0',getPath:()=>dir},dir,platform:'win32',env:{},autoUpdater:fake,uninstallerPresent:()=>true,onChange:status=>messages.push(status.status)});
  const updater=make();assert.equal(updater.status().supported,true);assert.equal(updater.status().autoDownload,true);
  const result=await updater.check();assert.equal(result.status,'ready');assert.equal(result.available,'0.2.0');assert.ok(messages.includes('ready'),'the interface is told when the download is ready: the Update pill and the Restart to update menu row replaced the old toast');
  await updater.install();assert.deepEqual(fake.args,[true,true]);
  assert.equal(updater.setAutoDownload(false).autoDownload,false);assert.equal(make().status().autoDownload,false);
  assert.throws(()=>updater.setAutoDownload('yes'));
  assert.equal(fake.autoDownload,false);
  // channel: a pre-release build starts on Beta, the choice persists, and it drives allowPrerelease
  const beta=createAppUpdater({app:{isPackaged:true,getVersion:()=>'0.1.0-beta.1',getPath:()=>dir},dir:fs.mkdtempSync(path.join(os.tmpdir(),'acira-upd-')),platform:'win32',env:{},autoUpdater:fake,uninstallerPresent:()=>true});
  assert.equal(beta.status().channel,'beta');assert.equal(updater.status().channel,'stable');
  await beta.check();assert.equal(fake.allowPrerelease,true);assert.equal(fake.channel,'beta');
  assert.equal(beta.setChannel('stable').channel,'stable');assert.equal(fake.allowPrerelease,false);assert.equal(fake.channel,'latest');fake.allowDowngrade===undefined||assert.equal(fake.allowDowngrade,false);
  assert.equal(make().status().channel,'stable');assert.throws(()=>updater.setChannel('nightly'));
});

test('app updater: the test feed override reaches the updater after the channel is set',async()=>{
  const {createAppUpdater}=require('../desktop/browser-services/app-updater.cjs'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
  const fake=Object.assign(new EventEmitter(),{feeds:[],setFeedURL(feed){fake.feeds.push(feed);},checkForUpdates:async()=>{}});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-upd-'));
  const updater=createAppUpdater({app:{isPackaged:true,getVersion:()=>'0.1.0-beta.1',getPath:()=>dir},dir,platform:'win32',env:{ACIRA_UPDATE_TEST:'1',ACIRA_UPDATE_FEED:'http://127.0.0.1:1'},autoUpdater:fake,uninstallerPresent:()=>true});
  await updater.check();
  assert.equal(fake.feeds.length,1);assert.equal(fake.feeds[0].provider,'custom','beta.11: one provider that asks the addresses in order (update-feeds.cjs)');
  assert.deepEqual(fake.feeds[0].feeds,[{name:'primary',url:'http://127.0.0.1:1'}]);assert.equal(fake.channel,'beta');
});

test('packaging config stays unsigned without secrets and switches to signing from environment only',()=>{
  const {createConfig,signingMode}=require('../packaging/signing-config.cjs');
  assert.equal(signingMode({}),'none');assert.equal(createConfig({}).win.signExecutable,false);assert.equal(createConfig({}).forceCodeSigning,false);
  assert.throws(()=>createConfig({ACIRA_SIGN:'azure'}),/ACIRA_PUBLISHER_NAME/);
  assert.throws(()=>createConfig({CSC_LINK:'x.pfx',ACIRA_PUBLISHER_NAME:'Acira'}),/CSC_KEY_PASSWORD/);
  const pfx=createConfig({CSC_LINK:'x.pfx',CSC_KEY_PASSWORD:'p',ACIRA_PUBLISHER_NAME:'Acira'});
  assert.equal(pfx.forceCodeSigning,true);assert.deepEqual(pfx.win.signtoolOptions.publisherName,['Acira']);assert.ok(!/unsigned/.test(pfx.nsis.artifactName));
  const azure=createConfig({ACIRA_SIGN:'azure',ACIRA_PUBLISHER_NAME:'Acira',AZURE_TENANT_ID:'t',AZURE_CLIENT_ID:'c',AZURE_CLIENT_SECRET:'s',ACIRA_AZURE_ENDPOINT:'https://x',ACIRA_AZURE_ACCOUNT:'a',ACIRA_AZURE_PROFILE:'p'});
  assert.equal(azure.win.azureSignOptions.certificateProfileName,'p');assert.equal(signingMode({ACIRA_SIGN_COMMAND:'sign.cmd'}),'command');
});
