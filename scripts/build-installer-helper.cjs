'use strict';
// Compiles the small Windows helpers in packaging/installer with the C# compiler that ships with the .NET Framework 4 on
// every supported Windows (no SDK needed; C# 5; AnyCPU, CLR v4.0.30319, so Windows 10 1809+ runs it on the in-box .NET Framework 4.7.2 with nothing to install; keep to APIs that exist there). Both executables carry the app icon (packaging/acira-icon.ico) and a manifest (acira-helper.manifest): PerMonitorV2 DPI, requestedExecutionLevel asInvoker, supportedOS Windows 8.1 and 10/11. Run: node scripts/build-installer-helper.cjs
//   AciraProgress.cs  -> acira-progress.exe   scene player + progress line for the installer (frames from anim/ embedded)
//   AciraUninstall.cs + AciraChoose.cs -> acira-uninstall.exe  branded uninstall question (scenes from scripts/uninstall-art-main.cjs, embedded) and the
//                      installer's Repair / Update / Open question when an Acira is already installed (--choose)
//   AciraVerify.cs    -> acira-verify.exe   ships in the app's resources folder: Windows Hello / account password check, executable icons,
//                      Authenticode signatures for Acira itself (desktop/windows-helper.cjs), so the app never runs a script host
// Pass names to build only those (node scripts/build-installer-helper.cjs acira-verify.exe): the portable package builds the app helper alone.
// Sources are UTF-8 (/codepage:65001): the helpers carry their sentences in every installer language.
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'packaging','installer'),art=path.join(dir,'uninstall');
const csc=[process.env.SystemRoot+'\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',process.env.SystemRoot+'\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'].find(fs.existsSync);
if(!csc)throw new Error('The .NET Framework C# compiler was not found.');
function build(out,source,extra=[],more=[]){
 // a response file: hundreds of embedded frames do not fit on one command line
 const args=['/nologo','/codepage:65001','/target:winexe','/optimize+','/platform:anycpu','/r:System.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/win32icon:'+path.join(root,'packaging','acira-icon.ico'),'/win32manifest:'+path.join(dir,'acira-helper.manifest'),...extra,'/out:'+path.join(dir,out),path.join(dir,source),...more.map(m=>path.join(dir,m))],rsp=path.join(require('node:os').tmpdir(),'acira-csc-'+process.pid+'.rsp');
 fs.writeFileSync(rsp,args.map(a=>'"'+a+'"').join(String.fromCharCode(10)));
 const result=spawnSync(csc,['@'+rsp],{encoding:'utf8'});fs.rmSync(rsp,{force:true});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
 if(result.status!==0)process.exit(result.status||1);
 console.log(out,fs.statSync(path.join(dir,out)).size,'bytes');
}
const only=process.argv.slice(2),wanted=name=>!only.length||only.includes(name);
for(const name of only)if(!['acira-progress.exe','acira-uninstall.exe','acira-verify.exe'].includes(name))throw new Error('Unknown helper: '+name);
if(wanted('acira-progress.exe')){
const anim=path.join(dir,'anim'),frames=fs.readdirSync(anim).filter(f=>/.(jpg|png)$/.test(f)).map(f=>'/resource:'+path.join(anim,f)+','+f);
if(!frames.length)throw new Error('Render the scene frames first: node_modules/electron/dist/electron.exe scripts/installer-frames-main.cjs');
build('acira-progress.exe','AciraProgress.cs',frames);
}
if(wanted('acira-uninstall.exe')){
const resources=fs.readdirSync(art).filter(f=>/\.(jpg|png|txt)$/.test(f)).map(f=>'/resource:'+path.join(art,f)+','+f);
build('acira-uninstall.exe','AciraUninstall.cs',resources,['AciraChoose.cs']);
}
if(wanted('acira-verify.exe'))build('acira-verify.exe','AciraVerify.cs');
