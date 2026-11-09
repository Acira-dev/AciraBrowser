// Separate windows: a switch to Personal lands on Personal even while another window is still starting. A window that is still reading its saved record has the
// empty default state, which says "Personal", so a switch to Personal took that window (made for another profile) as Personal's own: Personal never opened, and with
// many profiles and a restart a switch sat for 20 s without landing (the many-profile sweep, 9 Nov). `node qa/profile-switch-lands.mjs [repo]`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,sleep,poll} from './d-harness.mjs';

const stamp=Date.now(),root=path.resolve('.qa-profiles/switch-lands-'+stamp),out=path.resolve(process.env.SWITCH_LANDS_OUT||'qa/artifacts/switch-lands-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const UI='acira-browser-ui://ui/index.html',report={passed:false,problems:[]};
const launch=()=>startApp({root,args:['--use-mock-keychain'],main:path.resolve('qa/restore-delay-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
// every window's interface says which profile it holds
const windowProfiles=app=>app.main(async({BaseWindow},UI)=>{const out=[];for(const w of BaseWindow.getAllWindows()){if(w.isDestroyed())continue;for(const v of w.contentView.children){try{if(v.webContents.getURL()===UI)out.push(await Promise.race([v.webContents.executeJavaScript('window.acira.getSnapshot().then(s=>s.activeBrowserProfileId)'),new Promise(r=>setTimeout(()=>r('timeout'),3000))]));}catch{}}}return out;},UI);
// dispatch from the interface of the window that holds `profile` (the harness's own `act` is bound to the first window it found, which a restart or a close can change)
const actFrom=(app,profile,action)=>app.main(async({BaseWindow},{UI,profile,action})=>{for(const w of BaseWindow.getAllWindows()){if(w.isDestroyed())continue;for(const v of w.contentView.children){try{if(v.webContents.getURL()===UI&&await v.webContents.executeJavaScript('window.acira.getSnapshot().then(s=>s.activeBrowserProfileId)')===profile){await v.webContents.executeJavaScript('window.acira.dispatch('+JSON.stringify(action)+')');return true;}}catch{}}}return false;},{UI,profile,action});
let app;
try{
 app=await launch();
 if(process.platform==='darwin')assert.equal(await app.main(({app})=>app.commandLine.hasSwitch('use-mock-keychain')),true,'every launch here uses the mock keychain');
 await app.act({type:'settings.update',patch:{askBeforeClosing:false}});
 await app.act({type:'browser.profile.create',name:'Client'});await app.act({type:'browser.profile.create',name:'Studio'});await sleep(400);
 const ids=(await app.state()).browserProfiles.filter(p=>!p.private).map(p=>p.id),[personal,client,studio]=ids;
 assert.equal(personal,'profile-personal');
 // windows for Client and Studio (Personal's steps aside), then a restart: only the window on screen comes back, the others are saved records
 for(const id of [client,studio]){await app.act({type:'browser.profile.select',id,here:true});await poll(async()=>(await windowProfiles(app)).includes(id),Boolean,'a window for '+id,15000);await sleep(700);}
 await app.close();await sleep(2500);
 app=await launch();
 await poll(async()=>(await windowProfiles(app)).length>=1,Boolean,'the window after the restart',20000);
 const open=await windowProfiles(app);
 // Studio's window is the one to switch from; Client's window is closed on purpose (its record is kept for it), so the next window for Client is made from a saved record.
 const here=studio;assert.ok(open.includes(here),'Studio is open after the restart: '+JSON.stringify(open));
 assert.ok(!open.includes(personal),'Personal has no open window after the restart');
 await app.main(async({BaseWindow},{UI,client})=>{for(const w of BaseWindow.getAllWindows()){for(const v of w.contentView.children){try{if(v.webContents.getURL()===UI&&await v.webContents.executeJavaScript('window.acira.getSnapshot().then(s=>s.activeBrowserProfileId)')===client){w.close();return;}}catch{}}}},{UI,client});
 await poll(async()=>!(await windowProfiles(app)).includes(client),Boolean,'Client\'s window closed',15000).catch(()=>{});
 await sleep(500);
 // The next saved record to be read is slow: a window for Client starts (its state is the empty default, "Personal") ...
 await app.main(()=>{globalThis.__restoreDelay=2500;});
 assert.equal(await actFrom(app,studio,{type:'browser.profile.select',id:client}),true);
 await sleep(150);
 // ... and the switch to Personal comes while it is starting
 assert.equal(await actFrom(app,studio,{type:'browser.profile.select',id:personal,here:true}),true);
 await app.main(()=>{globalThis.__restoreDelay=0;});
 const landed=await poll(async()=>(await windowProfiles(app)).includes(personal),Boolean,'a window holding Personal',15000).then(()=>true,()=>false);
 report.windows=await windowProfiles(app);
 if(!landed)report.problems.push('the switch to Personal never opened Personal: the window that was starting for another profile was taken as Personal\'s (windows: '+report.windows.map(id=>id===personal?'Personal':id===client?'Client':id===studio?'Studio':id).join(', ')+')');
 report.passed=!report.problems.length;if(!report.passed)process.exitCode=1;
 console.log((report.passed?'PASS':'FAIL')+' switch to Personal lands while another window starts'+(report.problems.length?' - '+report.problems.join('; '):''));
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.log('FAIL '+report.error);}
finally{await app?.close();await fs.rm(root,{recursive:true,force:true});await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');}
