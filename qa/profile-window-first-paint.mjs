// Separate windows: the first switch to a profile whose window is not open makes a window, and the window being left stays on screen until the new one
// has drawn its interface. Before 13.3 the new window was shown and the old one hidden as soon as the new window was "ready", about 200 ms (much more on a
// busy Mac) before its interface had loaded: an empty window, the white flash of the Discord tester's third profile.
// The check reads the order of two moments: the old window's hide() and the new interface's first layout (the mark it makes when it has drawn). `node qa/profile-window-first-paint.mjs [repo]`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,sleep,poll} from './d-harness.mjs';

const stamp=Date.now(),root=path.resolve('.qa-profiles/first-paint-'+stamp),out=path.resolve(process.env.FIRST_PAINT_OUT||'qa/artifacts/first-paint-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const UI='acira-browser-ui://ui/index.html',report={passed:false,problems:[],switches:[]};
let app;
try{
 app=await startApp({root,args:['--use-mock-keychain'],main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 if(process.platform==='darwin')assert.equal(await app.main(({app})=>app.commandLine.hasSwitch('use-mock-keychain')),true,'every launch here uses the mock keychain');
 await app.main(({BaseWindow})=>{globalThis.__hides=[];const real=BaseWindow.prototype.hide;BaseWindow.prototype.hide=function(...args){globalThis.__hides.push({at:performance.timeOrigin+performance.now(),id:this.id});return real.apply(this,args);};});
 await app.act({type:'settings.update',patch:{askBeforeClosing:false}});
 await app.act({type:'browser.profile.create',name:'Client'});await app.act({type:'browser.profile.create',name:'Studio'});await sleep(500);
 const profiles=(await app.state()).browserProfiles.filter(p=>!p.private).map(p=>p.id);
 for(const index of [1,2]){
  await app.main(()=>{globalThis.__hides.length=0;});
  const before=await app.main(({BaseWindow})=>BaseWindow.getAllWindows().map(w=>w.id));
  await app.act({type:'browser.profile.select',id:profiles[index],here:true});
  // the new window: its interface, the first one that is not in a window that existed before
  const found=await poll(()=>app.main(async({BaseWindow,webContents},{UI,before})=>{for(const w of BaseWindow.getAllWindows()){if(before.includes(w.id))continue;for(const v of w.contentView.children){try{if(v.webContents.getURL()===UI){const marks=await v.webContents.executeJavaScript(`(()=>{const m=performance.getEntriesByName('acira-layout-sent')[0];return m?performance.timeOrigin+m.startTime:0;})()`);if(marks)return {layoutSent:marks,hides:globalThis.__hides.slice(),oldWindow:before};}}catch{}}}return null;},{UI,before}),Boolean,'the new window drew its interface',20000);
  await poll(()=>app.main(()=>globalThis.__hides.length>0),Boolean,'the old window stepped aside',20000);
  const hides=await app.main(()=>globalThis.__hides.slice()),hide=hides.find(h=>found.oldWindow.includes(h.id));
  const gap=hide?Math.round(hide.at-found.layoutSent):null;
  report.switches.push({to:index,hideAfterLayoutMs:gap});
  // allowed: the hide may come a few ms before the mark is read (the show is 16 ms after it); never the ~100-200 ms before that the empty window lasted
  if(gap===null)report.problems.push(`switch to profile ${index}: the old window never stepped aside`);
  else if(gap<-30)report.problems.push(`switch to profile ${index}: the old window was hidden ${-gap} ms before the new window's interface had drawn (an empty window on screen)`);
  await sleep(600);
 }
 report.passed=!report.problems.length;if(!report.passed)process.exitCode=1;
 console.log((report.passed?'PASS':'FAIL')+' profile window first paint '+JSON.stringify(report.switches)+(report.problems.length?' - '+report.problems.join('; '):''));
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.log('FAIL '+report.error);}
finally{await app?.close();await fs.rm(root,{recursive:true,force:true});await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');}
