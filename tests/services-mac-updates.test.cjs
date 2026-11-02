const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createAppUpdater}=require('../desktop/browser-services/app-updater.cjs');
const {macUpdateAvailability}=require('../desktop/browser-services/mac-app-update.cjs');
const makeDir=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-mac-update-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir};
test('Mac updates retain channel, download choice, ready/restart and errors across native updater events',async t=>{
 const dir=makeDir(t),events=new EventEmitter();let installs=0;
 Object.assign(events,{checkForUpdates:async()=>events.emit('update-available',{version:'0.2.0'}),downloadUpdate:async()=>{events.emit('download-progress',{percent:61.2});events.emit('update-downloaded',{version:'0.2.0'})},quitAndInstall:()=>installs++});
 const options={app:{isPackaged:true,getVersion:()=>'0.1.0-beta.1',getPath:()=>dir},dir,platform:'darwin',env:{},macAvailability:()=>null,autoUpdater:events};
 const service=createAppUpdater(options);assert.equal(service.status().supported,true);service.setAutoDownload(false);service.setChannel('stable');
 assert.equal((await service.check()).status,'available');assert.equal(events.allowDowngrade,false);assert.equal(events.allowPrerelease,false);
 assert.equal((await service.download()).status,'ready');assert.equal((await service.install()).installing,true);assert.equal(installs,1);
 const restored=createAppUpdater(options);assert.equal(restored.status().channel,'stable');assert.equal(restored.status().autoDownload,false);
 events.emit('error',Error('Bad update signature'));assert.equal(service.status().status,'error');await assert.rejects(()=>service.install(),/No downloaded update/);
});
test('local, untrusted and test-profile Mac builds cannot begin automatic delivery',t=>{
 const dir=makeDir(t);let checks=0;const base={app:{isPackaged:true,getVersion:()=>'0.1.0',getPath:()=>dir},dir,platform:'darwin',macAvailability:()=> 'Signature unavailable',schedule:()=>{checks++}};
 const unsigned=createAppUpdater({...base,env:{}});unsigned.start();assert.equal(unsigned.status().supported,false);assert.equal(checks,0);
 let called=false;const isolated=createAppUpdater({...base,env:{ACIRA_BROWSER_TEST_DATA:dir},macAvailability:()=>{called=true;return null}});assert.match(isolated.status().reason,/test profile/);assert.equal(called,false);
});
test('Mac trust gate verifies the sealed bundle and exact publisher; rejects forged, ad-hoc and wrong-team identities',{skip:process.platform==='win32'&&'POSIX paths and symlinks: runs on macOS'},t=>{
 const dir=makeDir(t),bundle=path.join(dir,'Acira Browser.app'),resources=path.join(bundle,'Contents/Resources'),exe=path.join(bundle,'Contents/MacOS/AciraBrowser');fs.mkdirSync(path.dirname(exe),{recursive:true});fs.mkdirSync(resources,{recursive:true});fs.writeFileSync(exe,'owned fixture');fs.writeFileSync(path.join(resources,'app-update.yml'),'provider: github');
 const options={app:{getPath:()=>exe},resourcesPath:resources};const identity='Authority=Developer ID Application: Khaled Kaed Beyh (2MGLP3QV9X)\nTeamIdentifier=2MGLP3QV9X\n';
 let calls=[];const runner=(file,args)=>{calls.push([file,args]);return {status:0,stderr:identity}};
 assert.equal(macUpdateAvailability({...options,run:runner}),null);assert.equal(calls[0][0],'/usr/bin/codesign');assert.ok(calls[0][1].includes('--strict'));
 for(const stderr of ['Signature=adhoc\n',identity.replace('Khaled Kaed Beyh','Other Company'),identity.replace('TeamIdentifier=2MGLP3QV9X','TeamIdentifier=Z1Z2Z3Z4Z5'),identity.replaceAll('2MGLP3QV9X','Z1Z2Z3Z4Z5')])assert.match(macUpdateAvailability({...options,run:()=>({status:0,stderr})}),/Developer ID/);
 assert.match(macUpdateAvailability({...options,run:()=>({status:1})}),/could not be verified/);
 fs.unlinkSync(path.join(resources,'app-update.yml'));assert.match(macUpdateAvailability({...options,run:runner}),/writable Applications|no update feed/);
});
