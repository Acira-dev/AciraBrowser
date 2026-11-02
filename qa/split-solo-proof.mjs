// Split views without mirrors (founder, 28 Oct): a tab that joins a split moves to where the split lives (no remnant rows,
// no linked marks), clicking each pane row leaves exactly one current row, Open alone and back (row button, Shift+Enter, tab
// menu), Ctrl/Shift clicks then a plain click, a row drag (no leftover selection), dragging a pane out of a card inside a
// group (lands at the drop line, takes that group; Esc cancels), the horizontal and compact strips, dark + light, 100% + 150%,
// en + de with the clip scanner. Synthetic input only (CDP), isolated profile, one native slot, the window kept hidden;
// captures this app's own pages only.
// Usage: npx tsx qa/split-solo-proof.mjs   (SPLIT_SOLO_EVIDENCE, default C:/ae/r3/split-solo/evidence)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';

delete process.env.D_VISIBLE;
const out=process.env.SPLIT_SOLO_EVIDENCE||'C:/ae/r3/split-solo/evidence',root=`.qa-profiles/splitsolo-${Date.now()}`,rows=[];
await fs.mkdir(out,{recursive:true});
const clip=await fs.readFile('qa/m-clip-scan.js','utf8');
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
const site=await httpFixture((request,response)=>{const name=request.url.slice(1)||'docs';response.writeHead(200,{'content-type':'text/html'});response.end(`<title>${name[0].toUpperCase()+name.slice(1)}</title><body style="font:16px system-ui;padding:24px">${name}</body>`);});
const release=await takeSlot('split-solo-proof');
let app;
const shot=async(name,page=app.ui)=>{await Promise.race([page.screenshot({path:path.join(out,name+'.png')}),sleep(6000)]).catch(()=>{});};
const overlay=()=>app.context.pages().find(page=>page.url().includes('view=overlay'));
/** What the sidebar draws: each visible tab row, which are current, whether a pane row sits outside a card, leftovers. */
const look=()=>app.ui.evaluate(()=>{
 const rows=[...document.querySelectorAll('.acira-sidebar .sb-tabs .sb-tab')].filter(node=>node.getClientRects().length&&!node.closest('[data-hidden]'));
 const fill=node=>getComputedStyle(node).backgroundColor;
 return {rows:rows.map(node=>node.dataset.tabId),current:[...new Set(rows.filter(node=>node.getAttribute('aria-current')==='true').map(node=>node.dataset.tabId))],
  inCard:rows.filter(node=>node.closest('.sb-split-group')).map(node=>node.dataset.tabId),
  headerFill:[...document.querySelectorAll('.acira-sidebar .split-group-sidebar[data-active]')].map(fill),
  marks:document.querySelectorAll('.acira-sidebar .sb-tab-split,.acira-sidebar [data-split-mirror],.acira-sidebar [data-split-linked],.tab-split-mark').length,
  glides:document.querySelectorAll('.acira-sidebar .sb-glide').length,leftover:document.querySelectorAll('.acira-sidebar [data-drop],.acira-sidebar [data-dragging],.acira-sidebar [data-joining]').length,
  solo:[...document.querySelectorAll('.acira-sidebar .sb-tab-solo[data-persistent]')].map(node=>node.closest('.sb-tab')?.dataset.tabId)};
});
/** A row's box once its FLIP slide has settled (two equal reads 120ms apart, at most 2s): a box read mid-slide sent the press to the row next to it. */
const box=async selector=>{const locator=app.ui.locator(selector).first();await locator.waitFor({timeout:6000});let last=null;for(let i=0;i<16;i++){await sleep(120);const next=await locator.boundingBox();if(last&&next&&Math.abs(last.y-next.y)<.5&&Math.abs(last.x-next.x)<.5)return next;last=next;}return last;};
const rowSel=id=>`.acira-sidebar .sb-tab[data-tab-id="${id}"] .sb-tab-main`;
const click=async(id,modifiers=[])=>{const b=await box(rowSel(id));for(const key of modifiers)await app.ui.keyboard.down(key);await app.ui.mouse.click(b.x+40,b.y+b.height/2);for(const key of modifiers.reverse())await app.ui.keyboard.up(key);await sleep(650);};
/** Drag a row from its title to the upper or lower quarter of another row; returns the drop line seen mid-drag. */
async function drag(fromId,toSelector,edge='before',{cancel=false,name}={}){
 const from=await box(rowSel(fromId)),to=await box(toSelector);
 await app.ui.mouse.move(from.x+40,from.y+from.height/2);
 const pressed=await app.ui.evaluate(p=>document.elementFromPoint(p.x,p.y)?.closest('.sb-tab')?.dataset.tabId,{x:from.x+40,y:from.y+from.height/2});if(pressed!==fromId)note(false,`the press for ${fromId} lands on ${pressed}`);
 await app.ui.mouse.down();await app.ui.mouse.move(from.x+40,from.y+from.height/2+8,{steps:3});
 await app.ui.mouse.move(to.x+Math.min(60,to.width/2),edge==='before'?to.y+to.height*.25:to.y+to.height*.75,{steps:14});await sleep(260);
 const hint=await app.ui.evaluate(()=>[...document.querySelectorAll('.acira-sidebar [data-drop]')].map(node=>`${node.dataset.tabId||node.className}:${node.dataset.drop}`));
 if(name)await shot(name);
 if(cancel){await app.ui.keyboard.press('Escape');await sleep(120);}
 await app.ui.mouse.up();await sleep(700);return hint;
}
const one=(view,label)=>note(view.current.length===1&&view.marks===0&&view.leftover===0&&view.headerFill.every(fill=>/rgba\(0, 0, 0, 0\)|transparent/.test(fill)),`${label}: one current row (${view.current.length}), no marks (${view.marks}), no leftovers (${view.leftover}), header unfilled (${view.headerFill.join('|')||'none'})`);
const scans=[];
async function scanAll(label,surface){
 for(const language of ['en','de'])for(const interfaceScale of [100,150])for(const appearance of ['light','dark']){
  await app.act({type:'settings.update',patch:{language,interfaceScale,appearance}});await sleep(900);
  const page=surface==='menu'?overlay():app.ui;if(!page){scans.push(`${label} ${language} ${interfaceScale} ${appearance}: no overlay`);continue;}
  // The scanner's own known false positive: a 1px-wide screen-reader live region (cw=1), listed but not counted.
  const result=await page.evaluate(clip),lines=result.split('\n').slice(1).filter(line=>line&&line!=='no hits'),hits=lines.filter(line=>!/ cw=1 /.test(line)).length;scans.push(`${label} ${language} ${interfaceScale}% ${appearance}: ${hits} hits${hits?'\n'+result:''}`);
  await shot(`${label}-${language}-${interfaceScale}-${appearance}`,page);
 }
 await app.act({type:'settings.update',patch:{language:'en',interfaceScale:100,appearance:'dark'}});await sleep(600);
}
try{
 app=await startApp({root});
 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',interfaceScale:100,sidebarWidth:260,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});
 await app.act({type:'tab.navigate',url:`http://127.0.0.1:${site.port}/docs`});
 for(const page of ['mail','news','maps','music','notes','extra','spare'])await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/${page}`,background:true});
 // By address, not by strip order: "New tabs at the top" reorders the new tabs a moment after they open.
 await sleep(800);const opened=(await app.state()).tabs,byName=name=>opened.find(tab=>(tab.url||'').endsWith('/'+name)).id;
 const [docs,mail,news,maps,music,notes,extra,spare]=['docs','mail','news','maps','music','notes','extra','spare'].map(byName);
 await app.act({type:'tab.group.create',tabId:mail,name:'Research',color:'blue'});const g=(await app.state()).tabGroups.find(item=>item.name==='Research').id;
 await app.act({type:'tab.group.assign',tabIds:[news],groupId:g});
 await app.act({type:'tab.group.create',tabId:music,name:'Leisure',color:'green'});
 await app.act({type:'tab.select',id:mail});

 // Case B: a loose tab joins a split inside a group: it moves into the group; nothing is left where it was.
 await app.act({type:'split.open',tabIds:[mail,maps]});await app.ui.locator('.sb-split-group[data-nested]').waitFor({timeout:8000});await sleep(700);
 let s=await app.state(),view=await look();
 note(s.tabs.find(tab=>tab.id===maps)?.group==='Research'&&view.rows.filter(id=>id===maps).length===1&&view.inCard.includes(maps)&&view.marks===0,`case B: Maps joined the Research split and moved into Research (one row, in the card, no mark): ${JSON.stringify({group:s.tabs.find(tab=>tab.id===maps)?.group,rows:view.rows.filter(id=>id===maps).length})}`);
 await shot('1-caseB-join-dark');
 // Case A (28 Oct, linked copies): a grouped tab dropped on a split outside any group stays in its group and is also a pane of the split (two rows, one tab).
 await app.act({type:'tab.select',id:docs});await app.act({type:'split.open',tabIds:[docs,extra]});await sleep(500);
 await app.act({type:'split.group.add',id:(await app.state()).windowUi.splitGroups.find(item=>item.tabIds.includes(docs)).id,tabId:music});await sleep(700);
 s=await app.state();view=await look();
 note(s.tabs.find(tab=>tab.id===music)?.group==='Leisure'&&s.windowUi.splitGroups.some(item=>item.linked?.includes(music))&&view.rows.filter(id=>id===music).length===2&&view.inCard.includes(music)&&view.marks===0,`case A: Music joined the loose split as a linked copy and stayed in Leisure (its group row and a card row): ${JSON.stringify({group:s.tabs.find(tab=>tab.id===music)?.group,rows:view.rows.filter(id=>id===music).length})}`);
 await shot('2-caseA-join-dark');

 // Each pane row: exactly one current row; a quick second click never leaves two raised cards.
 for(const id of [mail,maps,docs,extra,music,notes]){await click(id);view=await look();s=await app.state();one(view,`click ${id===notes?'Notes (loose)':'a pane'} → active ${s.activeTabId===id}, split shown ${!!s.windowUi.split}`);}
 {const a=await box(rowSel(mail)),b=await box(rowSel(maps));await app.ui.mouse.click(a.x+40,a.y+a.height/2);await sleep(90);await app.ui.mouse.click(b.x+40,b.y+b.height/2);await sleep(60);
  const mid=await look();await sleep(700);view=await look();note(mid.glides<=1&&view.current.length===1,`two quick clicks: ${mid.glides} raised card(s) mid-glide, then ${view.current.length} current`);}
 await shot('3-one-current-dark');

 // Open alone: the row button, then back; Shift+Enter; the tab menu.
 await click(maps);
 {const b=await box(rowSel(maps));await app.ui.mouse.move(b.x+40,b.y+b.height/2);await sleep(250);await shot('4-pane-hover-open-alone-dark');
  await app.ui.locator(`.acira-sidebar .sb-tab[data-tab-id="${maps}"] .sb-tab-solo`).click();await sleep(700);}
 s=await app.state();view=await look();
 note(s.activeTabId===maps&&!s.windowUi.split&&s.windowUi.splitGroups.some(item=>item.tabIds.includes(maps))&&view.solo.includes(maps)&&view.current.length===1,`Open alone: Maps by itself, its split kept (card still listed, Show split view kept on the row): ${JSON.stringify({split:s.windowUi.split,solo:view.solo})}`);
 await shot('5-open-alone-dark');
 await app.ui.locator(`.acira-sidebar .sb-tab[data-tab-id="${maps}"] .sb-tab-solo`).click();await sleep(700);s=await app.state();
 note(s.windowUi.split?.tabIds.includes(maps)&&s.activeTabId===maps,'Show split view: the split is back, focused on Maps');
 await app.ui.locator(rowSel(mail)).focus();await app.ui.keyboard.press('Shift+Enter');await sleep(600);s=await app.state();const aloneByKey=!s.windowUi.split&&s.activeTabId===mail;
 await app.ui.keyboard.press('Shift+Enter');await sleep(600);s=await app.state();note(aloneByKey&&s.windowUi.split?.tabIds.includes(mail),'Shift+Enter on a pane row opens it alone and brings the split back');
 await click(maps);{const b=await box(rowSel(maps));await app.ui.mouse.click(b.x+40,b.y+b.height/2,{button:'right'});}
 await poll(overlay,Boolean,'overlay',5000);await sleep(700);
 const menu=await overlay().evaluate(()=>[...document.querySelectorAll('.browser-popup.popup-content-tab-context button')].map(node=>node.textContent.trim()).filter(Boolean));
 note(menu.some(text=>text.startsWith('Open alone'))&&menu.some(text=>text.startsWith('Remove from split view')),`the pane's tab menu offers Open alone and Remove from split view: ${JSON.stringify(menu.filter(text=>/alone|split/i.test(text)))}`);
 await overlay().evaluate(()=>{document.documentElement.dataset.qaBackdrop='1';document.body.style.background='#1d1f22';});await shot('6-tab-menu-dark-on-backdrop',overlay());await overlay().evaluate(()=>{document.body.style.background='';});
 await scanAll('scan-tab-menu','menu');
 await app.ui.keyboard.press('Escape');await sleep(400);

 // Ctrl/Shift clicks, then a plain click: one current row (Acira has no multi-select; nothing persists).
 await click(notes,['Control']);view=await look();one(view,'Ctrl+click');
 await click(docs,['Shift']);view=await look();one(view,'Shift+click');
 await click(notes);view=await look();one(view,'plain click after Ctrl/Shift');
 await app.ui.keyboard.press('Escape');await sleep(200);view=await look();one(view,'Esc');

 // A drag (Notes reordered) leaves no selection behind.
 await drag(notes,rowSel(spare),'after');view=await look();s=await app.state();one(view,'after a row drag');note(s.tabs.findIndex(tab=>tab.id===notes)===s.tabs.findIndex(tab=>tab.id===spare)+1,'the row drag moved Notes below Spare');

 // Dragging a pane out of a card inside a group (founder, 28 Oct): Esc cancels; to the top level; within the card it reorders.
 const research=(await app.state()).windowUi.splitGroups.find(item=>item.tabIds.includes(mail)).id;
 await app.act({type:'split.group.add',id:research,tabId:news});await sleep(600);
 let hint=await drag(news,rowSel(notes),'before',{cancel:true});s=await app.state();
 note(s.windowUi.splitGroups.find(item=>item.id===research)?.tabIds.includes(news),`Esc cancels a pane drag (News still in the split; hint ${JSON.stringify(hint)})`);
 hint=await drag(news,rowSel(spare),'before',{name:'7-pane-drag-out-hint-dark'});s=await app.state();view=await look();
 const order=s.tabs.map(tab=>tab.id);
 note(!s.windowUi.splitGroups.find(item=>item.id===research)?.tabIds.includes(news)&&s.tabs.find(tab=>tab.id===news)?.group===''&&order.indexOf(news)===order.indexOf(spare)-1&&!view.inCard.includes(news),`pane dragged out of the card in Research to above Spare (top level): left the split, loose, right at the drop line (hint ${JSON.stringify(hint)})`);
 one(view,'after the pane drag');await shot('8-pane-dragged-out-dark');
 hint=await drag(maps,rowSel(mail),'before',{name:'9-pane-reorder-hint-dark'});s=await app.state();
 note(s.windowUi.splitGroups.find(item=>item.id===research)?.tabIds[0]===maps,`a pane dragged within its card reorders the panes: ${JSON.stringify(s.windowUi.splitGroups.find(item=>item.id===research)?.tabIds.map(id=>s.tabs.find(tab=>tab.id===id)?.title))}`);
 // A two-pane split dragged apart ends; its last pane stays in the group.
 hint=await drag(maps,rowSel(spare),'after');s=await app.state();
 note(!s.windowUi.splitGroups.some(item=>item.tabIds.includes(mail))&&s.tabs.find(tab=>tab.id===mail)?.group==='Research'&&s.tabs.find(tab=>tab.id===maps)?.group==='',`a two-pane split dragged apart ends; Mail stays in Research, Maps lands loose (hint ${JSON.stringify(hint)})`);
 await app.act({type:'tab.select',id:mail});await app.act({type:'split.open',tabIds:[mail,news,maps]});await sleep(700);await click(news);
 await shot('10-sidebar-final-dark');await app.act({type:'settings.update',patch:{appearance:'light'}});await sleep(500);await shot('10-sidebar-final-light');
 await app.act({type:'settings.update',patch:{interfaceScale:150}});await sleep(800);await shot('10-sidebar-final-light-150');await app.act({type:'settings.update',patch:{appearance:'dark'}});await sleep(500);await shot('10-sidebar-final-dark-150');
 await app.act({type:'settings.update',patch:{interfaceScale:100}});await sleep(500);
 // Solo state, scanned (the persistent Show split view button).
 await app.act({type:'tab.select',id:news,individual:true});await sleep(600);
 await scanAll('scan-sidebar-solo','sidebar');

 // The strips: one selected chip after a click on a pane chip; no linked marks.
 await app.act({type:'settings.update',patch:{verticalTabs:false}});await app.act({type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false}});await sleep(900);
 for(const id of [maps,mail]){const chip=app.ui.locator(`.tabs-strip .browser-tab[data-tab-id="${id}"]`).first();await chip.click();await sleep(600);
  const strip=await app.ui.evaluate(()=>({selected:document.querySelectorAll('.tabs-strip .browser-tab.selected').length,marks:document.querySelectorAll('.tab-split-mark').length}));s=await app.state();
  note(strip.selected===1&&strip.marks===0&&s.windowUi.split?.tabIds.includes(id)&&s.activeTabId===id,`horizontal strip: clicking a pane chip shows its split focused on it, one selected chip (${strip.selected}), no marks`);}
 await shot('11-strip-dark');await app.act({type:'settings.update',patch:{appearance:'light'}});await sleep(500);await shot('11-strip-light');
 await scanAll('scan-strip','sidebar');
 await app.act({type:'ui.update',patch:{view:'compact'}});await sleep(1000);
 {const chip=app.ui.locator(`.acira-compact-tab[data-tab-id="${news}"]`).first();if(await chip.count()){await chip.click();await sleep(600);}
  const compact=await app.ui.evaluate(()=>({selected:document.querySelectorAll('.acira-compact-tab.selected').length,marks:document.querySelectorAll('.tab-split-mark').length,chips:document.querySelectorAll('.acira-compact-tab').length}));s=await app.state();
  note(compact.chips>0&&compact.selected===1&&compact.marks===0&&s.windowUi.split?.tabIds.includes(news),`compact strip: one selected chip (${compact.selected} of ${compact.chips}), its split shown, no marks`);}
 await shot('12-compact-light');await app.act({type:'settings.update',patch:{appearance:'dark'}});await sleep(500);await shot('12-compact-dark');
 await scanAll('scan-compact','sidebar');
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result.txt'),rows.join('\n')+'\n\n'+scans.join('\n')+'\n');console.log(`evidence: ${out}`);
}
