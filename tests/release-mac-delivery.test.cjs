const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {notarizationPolicy,notarizeBundle}=require('../packaging/macos/notarization.cjs');
const {writeMacUpdateConfig,writeMacUpdateFeed,publicFeedConfig}=require('../packaging/macos/update-feed.cjs');
const {parseUpdateInfo,resolveFiles}=require('electron-updater/out/providers/Provider');
const {MacUpdater}=require('electron-updater/out/MacUpdater');
test('distribution notarization requires existing credentials and refuses Apple rejection before stapling',async()=>{
 assert.equal(notarizationPolicy(false).enabled,false);assert.throws(()=>notarizationPolicy(true),/existing notarytool credentials/);
 const policy=notarizationPolicy(true,'acira-release'),calls=[];
 const run=async(file,args)=>{calls.push(args);return {stdout:args[0]==='notarytool'?JSON.stringify({status:'Invalid',id:crypto.randomUUID()}):''}};
 await assert.rejects(notarizeBundle({bundle:'/owned/Acira Browser.app',work:'/owned',policy,run}),/not accepted/);assert.equal(calls.length,2);assert(!calls.flat().includes('--force'));
});
test('public Mac updates can use a credential-free HTTPS feed embedded before signing',async t=>{
 const output=await fs.mkdtemp(path.join(os.tmpdir(),'acira-public-feed-'));t.after(()=>fs.rm(output,{recursive:true,force:true}));
 await writeMacUpdateConfig(output,{feedURL:'https://updates.example.org/acira/mac'});
 const yaml=require('js-yaml').load(await fs.readFile(path.join(output,'app-update.yml'),'utf8'));
 assert.equal(yaml.provider,'generic');assert.equal(yaml.url,'https://updates.example.org/acira/mac/');
 for(const url of ['http://updates.example.org/','https://user:password@example.org/','https://example.org/?token=a','https://example.org/#fragment','not a URL'])assert.throws(()=>publicFeedConfig(url));
 const config=require('../packaging/signing-config.cjs').createConfig({ACIRA_MAC_UPDATE_FEED_URL:'https://updates.example.org/mac/'});
 assert.equal(config.mac.publish[0].provider,'generic');assert.equal(config.publish[0].provider,require('../packaging/release-target.cjs').loadReleaseTarget().provider,'Windows follows packaging/release-target.json');
});
test('one update manifest carries both signed archive architectures and the real updater selects the right one',async t=>{
 const output=await fs.mkdtemp(path.join(os.tmpdir(),'acira-multiarch-feed-'));t.after(()=>fs.rm(output,{recursive:true,force:true}));
 const artifacts=[];
 for(const arch of ['arm64','x64']){const zip=path.join(output,'AciraBrowser-0.2.0-mac-'+arch+'-update.zip');await fs.writeFile(zip,arch);artifacts.push({arch,zip});}
 const receipt=await writeMacUpdateFeed({output,version:'0.2.0',artifacts});
 const info=parseUpdateInfo(await fs.readFile(receipt.file,'utf8'),'latest-mac.yml',new URL('https://updates.example.org/'));
 const files=resolveFiles(info,new URL('https://updates.example.org/'));
 assert.equal(MacUpdater.filterFilesForArch(files,true)[0].url.pathname.includes('arm64'),true);
 assert.equal(MacUpdater.filterFilesForArch(files,false)[0].url.pathname.includes('x64'),true);
 assert.equal(info.files.length,2);
 await assert.rejects(writeMacUpdateFeed({output,version:'0.2.0',artifacts:[artifacts[0],artifacts[0]]}),/unique architecture/);
});
test('a notarized custom-installer payload is stapled and assessed before it can be packaged',async()=>{
 const calls=[],policy=notarizationPolicy(true,'acira-release'),id=crypto.randomUUID();
 const run=async(file,args)=>{calls.push([file,args]);return {stdout:args[0]==='notarytool'?JSON.stringify({status:'Accepted',id}):''}};
 const receipt=await notarizeBundle({bundle:'/owned/Acira Browser.app',work:'/owned',policy,run});assert.equal(receipt.id,id);assert.equal(receipt.gatekeeperAccepted,true);
 assert.deepEqual(calls.slice(-3).map(x=>x[1].slice(0,2)),[['stapler','staple'],['stapler','validate'],['--assess','--verbose=2']]);
 await assert.rejects(notarizeBundle({bundle:'/owned/Acira Browser.app',work:'/owned',policy,run:async(file,args)=>{if(args[0]==='stapler')throw Error('Ticket missing');return run(file,args)}}),/Ticket missing/);
});
test('Mac feed is consumed by the actual updater parser, selects the matching architecture, and binds exact ZIP bytes',async t=>{
 const output=await fs.mkdtemp(path.join(os.tmpdir(),'acira-mac-feed-'));t.after(()=>fs.rm(output,{recursive:true,force:true}));
 const zip=path.join(output,'AciraBrowser-0.2.0-beta.1-mac-arm64-update.zip'),bytes=Buffer.from('owned zip transport fixture');await fs.writeFile(zip,bytes);
 const result=await writeMacUpdateFeed({output,version:'0.2.0-beta.1',zip,arch:'arm64'}),text=await fs.readFile(result.file,'utf8');assert.equal(path.basename(result.file),'beta-mac.yml');
 const base=new URL('https://example.org/releases/'),info=parseUpdateInfo(text,'beta-mac.yml',base),files=resolveFiles(info,base);
 assert.equal(info.version,'0.2.0-beta.1');assert.equal(info.files[0].size,bytes.length);assert.equal(info.files[0].sha512,crypto.createHash('sha512').update(bytes).digest('base64'));
 assert.equal(MacUpdater.filterFilesForArch(files,true).length,1);assert.equal(MacUpdater.filterFilesForArch(files,false).length,0,'Intel cannot select the Apple Silicon archive');
 await writeMacUpdateConfig(output);const config=await fs.readFile(path.join(output,'app-update.yml'),'utf8');assert.match(config,/update\.acirabrowser\.com/,'a new build asks the new address first; the GitHub feed is its compiled-in fallback');assert.doesNotMatch(config,/AciraBrowserNoAI|token|password|secret/i);
 await assert.rejects(writeMacUpdateFeed({output,version:'0.2.0',zip,arch:'x64'}),/architecture-labelled/);
});
