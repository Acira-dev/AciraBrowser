// Many profiles (founder, 9 Nov: "what if someone had even more?"). Profiles as spaces, eight of them, Favorites 0 / 1 / 3 / 9 / 20 and a hidden list mixed
// across them, pinned tabs in some, a page in each, the layout changed between rounds (tabs in the sidebar, tabs on top, seamless, compact, focus), and ninety
// seeded random switches with a fast A-B-A-B-A-B burst every fifteenth: the interface never throws, never reloads, never shows the error screen; every switch
// lands on the profile asked for; and no switch is slower than a second and a half. Memory and the switch times are written to the result file.
// `node qa/many-profiles-switch.mjs [repo]` runs another checkout's main and interface (a base copy, to see it fail there).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,sleep,poll} from './d-harness.mjs';

const stamp=Date.now(),root=path.resolve('.qa-profiles/many-profiles-'+stamp),out=path.resolve(process.env.MANY_PROFILES_OUT||'qa/artifacts/many-profiles-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const N=Number(process.env.MANY_PROFILES||8),STEPS=Number(process.env.MANY_STEPS||90);
let seed=7;const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const pick=list=>list[Math.floor(rnd()*list.length)];
const fixture=await httpFixture((req,res)=>{const name=decodeURIComponent(req.url.slice(1))||'Page';res.setHeader('Content-Type','text/html');res.end(`<title>${name}</title><style>body{font:15px system-ui;margin:24px}.g{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.c{height:60px;background:#8884}</style><h1>${name}</h1><div class=g>${'<div class=c></div>'.repeat(200)}</div>`);});
const site=name=>'http://127.0.0.1:'+fixture.port+'/'+encodeURIComponent(name);
const FAVORITES=[0,1,3,9,20,1,0,3],PINS=[0,2,0,1,0,2,0,0],LAYOUTS=[{vertical:true,view:'full'},{vertical:false,view:'full'},{vertical:true,view:'seamless'},{vertical:false,view:'compact'},{vertical:true,view:'focus'}];
const report={passed:false,problems:[],profiles:N,steps:STEPS,times:{},memory:[]};
const UI='acira-browser-ui://ui/index.html';
let app;
try{
 app=await startApp({root,args:['--use-mock-keychain'],main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 if(process.platform==='darwin')assert.equal(await app.main(({app})=>app.commandLine.hasSwitch('use-mock-keychain')),true,'every launch here uses the mock keychain');
 await app.main(({BaseWindow},UI)=>{globalThis.__mp={loads:0,errors:[]};for(const w of BaseWindow.getAllWindows())for(const v of w.contentView.children)if(v.webContents?.getURL()===UI){const wc=v.webContents;wc.on('did-start-loading',()=>{globalThis.__mp.loads++;});wc.on('console-message',(e,level,message)=>{const m=String(e?.message??message);if((e?.level??level)>=2)globalThis.__mp.errors.push(m.slice(0,160));});}},UI);
 const memory=label=>app.main(({app})=>{let total=0,main=0;for(const p of app.getAppMetrics()){const kb=p.memory?.workingSetSize||0;total+=kb;if(p.type==='Browser')main+=kb;}return {total:Math.round(total/1024),main:Math.round(main/1024)};}).then(m=>{report.memory.push({label,...m});});
 await app.act({type:'settings.update',patch:{askBeforeClosing:false,reducedMotion:false}});
 for(let i=1;i<N;i++)await app.act({type:'browser.profile.create',name:'Profile '+(i+1)});
 await app.act({type:'settings.update',patch:{spaces:'profiles',verticalTabs:false}});await app.act({type:'ui.update',patch:{view:'full',workspaceOpen:true,webWorkspaceOpen:true}});await sleep(800);
 const s=await app.state(),ids=s.browserProfiles.filter(p=>!p.private).map(p=>p.id),space=id=>s.workspaces.find(w=>w.browserProfileId===id).id;
 assert.equal(ids.length,N);
 await memory('created');
 for(let i=0;i<N;i++){
  await app.act({type:'workspace.select',id:space(ids[i])});await sleep(300);
  await app.act({type:'tab.new',url:site('Profile '+(i+1)+' page'),browserProfileId:ids[i]});await sleep(250);
  for(let k=0;k<PINS[i%PINS.length];k++){const tab=(await app.state()).tabs.find(t=>t.browserProfileId===ids[i]&&!t.pinned&&t.url!=='acira://new');if(tab)await app.act({type:'tab.pin',id:tab.id});}
 }
 await app.ui.evaluate(({ids,FAVORITES})=>{ids.forEach((id,i)=>{const n=FAVORITES[i%FAVORITES.length];localStorage.setItem('acira-sidebar-apps:'+id,JSON.stringify({apps:Array.from({length:n},(_,k)=>({id:'app-'+i+'-'+k,url:'https://example.com/'+k,title:'Favorite '+i+'-'+k})),hidden:i===7,seeded:true}));});window.dispatchEvent(new Event('acira-sidebar-apps'));},{ids,FAVORITES});
 await app.act({type:'workspace.select',id:space(ids[0])});await sleep(600);
 await memory('seeded');
 const layout=async l=>{await app.act({type:'settings.update',patch:{verticalTabs:l.vertical}});await app.act({type:'ui.update',patch:{view:l.view,workspaceOpen:true,webWorkspaceOpen:true}});await sleep(900);};
 await layout(LAYOUTS[0]);
 await app.main(()=>{globalThis.__mp.loads=0;globalThis.__mp.errors.length=0;});
 const times=[];let layoutIndex=0,lastError='';
 for(let step=1;step<=STEPS&&!report.problems.length;step++){
  if(step%18===0){layoutIndex=(layoutIndex+1)%LAYOUTS.length;await layout(LAYOUTS[layoutIndex]);}
  const current=(await app.state()).activeBrowserProfileId;
  if(step%15===0){const a=pick(ids),b=pick(ids.filter(x=>x!==a));let last=b;for(let k=0;k<6;k++){last=k%2?a:b;await app.act({type:'browser.profile.select',id:last,here:true});}
   await poll(async()=>(await app.state()).activeBrowserProfileId===last,Boolean,`step ${step}: the burst did not settle on its last profile`,8000).catch(()=>report.problems.push(`step ${step}: the fast burst did not settle on the last profile asked for`));
   await sleep(400);continue;}
  const target=pick(ids.filter(x=>x!==current)),started=Date.now();
  await app.act({type:'browser.profile.select',id:target,here:true});
  await poll(async()=>(await app.state()).activeBrowserProfileId===target,Boolean,`step ${step}: switch`,8000).then(()=>times.push(Date.now()-started),()=>report.problems.push(`step ${step}: the switch to profile ${ids.indexOf(target)+1} did not land`));
  await sleep(pick([0,0,40,150,400]));
  const seen=await app.main(()=>({loads:globalThis.__mp.loads,errors:[...globalThis.__mp.errors]}));
  if(seen.loads||seen.errors.length){lastError=`after step ${step} (layout ${layoutIndex}): ${seen.loads} reload(s), ${[...new Set(seen.errors)].slice(0,2).join(' | ')}`;report.problems.push(lastError);}
 }
 await sleep(800);await memory('final');
 const shown=await app.ui.evaluate(()=>({error:/display this view/.test(document.body.innerText)}));
 if(shown.error)report.problems.push('the error screen is up at the end');
 times.sort((a,b)=>a-b);report.times={n:times.length,p50:times[times.length>>1],p95:times[Math.floor(times.length*.95)],max:times.at(-1)};
 if(report.times.max>1500)report.problems.push(`the slowest switch took ${report.times.max} ms`);
 report.passed=!report.problems.length;if(!report.passed)process.exitCode=1;
 console.log((report.passed?'PASS':'FAIL')+` ${N} profiles, ${STEPS} steps: switch p50 ${report.times.p50} ms, p95 ${report.times.p95} ms, max ${report.times.max} ms; memory ${report.memory.map(m=>m.label+' '+m.total+' MB (main '+m.main+')').join(', ')}`+(report.problems.length?' - '+report.problems.join('; '):''));
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.log('FAIL '+report.error);}
finally{await app?.close();await fixture.close();await fs.rm(root,{recursive:true,force:true});await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');}
