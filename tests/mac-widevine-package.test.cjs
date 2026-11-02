const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {sealAsar,FUSES,signingTargets}=require('../packaging/macos/widevine.cjs'),asar=require('@electron/asar'),plist=require('plist'),{FuseV1Options:F}=require('@electron/fuses');
test('Mac signing includes executable code and bundles while excluding binary data and archives',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-sign-targets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'Acira.app'),framework=path.join(app,'Contents/Frameworks/Test.framework');await fs.mkdir(framework,{recursive:true});
 const binary=path.join(framework,'native');await fs.writeFile(binary,Buffer.from('cffaedfe00000000','hex'));
 const data=path.join(framework,'locale.pak');await fs.writeFile(data,Buffer.from('0400000000000000','hex'));
 const archive=path.join(app,'Contents/app.asar');await fs.writeFile(archive,Buffer.from('0400000000000000','hex'));
 const targets=await signingTargets(app);assert(targets.has(app));assert(targets.has(framework));assert(targets.has(binary));assert(!targets.has(data));assert(!targets.has(archive));
});
test('the EVS-compatible Mac fuse policy retains cookie encryption and requires archive integrity',()=>{
 assert.equal(FUSES[F.EnableCookieEncryption],true);assert.equal(FUSES[F.RunAsNode],false);
 assert.equal(FUSES[F.EnableEmbeddedAsarIntegrityValidation],true);assert.equal(FUSES[F.OnlyLoadAppFromAsar],true);
 assert.equal(FUSES[F.EnableNodeCliInspectArguments],false);
 assert.equal(Object.hasOwn(FUSES,F.WasmTrapHandlers),false);
});
test('Mac ASAR packaging records the exact header hash and unpacks native addons',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-widevine-asar-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'Browser.app'),resources=path.join(app,'Contents/Resources'),source=path.join(resources,'app');
 await fs.mkdir(path.join(source,'desktop/native'),{recursive:true});
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({main:'main.cjs'}));await fs.writeFile(path.join(source,'main.cjs'),'exports.ready=true;');
 await fs.writeFile(path.join(source,'desktop/native/test.node'),'native fixture');
 await fs.writeFile(path.join(app,'Contents/Info.plist'),plist.build({CFBundleIdentifier:'computer.acira.test'}));
 const integrity=await sealAsar(app),archive=path.join(resources,'app.asar');
 assert.equal(integrity['Resources/app.asar'].hash,createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex'));
 assert.equal(asar.extractFile(archive,'main.cjs').toString(),'exports.ready=true;');
 assert.equal(await fs.readFile(path.join(resources,'app.asar.unpacked/desktop/native/test.node'),'utf8'),'native fixture');
 assert.equal(plist.parse(await fs.readFile(path.join(app,'Contents/Info.plist'),'utf8')).ElectronAsarIntegrity['Resources/app.asar'].hash,integrity['Resources/app.asar'].hash);
 await assert.rejects(fs.access(source),{code:'ENOENT'});
});
test('Mac-only runtime pins do not replace or alter the Windows Electron dependency',()=>{
 const pkg=require('../package.json'),pin=require('../packaging/macos/widevine-runtime.json');
 assert.equal(pkg.devDependencies.electron,pin.electron);assert.deepEqual(Object.keys(pin.platforms),['arm64','x64']);
 for(const spec of Object.values(pin.platforms))assert.match(spec.sha256,/^[a-f0-9]{64}$/);
});
