// A press-and-drag on any sidebar or strip row never leaves text selected (coordinator, 27 Oct); rename fields stay selectable.
// Synthetic pointer input (CDP) on an isolated profile, one native slot, the window hidden (it can never take focus).
// Usage: npx tsx qa/row-selection.mjs   (ROWSEL_EVIDENCE, default C:/ae/r6/splitgroup/evidence/selection)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,sleep} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';

delete process.env.D_VISIBLE;
const out=process.env.ROWSEL_EVIDENCE||'C:/ae/r6/splitgroup/evidence/selection',root=`.qa-profiles/rowsel-${Date.now()}`,rows=[];
await fs.mkdir(out,{recursive:true});
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
const site=await httpFixture((request,response)=>{const name=request.url.slice(1)||'docs';response.writeHead(200,{'content-type':'text/html'});response.end(`<title>${name} page with a long readable title</title>${name}`);});
const release=await takeSlot('row-selection');
let app;
/** Select some text first (the drag must clear it), then press on `selector` and drag across the rows next to it. */
async function dragAcross(label,selector,{dx=0,dy=90}={}){
 const target=app.ui.locator(selector).first();if(!(await target.count())){note(false,`${label}: no ${selector}`);return;}
 await sleep(400);const box=await target.boundingBox();
 // Some selectable text anywhere in the window (rows themselves cannot be selected any more).
 await app.ui.evaluate(()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let text;while((text=walker.nextNode())){const parent=text.parentElement;if(parent&&text.textContent.trim().length>3&&getComputedStyle(parent).userSelect!=='none'&&parent.getClientRects().length&&!parent.closest('input,textarea'))break;}if(!text)return;const range=document.createRange();range.selectNodeContents(text);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 const before=await app.ui.evaluate(()=>getSelection().toString());
 const x=box.x+box.width*.45,y=box.y+box.height/2;
 await app.ui.mouse.move(x,y);await app.ui.mouse.down();await app.ui.mouse.move(x+dx*.5,y+dy*.5,{steps:6});await app.ui.mouse.move(x+dx,y+dy,{steps:6});
 const during=await app.ui.evaluate(()=>getSelection().toString());
 await app.ui.keyboard.press('Escape');await app.ui.mouse.up();await sleep(300);
 const after=await app.ui.evaluate(()=>getSelection().toString());
 note(during===''&&after==='',`${label}: selection before ${JSON.stringify(before.slice(0,24))}, during drag ${JSON.stringify(during)}, after ${JSON.stringify(after)}`);
}
try{
 app=await startApp({root});
 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',sidebarWidth:260}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});
 await app.act({type:'tab.navigate',url:`http://127.0.0.1:${site.port}/docs`});
 for(const page of ['mail','news','maps','music'])await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/${page}`,background:true});
 const [docs,b,c,d,e]=(await app.state()).tabs.map(tab=>tab.id);
 await app.act({type:'tab.group.create',tabId:b,name:'Research group',color:'blue'});const g=(await app.state()).tabGroups[0].id;
 await app.act({type:'tab.group.assign',tabIds:[c],groupId:g});await app.act({type:'tab.select',id:b});await app.act({type:'split.open',tabIds:[b,c]});
 await app.act({type:'tab.pin',id:e});await sleep(900);
 await dragAcross('sidebar tab row',`.acira-sidebar .sb-tab[data-tab-id="${d}"] .sb-tab-main`,{dy:-120});
 await dragAcross('sidebar split card header','.acira-sidebar .sb-split-group .split-group-open',{dy:110});
 await dragAcross('sidebar group header',`.acira-sidebar .sb-group-header[data-group-header="${g}"]`,{dy:110});
 await dragAcross('sidebar pinned tab',`.acira-sidebar .sb-tab[data-pinned][data-tab-id="${e}"], .acira-sidebar .sb-app`,{dy:120});
 await dragAcross('sidebar bookmarks row','.acira-sidebar :is(.sb-bookmark,.sb-folder,.sb-zone-head,[data-flip^="sep"])',{dy:-80});
 await app.ui.screenshot({path:path.join(out,'sidebar-after-drags.png')}).catch(()=>{});
 // Rename field stays selectable.
 await app.ui.locator(`.acira-sidebar .sb-tab[data-tab-id="${docs}"] .sb-tab-main`).dblclick();await sleep(300);
 const field=await app.ui.evaluate(()=>{const input=document.querySelector('.acira-sidebar .sb-tab input');if(!input)return null;input.focus();input.select();return {start:input.selectionStart,end:input.selectionEnd,length:input.value.length};});
 note(!!field&&field.end-field.start===field.length&&field.length>0,`the inline rename field still selects its text: ${JSON.stringify(field)}`);
 await app.ui.keyboard.press('Escape');await sleep(300);
 // Strips.
 await app.act({type:'settings.update',patch:{verticalTabs:false}});await app.act({type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false,view:null}});await sleep(900);
 await dragAcross('horizontal strip tab',`.tabs-strip .browser-tab[data-tab-id="${d}"]`,{dx:-160,dy:4});
 await dragAcross('horizontal strip split chip','.tabs-strip .split-group-parent .split-group-open',{dx:140,dy:2});
 await dragAcross('horizontal strip group label','.tabs-strip [data-group-header]',{dx:120,dy:2});
 await app.ui.screenshot({path:path.join(out,'strip-after-drags.png')}).catch(()=>{});
 await app.act({type:'ui.update',patch:{view:'compact'}});await sleep(900);
 await dragAcross('compact strip tab','.acira-compact-tabs .acira-compact-tab',{dx:140,dy:2});
 await app.ui.screenshot({path:path.join(out,'compact-after-drags.png')}).catch(()=>{});
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result.txt'),rows.join('\n')+'\n');console.log(`evidence: ${out}`);
}
