// Stream H QA: Rewind in the real app — batch-close capture, the page, selective additive restore, history deletion,
// restart persistence, themes. node qa/h-rewind.mjs [--shots dir]   (D_VISIBLE=1 for a visible window)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const site=await httpFixture((req,res)=>{const n=req.url.replace(/\W/g,'')||'root';res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><title>${n[0].toUpperCase()+n.slice(1)} notes</title><p>${n}`);});
const base=`http://127.0.0.1:${site.port}`;
const root=path.resolve(`.qa-profiles/h-rewind-${Date.now()}`);
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const rw=(t,r)=>t.ui.evaluate(r=>window.acira.rewind(r),r).then(x=>x.rewind);
async function shot(t,name){if(!shots)return;await fs.mkdir(shots,{recursive:true});await sleep(350);await t.ui.screenshot({path:path.join(shots,`${name}.png`),scale:'css'});}
let t=await startApp({root});
try{
 const home=(await t.state()).activeTabId;
 await t.act({type:'tab.navigate',tabId:home,url:`${base}/inbox`});
 for(const n of ['design','research','specs','pricing'])await t.act({type:'tab.new',url:`${base}/${n}`,background:true});
 let s=await poll(t.state,s=>s.tabs.length===5,'five tabs');
 await t.act({type:'tab.group.create',tabId:s.tabs[1].id,name:'Design research',color:'purple'});
 s=await poll(t.state,s=>s.tabGroups.length===1,'group');await t.act({type:'tab.group.assign',tabIds:[s.tabs[1].id,s.tabs[2].id,s.tabs[3].id],groupId:s.tabGroups[0].id});
 // Titles for background tabs arrive only when loaded; select each once so the checkpoint has real titles.
 s=await t.state();for(const tab of s.tabs)await t.act({type:'tab.select',id:tab.id});await poll(t.state,s=>s.tabs.every(x=>x.title.endsWith('notes')),'titles',15000).catch(()=>{});
 await t.act({type:'tab.select',id:s.tabs[0].id});s=await t.state();
 // The whole group closes first (one saved moment), then one ungrouped tab, so the page has group rows and a plain row.
 const plain=s.tabs[4].id;
 for(const id of [s.tabs[1].id,s.tabs[2].id,s.tabs[3].id])await t.act({type:'tab.close',id});
 await sleep(2200);
 let list=await rw(t,{type:'rewind.list'});
 check(list.checkpoints[0]?.reason==='group-close'&&list.checkpoints[0].label==='Design research','group close saved a checkpoint '+JSON.stringify(list.checkpoints.slice(0,3).map(c=>[c.reason,c.label,c.tabCount]))); await t.act({type:'tab.close',id:plain});await sleep(800);
 // Open Rewind like a user: the shortcut path lands on acira://rewind. The closed tab is the unit (R3-39): one row per closed tab, in time bands.
 await t.act({type:'tab.new',url:'acira://rewind'});
 await poll(()=>t.ui.locator('.rwp-row').count(),n=>n>=4,'rewind rows');
 check(await t.ui.locator('.rwp-row').count()===4,'the page lists the 4 closed tabs, one row each');
 check(await t.ui.locator('.rwp-row .rwp-chip').filter({hasText:'Design research'}).count()===3,'each grouped row says the group it was in');
 await shot(t,'rewind-light-100');
 // One click brings back one tab, in the background: it never replaces anything that is open, and the page stays.
 const openBefore=(await t.state()).tabs.length;
 await t.ui.locator('.rwp-row').filter({hasText:'Pricing notes'}).locator('.lib-open').click();
 s=await poll(t.state,s=>s.tabs.length===openBefore+1,'one tab restored');
 check(s.tabs.some(x=>x.url.endsWith('/pricing'))&&s.tabs.find(x=>x.url==='acira://rewind').id===s.activeTabId,'one click restored the tab and stayed on Rewind (restore is in the background)');
 // Shift+Enter on a grouped row brings the whole group back as a unit, with its name and colour.
 await poll(()=>t.ui.locator('.rwp-row').count(),n=>n===3,'three rows left');
 await t.ui.locator('.rwp-row .lib-open').first().focus();await t.ui.keyboard.press('Shift+Enter');
 s=await poll(t.state,s=>s.tabs.filter(x=>x.group==='Design research').length===3,'the group restored whole',8000);
 const group=s.tabGroups.find(g=>g.name==='Design research');
 check(Boolean(group)&&group.color==='purple'&&s.tabs.length===6,'Shift+Enter restored the whole group with its name and colour');
 check(s.tabs.find(x=>x.url==='acira://rewind').id===s.activeTabId,'still on Rewind');
 await shot(t,'rewind-restored');
 for(const [name,patch] of [['dark',{appearance:'dark'}],['burgundy',{appearance:'dark',colorPreset:'Burgundy',accentColor:'#4d1821',browserTint:'#4d1821'}],['burgundy-light',{appearance:'light'}]]){await t.act({type:'settings.update',patch});await shot(t,`rewind-${name}`);}
 await t.act({type:'settings.update',patch:{interfaceScale:150}});await sleep(600);await shot(t,'rewind-150');await t.act({type:'settings.update',patch:{interfaceScale:100}});
 // Deleting all history removes saved moments too.
 const before=(await rw(t,{type:'rewind.list'})).checkpoints.length;
 await t.svc({type:'data.clear',categories:['history'],range:'all'});await sleep(300);
 check(before>0&&(await rw(t,{type:'rewind.list'})).checkpoints.length===0,'clear history removes saved moments');
 // Survives restart.
 s=await t.state();for(const id of s.tabs.filter(x=>x.group==='Design research').map(x=>x.id))await t.act({type:'tab.close',id});
 await sleep(2200);check((await rw(t,{type:'rewind.list'})).checkpoints.length===1,'second group close saved');
 await t.close();t=await startApp({root,skipSetup:false});
 list=await rw(t,{type:'rewind.list'});check(list.checkpoints.some(c=>c.reason==='group-close'&&c.label==='Design research'),'saved moment survives restart');
}finally{await t.close();await site.close();}
