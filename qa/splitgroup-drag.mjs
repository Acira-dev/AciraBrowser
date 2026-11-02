// Dragging a whole split by its card header (founder, 27 Oct): out of its group to the top level, into another group, reordered
// inside a group, Esc cancels, and a restart keeps the result. A tab dropped on a card's edge joins it (28 Oct): 6px inside the
// bottom edge at the last slot, 6px inside the top edge at the first, with the same drop line as between two panes, 10 of 10 each.
// Real input only (webContents.sendInputEvent on the interface view), isolated profile, one native slot, the window shown inactive
// off screen (qa/split-native.mjs: it never takes focus); captures this app's own view only.
// Usage: npx tsx qa/splitgroup-drag.mjs   (SPLITGROUP_EVIDENCE, default C:/ae/r6/splitgroup/evidence/drag)
import fs from 'node:fs/promises';
import path from 'node:path';
import {httpFixture,poll,sleep} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';
import {startInactive,mouse,settledBox,focused,capture} from './split-native.mjs';
import {splitPlacement} from '../src/runtime/splitPlacement.ts';

const out=process.env.SPLITGROUP_EVIDENCE||'C:/ae/r6/splitgroup/evidence/drag',root=`.qa-profiles/splitdrag-${Date.now()}`,rows=[];
await fs.mkdir(out,{recursive:true});
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
const site=await httpFixture((request,response)=>{const name=request.url.slice(1)||'docs';response.writeHead(200,{'content-type':'text/html'});response.end(`<title>${name[0].toUpperCase()+name.slice(1)}</title>${name}`);});
const release=await takeSlot('splitgroup-drag');
let app,pointer,focusSeen=false;
const shot=async name=>{await capture(app,path.join(out,name+'.png'));if(await focused(app))focusSeen=true;};
const where=async()=>{const s=await app.state(),split=s.windowUi.splitGroups?.[0];const p=split&&splitPlacement(split,s.tabs,s.tabGroups);return {s,split,home:p?.home?.name??null,order:s.tabs.map(tab=>tab.id)};};
/** What the sidebar shows mid-drag: the ordinary drop line (data-drop on a row), the split join marks (the header's fill, the
 *  insertion line on a pane: data-split-insert), the joining group and the dimmed dragged card. */
const marks=()=>app.ui.evaluate(()=>({
 drop:[...document.querySelectorAll('.acira-sidebar .sb-tab[data-drop]')].map(node=>`${node.dataset.tabId}:${node.dataset.drop}`),
 insert:[...document.querySelectorAll('.acira-sidebar [data-split-insert]')].map(node=>`${node.dataset.tabId}:${node.dataset.splitInsert}`),
 header:document.querySelectorAll('.acira-sidebar .split-group-sidebar[data-drop]').length,
 joining:document.querySelectorAll('.acira-sidebar .sb-group[data-joining]').length,
 dragging:!!document.querySelector('.acira-sidebar .sb-split-group[data-dragging]'),
 line:(()=>{const node=document.querySelector('.acira-sidebar .sb-tab[data-split-insert]');if(!node)return null;const line=getComputedStyle(node,'::before');return {content:line.content,height:line.height,color:line.backgroundColor,left:line.left};})(),
}));
/** Press at `from`, pull 8px to start the drag, glide to `to` (a hand's pace, about a frame per step), read the marks, release. */
async function drag(from,to,{cancel=false,name}={}){
 await pointer.move(from.x,from.y);await sleep(40);await pointer.down();await sleep(30);
 await pointer.glide(from.x,from.y+8,3);await pointer.glide(to.x,to.y,14);await sleep(250);
 const seen=await marks();if(name)await shot(name);
 if(cancel){await pointer.key('Escape');await sleep(120);}
 await pointer.up();await sleep(600);return seen;
}
/** The card header's grab point once the rows have settled (FLIP glides), checked to be the header under the pointer. */
async function headerPoint(){
 const box=await settledBox(app,'.acira-sidebar .sb-split-group .split-group-open'),p={x:box.x+box.width/3,y:box.y+box.height/2};
 const hit=await app.ui.evaluate(p=>!!document.elementFromPoint(p.x,p.y)?.closest('.split-group-parent'),p);if(!hit)throw Error('the card header is not under the pointer');
 return p;
}
const rowPoint=async(selector,edge='after')=>{const box=await settledBox(app,selector);return {x:box.x+Math.min(60,box.width/2),y:edge==='before'?box.y+box.height*.25:box.y+box.height*.75};};
const dragHeader=async(target,edge,options)=>drag(await headerPoint(),await rowPoint(target,edge),options);
try{
 app=await startInactive({root});pointer=mouse(app);
 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',interfaceScale:100,sidebarWidth:260,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});
 await app.act({type:'tab.navigate',url:`http://127.0.0.1:${site.port}/docs`});
 for(const page of ['mail','news','maps','music','notes','extra','spare'])await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/${page}`,background:true});
 // By address, not by strip order: "New tabs at the top" reorders the new tabs a moment after they open.
 await sleep(900);const opened=(await app.state()).tabs,byName=name=>opened.find(tab=>(tab.url||'').endsWith('/'+name)).id;
 const [docs,b,c,d,e,f,extra,spare]=['docs','mail','news','maps','music','notes','extra','spare'].map(byName);
 await app.act({type:'tab.group.create',tabId:b,name:'Research',color:'blue'});const g=(await app.state()).tabGroups.find(item=>item.name==='Research').id;
 await app.act({type:'tab.group.assign',tabIds:[c],groupId:g});
 await app.act({type:'tab.group.create',tabId:d,name:'Leisure',color:'green'});const h=(await app.state()).tabGroups.find(item=>item.name==='Leisure').id;
 await app.act({type:'tab.group.assign',tabIds:[e],groupId:h});
 await app.act({type:'tab.select',id:b});await app.act({type:'split.open',tabIds:[b,c]});
 await app.ui.locator('.sb-split-group[data-nested]').waitFor({timeout:8000});await sleep(500);
 let w=await where();note(w.home==='Research','start: the split lives in Research');await shot('drag-0-start');

 // Esc cancels.
 let hint=await dragHeader(`.acira-sidebar .sb-tab[data-tab-id="${docs}"]`,'before',{cancel:true});
 w=await where();note(w.home==='Research'&&hint.dragging,`Esc cancels the drag (still in ${w.home}; card dimmed while dragging: ${hint.dragging})`);

 // Out of the group, to the top level (above Docs).
 hint=await dragHeader(`.acira-sidebar .sb-tab[data-tab-id="${docs}"]`,'before',{name:'drag-1-out-hint'});
 w=await poll(where,value=>value.home===null,'split out of its group',6000).catch(()=>where());
 note(w.home===null&&w.order.indexOf(b)<w.order.indexOf(docs),`out of the group to the top level: home ${w.home}, hint ${JSON.stringify(hint.drop)}`);
 note(!w.s.tabGroups.some(item=>item.id===g)||w.s.tabs.every(tab=>tab.group!=='Research'),'Research has no members left (its line and indent go with them)');
 await shot('drag-1-out');

 // Into another group (onto Maps, a Leisure row).
 hint=await dragHeader(`.acira-sidebar .sb-tab[data-tab-id="${d}"]`,'after',{name:'drag-2-into-hint'});
 w=await poll(where,value=>value.home==='Leisure','split into Leisure',6000).catch(()=>where());
 note(w.home==='Leisure',`into another group: home ${w.home}, hint ${JSON.stringify(hint.drop)} joining ${hint.joining}`);
 await shot('drag-2-into');

 // Reorder inside the group: Notes joins Leisure, then the split goes above Maps.
 await app.act({type:'tab.group.assign',tabIds:[f],groupId:h});await sleep(400);
 const before=(await where()).order;
 hint=await dragHeader(`.acira-sidebar .sb-group-members>.sb-tab[data-tab-id="${d}"]`,'before',{name:'drag-3-reorder-hint'});
 w=await poll(where,value=>value.order.indexOf(b)<value.order.indexOf(d),'reordered above Maps',6000).catch(()=>where());
 note(w.home==='Leisure'&&w.order.indexOf(b)<w.order.indexOf(d)&&w.order.indexOf(c)===w.order.indexOf(b)+1,`reorder inside the group: ${before.indexOf(b)}→${w.order.indexOf(b)} (Maps at ${w.order.indexOf(d)}), panes together`);
 await shot('drag-3-reorder');
 await app.act({type:'settings.update',patch:{appearance:'light'}});await sleep(500);await shot('drag-3-reorder-light');
 await app.act({type:'settings.update',patch:{appearance:'dark'}});

 // A card's edges are drop zones (28 Oct): a tab dropped 6px inside the bottom edge joins at the last slot, 6px inside the top
 // edge at the first, and the pane next to that slot draws the drop line while the tab is over it. A loose split (Docs + Extra)
 // and the split in Leisure (Mail + News); the dragged tab is the loose Spare, so either way it ends up beside the panes.
 for(const item of (await app.state()).windowUi.splitGroups||[])await app.act({type:'split.unsplit',groupId:item.id});
 await app.act({type:'tab.select',id:docs});await app.act({type:'split.open',tabIds:[docs,extra]});
 await app.act({type:'tab.select',id:b});await app.act({type:'split.open',tabIds:[b,c]});await sleep(700);
 const counts={bottom:0,top:0},runs={bottom:0,top:0};
 for(let round=0;round<20;round++){
  const edge=round%2?'top':'bottom',nested=Math.floor(round/2)%2===1;
  const split=(await app.state()).windowUi.splitGroups.find(item=>item.tabIds.includes(nested?b:docs));
  const card=await settledBox(app,`.acira-sidebar .sb-split-group[data-split-container="${split.id}"]`),row=await settledBox(app,`.acira-sidebar .sb-tab[data-tab-id="${spare}"]`),from={x:row.x+40,y:row.y+row.height/2};
  const to={x:card.x+card.width/2,y:edge==='bottom'?card.y+card.height-6:card.y+6};
  const seen=await drag(from,to,{name:round<4?`drag-edge-${edge}-${nested?'group':'loose'}-hint`:undefined});
  const s=await app.state(),after=s.windowUi.splitGroups.find(item=>item.id===split.id),panes=split.tabIds,slot=after?.tabIds.indexOf(spare);
  const lineAt=edge==='bottom'?`${panes.at(-1)}:after`:`${panes[0]}:before`;
  const ok=!!after&&slot===(edge==='bottom'?after.tabIds.length-1:0)&&seen.insert.length===1&&seen.insert[0]===lineAt&&seen.header===1&&seen.drop.length===0&&seen.line?.content!=='none'&&seen.line?.height==='2px';
  runs[edge]++;if(ok)counts[edge]++;
  note(ok,`${edge} edge of the ${nested?'Leisure':'loose'} card, round ${round+1}: Spare at slot ${slot} of ${after?.tabIds.length} (${s.tabs.find(tab=>tab.id===spare)?.group||'no group'}); marks ${JSON.stringify({insert:seen.insert.map(item=>item.replace(/^tab-(.{4}).*:/,'$1:')),header:seen.header,rowLines:seen.drop.length,line:seen.line})}`);
  // Put Spare back at the top level, below Notes' old place (the action a drag out of the card sends).
  if(after?.tabIds.includes(spare)){await app.act({type:'split.separate',tabId:spare,groupId:null});await sleep(700);}
 }
 note(counts.bottom===runs.bottom&&counts.top===runs.top&&runs.bottom===10&&runs.top===10,`edge drops: bottom ${counts.bottom}/${runs.bottom}, top ${counts.top}/${runs.top}, no fallback`);
 await app.act({type:'settings.update',patch:{appearance:'light'}});await sleep(400);
 {const split=(await app.state()).windowUi.splitGroups.find(item=>item.tabIds.includes(docs)),card=await settledBox(app,`.acira-sidebar .sb-split-group[data-split-container="${split.id}"]`),from=await settledBox(app,`.acira-sidebar .sb-tab[data-tab-id="${spare}"]`);
  await drag({x:from.x+40,y:from.y+16},{x:card.x+card.width/2,y:card.y+card.height-6},{name:'drag-edge-bottom-loose-hint-light'});
  if((await app.state()).windowUi.splitGroups.find(item=>item.id===split.id)?.tabIds.includes(spare)){await app.act({type:'split.separate',tabId:spare,groupId:null});await sleep(600);}}
 await app.act({type:'settings.update',patch:{appearance:'dark'}});await sleep(300);

 // Restart keeps it.
 const kept=await where();await app.close();await sleep(800);app=await startInactive({root});pointer=mouse(app);
 await app.act({type:'settings.update',patch:{verticalTabs:true}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});await sleep(800);
 w=await where();note(w.home===kept.home&&w.order.join()===kept.order.join(),`restart keeps it: home ${w.home}, same order ${w.order.join()===kept.order.join()}`);
 await shot('drag-4-after-restart');
 note(!focusSeen&&!(await focused(app)),'the fixture never held focus (checked at every capture)');
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result.txt'),rows.join('\n')+'\n');console.log(`evidence: ${out}`);
}
