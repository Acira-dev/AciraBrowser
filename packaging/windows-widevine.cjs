'use strict';
// Windows protected video (docs/launch/WINDOWS_WIDEVINE.md). Only `npm run build:windows:widevine` loads this file; the plain Windows build
// never does. That build packages castlabs' ECS runtime (scripts/fetch-windows-widevine.mjs) instead of stock Electron, then seals it here.
// Why a seal: free EVS VMP-signs an ECS program only when its fuse wire is Electron's default or exactly ONE fixed set, the set Mac ships
// (fuses.cjs SHIPPED; castlabs wiki FAQ "Can I use @electron/fuses with the free version of ECS and EVS?", castlabs/electron-releases#152).
// The plain Windows set (fuses.cjs WINDOWS) differs in three fuses and would be refused ("Binary signature denied"). SHIPPED needs the app
// as resources\app.asar with the hash of its header inside the program, and it turns --inspect off, which the packaged-app rigs need to drive
// the program. So build-windows.mjs qualifies a TWIN first (the same ECS program and files, the app as a resources\app folder, WINDOWS fuses)
// with every rig it runs today, and only then seals a copy of it:
//   1. resources\app -> resources\app.asar (native addons unpacked), its header hash written into AciraBrowser.exe (the resource Electron reads)
//   2. the EVS fuse set burned and read back
//   3. Authenticode, later: on Windows VMP signing must come AFTER code signing, the reverse of Mac (castlabs wiki, EVS page). The hook is here.
//   4. VMP: the official client (python -m castlabs_evs.vmp sign-pkg) writes AciraBrowser.exe.sig beside the program; verify-pkg reads it back.
// The client hashes the WHOLE AciraBrowser.exe (castlabs_evs core/util.py hash_pe_wv0), so nothing may change the program after step 4.
// The sealed folder's files are then compared with the twin's: the same bytes everywhere, the app's files byte for byte inside the asar, and
// only the program, its signature and the two text records differing. The installer step accepts a sealed folder only through that check.
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {SHIPPED,burnFuses,readFuses,fuseProblems,describe}=require('./fuses.cjs');
const run=promisify(execFile);
const PROGRAM='AciraBrowser.exe',SIGNATURE='AciraBrowser.exe.sig',DEV_SIGNATURE='electron.exe.sig',ASAR='resources/app.asar',APP='resources/app/';
const EVS_FUSES=SHIPPED;
// What may differ between the qualified twin and the sealed folder, besides the app moving into the asar.
const CHANGED=Object.freeze(['AciraBrowser.exe','ACIRA-PROVENANCE.json','READ-ME.txt']),ADDED=Object.freeze([SIGNATURE]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function filesIn(dir){const files=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.isSymbolicLink())throw Error('Symlink is not permitted in release inputs: '+full);if(item.isDirectory())files.push(...await filesIn(full));else if(item.isFile())files.push(full);}return files;}
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));
/** A module electron-builder's own app-builder-lib uses (resedit, its Windows ASAR integrity writer), from the copy electron-builder installed. */
function builderModule(request){
 const {createRequire}=require('node:module'),fromBuilder=createRequire(require.resolve('electron-builder/package.json')),lib=fromBuilder.resolve('app-builder-lib');
 return request.startsWith('./')?require(path.join(path.dirname(lib),request)):createRequire(lib)(request);
}
const defaultPython=(env,platform)=>env.ACIRA_EVS_PYTHON||(platform==='win32'?'python':'python3');

/** Before any long work: an EVS login file, Python with the official client, and a login that still refreshes without a password.
 *  Nothing is created or copied: the login stays in the client's own file. */
async function preflight({env=process.env,platform=process.platform,python=defaultPython(env,platform),exec=run}={}){
 if(!env.EVS_CONFIG_FILE)throw Error('Set EVS_CONFIG_FILE to your EVS login file before a Widevine build (usually %USERPROFILE%\\.config\\evs\\config.json; `python -m castlabs_evs.account reauth` writes it). No credential is created or shipped by the build.');
 try{await fs.access(env.EVS_CONFIG_FILE);}catch{throw Error(`EVS_CONFIG_FILE is ${env.EVS_CONFIG_FILE}, which does not exist. Log in once with: python -m castlabs_evs.account reauth`);}
 const options={env,windowsHide:true,timeout:120000,maxBuffer:1024*1024};
 let client;
 try{client=(await exec(python,['-m','castlabs_evs.vmp','--version'],options)).stdout.trim();}
 catch(error){throw Error(error.code==='ENOENT'?`Python was not found (${python}). Install Python 3, then set ACIRA_EVS_PYTHON to its python.exe.`:`The castlabs EVS client is not installed for ${python}: run  ${python} -m pip install --upgrade castlabs-evs`);}
 try{await exec(python,['-m','castlabs_evs.account','--no-ask','refresh'],options);}
 catch{throw Error('Your EVS login needs a password again (logins last about a month). Run  '+python+' -m castlabs_evs.account reauth  and start the build again.');}
 return {python,client};
}

/** resources\app -> resources\app.asar (*.node unpacked, as packaging/electron-builder.json asarUnpack). Returns the integrity record the program carries. */
async function sealAsar(folder){
 const asar=require('@electron/asar'),source=path.join(folder,'resources','app'),archive=path.join(folder,'resources','app.asar');
 await asar.createPackageWithOptions(source,archive,{unpack:'**/*.node'});
 await fs.rm(source,{recursive:true});
 return {[ASAR]:{algorithm:'SHA256',hash:sha(asar.getRawHeader(archive).headerString)}};
}
/** Writes the integrity record into the program with electron-builder's own writer (an INTEGRITY/ELECTRONASAR resource, as Electron reads it on Windows). */
async function writeAsarIntegrity(program,integrity){
 await builderModule('./electron/electronWin.js').addWinAsarIntegrity(program,integrity);
 const back=await readAsarIntegrity(program),expected=Object.entries(integrity).map(([file,{algorithm,hash}])=>({file:path.win32.normalize(file),alg:algorithm,value:hash}));
 if(JSON.stringify(back)!==JSON.stringify(expected))throw Error('The ASAR integrity record did not take: '+JSON.stringify(back));
 return back;
}
/** The program's ASAR integrity record ([{file,alg,value}]), or null when it has none. */
async function readAsarIntegrity(program){
 const {NtExecutable,NtExecutableResource}=builderModule('resedit');
 const entry=NtExecutableResource.from(NtExecutable.from(await fs.readFile(program))).entries.find(item=>item.type==='INTEGRITY'&&item.id==='ELECTRONASAR');
 return entry?JSON.parse(Buffer.from(entry.bin).toString('utf8')):null;
}
/** The official EVS client on the package folder: sign-pkg (production, streaming) or verify-pkg. It finds AciraBrowser.exe by the name hint. */
async function signVmp(folder,{python,env=process.env,verifyOnly=false,exec=run}={}){
 python??=defaultPython(env,process.platform);
 const action=verifyOnly?'verify-pkg':'sign-pkg';
 // Uploading the program can take a while on a slow line: EVS_GZ=1 in the environment asks the client to send it compressed.
 const result=await exec(python,['-m','castlabs_evs.vmp','--no-ask',action,...(verifyOnly?[]:['--streaming']),'--name-hint','AciraBrowser',folder],{env,windowsHide:true,maxBuffer:4*1024*1024,timeout:60*60*1000});
 // Only the client's non-secret signature lines are kept; the login never becomes a build input or a shipped file.
 return {action,diagnostic:result.stdout.trim()};
}

/** The twin's record of where it came from: its own manifest (checked file by file) and provenance. */
async function readQualifiedTwin(twin){
 const manifestBytes=await fs.readFile(path.join(twin,'FILES-SHA256.json')),manifest=JSON.parse(manifestBytes.toString('utf8')),provenance=await readJSON(path.join(twin,'ACIRA-PROVENANCE.json'));
 if(provenance.widevine?.stage!=='twin')throw Error('Not a Widevine qualification twin (ACIRA-PROVENANCE.json widevine.stage): '+twin);
 for(const entry of manifest.files){const file=path.resolve(twin,entry.file);if(!file.startsWith(path.resolve(twin)+path.sep))throw Error('Invalid twin manifest path');const bytes=await fs.readFile(file);if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error('The qualified twin changed after qualification: '+entry.file);}
 return {manifest,manifestSha256:sha(manifestBytes),provenance};
}
/** Every file in the asar, from its header: {relative posix path: {unpacked}}. A link is refused (the twin has none). */
function asarFiles(archive){
 const out={},walk=(node,prefix)=>{for(const [name,item] of Object.entries(node.files||{})){const rel=prefix+name;if(item.files)walk(item,rel+'/');else if('link' in item)throw Error('A link in the sealed asar: '+rel);else out[rel]={unpacked:Boolean(item.unpacked)};}};
 walk(require('@electron/asar').getRawHeader(archive).header,'');return out;
}
/** The sealed folder holds exactly the twin's product: the same bytes for every file, the app's files byte for byte inside the asar (or beside it,
 *  unpacked), and only CHANGED/ADDED besides. Throws on the first difference. */
async function compareSealedToTwin({sealed,twin}){
 const [a,b]=await Promise.all([readJSON(path.join(twin,'FILES-SHA256.json')),readJSON(path.join(sealed,'FILES-SHA256.json'))]);
 const before=new Map(a.files.map(entry=>[entry.file,entry])),after=new Map(b.files.map(entry=>[entry.file,entry]));
 const app=[...before.keys()].filter(file=>file.startsWith(APP));
 if(!app.length)throw Error('The twin has no resources/app folder: it was not packaged by scripts/release-package.mjs.');
 for(const [file,entry] of before){
  if(file.startsWith(APP)||CHANGED.includes(file))continue;
  const now=after.get(file);if(!now||now.sha256!==entry.sha256||now.bytes!==entry.bytes)throw Error('The sealed folder differs from its qualified twin at '+file);
 }
 for(const file of after.keys()){
  if(file.startsWith(APP))throw Error('The sealed folder still has the unpacked app: '+file);
  if(!before.has(file)&&!ADDED.includes(file)&&file!==ASAR&&!file.startsWith(ASAR+'.unpacked/'))throw Error('The sealed folder has a file its twin did not: '+file);
 }
 for(const file of [...CHANGED,...ADDED,ASAR])if(!after.has(file))throw Error('The sealed folder is missing '+file);
 const archive=path.join(sealed,ASAR),inside=asarFiles(archive),asar=require('@electron/asar');
 const expected=new Set(app.map(file=>file.slice(APP.length)));
 for(const rel of Object.keys(inside))if(!expected.has(rel))throw Error('The sealed asar has a file the qualified app did not: '+rel);
 let unpacked=0;
 for(const rel of expected){
  const want=before.get(APP+rel);if(!inside[rel])throw Error('The sealed asar is missing '+rel);
  if(inside[rel].unpacked){unpacked++;const entry=after.get(ASAR+'.unpacked/'+rel);if(!entry||entry.sha256!==want.sha256)throw Error('An unpacked app file differs from the qualified one: '+rel);continue;}
  const bytes=asar.extractFile(archive,path.normalize(rel));if(bytes.length!==want.bytes||sha(bytes)!==want.sha256)throw Error('An app file in the sealed asar differs from the qualified one: '+rel);
 }
 for(const file of after.keys())if(file.startsWith(ASAR+'.unpacked/')&&!inside[file.slice(ASAR.length+'.unpacked/'.length)]?.unpacked)throw Error('An unpacked file the asar does not list: '+file);
 return {identical:[...before.keys()].filter(file=>!file.startsWith(APP)&&!CHANGED.includes(file)).length,appFiles:expected.size,unpacked};
}
/** The sealed program as EVS and Electron need it: the EVS fuse set, the asar's header hash in its integrity record, a VMP signature beside it. */
async function verifySealedProgram(folder){
 const program=path.join(folder,PROGRAM),wrong=await fuseProblems(program,EVS_FUSES);
 if(wrong.length)throw Error('The sealed program does not carry the EVS fuse set: '+describe(wrong));
 const record=await readAsarIntegrity(program),hash=sha(require('@electron/asar').getRawHeader(path.join(folder,ASAR)).headerString);
 if(JSON.stringify(record)!==JSON.stringify([{file:'resources\\app.asar',alg:'SHA256',value:hash}]))throw Error('The sealed program\'s ASAR integrity record does not match resources\\app.asar: '+JSON.stringify(record));
 const signature=await fs.readFile(path.join(folder,SIGNATURE)).catch(()=>null);if(!signature?.length)throw Error('The sealed folder has no VMP signature ('+SIGNATURE+').');
 return {fuses:await readFuses(program),asarIntegrity:record,signatureSha256:sha(signature)};
}
async function writeManifest(folder,sourceDigest){
 const files=[];for(const file of await filesIn(folder)){const relative=path.relative(folder,file).replaceAll('\\','/');if(relative==='FILES-SHA256.json')continue;const bytes=await fs.readFile(file);files.push({file:relative,sha256:sha(bytes),bytes:bytes.length});}
 files.sort((x,y)=>x.file<y.file?-1:x.file>y.file?1:0);
 await fs.writeFile(path.join(folder,'FILES-SHA256.json'),JSON.stringify({sourceDigest,files},null,2)+'\n');return files.length;
}
/** The sealed folder's name: the twin's, without "-twin". */
function sealedName(twin){const name=path.basename(twin);if(!/-widevine-twin-unsigned$/.test(name))throw Error('Not a Widevine twin folder name: '+name);return name.replace(/-widevine-twin-unsigned$/,'-widevine-unsigned');}

/** Seals a copy of the qualified twin (steps 1-4 above) and returns {output, ...record}. `authenticode(program)` is the code-signing hook:
 *  when Microsoft signing exists, pass a function that signs AciraBrowser.exe (scripts/release-sign.mjs signFiles); it runs after the fuses
 *  and before VMP, which is the order Windows needs. `vmp` is signVmp (tests pass a stand-in). */
async function sealWindowsWidevine(twin,{root,python,env=process.env,authenticode=null,vmp=signVmp,log=console.log}={}){
 twin=path.resolve(twin);root=path.resolve(root||path.join(__dirname,'..'));
 if(!twin.startsWith(path.join(root,'release')+path.sep))throw Error('Seal a twin made by scripts/release-package.mjs under release/.');
 const qualified=await readQualifiedTwin(twin),output=path.join(path.dirname(twin),sealedName(twin));
 try{await fs.access(output);throw Error('The sealed folder already exists; do not overwrite release evidence: '+output);}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.cp(twin,output,{recursive:true});
 await fs.rm(path.join(output,'FILES-SHA256.json'));
 const exe=path.join(output,PROGRAM);
 log('Sealing the app into resources\\app.asar');
 const asarIntegrity=await writeAsarIntegrity(exe,await sealAsar(output));
 log('Burning the EVS fuse set');
 const fuses=await burnFuses(exe,EVS_FUSES);
 if(authenticode){log('Code signing the program (before VMP)');await authenticode(exe);}
 log('VMP signing with castlabs EVS (production, streaming)');
 const signed=await vmp(output,{python,env});log(signed.diagnostic);
 const verified=await vmp(output,{python,env,verifyOnly:true});log(verified.diagnostic);
 // From here on AciraBrowser.exe is final: VMP covers every byte of it.
 const programSha256=sha(await fs.readFile(exe)),signature=sha(await fs.readFile(path.join(output,SIGNATURE)));
 const provenance=qualified.provenance;
 provenance.widevine={...provenance.widevine,stage:'sealed',twin:{folder:path.relative(root,twin).replaceAll('\\','/'),manifestSha256:qualified.manifestSha256,programSha256:qualified.manifest.files.find(entry=>entry.file===PROGRAM)?.sha256},
  program:{sha256:programSha256,fuses,asarIntegrity},vmp:{kind:'streaming',signature:{file:SIGNATURE,sha256:signature},signed:signed.diagnostic,verified:verified.diagnostic},
  authenticode:authenticode?'signed before VMP':'not signed (Microsoft signing pending; when it exists it goes before VMP)',
  order:['resource editor (icon, version)','ASAR integrity record','EVS fuse set','Authenticode (when configured)','VMP signature (last: it covers the whole program)'],playbackVerified:false};
 provenance.electronFuses=fuses;
 provenance.nativeQualification=`Qualified as its twin ${provenance.widevine.twin.folder} (the same files with the app as a resources\\app folder and the Windows fuse set, which the packaged-app rigs need). This folder is that twin sealed; scripts/release-installer.mjs compares the two file by file.`;
 provenance.packagingInputs=[...provenance.packagingInputs.filter(input=>input.file!=='packaging/windows-widevine.cjs'),{file:'packaging/windows-widevine.cjs',source:'packaging-tool',sha256:sha(await fs.readFile(__filename))}];
 provenance.limitations=[...provenance.limitations,'VMP-signed with castlabs EVS (production, streaming). Whether Netflix, Spotify and Disney+ play is checked by hand on a clean profile (docs/launch/WINDOWS_WIDEVINE.md).'];
 await fs.writeFile(path.join(output,'ACIRA-PROVENANCE.json'),JSON.stringify(provenance,null,2)+'\n');
 const readme=(await fs.readFile(path.join(output,'READ-ME.txt'),'utf8')).replace(/\nQualification twin[^\n]*\n/,'\n');
 await fs.writeFile(path.join(output,'READ-ME.txt'),readme+`Protected video (Widevine): castlabs ECS ${provenance.widevine.runtime.release}, VMP-signed. Keep ${SIGNATURE} beside ${PROGRAM}; protected video stops playing without it.\n`);
 const files=await writeManifest(output,provenance.sourceDigest);
 const comparison=await compareSealedToTwin({sealed:output,twin}),program=await verifySealedProgram(output);
 return {output,files,sourceDigest:provenance.sourceDigest,twin,widevine:provenance.widevine,comparison,program};
}
/** For scripts/release-installer.mjs: a sealed folder's qualified twin, checked again (twin unchanged, sealed = twin sealed, program as EVS needs). */
async function verifySealedWidevine({sealed,root,provenance}){
 const twin=path.resolve(root,provenance.widevine?.twin?.folder||'');
 if(!twin.startsWith(path.join(path.resolve(root),'release')+path.sep))throw Error('The sealed folder names no qualified twin under release/.');
 const qualified=await readQualifiedTwin(twin);
 if(qualified.manifestSha256!==provenance.widevine.twin.manifestSha256)throw Error('The twin\'s manifest is not the one this folder was sealed from.');
 return {twin,twinManifestSha256:qualified.manifestSha256,comparison:await compareSealedToTwin({sealed,twin}),program:await verifySealedProgram(sealed)};
}
module.exports={EVS_FUSES,PROGRAM,SIGNATURE,DEV_SIGNATURE,CHANGED,ADDED,preflight,sealAsar,writeAsarIntegrity,readAsarIntegrity,signVmp,compareSealedToTwin,verifySealedProgram,sealedName,sealWindowsWidevine,verifySealedWidevine,builderModule};
