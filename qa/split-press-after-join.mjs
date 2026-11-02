// Two checks the split solo work left open (28 Oct): (1) a press 0/40/120/250 ms after a tab joins a split, with real native input
// (webContents.sendInputEvent mouseDown/mouseUp on the interface view), selects the row that will be under the pointer once the
// rows have slid into place, never the neighbour drawn over it mid-slide: no swap, one current row; (2) the tab menu of a grouped
// split pane: native overlay contentHeight against popupNaturalHeight (its estimate), beside an ordinary web tab's.
// Each round starts from the same two-pane split (Mail + News in Research): the joiner is separated again before the next join
// (the 28 Oct probe kept adding panes and tried to join a split that already had four).
// The window draws frames but never takes focus (qa/split-native.mjs); captures are this app's own view only.
// Usage: npx tsx qa/split-press-after-join.mjs   (SPLIT_PRESS_EVIDENCE, default C:/ae/r3/split-solo/evidence/press)
import fs from 'node:fs/promises';
import path from 'node:path';
import {httpFixture,poll,sleep} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';
import {startInactive,mouse,settledBox,focused,capture} from './split-native.mjs';
import {popupContentHeight,popupNaturalHeight} from '../src/ui/popup.ts';

const out=process.env.SPLIT_PRESS_EVIDENCE||'C:/ae/r3/split-solo/evidence/press',root=`.qa-profiles/splitpress-${Date.now()}`,rows=[];
await fs.mkdir(out,{recursive:true});
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
const site=await httpFixture((request,response)=>{const name=request.url.slice(1)||'docs';response.writeHead(200,{'content-type':'text/html'});response.end(`<title>${name[0].toUpperCase()+name.slice(1)}</title>${name}`);});
const release=await takeSlot('split-press-after-join');
let app,pointer,focusSeen=false;
/** In the page: wait for the joiner's row to land in the card (the moment its slide starts), then `delay` ms, then read where the
 *  joiner and the neighbour will be once every slide has finished (layout boxes: the drawn box minus the running slide's
 *  transform), what is drawn there now, and whether rows are still sliding. Times are from the landing. */
const afterLanding=(joiner,neighbour,delay)=>app.ui.evaluate(async([joiner,neighbour,delay])=>{
 const row=id=>document.querySelector(`.acira-sidebar .sb-tabs .sb-tab[data-tab-id="${id}"]`);
 const t0=await new Promise((resolve,reject)=>{const end=performance.now()+3000;const look=()=>{if(row(joiner)?.closest('.sb-split-group'))resolve(performance.now());else if(performance.now()>end)reject(Error('the joiner never reached the card'));else requestAnimationFrame(look);};look();});
 await new Promise(resolve=>setTimeout(resolve,delay));
 const settled=id=>{const node=row(id);if(!node)return null;const r=node.getBoundingClientRect();let shift=0;for(let item=node;item&&!item.classList.contains('sb-scroll');item=item.parentElement){const m=new DOMMatrixReadOnly(getComputedStyle(item).transform);shift+=m.m42;}return {x:r.left+Math.min(60,r.width/2),y:r.top-shift+r.height/2,drawnY:r.top+r.height/2};};
 const sliding=[...document.querySelectorAll('.acira-sidebar .sb-tabs [data-flip]')].filter(node=>node.getAnimations().some(animation=>animation.playState==='running'&&/^sb-/.test(animation.id))).length;
 const points={joiner:settled(joiner),neighbour:settled(neighbour)};
 const drawn=Object.fromEntries(Object.entries(points).map(([key,p])=>[key,p&&document.elementFromPoint(p.x,p.y)?.closest('.sb-tab')?.dataset.tabId||null]));
 // Record when the native press arrives (pointerdown, capture), for the report.
 window.__pressAt=null;window.addEventListener('pointerdown',()=>{window.__pressAt=performance.now()-t0;},{capture:true,once:true});
 window.__t0=t0;
 return {points,drawn,sliding,at:performance.now()-t0};
},[joiner,neighbour,delay]);
/** After the press: the selected tab, the rows that read as current (aria-current, the raised card, the glide), and what sits
 *  under the press point now that the rows have settled. */
const verdict=(p)=>app.ui.evaluate(p=>{const rows=[...document.querySelectorAll('.acira-sidebar .sb-tabs .sb-tab')].filter(node=>node.getClientRects().length&&!node.closest('[data-hidden],.sb-flip-ghost'));
 return {current:rows.filter(node=>node.getAttribute('aria-current')==='true').map(node=>node.dataset.tabId),glides:document.querySelectorAll('.acira-sidebar .sb-glide').length,under:document.elementFromPoint(p.x,p.y)?.closest('.sb-tab')?.dataset.tabId||null,pressAt:window.__pressAt};},p);
try{
 app=await startInactive({root});pointer=mouse(app);
 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',interfaceScale:100,sidebarWidth:260,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});
 await app.act({type:'tab.navigate',url:`http://127.0.0.1:${site.port}/docs`});
 for(const page of ['mail','news','maps','music','spare'])await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/${page}`,background:true});
 await sleep(900);const opened=(await app.state()).tabs,id=name=>opened.find(tab=>(tab.url||'').endsWith('/'+name)).id;
 const [docs,mail,news,maps,music,spare]=['docs','mail','news','maps','music','spare'].map(id),name=tab=>opened.find(item=>item.id===tab)?.url.split('/').pop()??String(tab);
 await app.act({type:'tab.group.create',tabId:mail,name:'Research',color:'blue'});const g=(await app.state()).tabGroups.find(item=>item.name==='Research').id;
 await app.act({type:'tab.group.assign',tabIds:[news],groupId:g});
 await app.act({type:'tab.select',id:mail});await app.act({type:'split.open',tabIds:[mail,news]});await sleep(900);
 const split=(await app.state()).windowUi.splitGroups[0].id;
 /** Back to the two-pane split with Docs current, every row at rest. */
 const reset=async()=>{
  for(const tab of ((await app.state()).windowUi.splitGroups.find(item=>item.id===split)?.tabIds||[]).filter(tab=>tab!==mail&&tab!==news))await app.act({type:'split.separate',tabId:tab,groupId:null});
  await app.act({type:'tab.select',id:docs});await sleep(300);
  for(const tab of [maps,music,spare,docs])await settledBox(app,`.acira-sidebar .sb-tab[data-tab-id="${tab}"]`);
  const s=await app.state(),panes=s.windowUi.splitGroups.find(item=>item.id===split)?.tabIds;
  if(panes?.join()!==[mail,news].join())throw Error(`reset left the split at ${panes?.map(name)}`);
 };
 // (1) Join, then press where the joiner (or the row that was below it, which slides into its old place) will be.
 const counts={};
 for(const delay of [0,40,120,250])for(const [joiner,target] of [['music','joiner'],['maps','joiner'],['music','neighbour'],['maps','neighbour']]){
  await reset();
  const joinerId=id(joiner),loose=await app.ui.evaluate(()=>[...document.querySelectorAll('.acira-sidebar .sb-zone-body>.sb-tab')].map(node=>node.dataset.tabId));
  const neighbourId=loose[loose.indexOf(joinerId)+1]||loose[loose.indexOf(joinerId)-1];
  void app.act({type:'split.group.add',id:split,tabId:joinerId});
  const seen=await afterLanding(joinerId,neighbourId,delay),p=seen.points[target],want=target==='joiner'?joinerId:neighbourId;
  if(!p){note(false,`${delay}ms ${joiner} ${target}: no row`);continue;}
  await pointer.click(p.x,p.y);await sleep(700);
  const after=await verdict(p),s=await app.state(),panes=s.windowUi.splitGroups.find(item=>item.id===split)?.tabIds||[];
  const ok=s.activeTabId===want&&after.current.length===1&&after.current[0]===want&&after.under===want&&after.glides===0;
  counts[delay]=(counts[delay]||0)+(ok?1:0);
  note(ok,`join ${joiner}, press ${target==='joiner'?joiner:name(neighbourId)}'s settled place ${delay}ms after the join landed (press arrived at ${after.pressAt?.toFixed(0)}ms, ${seen.sliding} rows sliding, drawn there at the read: ${name(seen.drawn[target])}): selected ${name(s.activeTabId)}, current rows ${after.current.map(name).join(',')||'none'}, under the pointer now ${name(after.under)}, split ${panes.map(name).join('+')}`);
 }
 note(Object.values(counts).every(count=>count===4)&&Object.keys(counts).length===4,`presses after a join select the settled row: ${Object.entries(counts).map(([delay,count])=>`${delay}ms ${count}/4`).join(', ')}`);
 await reset();
 // (2) Tab menu heights: an ordinary web tab, then a grouped split pane (Open alone, Remove from split view, Remove from group).
 const overlayKey=key=>app.main(({webContents},key)=>{const wc=webContents.getAllWebContents().find(item=>item.getURL().includes('view=overlay'));if(wc){wc.sendInputEvent({type:'keyDown',keyCode:key});wc.sendInputEvent({type:'keyUp',keyCode:key});}},key);
 for(const [label,tabId] of [['web tab',spare],['grouped split pane',news]]){
  await app.act({type:'tab.select',id:mail});await sleep(400);
  const box=await settledBox(app,`.acira-sidebar .sb-tab[data-tab-id="${tabId}"] .sb-tab-main`);await pointer.click(box.x+40,box.y+box.height/2,'right');
  const settled=await poll(async()=>{const a=(await app.ui.evaluate(()=>window.acira.getBrowserLayout()))?.overlay;await sleep(250);const b=(await app.ui.evaluate(()=>window.acira.getBrowserLayout()))?.overlay;return a&&b&&a.kind==='tab-context'&&a.contentHeight===b.contentHeight?b:null;},Boolean,'tab menu',6000).catch(()=>null);
  const s=await app.state(),target=s.tabs.find(tab=>tab.id===tabId),estimate=popupNaturalHeight('tab-context',s,{target}),expected=popupContentHeight('tab-context',estimate);
  note(!!settled&&Math.abs(settled.contentHeight-expected)<=1,`tab menu of a ${label}: native contentHeight ${settled?.contentHeight}, estimate ${estimate} (content ${expected})`);
  const overlay=app.context.pages().find(page=>page.url().includes('view=overlay'));
  if(overlay){await overlay.evaluate(()=>{document.body.style.background='#1d1f22';});await app.main(async({webContents},file)=>{const wc=webContents.getAllWebContents().find(item=>item.getURL().includes('view=overlay'));const image=await wc.capturePage();require('node:fs').writeFileSync(file,image.toPNG());},path.join(out,`menu-${label.replaceAll(' ','-')}-on-backdrop.png`)).catch(()=>{});await overlay.evaluate(()=>{document.body.style.background='';});}
  await overlayKey('Escape');await sleep(500);
 }
 await capture(app,path.join(out,'press-final.png'));
 if(await focused(app))focusSeen=true;note(!focusSeen,'the fixture never held focus');
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result.txt'),rows.join('\n')+'\n');console.log(`evidence: ${out}`);
}
