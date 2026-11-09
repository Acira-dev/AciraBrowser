// The third profile (Discord tester, 9 Nov 2026): "the first two switch seamlessly, but on my third profile it flashes white, lags, sometimes shows
// 'Acira couldn't display this view', and sometimes gets stuck so I can't click the window". Profiles as spaces, tabs in the sidebar, and Favorites
// that differ from one profile to the next (the first two have one, the third none): the sidebar's Favorites drew a different number of hooks from
// one render to the next, React threw (#300/#310), the interface reloaded itself (the white flash and the lag), and the third failure within a minute
// left the error screen up with the last page still drawn over it, so Reload view could not be reached.
//   Part 1: ten real switches across the three profiles with a page open in each: the interface never throws, never reloads and never shows the error screen.
//   Part 2: when the error screen IS up (interface-error), main takes every page view off the interface, and Reload view brings the page back.
// `node qa/third-profile-switch.mjs [repo]` runs another checkout's main and interface (a base copy, to see it fail there).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,sleep,poll} from './d-harness.mjs';

const stamp=Date.now(),root=path.resolve('.qa-profiles/third-profile-'+stamp),out=path.resolve(process.env.THIRD_PROFILE_OUT||'qa/artifacts/third-profile-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const fixture=await httpFixture((req,res)=>{const name=decodeURIComponent(req.url.slice(1))||'Page';res.setHeader('Content-Type','text/html');res.end(`<title>${name}</title><style>body{font:15px system-ui;margin:24px}.g{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.c{height:60px;background:#8884}</style><h1>${name}</h1><div class=g>${'<div class=c></div>'.repeat(300)}</div>`);});
const site=name=>'http://127.0.0.1:'+fixture.port+'/'+encodeURIComponent(name);
const report={passed:false,problems:[],switches:[]};
const UI='acira-browser-ui://ui/index.html';
let app;
try{
 app=await startApp({root,args:['--use-mock-keychain'],main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 if(process.platform==='darwin')assert.equal(await app.main(({app})=>app.commandLine.hasSwitch('use-mock-keychain')),true,'every launch here uses the mock keychain');
 // What the interface does: every error it logs, and every time it loads (a reload is the white flash).
 await app.main(({BaseWindow},UI)=>{const ui=[];for(const w of BaseWindow.getAllWindows())for(const v of w.contentView.children)if(v.webContents?.getURL()===UI)ui.push(v.webContents);
  globalThis.__tp={loads:0,errors:[]};for(const wc of ui){wc.on('did-start-loading',()=>{globalThis.__tp.loads++;});wc.on('console-message',(e,level,message)=>{const m=String(e?.message??message);if((e?.level??level)>=2||/React error|Error:/.test(m))globalThis.__tp.errors.push(m.slice(0,200));});}},UI);
 await app.act({type:'settings.update',patch:{askBeforeClosing:false,reducedMotion:false}});
 await app.act({type:'browser.profile.create',name:'Client'});await app.act({type:'browser.profile.create',name:'Studio'});
 await app.act({type:'settings.update',patch:{spaces:'profiles',verticalTabs:false}});await app.act({type:'ui.update',patch:{view:'full',workspaceOpen:true,webWorkspaceOpen:true}});await sleep(600);
 const s=await app.state(),profiles=Object.fromEntries(s.browserProfiles.filter(p=>!p.private).map(p=>[p.name,p.id])),names=Object.keys(profiles),space=name=>s.workspaces.find(w=>w.browserProfileId===profiles[name]).id;
 for(const name of names){await app.act({type:'workspace.select',id:space(name)});await sleep(400);await app.act({type:'tab.new',url:site(name+' page'),browserProfileId:profiles[name]});await sleep(300);}
 await app.act({type:'workspace.select',id:space('Personal')});await sleep(1500);
 // Favorites live in the interface's storage, per profile: Personal and Client have one, Studio none (the third profile's state differs from the first two's).
 await app.ui.evaluate(({profiles})=>{for(const [name,id] of Object.entries(profiles)){const n=name==='Studio'?0:1;localStorage.setItem('acira-sidebar-apps:'+id,JSON.stringify({apps:Array.from({length:n},(_,k)=>({id:'app-'+name+k,url:'https://example.com/'+k,title:name+' favorite'})),hidden:false,seeded:true}));}window.dispatchEvent(new Event('acira-sidebar-apps'));},{profiles});
 await sleep(400);
 // Tabs in the sidebar: the Favorites region is drawn from the first profile's list.
 await app.act({type:'settings.update',patch:{verticalTabs:true}});await sleep(2500);
 await app.main(()=>{globalThis.__tp.loads=0;globalThis.__tp.errors.length=0;});
 const order=['Client','Studio','Personal','Studio','Client','Personal','Studio','Client','Studio','Personal'];
 for(const name of order){
  await app.act({type:'browser.profile.select',id:profiles[name],here:true});
  await poll(async()=>(await app.state()).activeBrowserProfileId===profiles[name],Boolean,'switch to '+name,10000);
  await sleep(350);
  const shown=await app.ui.evaluate(()=>({error:/display this view/.test(document.body.innerText),footer:document.querySelector('.sb-foot-profile')?.textContent?.trim()??''}));
  const seen=await app.main(()=>({loads:globalThis.__tp.loads,errors:[...globalThis.__tp.errors]}));
  report.switches.push({to:name,...shown,...seen});
  if(shown.error)report.problems.push(`switch to ${name}: the error screen is up`);
 }
 const last=report.switches.at(-1);
 if(last.loads)report.problems.push(`the interface reloaded itself ${last.loads} time(s) during ten switches (each one is a blank view: the white flash and the lag)`);
 if(last.errors.length)report.problems.push(`the interface threw ${last.errors.length} error(s) during the switches: ${[...new Set(last.errors)].slice(0,3).join(' | ')}`);
 // Part 2: the error screen is up; nothing of a page may stay over it, and Reload view brings everything back.
 const visiblePages=()=>app.main(({BaseWindow},UI)=>{let n=0;for(const w of BaseWindow.getAllWindows())for(const v of w.contentView.children){let url='';try{url=v.webContents?.getURL()||'';}catch{}if(/^https?:/.test(url)&&v.getVisible())n++;}return n;},UI);
 assert.equal(await visiblePages(),1,'before the error screen, the page of the profile on screen is drawn');
 let refused='';try{await app.cmd({type:'interface-error',tabId:'interface',on:true});}catch(error){refused=String(error?.message||error);}
 if(refused)report.problems.push('main refused the interface-error command: '+refused);
 else{
  await sleep(400);const covering=await visiblePages();
  if(covering)report.problems.push(`${covering} page view(s) stay drawn over the interface's error screen (Reload view cannot be clicked)`);
  // Reload view: the interface loads again and draws; its first layout puts the page back.
  await app.ui.evaluate(()=>location.reload());
  await poll(()=>app.ui.evaluate(()=>Boolean(window.acira?.getSnapshot)&&document.querySelector('.acira-sidebar,.tab-strip-container')),Boolean,'the interface after Reload view',20000);
  const back=await poll(async()=>(await visiblePages())===1,Boolean,'the page after Reload view',10000).then(()=>true,()=>false);
  if(!back)report.problems.push('after Reload view the page did not come back');
 }
 report.passed=!report.problems.length;
 if(!report.passed)process.exitCode=1;
 console.log((report.passed?'PASS':'FAIL')+' third profile switch'+(report.problems.length?' - '+report.problems.join('; '):''));
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.log('FAIL '+report.error);}
finally{await app?.close();await fixture.close();await fs.rm(root,{recursive:true,force:true});await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');}
