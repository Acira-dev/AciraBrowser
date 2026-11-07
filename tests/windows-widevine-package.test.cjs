'use strict';
// The Windows Widevine build (npm run build:windows:widevine, docs/launch/WINDOWS_WIDEVINE.md): the pinned ECS runtime and its fetch, the EVS
// preflight, and the seal of a qualified twin (app.asar, its hash in the program, the EVS fuse set, Authenticode hook, VMP last), run end to end
// on a small real Windows program built here with electron-builder's own resource library. The EVS client is a stand-in: no account is used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const W=require('../packaging/windows-widevine.cjs'),{SHIPPED,WINDOWS,readFuses}=require('../packaging/fuses.cjs'),{FUSES:MAC}=require('../packaging/macos/widevine.cjs');
const {FuseV1Options}=require('@electron/fuses'),asar=require('@electron/asar'),AdmZip=require('adm-zip');
const root=path.join(__dirname,'..'),read=file=>require('node:fs').readFileSync(path.join(root,file),'utf8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fetchModule=()=>import('../scripts/fetch-windows-widevine.mjs');
async function temp(t,prefix){const dir=await fs.mkdtemp(path.join(os.tmpdir(),prefix));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('the Windows pin is the same ECS release as the Mac one, for the Electron the project uses, taken from the release digest',()=>{
 const pkg=require('../package.json'),pin=require('../packaging/windows-widevine-runtime.json'),mac=require('../packaging/macos/widevine-runtime.json');
 assert.equal(pin.electron,pkg.devDependencies.electron);assert.equal(pin.release,mac.release);assert.equal(pin.repository,'castlabs/electron-releases');
 assert.deepEqual(Object.keys(pin.platforms),['x64']);
 // castlabs/electron-releases v44.9.3+wvcus: electron-v44.9.3+wvcus-win32-x64.zip, GitHub asset digest = castlabs SHASUMS256.txt
 assert.deepEqual(pin.platforms.x64,{sha256:'1ab1e5aa4566f218873d272af1a57c6162ad83911a69bbd4b0e341c37c6c40fc',bytes:158806556});
});

test('the runtime URL and cache name follow the release asset, and the fetch refuses outside Windows or for another Electron',async()=>{
 const {archiveName,archiveUrl,fetchWindowsWidevineRuntime}=await fetchModule();
 assert.equal(archiveName('x64'),'electron-v44.9.3+wvcus-win32-x64.zip');
 assert.equal(archiveUrl('x64'),'https://github.com/castlabs/electron-releases/releases/download/v44.9.3%2Bwvcus/electron-v44.9.3%2Bwvcus-win32-x64.zip');
 await assert.rejects(fetchWindowsWidevineRuntime({platform:'darwin'}),/prepared on Windows/);
 await assert.rejects(fetchWindowsWidevineRuntime({platform:'win32',electron:'45.0.0'}),/update packaging\/windows-widevine-runtime\.json/);
 await assert.rejects(fetchWindowsWidevineRuntime({platform:'win32',arch:'arm64'}),/No Windows Widevine runtime is pinned for arm64/);
});

/** A small ECS-like archive and a pin that matches it. */
async function fixtureArchive(dir,{version='44.9.3+wvcus'}={}){
 const zip=new AdmZip();zip.addFile('electron.exe',Buffer.from('MZ ECS program'));zip.addFile('electron.exe.sig',Buffer.from('development signature'));zip.addFile('version',Buffer.from(version+'\n'));zip.addFile('locales/en-US.pak',Buffer.from('pak'));
 const file=path.join(dir,'fixture.zip');zip.writeZip(file);const bytes=await fs.readFile(file);
 return {file,bytes,pin:{electron:'44.9.3',release:'44.9.3+wvcus',repository:'castlabs/electron-releases',platforms:{x64:{sha256:sha(bytes),bytes:bytes.length}}}};
}
test('a downloaded archive is checked against the pin before use, extracted into a new folder, and recorded',async t=>{
 const dir=await temp(t,'acira-ecs-win-'),{cachedArchive,fetchWindowsWidevineRuntime}=await fetchModule(),fixture=await fixtureArchive(dir),cache=path.join(dir,'cache');
 const urls=[],fetchImpl=async url=>{urls.push(url);return new Response(fixture.bytes,{headers:{'content-length':String(fixture.bytes.length)}});};
 const got=await fetchWindowsWidevineRuntime({platform:'win32',pin:fixture.pin,electron:'44.9.3',cache,fetchImpl,log:()=>{}});
 assert.deepEqual(urls,['https://github.com/castlabs/electron-releases/releases/download/v44.9.3%2Bwvcus/electron-v44.9.3%2Bwvcus-win32-x64.zip']);
 assert.equal(await fs.readFile(path.join(got.runtime,'electron.exe'),'utf8'),'MZ ECS program');
 assert.deepEqual({...got,runtime:undefined},{runtime:undefined,arch:'x64',electron:'44.9.3',release:'44.9.3+wvcus',repository:'castlabs/electron-releases',archiveSha256:fixture.pin.platforms.x64.sha256,executableSha256:sha(Buffer.from('MZ ECS program')),developmentSignature:true});
 assert.equal(await fs.readFile(cachedArchive(cache,'x64',fixture.pin)).then(sha),fixture.pin.platforms.x64.sha256,'kept in the cache');
 const again=await fetchWindowsWidevineRuntime({platform:'win32',pin:fixture.pin,electron:'44.9.3',cache,fetchImpl:()=>{throw Error('no second download');},log:()=>{}});
 assert.notEqual(again.runtime,got.runtime,'every build extracts into a new folder');
});
test('an archive that does not match the pin is never used, downloaded or cached, and a wrong version inside is refused',async t=>{
 const dir=await temp(t,'acira-ecs-win-'),{cachedArchive,fetchWindowsWidevineRuntime}=await fetchModule(),fixture=await fixtureArchive(dir),cache=path.join(dir,'cache');
 const tampered=Buffer.from(fixture.bytes);tampered[tampered.length-30]^=1;
 await assert.rejects(fetchWindowsWidevineRuntime({platform:'win32',pin:fixture.pin,electron:'44.9.3',cache,fetchImpl:async()=>new Response(tampered),log:()=>{}}),/does not match its pinned release digest/);
 assert.deepEqual(await fs.readdir(cache),[],'nothing left behind');
 await fs.writeFile(cachedArchive(cache,'x64',fixture.pin),tampered);
 await assert.rejects(fetchWindowsWidevineRuntime({platform:'win32',pin:fixture.pin,electron:'44.9.3',cache,fetchImpl:()=>{throw Error('unused');},log:()=>{}}),/does not match its pinned size and SHA-256/);
 const other=await fixtureArchive(await temp(t,'acira-ecs-win-'),{version:'44.9.2+wvcus'}),otherCache=path.join(dir,'other');
 await fs.mkdir(otherCache);await fs.writeFile(cachedArchive(otherCache,'x64',other.pin),other.bytes);
 await assert.rejects(fetchWindowsWidevineRuntime({platform:'win32',pin:other.pin,electron:'44.9.3',cache:otherCache,log:()=>{}}),/says it is 44\.9\.2\+wvcus/);
 assert.deepEqual((await fs.readdir(otherCache)).filter(name=>name.startsWith('win32-')),[],'a refused extraction is removed');
});

test('the sealed program carries exactly the fuse set free EVS signs: the Mac set, not the plain Windows one',()=>{
 assert.equal(W.EVS_FUSES,SHIPPED);
 for(const [name,value] of Object.entries(SHIPPED))assert.equal(MAC[FuseV1Options[require('../packaging/fuses.cjs').ENUM[name]]],value,name);
 assert.deepEqual(Object.keys(WINDOWS).filter(name=>WINDOWS[name]!==W.EVS_FUSES[name]).sort(),['enableEmbeddedAsarIntegrityValidation','enableNodeCliInspectArguments','onlyLoadAppFromAsar'],'why the twin cannot be signed as it is');
});

test('the preflight stops a Widevine build before any long work when the EVS login or client is missing',async t=>{
 const dir=await temp(t,'acira-evs-'),config=path.join(dir,'config.json');await fs.writeFile(config,'{}');
 const calls=[],exec=answers=>async(file,args)=>{calls.push([file,...args]);const answer=answers.shift();if(answer instanceof Error)throw answer;return {stdout:answer||''};};
 const enoent=Object.assign(Error('spawn python ENOENT'),{code:'ENOENT'});
 await assert.rejects(W.preflight({env:{},exec:exec([])}),/Set EVS_CONFIG_FILE/);
 await assert.rejects(W.preflight({env:{EVS_CONFIG_FILE:path.join(dir,'none.json')},exec:exec([])}),/does not exist[\s\S]*castlabs_evs\.account reauth/);
 await assert.rejects(W.preflight({env:{EVS_CONFIG_FILE:config},platform:'win32',exec:exec([enoent])}),/Python was not found \(python\)[\s\S]*ACIRA_EVS_PYTHON/);
 await assert.rejects(W.preflight({env:{EVS_CONFIG_FILE:config,ACIRA_EVS_PYTHON:'C:\\evs\\python.exe'},exec:exec([Error('No module named castlabs_evs')])}),/C:\\evs\\python\.exe -m pip install --upgrade castlabs-evs/);
 await assert.rejects(W.preflight({env:{EVS_CONFIG_FILE:config},exec:exec(['vmp.py 1.3.3',Error('NonInteractiveError')])}),/needs a password again[\s\S]*castlabs_evs\.account reauth/);
 calls.length=0;
 assert.deepEqual(await W.preflight({env:{EVS_CONFIG_FILE:config,ACIRA_EVS_PYTHON:'py'},exec:exec(['vmp.py 1.3.3\n',''])}),{python:'py',client:'vmp.py 1.3.3'});
 assert.deepEqual(calls,[['py','-m','castlabs_evs.vmp','--version'],['py','-m','castlabs_evs.account','--no-ask','refresh']],'the official client only; the login stays in its file');
});

test('VMP signing is the official client on the package folder, production streaming, found by the AciraBrowser name',async()=>{
 const calls=[],exec=async(file,args,options)=>{calls.push({file,args,timeout:options.timeout});return {stdout:' - Signature request successful \n'};};
 assert.deepEqual(await W.signVmp('C:\\out',{python:'py',exec}),{action:'sign-pkg',diagnostic:'- Signature request successful'});
 assert.deepEqual(await W.signVmp('C:\\out',{python:'py',exec,verifyOnly:true}),{action:'verify-pkg',diagnostic:'- Signature request successful'});
 assert.deepEqual(calls.map(call=>call.args),[['-m','castlabs_evs.vmp','--no-ask','sign-pkg','--streaming','--name-hint','AciraBrowser','C:\\out'],['-m','castlabs_evs.vmp','--no-ask','verify-pkg','--name-hint','AciraBrowser','C:\\out']]);
 assert.ok(calls[0].timeout>=30*60*1000,'the program upload may be slow');
});

// A small real Windows program: version information (the resource editor's), and an Electron fuse wire in a data resource, so the fuse
// library finds and flips it as it does in electron.exe. Wire: RunAsNode..GrantFileProtocolExtraPrivileges, then one later fuse left alone.
function fakeProgram(set){
 const {NtExecutable,NtExecutableResource,Resource}=W.builderModule('resedit'),{ENUM}=require('../packaging/fuses.cjs');
 const exe=NtExecutable.createEmpty(false,false),res=NtExecutableResource.from(exe),info=Resource.VersionInfo.createEmpty();
 info.setFileVersion(0,1,10,10,1033);info.setStringValues({lang:1033,codepage:1200},{ProductName:'Acira Browser',OriginalFilename:'AciraBrowser.exe'});info.outputToResourceEntries(res.entries);
 const wire=Object.entries(ENUM).sort((a,b)=>FuseV1Options[a[1]]-FuseV1Options[b[1]]).map(([name])=>set[name]?'1':'0').join('')+'1';
 res.entries.push({type:10,id:1,lang:1033,codepage:1200,bin:Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),Buffer.from([1,wire.length]),Buffer.from(wire,'latin1')])});
 res.outputResource(exe);return Buffer.from(exe.generate());
}
async function writeManifestLike(folder,sourceDigest){const out=[];const walk=async dir=>{for(const item of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.isDirectory())await walk(full);else{const rel=path.relative(folder,full).replaceAll('\\','/');if(rel!=='FILES-SHA256.json'){const bytes=await fs.readFile(full);out.push({file:rel,sha256:sha(bytes),bytes:bytes.length});}}}};await walk(folder);await fs.writeFile(path.join(folder,'FILES-SHA256.json'),JSON.stringify({sourceDigest,files:out},null,2)+'\n');}
/** A twin as scripts/release-package.mjs leaves it: the program with the plain Windows fuses, the app as a resources\app folder, records. */
async function fixtureTwin(t){
 const base=await temp(t,'acira-wv-seal-'),twin=path.join(base,'release','AciraBrowser-0.1.10-beta.10-win32-x64-abcdef12-widevine-twin-unsigned'),digest='abcdef12'+'0'.repeat(56);
 const files={'AciraBrowser.exe':fakeProgram(WINDOWS),'ffmpeg.dll':'dll','resources/app-update.yml':'url: https://example.invalid/feed\n','resources/acira-verify.exe':'helper','resources/tor/tor.exe':'tor',
  'resources/app/package.json':JSON.stringify({name:'acira-browser',main:'desktop/main.cjs'}),'resources/app/desktop/main.cjs':'require("./other.cjs");','resources/app/desktop/other.cjs':'exports.ok=1;','resources/app/desktop/native/addon.node':'native',
  'READ-ME.txt':'Acira Browser 0.1.10-beta.10\n\nPortable Windows x64 candidate.\nQualification twin of a Widevine build: not VMP-signed and never shipped; the sealed folder made from it is the product.\nSource: x\n',
  'ACIRA-PROVENANCE.json':JSON.stringify({sourceDigest:digest,electronFuses:{},packagingInputs:[{file:'scripts/release-package.mjs',sha256:'0'}],limitations:['Unsigned portable candidate.'],widevine:{stage:'twin',runtime:{repository:'castlabs/electron-releases',release:'44.9.3+wvcus',archiveSha256:'1ab1e5aa'}}})};
 for(const [file,bytes] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(twin,file)),{recursive:true});await fs.writeFile(path.join(twin,file),bytes);}
 await writeManifestLike(twin,digest);
 return {root:base,twin};
}
/** A stand-in EVS client: sign-pkg writes AciraBrowser.exe.sig over the program's hash, verify-pkg checks it. Records what it saw. */
function standInVmp(seen){
 return async(folder,{verifyOnly}={})=>{
  const program=path.join(folder,'AciraBrowser.exe'),hash=sha(await fs.readFile(program));
  seen.push({step:verifyOnly?'verify':'sign',program:hash,fuses:await readFuses(program),integrity:await W.readAsarIntegrity(program)});
  if(verifyOnly){assert.equal(await fs.readFile(program+'.sig','utf8'),'vmp:'+hash,'the program changed after it was signed');return {action:'verify-pkg',diagnostic:' - Signature is valid'};}
  await fs.writeFile(program+'.sig','vmp:'+hash);return {action:'sign-pkg',diagnostic:' - Signature request successful'};
 };
}

test('sealing a qualified twin: app.asar with its hash in the program, the EVS fuse set, then the code-signing hook, then VMP last',async t=>{
 const {root:base,twin}=await fixtureTwin(t),seen=[];
 const result=await W.sealWindowsWidevine(twin,{root:base,vmp:standInVmp(seen),log:()=>{},authenticode:async program=>{seen.push({step:'authenticode',program:sha(await fs.readFile(program)),fuses:await readFuses(program),integrity:await W.readAsarIntegrity(program)});}});
 const sealed=path.join(base,'release','AciraBrowser-0.1.10-beta.10-win32-x64-abcdef12-widevine-unsigned');
 assert.equal(result.output,sealed);
 assert.deepEqual(seen.map(step=>step.step),['authenticode','sign','verify']);
 assert.deepEqual(seen[0].fuses,SHIPPED,'the fuses are burned before code signing');assert.ok(seen[0].integrity,'and the integrity record is in');
 assert.equal(seen[0].program,seen[1].program,'VMP signs exactly the code-signed program: Windows wants VMP after Authenticode');
 const manifest=JSON.parse(await fs.readFile(path.join(sealed,'FILES-SHA256.json'),'utf8')),entry=file=>manifest.files.find(item=>item.file===file);
 assert.equal(entry('AciraBrowser.exe').sha256,seen[1].program,'nothing touched the program after VMP');
 assert.ok(entry('AciraBrowser.exe.sig'),'the VMP signature is in the payload the installer carries');
 assert.ok(entry('resources/app.asar')&&entry('resources/app.asar.unpacked/desktop/native/addon.node'),'native addons stay unpacked');
 assert.equal(manifest.files.filter(item=>item.file.startsWith('resources/app/')).length,0);
 await assert.rejects(fs.access(path.join(sealed,'resources','app')),{code:'ENOENT'});
 assert.equal(asar.extractFile(path.join(sealed,'resources','app.asar'),path.normalize('desktop/main.cjs')).toString(),'require("./other.cjs");');
 const header=sha(asar.getRawHeader(path.join(sealed,'resources','app.asar')).headerString);
 assert.deepEqual(await W.readAsarIntegrity(path.join(sealed,'AciraBrowser.exe')),[{file:'resources\\app.asar',alg:'SHA256',value:header}],'the INTEGRITY/ELECTRONASAR resource Electron reads on Windows');
 assert.deepEqual(await readFuses(path.join(sealed,'AciraBrowser.exe')),SHIPPED);
 assert.deepEqual(await readFuses(path.join(twin,'AciraBrowser.exe')),WINDOWS,'the qualified twin is left as it was');
 const provenance=JSON.parse(await fs.readFile(path.join(sealed,'ACIRA-PROVENANCE.json'),'utf8'));
 assert.equal(provenance.widevine.stage,'sealed');assert.equal(provenance.widevine.twin.folder,'release/AciraBrowser-0.1.10-beta.10-win32-x64-abcdef12-widevine-twin-unsigned');
 assert.equal(provenance.widevine.twin.manifestSha256,sha(await fs.readFile(path.join(twin,'FILES-SHA256.json'))));
 assert.equal(provenance.widevine.authenticode,'signed before VMP');assert.deepEqual(provenance.electronFuses,SHIPPED);
 assert.match(provenance.widevine.order.at(-1),/^VMP signature \(last/);
 const readme=await fs.readFile(path.join(sealed,'READ-ME.txt'),'utf8');
 assert.doesNotMatch(readme,/Qualification twin/);assert.match(readme,/Keep AciraBrowser\.exe\.sig beside AciraBrowser\.exe/);
 assert.deepEqual(result.comparison,{identical:4,appFiles:4,unpacked:1});
 await assert.rejects(W.sealWindowsWidevine(twin,{root:base,vmp:standInVmp([]),log:()=>{}}),/already exists/,'release evidence is never overwritten');
});

test('without the hook the program is recorded as not code-signed, and only a twin under release/ is sealed',async t=>{
 const {root:base,twin}=await fixtureTwin(t);
 await assert.rejects(W.sealWindowsWidevine(twin,{root:path.join(base,'elsewhere'),vmp:standInVmp([]),log:()=>{}}),/under release/);
 const result=await W.sealWindowsWidevine(twin,{root:base,vmp:standInVmp([]),log:()=>{}});
 assert.match(result.widevine.authenticode,/^not signed/);
 assert.throws(()=>W.sealedName('/x/AciraBrowser-0.1.10-beta.10-win32-x64-abcdef12-unsigned'),/Not a Widevine twin/,'a plain build is never sealed');
 // The hand check in the guide: scripts/check-fuses.mjs expects the EVS set when the signature sits beside the program, the Windows set otherwise.
 const check=program=>require('node:child_process').spawnSync(process.execPath,[path.join(root,'scripts/check-fuses.mjs'),program],{encoding:'utf8'});
 const sealedCheck=check(path.join(result.output,'AciraBrowser.exe')),twinCheck=check(path.join(twin,'AciraBrowser.exe'));
 assert.equal(sealedCheck.status,0,sealedCheck.stdout+sealedCheck.stderr);assert.equal(JSON.parse(sealedCheck.stdout).build,'widevine (EVS fuse set)');
 assert.equal(twinCheck.status,0,twinCheck.stdout+twinCheck.stderr);assert.equal(JSON.parse(twinCheck.stdout).build,undefined);
 await fs.rm(path.join(result.output,'AciraBrowser.exe.sig'));
 assert.equal(check(path.join(result.output,'AciraBrowser.exe')).status,1,'the same program without its signature is held to the plain Windows set');
});

test('the installer accepts a sealed folder only while it is exactly its qualified twin, sealed',async t=>{
 const {root:base,twin}=await fixtureTwin(t),{output:sealed}=await W.sealWindowsWidevine(twin,{root:base,vmp:standInVmp([]),log:()=>{}});
 const provenance=JSON.parse(await fs.readFile(path.join(sealed,'ACIRA-PROVENANCE.json'),'utf8'));
 const ok=await W.verifySealedWidevine({sealed,root:base,provenance});
 assert.equal(ok.twinManifestSha256,provenance.widevine.twin.manifestSha256);
 const manifestFile=path.join(sealed,'FILES-SHA256.json'),original=await fs.readFile(manifestFile);
 const rewrite=async change=>{const manifest=JSON.parse(original.toString());change(manifest.files);await fs.writeFile(manifestFile,JSON.stringify(manifest));};
 // a shipped file that is not the qualified one
 await rewrite(files=>{files.find(item=>item.file==='resources/app-update.yml').sha256='0'.repeat(64);});
 await assert.rejects(W.compareSealedToTwin({sealed,twin}),/differs from its qualified twin at resources\/app-update\.yml/);
 // a file the twin never had
 await rewrite(files=>files.push({file:'extra.dll',sha256:'0'.repeat(64),bytes:1}));
 await assert.rejects(W.compareSealedToTwin({sealed,twin}),/has a file its twin did not: extra\.dll/);
 // the app folder left beside the asar
 await rewrite(files=>files.push({file:'resources/app/desktop/main.cjs',sha256:'0'.repeat(64),bytes:1}));
 await assert.rejects(W.compareSealedToTwin({sealed,twin}),/still has the unpacked app/);
 await fs.writeFile(manifestFile,original);
 // app code in the asar that is not the qualified code
 const archive=path.join(sealed,'resources','app.asar'),work=path.join(base,'repack');
 await fs.cp(path.join(twin,'resources','app'),work,{recursive:true});await fs.writeFile(path.join(work,'desktop','other.cjs'),'exports.ok=22;');
 const saved=await fs.readFile(archive);await asar.createPackageWithOptions(work,archive,{unpack:'**/*.node'});
 await assert.rejects(W.compareSealedToTwin({sealed,twin}),/An app file in the sealed asar differs from the qualified one: desktop\/other\.cjs/);
 await assert.rejects(W.verifySealedProgram(sealed),/integrity record does not match/,'and the program\'s record no longer matches it');
 await fs.writeFile(archive,saved);
 // the twin changed after it was qualified
 await fs.writeFile(path.join(twin,'ffmpeg.dll'),'changed');
 await assert.rejects(W.verifySealedWidevine({sealed,root:base,provenance}),/changed after qualification: ffmpeg\.dll/);
});

test('the build wiring: opt-in flag, preflight first, twin qualified by the existing rigs, sealed copy checked and made the installer',()=>{
 const pkg=require('../package.json'),build=read('scripts/build-windows.mjs'),pack=read('scripts/release-package.mjs'),installer=read('scripts/release-installer.mjs'),seal=read('packaging/windows-widevine.cjs');
 assert.equal(pkg.scripts['build:windows'],'node scripts/build-windows.mjs','the plain build is the same command');
 assert.equal(pkg.scripts['build:windows:widevine'],'node scripts/build-windows.mjs --widevine');
 assert.match(build,/const widevine=process\.argv\.includes\('--widevine'\)/);
 assert.ok(build.indexOf('sealing.preflight()')<build.indexOf("for(const script of ['build','test'])"),'EVS login and client are checked before the long build');
 assert.ok(build.indexOf('fetchWindowsWidevineRuntime()')<build.indexOf("for(const script of ['build','test'])"),'and the runtime is fetched and verified first');
 assert.match(build,/packageWindows\(candidate,\{widevine:runtime\}\)/);
 const sealAt=build.indexOf('sealing.sealWindowsWidevine(portable.output');
 assert.ok(sealAt>build.indexOf("'qa/release-reader-assets.mjs'"),'the twin passes every rig first');
 assert.ok(sealAt<build.indexOf("node('scripts/release-installer.mjs',product)"),'and the installer is made from the sealed copy');
 assert.match(build,/qa\/release-alive\.ps1'\),'-Exe',path\.join\(product,'AciraBrowser\.exe'\)/,'the sealed program is opened as a person opens it');
 assert.match(build,/'release\/installers',portable\.sourceDigest\.slice\(0,8\)\+\(widevine\?'-widevine':''\)/);
 assert.match(pack,/-\$\{widevine\?'widevine-twin-':''\}unsigned`/,'the plain package keeps its name');
 assert.match(pack,/path\.basename\(file\)==='electron\.exe\.sig'/,'ECS\'s development signature is left out');
 assert.match(installer,/provenance\.widevine&&provenance\.widevine\.stage!=='sealed'\)throw new Error\('This folder is the qualification twin/);
 assert.match(installer,/report\.packageManifestSha256===qualifiedManifestSha256/);
 const order=['writeAsarIntegrity(exe,','burnFuses(exe,EVS_FUSES)','await authenticode(exe)','await vmp(output,{python,env})'].map(step=>seal.indexOf(step));
 assert.ok(order.every((at,i)=>at>0&&(i===0||at>order[i-1])),'integrity, fuses, Authenticode, VMP: '+order);
});
