// Linked copies in the strips, with real input only (webContents.sendInputEvent on the interface view): a grouped tab's chip dragged onto a loose
// split's tray in the FULL strip and in the COMPACT strip links it (it stays in its group and is also a pane of the split), and the tab's menu
// opens at a chip that is in view when the other chip of the tab is scrolled out of the compact strip (a menu asked for by tab id, no anchor;
// a right-click on the copy; the keyboard menu key on the copy). Isolated profile, one native slot, the window shown inactive off screen
// (qa/split-native.mjs: it never takes focus); captures are this app's own view only.
// Usage: npx tsx qa/split-linked-strips.mjs   (SPLIT_LINKED_EVIDENCE, default C:/ae/r3/split-linked/evidence)
import fs from 'node:fs/promises';
import path from 'node:path';
import {httpFixture,poll,sleep} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';
import {startInactive,mouse,settledBox,focused,capture} from './split-native.mjs';

const out=process.env.SPLIT_LINKED_EVIDENCE||'C:/ae/r3/split-linked/evidence',root=`.qa-profiles/splitlinkedstrips-${Date.now()}`,rows=[];
await fs.mkdir(out,{recursive:true});
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
const site=await httpFixture((request,response)=>{const name=request.url.slice(1)||'docs';response.writeHead(200,{'content-type':'text/html'});response.end(`<title>${name[0].toUpperCase()+name.slice(1)}</title>${name}`);});
const release=await takeSlot('split-linked-strips');
let app,pointer,focusSeen=false;
const shot=async name=>{await capture(app,path.join(out,name+'.png'));if(await focused(app))focusSeen=true;};
const state=()=>app.state();
const split0=async()=>{const s=await state();return {s,split:s.windowUi.splitGroups?.[0]};};
/** A chip's box once it has stopped moving; `copy` picks the tab's chip in the split's tray, else its own chip outside it. */
const chipSelector=(layout,id,copy)=>`${layout==='strip'?'.browser-tab':'.acira-compact-tab'}[data-tab-id="${id}"]${copy?'[data-link-copy]':':not([data-link-copy])'}`;
const box=selector=>settledBox(app,selector);
const mid=b=>({x:b.x+b.width/2,y:b.y+b.height/2});
/** Press on `from`, pull 6px to start the drag, glide to `to`, hold, release (the way a hand drags a chip). */
async function drag(from,to,name){
 await pointer.move(from.x,from.y);await sleep(60);await pointer.down();await sleep(40);
 await pointer.glide(from.x+6,from.y+2,3);await pointer.glide(to.x,to.y,18,18);await sleep(300);
 if(name)await shot(name);
 await pointer.up();await sleep(900);
}
const copies=layout=>app.ui.evaluate(layout=>[...document.querySelectorAll(`${layout==='strip'?'.browser-tab':'.acira-compact-tab'}[data-link-copy]`)].filter(n=>n.getClientRects().length&&!n.closest('[inert]')).map(n=>n.dataset.tabId),layout);
const overlayState=()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()).then(layout=>layout?.overlay??null);
const closeMenu=async()=>{await app.main(({webContents})=>{const wc=webContents.getAllWebContents().find(item=>item.getURL().includes('view=overlay'));if(wc){wc.sendInputEvent({type:'keyDown',keyCode:'Escape'});wc.sendInputEvent({type:'keyUp',keyCode:'Escape'});}});await sleep(500);};
try{
 app=await startInactive({root,width:1900,height:1000});pointer=mouse(app);
 await app.act({type:'settings.update',patch:{verticalTabs:false,appearance:'dark',interfaceScale:100,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false,view:null}});
 await app.act({type:'tab.navigate',url:`http://127.0.0.1:${site.port}/docs`});
 for(const page of ['mail','news','maps','music','spare'])await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/${page}`,background:true});
 await sleep(900);const opened=(await state()).tabs,byName=name=>opened.find(tab=>(tab.url||'').endsWith('/'+name)).id;
 const [docs,mail,news,maps,music,spare]=['docs','mail','news','maps','music','spare'].map(byName);
 await app.act({type:'tab.group.create',tabId:mail,name:'Research',color:'blue'});
 await app.act({type:'tab.group.assign',tabIds:[maps,spare],groupId:(await state()).tabGroups.find(item=>item.name==='Research').id});
 await app.act({type:'tab.select',id:docs});await app.act({type:'split.open',tabIds:[docs,news]});await sleep(900);

 for(const layout of ['strip','compact']){
  await app.act({type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false,view:layout==='compact'?'compact':null}});await sleep(1000);
  let {s,split}=await split0();
  if(split?.linked?.length){await app.act({type:'split.separate',tabId:split.linked[0]});await sleep(500);({s,split}=await split0());}
  note(split?.tabIds.join()===[docs,news].join()&&!split.linked&&(await copies(layout)).length===0,`${layout}: a loose split (Docs + News), no copy yet`);
  // 1. Drag the group chip of Spare onto the split's member chip (News): a native drag.
  if(layout==='compact')await app.ui.evaluate(()=>{const viewport=document.querySelector('.acira-compact-tabs-viewport');if(viewport)viewport.scrollLeft=viewport.scrollWidth;});
  await sleep(500);
  const from=mid(await box(chipSelector(layout,spare,false))),target=mid(await box(`${layout==='strip'?'.browser-tab':'.acira-compact-tab'}[data-split-member][data-tab-id="${news}"]`));
  await drag(from,target,`strips-${layout}-drag-hold`);
  ({s,split}=await split0());
  const spare1=s.tabs.find(tab=>tab.id===spare);
  note(split?.linked?.join()===spare&&split.tabIds.includes(spare)&&spare1?.group==='Research'&&s.tabs.filter(tab=>tab.id===spare).length===1,`${layout}: dragging Spare's own chip onto the split links it (stays in ${spare1?.group}, ${split?.tabIds.length} panes, linked ${split?.linked?.length})`);
  const chips=await app.ui.evaluate(([layout,id])=>[...document.querySelectorAll(`${layout==='strip'?'.browser-tab':'.acira-compact-tab'}[data-tab-id="${id}"]`)].filter(n=>n.getClientRects().length&&!n.closest('[inert]')).map(n=>`${n.hasAttribute('data-link-copy')?'copy':n.dataset.linkedIn?'home':'plain'}`),[layout,spare]);
  note(chips.length===2&&chips.includes('copy')&&chips.includes('home'),`${layout}: two chips for Spare: ${chips}`);
  await shot(`strips-${layout}-linked`);

  // 2. The tab's menu opens at a chip that is in view of its strip, whichever of the tab's two chips (its own, its copy in the split's tray) is
  // scrolled out: ten more tabs make the strip scroll, then it is scrolled to each end and the menu is asked for by tab id, with no anchor.
  if(layout==='strip'||layout==='compact'){
   const viewport=layout==='strip'?'.tab-strip-viewport':'.acira-compact-tabs-viewport',tabSel=layout==='strip'?'.browser-tab':'.acira-compact-tab';
   for(let n=1;n<=10;n++)await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/extra${layout}${n}`,background:true});
   await sleep(1200);
   // The extra tabs sit between the split's tray and the group, so a strip scrolled to its start has the copy in view and the group's chip far out of it.
   for(const extra of (await state()).tabs.filter(tab=>(tab.url||'').includes('/extra')))await app.act({type:'tab.drop',from:extra.id,to:mail,position:'before',groupId:null});
   await sleep(900);
   const scrollable=await app.ui.evaluate(([viewport])=>{const node=document.querySelector(viewport);return node.scrollWidth>node.clientWidth+4;},[viewport]);
   if(!scrollable)note(true,`${layout}: the strip shrinks its chips to fit all ${(await state()).tabs.length} tabs, so no chip of the tab is scrolled out of it (nothing to anchor around)`);
   // 'own': the tab's own chip sits at the strip's left edge (its copy in the tray is scrolled out to the left); 'copy': the copy's right edge sits at the strip's right edge (the own chip is out to the right).
   for(const edge of scrollable?['own','copy']:[]){
    await app.ui.evaluate(([viewport,tabSel,id,edge])=>{const node=document.querySelector(viewport),clip=node.getBoundingClientRect(),r=document.querySelector(`${tabSel}[data-tab-id="${id}"]${edge==='own'?':not([data-link-copy])':'[data-link-copy]'}`).getBoundingClientRect();node.scrollLeft+=edge==='own'?r.left-clip.left:r.right-clip.right;},[viewport,tabSel,spare,edge]);await sleep(700);
    const seen=await app.ui.evaluate(([viewport,tabSel,id])=>{const clip=document.querySelector(viewport).getBoundingClientRect();const read=sel=>{const r=document.querySelector(`${tabSel}[data-tab-id="${id}"]${sel}`).getBoundingClientRect();return {x:r.x,visible:Math.max(0,Math.min(r.right,clip.right)-Math.max(r.left,clip.left)),width:r.width};};return {own:read(':not([data-link-copy])'),copy:read('[data-link-copy]'),clip:{left:clip.left,right:clip.right}};},[viewport,tabSel,spare]);
    const inView=seen.own.visible>seen.copy.visible?'own':'copy',other=inView==='own'?seen.copy:seen.own,shown=seen[inView];
    await app.cmd({type:'ui',tabId:(await state()).activeTabId,action:'open',kind:'tab-context',targetTabId:spare});
    const asked=await poll(async()=>{const o=await overlayState();return o&&o.kind==='tab-context'?o:null;},Boolean,'tab menu by id',6000).catch(()=>null);
    const anchorX=asked?.anchor?.x??asked?.bounds?.x;
    note(other.visible<other.width*.6&&shown.visible>=Math.min(shown.width,24)&&!!asked&&typeof anchorX==='number'&&Math.abs(anchorX-shown.x)<4,`${layout}, strip scrolled to its ${edge}: the ${inView==='own'?'copy':'own'} chip shows ${Math.round(other.visible)} of ${Math.round(other.width)}px, the ${inView} chip ${Math.round(shown.visible)}px; the menu asked for by tab id opens at the chip in view (overlay x=${anchorX}, chip x=${Math.round(shown.x)})`);
    if(edge==='copy')await shot(`strips-${layout}-menu-scrolled`);
    await closeMenu();
   }
   for(const extra of (await state()).tabs.filter(tab=>(tab.url||'').includes('/extra')))await app.act({type:'tab.close',id:extra.id});
   await app.ui.evaluate(([viewport])=>{const node=document.querySelector(viewport);if(node)node.scrollLeft=0;},[viewport]);await sleep(900);
  }
  const copyBox=await box(chipSelector(layout,spare,true));
  // A right-click on the copy chip, and the menu key with the copy chip focused.
  const c=mid(copyBox);await pointer.click(c.x,c.y,'right');
  const right=await poll(async()=>{const o=await overlayState();return o&&o.kind==='tab-context'?o:null;},Boolean,'tab menu by right-click',6000).catch(()=>null);
  note(!!right,`${layout}: a right-click on the copy chip opens the tab menu`);await closeMenu();
  await app.ui.evaluate(([layout,id])=>document.querySelector(`${layout==='strip'?'.browser-tab':'.acira-compact-tab'}[data-tab-id="${id}"][data-link-copy]`)?.focus({preventScroll:false}),[layout,spare]);await sleep(200);
  await pointer.key('F10',['shift']);
  const key=await poll(async()=>{const o=await overlayState();return o&&o.kind==='tab-context'?o:null;},Boolean,'tab menu by key',6000).catch(()=>null);
  note(!!key,`${layout}: Shift+F10 on the focused copy chip opens the tab menu`);await closeMenu();
 }
 if(await focused(app))focusSeen=true;note(!focusSeen,'the fixture never held focus');
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result-strips.txt'),rows.join('\n')+'\n');console.log(`evidence: ${out}`);
}
