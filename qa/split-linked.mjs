// Linked copies (founder, 28 Oct): a tab of a tab group dragged onto a split OUTSIDE every group stays in its group AND is a pane of the
// split, the same tab (one page) in two rows. Real app, real input only (webContents.sendInputEvent on the interface view), isolated
// profile, one native slot, the window shown inactive off screen (qa/split-native.mjs: it never takes focus); captures are this app's own view.
// Checks the drag, the two rows reading as current together (one glide pair, none left behind), the tooltips, the × on each row, the drag
// of the split row out, rename/mute on both rows, a restart, then the sidebar, the horizontal strip and the compact strip (and the tab menu)
// in dark and light at 100% and 150%, English and German: clip scan + glyph/title/× overlap scan, shots saved.
// Usage: npx tsx qa/split-linked.mjs   (SPLIT_LINKED_EVIDENCE, default C:/ae/r3/split-linked/evidence)   SPLIT_LINKED_QUICK=1 skips the matrix.
import fs from 'node:fs/promises';
import path from 'node:path';
import {httpFixture,poll,sleep} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';
import {startInactive,mouse,settledBox,focused,capture} from './split-native.mjs';

const out=process.env.SPLIT_LINKED_EVIDENCE||'C:/ae/r3/split-linked/evidence',root=`.qa-profiles/splitlinked-${Date.now()}`,rows=[];
await fs.mkdir(out,{recursive:true});
const scan=await fs.readFile('qa/m-clip-scan.js','utf8');
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
const site=await httpFixture((request,response)=>{const name=request.url.slice(1)||'docs';response.writeHead(200,{'content-type':'text/html'});response.end(`<title>${name[0].toUpperCase()+name.slice(1)}</title>${name}`);});
const release=await takeSlot('split-linked');
let app,pointer,focusSeen=false;
const shot=async name=>{await capture(app,path.join(out,name+'.png'));if(await focused(app))focusSeen=true;};
const A=".acira-sidebar";
const groupRow=id=>`${A} .sb-group-members .sb-tab[data-tab-id="${id}"]:not([data-link-role=split])`,cardRow=id=>`${A} .sb-split-group .sb-tab[data-tab-id="${id}"]`;
/** Press at `from`, pull 8px to start the drag, glide to `to`, release (the way a hand drags). */
async function drag(from,to,name){
 await pointer.move(from.x,from.y);await sleep(40);await pointer.down();await sleep(30);
 await pointer.glide(from.x,from.y+8,3);await pointer.glide(to.x,to.y,14);await sleep(250);
 // What the sidebar shows while the row is held over its drop: the drop line (data-drop on a row), the split join marks, and "leaving".
 const seen=await app.ui.evaluate(()=>{const label=document.querySelector('.acira-sidebar .sb-tab[data-dragging] .sb-tab-leave');return {drops:document.querySelectorAll('.acira-sidebar [data-drop]').length,insert:document.querySelectorAll('.acira-sidebar [data-split-insert]').length,leaving:!!document.querySelector('.acira-sidebar .sb-split-group[data-leaving]'),label:label?getComputedStyle(label).display:null};});
 if(name)await shot(name);
 await pointer.up();await sleep(700);return seen;
}
const centre=async(selector,dx)=>{const box=await settledBox(app,selector);return {x:box.x+(dx??Math.min(60,box.width/2)),y:box.y+box.height/2,box};};
const clickRow=async selector=>{const p=await centre(`${selector} .sb-tab-main`,40);await pointer.click(p.x,p.y);await sleep(80);};
/** Both rows of a tab as the sidebar draws them. */
const rowsOf=id=>app.ui.evaluate(id=>[...document.querySelectorAll(`.acira-sidebar .sb-tab[data-tab-id="${id}"]`)].filter(n=>n.getClientRects().length&&!n.closest('.sb-flip-ghost,[data-hidden]')).map(n=>({role:n.dataset.linkRole||'',current:n.getAttribute('aria-current')==='true',title:n.querySelector('.sb-tab-title-text')?.textContent,link:n.querySelector('.sb-tab-link')?.getAttribute('title')??null,close:n.querySelector('.sb-tab-close')?.getAttribute('title')??null,inCard:!!n.closest('.sb-split-group')})),id);
const glides=()=>app.ui.evaluate(()=>document.querySelectorAll('.acira-sidebar .sb-glide').length);
const pages=async name=>app.main(({webContents},suffix)=>webContents.getAllWebContents().filter(w=>!w.isDestroyed()&&w.getURL().endsWith(suffix)).length,'/'+name);
const split0=async()=>{const s=await app.state();return {s,split:s.windowUi.splitGroups?.[0]};};
const tabOf=(s,id)=>s.tabs.find(tab=>tab.id===id);
try{
 app=await startInactive({root,width:1900,height:1000});pointer=mouse(app);
 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',interfaceScale:100,sidebarWidth:260,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});
 await app.act({type:'tab.navigate',url:`http://127.0.0.1:${site.port}/docs`});
 for(const page of ['mail','news','maps','music','spare'])await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/${page}`,background:true});
 await sleep(900);const opened=(await app.state()).tabs,byName=name=>opened.find(tab=>(tab.url||'').endsWith('/'+name)).id;
 const [docs,mail,news,maps,music,spare]=['docs','mail','news','maps','music','spare'].map(byName);
 await app.act({type:'tab.group.create',tabId:mail,name:'Research',color:'blue'});const g=(await app.state()).tabGroups.find(item=>item.name==='Research').id;
 await app.act({type:'tab.group.assign',tabIds:[maps,spare],groupId:g});
 await app.act({type:'tab.select',id:docs});await app.act({type:'split.open',tabIds:[docs,news]});
 await app.ui.locator('.sb-split-group').waitFor({timeout:8000});await sleep(700);
 let {s,split}=await split0();
 note(split?.tabIds.join()===[docs,news].join()&&!split.linked&&(await rowsOf(maps)).length===1,'start: a loose split (Docs + News) and Maps, Mail, Spare in Research');

 // 1. Drag the group row of Maps onto the loose card's bottom edge.
 const from=await centre(`${groupRow(maps)} .sb-tab-main`,40),card=await settledBox(app,`${A} .sb-split-group`);
 await drag(from,{x:card.x+card.width/2,y:card.y+card.height-6});
 ({s,split}=await split0());
 const maps1=tabOf(s,maps);
 note(split?.tabIds.includes(maps)&&split.linked?.join()===maps&&maps1?.group==='Research'&&s.tabs.filter(tab=>tab.id===maps).length===1,`dragging Maps (in Research) onto the loose split links it: stays in ${maps1?.group}, split ${split?.tabIds.length} panes, linked ${split?.linked?.length}`);
 let two=await rowsOf(maps);
 note(two.length===2&&two.some(r=>r.role==='group'&&!r.inCard&&r.link==='Also in split view')&&two.some(r=>r.role==='split'&&r.inCard&&r.link==='In group Research'&&r.close==='Remove from split view'),`two rows: ${two.map(r=>`${r.role||'plain'}[${r.inCard?'card':'group'}] "${r.link}" ×="${r.close}"`).join(' | ')}`);
 note((await pages('maps'))===1,'one page (one webContents) behind both rows');
 await shot('1-linked-dark');

 // 2. Either row selects the tab; both read as current together, one glide pair, none left.
 await app.act({type:'tab.select',id:mail});await sleep(700);
 await clickRow(groupRow(maps));let mid=0;for(const wait of [30,90,180]){await sleep(wait);mid=Math.max(mid,await glides());}
 await sleep(700);two=await rowsOf(maps);let now=await app.state();
 note(now.activeTabId===maps&&two.length===2&&two.every(r=>r.current)&&(await glides())===0&&mid>=1,`click on the group row: active ${now.activeTabId===maps}, both rows current ${two.map(r=>r.current)}, glides during the move ${mid}, left after ${await glides()}`);
 await shot('2-group-row-current');
 await clickRow(groupRow(mail));await sleep(700);
 note((await rowsOf(maps)).every(r=>!r.current),'another tab current: neither row of Maps reads as current');
 await clickRow(cardRow(maps));mid=0;for(const wait of [30,90,180]){await sleep(wait);mid=Math.max(mid,await glides());}
 await sleep(700);two=await rowsOf(maps);now=await app.state();
 note(now.activeTabId===maps&&now.windowUi.split?.groupId===split.id&&two.every(r=>r.current)&&(await glides())===0,`click on the card row: active ${now.activeTabId===maps}, split shown ${now.windowUi.split?.groupId===split.id}, both rows current ${two.map(r=>r.current)}, glides during ${mid}, after ${await glides()}`);
 await shot('3-card-row-current');

 // 3. Rename and mute update both rows.
 await app.act({type:'tab.rename',id:maps,title:'Atlas'});await app.act({type:'tab.mute',id:maps,muted:true});await sleep(500);
 two=await rowsOf(maps);note(two.length===2&&two.every(r=>r.title==='Atlas'),`rename: both rows say ${two.map(r=>r.title)}`);
 await app.act({type:'tab.rename',id:maps,title:''});await app.act({type:'tab.mute',id:maps,muted:false});await sleep(300);

 // 4. × on the card row removes it from the split only.
 let p=await centre(`${cardRow(maps)} .sb-tab-main`,40);await pointer.move(p.x,p.y);await sleep(200);
 let x=await centre(`${cardRow(maps)} .sb-tab-close`,10);await pointer.click(x.x,x.y);await sleep(800);
 ({s,split}=await split0());
 note(split?.tabIds.join()===[docs,news].join()&&!split.linked&&tabOf(s,maps)?.group==='Research'&&(await rowsOf(maps)).length===1,`× on the split row: split ${split?.tabIds.length} panes, Maps still in ${tabOf(s,maps)?.group}, rows ${(await rowsOf(maps)).length}`);

 // 5. Link again, then × on the group row closes the tab everywhere.
 const again=async id=>{const f=await centre(`${groupRow(id)} .sb-tab-main`,40),c=await settledBox(app,`${A} .sb-split-group`);await drag(f,{x:c.x+c.width/2,y:c.y+c.height-6});};
 await again(maps);({s,split}=await split0());note(split?.linked?.join()===maps,'dragged in again: linked');
 p=await centre(`${groupRow(maps)} .sb-tab-main`,40);await pointer.move(p.x,p.y);await sleep(200);
 x=await centre(`${groupRow(maps)} .sb-tab-close`,10);await pointer.click(x.x,x.y);await sleep(900);
 ({s,split}=await split0());
 note(!tabOf(s,maps)&&split?.tabIds.join()===[docs,news].join()&&(await rowsOf(maps)).length===0,`× on the group row closes the tab: gone from tabs ${!tabOf(s,maps)}, split ${split?.tabIds.length} panes, rows ${(await rowsOf(maps)).length}`);

 // 6. Dragging the split row out removes it from the split only (the tab keeps its place in the group).
 await again(spare);({s,split}=await split0());note(split?.linked?.join()===spare,'Spare linked');
 const order=s.tabs.map(tab=>tab.id).join();
 const f2=await centre(`${cardRow(spare)} .sb-tab-main`,40),far=await centre(`${A} .sb-tab[data-tab-id="${music}"] .sb-tab-main`,40);
 const held=await drag(f2,{x:far.x,y:far.y+6},'6-copy-dragged-out');
 note(held.drops===0&&held.insert===0&&held.leaving&&held.label==='inline-block',`while the copy is held over loose rows no drop line is drawn (drop lines ${held.drops}, split marks ${held.insert}) and its row says "Remove from split view" (${held.leaving}, ${held.label})`);
 ({s,split}=await split0());
 note(await app.ui.evaluate(()=>!document.querySelector('.acira-sidebar [data-leaving]')),'after the release nothing is left marked as leaving');
 note(split?.tabIds.join()===[docs,news].join()&&!split.linked&&tabOf(s,spare)?.group==='Research'&&s.tabs.map(tab=>tab.id).join()===order,`dragging the split row out: split ${split?.tabIds.length} panes, Spare still in ${tabOf(s,spare)?.group}, strip order unchanged ${s.tabs.map(tab=>tab.id).join()===order}`);

 // 7. A restart keeps both rows.
 await again(spare);({s,split}=await split0());note(split?.linked?.join()===spare,'Spare linked before the restart');
 await sleep(1200);await app.close();
 app=await startInactive({root,width:1900,height:1000});pointer=mouse(app);await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',interfaceScale:100,sidebarWidth:260,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});await sleep(1500);
 ({s,split}=await split0());two=await rowsOf(spare);
 note(split?.linked?.join()===spare&&tabOf(s,spare)?.group==='Research'&&two.length===2,`after a restart: linked ${split?.linked?.length}, Spare in ${tabOf(s,spare)?.group}, rows ${two.length}`);
 await shot('4-after-restart');
 await app.act({type:'tab.select',id:spare});await sleep(700);

 // 7b. Undo of a closed pane (any pane, a linked copy too) puts it back into its split at its slot, not only into its group.
 {
  ({s,split}=await split0());const order0=split.tabIds.join();
  p=await centre(`${cardRow(news)} .sb-tab-main`,40);await pointer.move(p.x,p.y);await sleep(200);
  x=await centre(`${cardRow(news)} .sb-tab-close`,10);await pointer.click(x.x,x.y);await sleep(900);
  ({s,split}=await split0());
  note(!tabOf(s,news)&&split?.tabIds.join()===[docs,spare].join(),`× on a pane of the loose split closes it: split ${split?.tabIds.length} panes, toast ${s.toast?.action?.label}`);
  await app.act(s.toast.action.command);await sleep(900);
  ({s,split}=await split0());two=await rowsOf(news);
  note(split?.tabIds.join()===order0&&two.length===1&&two[0].inCard,`Undo puts Maps' neighbour back into the split at its slot: ${split?.tabIds.map(id=>tabOf(s,id)?.url.split('/').pop()).join('+')} (was ${order0===split?.tabIds.join()?'the same order':'a different order'}), one card row`);
  p=await centre(`${groupRow(spare)} .sb-tab-main`,40);await pointer.move(p.x,p.y);await sleep(200);
  x=await centre(`${groupRow(spare)} .sb-tab-close`,10);await pointer.click(x.x,x.y);await sleep(900);
  ({s,split}=await split0());
  note(!tabOf(s,spare)&&split?.tabIds.join()===[docs,news].join(),`× on the linked copy's group row closes the tab: split ${split?.tabIds.length} panes`);
  await app.act(s.toast.action.command);await sleep(900);
  ({s,split}=await split0());two=await rowsOf(spare);
  note(split?.tabIds.join()===order0&&split.linked?.join()===spare&&tabOf(s,spare)?.group==='Research'&&two.length===2,`Undo of the linked tab: back in Research and in the split as a copy at its slot (rows ${two.map(r=>r.role||'plain')}, linked ${split?.linked?.length})`);
  await shot('5-after-undo');
 }

 if(!process.env.SPLIT_LINKED_QUICK){
  // 8. The matrix: sidebar, horizontal strip, compact strip, tab menu — dark/light x 100/150 x English/German.
  const layouts=[
   ['sidebar',{verticalTabs:true},{workspaceOpen:true,webWorkspaceOpen:true,view:null}],
   ['strip',{verticalTabs:false},{workspaceOpen:false,webWorkspaceOpen:false,view:null}],
   ['compact',{verticalTabs:false},{workspaceOpen:false,webWorkspaceOpen:false,view:'compact'}],
  ];
  for(const [layout,patch,ui] of layouts){
   for(const [appearance,scale,language] of [['dark',100,'en'],['light',100,'en'],['dark',150,'en'],['light',150,'en'],['dark',100,'de'],['light',150,'de']]){
    // A language change reloads the interface: retry the act that was in flight.
    for(let attempt=0;attempt<3;attempt++){try{await app.act({type:'settings.update',patch:{...patch,appearance,interfaceScale:scale,language,sidebarWidth:260}});await sleep(1200);await app.act({type:'ui.update',patch:ui});break;}catch(error){if(attempt===2)throw error;await sleep(1500);}}await sleep(1100);
    const hits=await app.ui.evaluate(scan);
    const clip=String(hits).split('\n').slice(1).filter(line=>line&&line!=='no hits'&&!/live region|width 1px| cw=1 /i.test(line));
    // The glyph, the title and the × of the two linked chips/rows never overlap, and each title/glyph stays inside its row.
    const overlap=await app.ui.evaluate(()=>{
     const bad=[];const box=n=>n?.getBoundingClientRect();
     const rows=[...document.querySelectorAll('[data-link-role],.link-copy,.link-home')].filter(n=>n.getClientRects().length&&!n.closest('[inert],[hidden]'));
     for(const row of rows){
      const r=box(row),mark=row.querySelector('.sb-tab-link,.tab-link-mark,.acira-compact-tab-link'),title=row.querySelector('.sb-tab-title-text,.tab-title-text'),close=row.querySelector('.sb-tab-close,.tab-close,.acira-compact-tab-close,.standard-tab-icon-close');
      if(mark&&getComputedStyle(mark).display!=='none'){const m=box(mark);if(m.left<r.left-0.5||m.right>r.right+0.5||m.top<r.top-0.5||m.bottom>r.bottom+0.5)bad.push('glyph outside its row');
       if(title){const range=document.createRange();range.selectNodeContents(title);const t=range.getBoundingClientRect();const tr=title.parentElement.getBoundingClientRect();const visibleRight=Math.min(t.right,tr.right);if(visibleRight>m.left+1&&t.left<m.right&&Math.abs(t.top-m.top)<20&&visibleRight-m.left>2)bad.push('title runs under the glyph');}
       if(close&&close.getClientRects().length&&parseFloat(getComputedStyle(close).opacity)>0.2){const c=box(close);if(m.right>c.left+1&&m.left<c.right-1)bad.push('glyph over the ×');}}
     }
     return {count:rows.length,bad:[...new Set(bad)]};
    });
    const label=`${layout} ${appearance} ${scale}% ${language}`;
    note(clip.length===0&&overlap.bad.length===0&&overlap.count>=(layout==='sidebar'?2:2),`${label}: clip scan ${clip.length} hits${clip.length?' ('+clip.slice(0,2).join('; ')+')':''}, overlap ${overlap.bad.length} (${overlap.count} linked rows/chips)${overlap.bad.length?' '+overlap.bad.join(', '):''}`);
    await shot(`m-${layout}-${appearance}-${scale}-${language}`);
   }
   // Both chips/rows current together, in every layout.
   const current=await app.ui.evaluate(id=>{const all=[...document.querySelectorAll(`[data-tab-id="${id}"]`)].filter(n=>n.getClientRects().length&&!n.closest('[inert],[hidden],.sb-flip-ghost,.tab-drag-preview'));return all.map(n=>n.getAttribute('aria-current')==='true'||n.getAttribute('aria-selected')==='true'||n.classList.contains('selected'));},spare);
   note(current.length===2&&current.every(Boolean),`${layout}: both drawings of Spare read as current ${current}`);
   const pills=await app.ui.evaluate(()=>[...document.querySelectorAll('.tab-strip-selection,.acira-compact-selection')].filter(n=>!n.hasAttribute('data-hidden')&&getComputedStyle(n).opacity!=='0'&&n.getClientRects().length&&!n.parentElement.closest('[inert],[aria-hidden=true],[hidden]')).map(n=>`${n.className.split(' ')[0]}${n.hasAttribute('data-copy')?'(copy)':''}@${Math.round(n.getBoundingClientRect().left)}`));
   if(layout!=='sidebar')note(pills.length===2&&pills.some(p=>p.includes('(copy)')),`${layout}: two selection pills (${pills.join(', ')})`);
   // Tab menu of the linked tab, from the chip/row of its group.
   await app.act({type:'settings.update',patch:{appearance:'dark',interfaceScale:100,language:'en'}});await sleep(700);
   const target=layout==='sidebar'?`${groupRow(spare)} .sb-tab-main`:layout==='strip'?'.browser-tab[data-tab-id="'+spare+'"]:not([data-link-copy])':'.acira-compact-tab[data-tab-id="'+spare+'"][data-link-copy]';
   const t=await centre(target,layout==='sidebar'?40:undefined);await pointer.click(t.x,t.y,'right');
   const menu=await poll(async()=>{const a=(await app.ui.evaluate(()=>window.acira.getBrowserLayout()))?.overlay;await sleep(250);return a&&a.kind==='tab-context'?a:null;},Boolean,'tab menu',6000).catch(()=>null);
   if(menu){const overlay=app.context.pages().find(page=>page.url().includes('view=overlay'));const text=overlay?await overlay.evaluate(scan):'no overlay page';note(String(text).endsWith('no hits')||String(text)==='ellipsis(deliberate)=0\nno hits',`${layout}: tab menu of the linked tab, clip scan ${String(text).split('\n').slice(1).join(' | ')}`);
    if(overlay){await overlay.evaluate(()=>{document.body.style.background='#1d1f22';});await app.main(async({webContents},file)=>{const wc=webContents.getAllWebContents().find(item=>item.getURL().includes('view=overlay'));require('node:fs').writeFileSync(file,(await wc.capturePage()).toPNG());},path.join(out,`menu-${layout}.png`)).catch(()=>{});await overlay.evaluate(()=>{document.body.style.background='';});}}
   else note(false,`${layout}: the tab menu did not open`);
   await app.main(({webContents})=>{const wc=webContents.getAllWebContents().find(item=>item.getURL().includes('view=overlay'));if(wc){wc.sendInputEvent({type:'keyDown',keyCode:'Escape'});wc.sendInputEvent({type:'keyUp',keyCode:'Escape'});}});await sleep(500);
  }
 }
 if(await focused(app))focusSeen=true;note(!focusSeen,'the fixture never held focus');
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result.txt'),rows.join('\n')+'\n');console.log(`evidence: ${out}`);
}
