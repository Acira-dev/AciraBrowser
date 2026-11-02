'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),AdmZip=require('adm-zip'),vm=require('node:vm');
const {APP,walk,hashFile,installApplication,validateManifest}=require('../packaging/macos/install-engine.cjs');
const {buildInstallerPage}=require('../packaging/macos/installer-page.cjs');
const {runningInBundle,assertApplicationStopped}=require('../packaging/macos/running-app.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-install-unit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source',APP);await fs.mkdir(path.join(source,'Contents','MacOS'),{recursive:true});await fs.writeFile(path.join(source,'Contents','Info.plist'),'owned test app');await fs.writeFile(path.join(source,'Contents','MacOS','AciraBrowser'),'owned test binary');const zip=new AdmZip();zip.addLocalFolder(source,APP);const archive=path.join(root,'payload.zip');await fs.writeFile(archive,zip.toBuffer());const manifest={schema:1,appName:APP,archiveSha256:await hashFile(archive),entries:await walk(source)};const destination=path.join(root,'Applications',APP);const extractArchive=async(_archive,stage)=>fs.cp(source,path.join(stage,APP),{recursive:true});return {root,source,archive,manifest,destination,extractArchive};}
test('Mac installation reports actual monotonic work, preserves profiles, and keeps the previous app recoverable',async t=>{const f=await fixture(t),profile=path.join(f.root,'profile');await fs.writeFile(profile,'keep tabs and settings');await fs.mkdir(f.destination,{recursive:true});await fs.writeFile(path.join(f.destination,'previous'),'keep old app');const frames=[];const result=await installApplication({...f,onProgress:s=>frames.push(s)});assert.equal(await fs.readFile(profile,'utf8'),'keep tabs and settings');assert.equal(await fs.readFile(path.join(result.backupPath,'previous'),'utf8'),'keep old app');assert.equal(await fs.readFile(path.join(f.destination,'Contents','Info.plist'),'utf8'),'owned test app');assert.equal(frames.at(-1).phase,'done');assert.equal(frames.at(-1).progress,1);assert.ok(frames.slice(0,-1).every(s=>s.progress<1));assert.ok(frames.every((s,i)=>i===0||s.progress>=frames[i-1].progress));assert.ok(!(await fs.readdir(path.dirname(f.destination))).some(n=>n.startsWith('.Acira-install-')));});
test('cancelling a Mac install removes only its owned stage and leaves the current app untouched',async t=>{const f=await fixture(t),abort=new AbortController();await fs.mkdir(f.destination,{recursive:true});await fs.writeFile(path.join(f.destination,'previous'),'keep');await assert.rejects(installApplication({...f,signal:abort.signal,onProgress:s=>{if(s.phase==='installing')abort.abort();}}),{name:'AbortError'});assert.equal(await fs.readFile(path.join(f.destination,'previous'),'utf8'),'keep');assert.deepEqual(await fs.readdir(path.dirname(f.destination)),[APP]);});
test('corrupt or incomplete extracted files cannot replace an existing Mac app',async t=>{const f=await fixture(t);await fs.mkdir(f.destination,{recursive:true});await fs.writeFile(path.join(f.destination,'previous'),'keep');await assert.rejects(installApplication({...f,extractArchive:async(...args)=>{await f.extractArchive(...args);await fs.writeFile(path.join(args[1],APP,'Contents','Info.plist'),'tampered');}}),/integrity/);assert.equal(await fs.readFile(path.join(f.destination,'previous'),'utf8'),'keep');});
test('failed native signature verification leaves the existing Mac app in place',async t=>{const f=await fixture(t);await fs.mkdir(f.destination,{recursive:true});await fs.writeFile(path.join(f.destination,'previous'),'keep');await assert.rejects(installApplication({...f,verifySignature:async()=>{throw Error('signature refused');}}),/signature refused/);assert.equal(await fs.readFile(path.join(f.destination,'previous'),'utf8'),'keep');});
test('Mac payload manifests reject traversal, external links and duplicate paths before extraction',async t=>{const f=await fixture(t);for(const entry of [{path:'../outside',type:'directory'},{path:'Contents/escape',type:'symlink',target:'../../../outside'},f.manifest.entries[0]]){assert.throws(()=>validateManifest({...f.manifest,entries:[...f.manifest.entries,entry]}),/invalid|unsafe/);}});
test('Mac installer uses the shared artwork with real native progress instead of the concept demo timer',async()=>{const source=await fs.readFile(path.join(__dirname,'../docs/launch/concepts/installer-creation.html'),'utf8'),page=buildInstallerPage(source);new vm.Script(page.script);assert.ok(page.html.includes('Content-Security-Policy'));assert.ok(page.html.includes('data-action="install"'));assert.ok(page.html.includes('data-action="open"'));assert.ok(page.html.includes('role="progressbar"'));assert.ok(!page.script.includes('progressAt((now-start)/1000)'));assert.ok(page.script.includes('actual.progress'));assert.ok(page.script.includes('window.aciraInstaller.ready()'));assert.ok(page.script.includes('document.hidden'));});
test('Mac running-app check matches this bundle and its helpers, not other copies or similarly named paths',async()=>{
 const app=path.resolve('/owned/Applications/Acira Browser.app');
 assert(runningInBundle(`  12 ${app}/Contents/MacOS/AciraBrowser`,app));
 assert(runningInBundle(`  13 ${app}/Contents/Frameworks/Acira Helper.app/Contents/MacOS/Acira Helper (Renderer)`,app));
 for(const output of [` 12 ${app}-previous/Contents/MacOS/AciraBrowser`,` 12 /other/Acira Browser.app/Contents/MacOS/AciraBrowser`,` 12 /owned/profile/AciraBrowser`,'not a process'])assert(!runningInBundle(output,app));
 await assert.rejects(assertApplicationStopped(app,async()=>`12 ${app}/Contents/MacOS/AciraBrowser`),{code:'ACIRA_RUNNING'});
 await assert.rejects(assertApplicationStopped(app,async()=>{throw Error('ps unavailable')}),{code:'ACIRA_PROCESS_CHECK_FAILED'});
 await assertApplicationStopped(app,async()=>`12 /other/Acira Browser.app/Contents/MacOS/AciraBrowser`);
});
test('a running Mac browser refuses an upgrade before extraction and preserves the previous app',async t=>{
 const f=await fixture(t);await fs.mkdir(f.destination,{recursive:true});await fs.writeFile(path.join(f.destination,'previous'),'keep live app');let extracted=false;
 await assert.rejects(installApplication({...f,extractArchive:async()=>{extracted=true},ensureNotRunning:async target=>{assert.equal(target,f.destination);throw Object.assign(Error('Quit Acira'),{code:'ACIRA_RUNNING'})}}),{code:'ACIRA_RUNNING'});
 assert(!extracted);assert.equal(await fs.readFile(path.join(f.destination,'previous'),'utf8'),'keep live app');assert.deepEqual(await fs.readdir(path.dirname(f.destination)),[APP]);
});
test('a browser opened during copying blocks commit; retry after it closes installs without losing its profile',async t=>{
 const f=await fixture(t),profile=path.join(f.root,'browser-profile');await fs.mkdir(f.destination,{recursive:true});await fs.writeFile(path.join(f.destination,'previous'),'keep live app');await fs.writeFile(profile,'saved tabs');let checks=0,verified=false;
 await assert.rejects(installApplication({...f,verifySignature:async()=>{verified=true},ensureNotRunning:async()=>{if(++checks===2){assert(verified);throw Object.assign(Error('Quit Acira'),{code:'ACIRA_RUNNING'})}}}),{code:'ACIRA_RUNNING'});
 assert.equal(checks,2);assert.equal(await fs.readFile(path.join(f.destination,'previous'),'utf8'),'keep live app');assert.deepEqual(await fs.readdir(path.dirname(f.destination)),[APP]);
 const result=await installApplication({...f,ensureNotRunning:async()=>{}});assert.equal(await fs.readFile(path.join(result.backupPath,'previous'),'utf8'),'keep live app');assert.equal(await fs.readFile(profile,'utf8'),'saved tabs');
});
test('native Mac installer wires both process checks and does not register disposable test apps',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../packaging/macos/installer-main.cjs'),'utf8');assert(source.includes('ensureNotRunning:assertApplicationStopped'));assert.match(source,/if\(!testRoot\)await run\([^\n]*lsregister/);
});


test('Mac installer follows supported preferred languages and safely falls back for unsupported input',()=>{
 const {selectLocale,text,catalogs}=require('../packaging/macos/strings.cjs');
 for(const [input,expected] of [[['de-AT','en-US'],'de'],[['fr_CA'],'fr'],[['pt-PT'],'pt'],[['zh-Hant-TW'],'zh'],[['ja-JP'],'ja'],[['ar-LB','es-MX'],'es'],[['ar-LB'],'en'],[[], 'en'],[['__proto__','constructor'],'en'],[[null,42],'en']])assert.equal(selectLocale(input),expected);
 assert.equal(text('xx','install'),catalogs.en.install);assert.equal(text('de','copying'),require('../packaging/installer/strings.json').de.states[1][1]);
 const keys=Object.keys(catalogs.en).sort();for(const [locale,row] of Object.entries(catalogs)){assert.deepEqual(Object.keys(row).sort(),keys,locale);assert(Object.values(row).every(value=>typeof value==='string'&&value.length>0),locale);}
});
test('Mac installer recovery messages keep native errors localized without exposing raw paths',()=>{
 const {failureKey,text}=require('../packaging/macos/strings.cjs');
 for(const [error,key] of [[{code:'ACIRA_RUNNING'},'running'],[{code:'ACIRA_PROCESS_CHECK_FAILED'},'processCheckFailed'],[{code:'ENOSPC'},'noSpace'],[{code:'EACCES'},'accessDenied'],[{message:'The installer payload failed its integrity check'},'integrity'],[{message:'Command failed: /usr/bin/codesign'},'integrity'],[{message:'/private/user-name/unknown'},'failed']]){assert.equal(failureKey(error),key);assert(!text('fr',key).includes('/private/'));}
});
test('native Electron verifies and installs an ASAR payload as a physical file', {skip:process.platform!=='darwin'}, async t=>{
 const f=await fixture(t),resources=path.join(f.source,'Contents','Resources'),input=path.join(f.root,'app-input');
 await fs.mkdir(resources);await fs.mkdir(input);await fs.writeFile(path.join(input,'package.json'),'{"name":"owned-fixture"}');
 await require('@electron/asar').createPackage(input,path.join(resources,'app.asar'));
 const zip=new AdmZip();zip.addLocalFolder(f.source,APP);await fs.writeFile(f.archive,zip.toBuffer());
 f.manifest={...f.manifest,archiveSha256:await hashFile(f.archive),entries:await walk(f.source)};
 const config=path.join(f.root,'fixture.json'),script=path.join(f.root,'verify.cjs');await fs.writeFile(config,JSON.stringify(f));
 await fs.writeFile(script,`const {app}=require('electron'),fs=require('original-fs').promises,path=require('node:path'),assert=require('node:assert/strict');
 (async()=>{const engine=require(process.argv[2]),f=JSON.parse(await fs.readFile(process.argv[3],'utf8'));assert.deepEqual(await engine.walk(f.source),f.manifest.entries);await engine.installApplication({...f,extractArchive:(_archive,stage)=>fs.cp(f.source,path.join(stage,engine.APP),{recursive:true})});assert.deepEqual(await engine.walk(f.destination),f.manifest.entries);console.log('Physical ASAR verified and installed');app.exit(0);})().catch(e=>{console.error(e);app.exit(1)});`);
 const {promisify}=require('node:util'),{execFile}=require('node:child_process'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result=await promisify(execFile)(require('electron'),[script,path.resolve(__dirname,'../packaging/macos/install-engine.cjs'),config],{env,timeout:20000});
 assert.match(result.stdout,/Physical ASAR verified and installed/);
});
