// Stream H QA: Rewind and Routines sit on the Library page grid (UI_QA_REPORT V01): same heading position and size and column width as
// History, Bookmarks and Downloads, rows on the column's left edge, actions at the column's right end beside the content.
// One Electron instance (closed in finally), five pages, ≤ 5 tabs, bounded waits. node qa/h-library-grid.mjs [--shots dir]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const site=await httpFixture((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(`<title>${req.url.slice(1)||'home'} notes</title><body>${req.url}`);});
const base=`http://127.0.0.1:${site.port}`;
const root=path.resolve(`.qa-profiles/h-lib-grid-${Date.now()}`);
async function shot(t,name){if(!shots)return;await fs.mkdir(shots,{recursive:true});await sleep(400);await t.ui.screenshot({path:path.join(shots,`${name}.png`),scale:'css'});}
const rw=(t,r)=>t.ui.evaluate(r=>window.acira.rewind(r),r).then(x=>x.rewind);
const rt=(t,r)=>t.ui.evaluate(r=>window.acira.rewind(r),r).then(x=>x.routines);
// Where things are, in CSS pixels: heading, its size, the column, the right end of the actions.
const grid=t=>t.ui.evaluate(()=>{
 const box=el=>el&&el.getBoundingClientRect(),h=document.querySelector('.lib-head h1'),column=document.querySelector('.lib-inner'),actions=document.querySelector('.lib-head-actions');
 return {x:Math.round(box(h).left),size:getComputedStyle(h).fontSize,column:Math.round(box(column).width),columnRight:Math.round(box(column).right),actionsRight:actions?Math.round(box(actions).right):null,actionsLeft:actions?Math.round(box(actions).left):null,text:h.textContent};
});
const page=async(t,name,url)=>{await t.act({type:'tab.navigate',tabId:(await t.state()).activeTabId,url});await poll(()=>t.ui.evaluate(()=>document.querySelector('.lib-head h1')?.textContent),x=>x===name,`${name} page`,10000);await sleep(350);return grid(t);};
const t=await startApp({root});
try{
 await t.act({type:'settings.update',patch:{appearance:'light'}});
 const library={};
 for(const [name,url] of [['History','acira://history'],['Bookmarks','acira://bookmarks'],['Downloads','acira://downloads'],['Rewind','acira://rewind'],['Routines','acira://routines']])library[name]=await page(t,name,url);
 const ref=library.History;
 for(const name of ['Bookmarks','Downloads','Rewind','Routines']){
  const g=library[name];
  check(g.x===ref.x&&g.size===ref.size&&g.column===ref.column,`${name}: heading at x=${g.x}, ${g.size}, column ${g.column}px — same as History (x=${ref.x}, ${ref.size}, ${ref.column}px)`);
 }
 check(library.Routines.actionsRight!==null&&Math.abs(library.Routines.columnRight-library.Routines.actionsRight)<=1,`Routines actions end at the column's right edge (${library.Routines.actionsRight} of ${library.Routines.columnRight})`);
 check(library.Routines.actionsLeft-library.Routines.x<=840,'Routines actions are inside the 840px column, not at the window edge');
 await shot(t,'routines-empty-light');
 await page(t,'Rewind','acira://rewind');await shot(t,'rewind-empty-light');

 // Real data: a saved moment of four tabs, and a routine.
 for(const name of ['design','research','specs'])await t.act({type:'tab.new',url:`${base}/${name}`,background:true});
 let s=await poll(t.state,s=>s.tabs.length===4,'four tabs');
 await sleep(1500);
 const saved=await rw(t,{type:'rewind.save'});check(Boolean(saved.id),'a moment was saved');
 const recipe={format:'acira-routine',version:1,name:'Morning',description:'Mail and calendar, grouped.',steps:[
  {id:'open',command:'tabs.open',args:{reuse:'exact-url-in-workspace',items:[{ref:'mail',url:`${base}/mail`},{ref:'cal',url:`${base}/calendar`}]}},
  {id:'group',command:'tabs.group',args:{refs:['mail','cal'],name:'Daily work',color:'blue'}},
  {id:'focus',command:'layout.focus',args:{enabled:true}}]};
 const savedRoutine=await rt(t,{type:'routines.save',recipe,profileId:s.activeBrowserProfileId});check(savedRoutine.ok===true,'a routine was saved');
 const keep=s.tabs[0].id;for(const tab of s.tabs.slice(1))await t.act({type:'tab.close',id:tab.id});await t.act({type:'tab.select',id:keep});

 // Rewind with data.
 await page(t,'History','acira://history');// leave the page so it mounts afresh and reads the new moment
 const withData=await page(t,'Rewind','acira://rewind');
 await poll(()=>t.ui.locator('.rw-row').count(),n=>n>=1,'rewind rows');
 const edges=await t.ui.evaluate(()=>{const left=sel=>document.querySelector(sel)?.getBoundingClientRect().left,h=left('.lib-head h1');return {heading:Math.round(h),day:Math.round(left('.lib-section-head h2')),time:Math.round(left('.rw-row .rw-time')),detail:Math.round(left('.rw-detail-head h2')),search:Math.round(left('.lib-search')),
  save:Math.round(document.querySelector('.lib-head-actions .acira-button').getBoundingClientRect().right),column:Math.round(document.querySelector('.lib-inner').getBoundingClientRect().right),
  foot:Math.round(document.querySelector('.rw-detail-actions .acira-button-primary').getBoundingClientRect().right),detailRight:Math.round(document.querySelector('.rw-detail').getBoundingClientRect().right)};});
 check(Math.abs(edges.day-edges.heading)<=1&&Math.abs(edges.time-edges.heading)<=1&&Math.abs(edges.search-edges.heading)<=1,`Rewind: day label (${edges.day}), rows (${edges.time}) and search (${edges.search}) start at the heading edge (${edges.heading})`);
 check(Math.abs(edges.save-edges.column)<=1,`Rewind: Save now ends at the column's right edge (${edges.save} of ${edges.column})`);
 check(edges.foot<=edges.detailRight+1&&edges.foot<=edges.column+1,`Rewind: Restore sits under its tabs, inside the column (${edges.foot} of ${edges.column})`);
 check(withData.x===ref.x,'Rewind with data keeps the heading edge');
 await shot(t,'rewind-light');
 await t.act({type:'settings.update',patch:{appearance:'dark'}});await shot(t,'rewind-dark');
 await t.act({type:'settings.update',patch:{appearance:'light'}});

 // Routines with a routine open in the editor.
 await page(t,'History','acira://history');await page(t,'Routines','acira://routines');
 await poll(()=>t.ui.locator('.rt-row').count(),n=>n>=1,'routine rows');
 await t.ui.locator('.rt-row').first().click();
 await poll(()=>t.ui.locator('.rt-step').count(),n=>n===3,'editor steps');
 const rtEdges=await t.ui.evaluate(()=>{const box=sel=>document.querySelector(sel)?.getBoundingClientRect();return {heading:Math.round(box('.lib-head h1').left),row:Math.round(box('.rt-row').left+12),column:Math.round(box('.lib-inner').right),run:Math.round(box('.rt-editor .rw-foot .acira-button-primary').right),newRight:Math.round(box('.lib-head-actions').right),detailLeft:Math.round(box('.rt-editor').left)};});
 check(Math.abs(rtEdges.row-rtEdges.heading)<=1,`Routines: list rows start at the heading edge (${rtEdges.row} vs ${rtEdges.heading})`);
 check(rtEdges.run<=rtEdges.column+1&&Math.abs(rtEdges.newRight-rtEdges.column)<=1,`Routines: Run (${rtEdges.run}) and New routine (${rtEdges.newRight}) stay inside the column (${rtEdges.column})`);
 await shot(t,'routines-light');
 await t.act({type:'settings.update',patch:{appearance:'dark'}});await shot(t,'routines-dark');
 await t.act({type:'settings.update',patch:{appearance:'light',interfaceScale:150}});await sleep(600);await shot(t,'routines-light-150');
 await page(t,'Rewind','acira://rewind');await shot(t,'rewind-light-150');
 await t.act({type:'settings.update',patch:{interfaceScale:100}});
}finally{await t.close();await site.close();}
