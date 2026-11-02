// Stream H QA: "Tab closed · Undo" in the real app — toast with action, exact restore (position, group, history, scroll).
// node qa/h-undo.mjs [--shots dir]   (D_VISIBLE=1 for a visible window)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const page=n=>`<!doctype html><title>Page ${n}</title><body style="font:16px system-ui">${Array.from({length:200},(_,i)=>`<p id="p${i}">Page ${n} paragraph ${i}</p>`).join('')}`;
const site=await httpFixture((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(page(req.url.replace(/\W/g,'')||'root'));});
const base=`http://127.0.0.1:${site.port}`;
const t=await startApp({});
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
try{
 await poll(()=>t.ui.locator('.setup-dialog').count(),n=>n===0,'setup dismissed');
 await t.act({type:'tab.navigate',tabId:(await t.state()).activeTabId,url:`${base}/a`});
 await t.act({type:'tab.new',url:`${base}/b`});await t.act({type:'tab.new',url:`${base}/c`});
 let s=await poll(t.state,s=>s.tabs.length===3&&s.tabs.every(x=>x.title.startsWith('Page')),'three pages');
 const b=s.tabs[1];
 await t.act({type:'tab.navigate',tabId:b.id,url:`${base}/b2`});await poll(t.state,s=>s.tabs[1].url.endsWith('/b2'),'b2');
 await t.act({type:'tab.select',id:b.id});
 const web=await t.waitWeb(u=>u.endsWith('/b2'));await web.click('body',{position:{x:40,y:40}});await web.evaluate(()=>window.scrollTo(0,2400));await sleep(1500);
 const before=(await t.state()).tabs.map(x=>x.url);
 await t.act({type:'tab.close',id:b.id});
 s=await poll(t.state,s=>s.tabs.length===2&&s.toast?.action,'undo toast');
 check(s.toast.text==='Tab closed'&&s.toast.action.label==='Undo','toast says "Tab closed · Undo"');
 await sleep(400);
 console.log('toast layout',JSON.stringify(await t.ui.evaluate(()=>window.acira.getBrowserLayout())));
 if(shots){await fs.mkdir(shots,{recursive:true});const overlay=t.context.pages().find(p=>p.url().includes('view=overlay'));await t.ui.screenshot({path:path.join(shots,'undo-chrome.png')});if(overlay)try{await overlay.screenshot({path:path.join(shots,'undo-overlay.png')});}catch{}}
 // Click Undo the way a user does: the button in whichever surface shows the toast.
 let clicked=false;const seen=[];for(let attempt=0;attempt<20&&!clicked;attempt++){for(const p of t.context.pages()){try{const btn=p.locator('.toast-action');const n=await btn.count();if(n)seen.push(p.url().slice(-30)+':'+n+':'+(await btn.first().isVisible()));if(n&&await btn.first().isVisible()){await btn.first().click();clicked=true;break;}}catch{}}if(!clicked)await sleep(150);}
 if(!clicked){console.log('toast-action seen:',[...new Set(seen)].join(' | ')||'none');console.log('main logs',t.logs.join('').slice(-5000));for(const p of t.context.pages())if(p.url().startsWith('acira-browser-ui:'))console.log('surface',p.url(),await p.locator('body').innerText().catch(()=>''));}
 check(clicked,'Undo button visible and clicked');
 s=await poll(t.state,s=>s.tabs.length===3,'restored');
 check(JSON.stringify(s.tabs.map(x=>x.url))===JSON.stringify(before),'position restored');
 check(s.activeTabId===b.id&&s.toast===null,'active again, toast gone');
 const tab=s.tabs.find(x=>x.id===b.id);check(tab.history.some(u=>u.endsWith('/b'))&&tab.canGoBack!==false,'history kept');
 const back=await t.waitWeb(u=>u.endsWith('/b2'));const y=await poll(()=>back.evaluate(()=>window.scrollY),v=>v>1000,'scroll',8000).catch(()=>0);
 check(y>1000,`scroll restored (${y})`);
 // Group close: one batch, one toast.
 s=await t.state();await t.act({type:'tab.group.create',tabId:s.tabs[1].id,name:'Research',color:'blue'});
 s=await poll(t.state,s=>s.tabGroups.length===1,'group');await t.act({type:'tab.group.assign',tabIds:[s.tabs[1].id,s.tabs[2].id],groupId:s.tabGroups[0].id});
 s=await t.state();const groupBefore=s.tabs.map(x=>x.url);
 for(const id of [s.tabs[1].id,s.tabs[2].id])await t.act({type:'tab.close',id});
 s=await poll(t.state,s=>s.tabs.length===1&&s.toast?.text?.includes('Research'),'group toast');
 check(s.toast.text==='Group “Research” closed','group toast');
 await t.act(s.toast.action.command);s=await poll(t.state,s=>s.tabs.length===3,'group restored');
 check(JSON.stringify(s.tabs.map(x=>x.url))===JSON.stringify(groupBefore)&&s.tabs.slice(1).every(x=>x.group==='Research'),'group restored in place');
}finally{await t.close();await site.close();}
