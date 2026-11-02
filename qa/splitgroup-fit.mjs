// The split card fits the sidebar (coordinator, 27 Oct): in every nesting the card's right edge equals the sibling rows' right
// edge (±1px) and its outline stays inside the sidebar's inner edge, at rest, hovered, current and while groups/splits fold, at
// 100/150% and narrow widths. Isolated profile, one native slot. The window never takes focus (qa/split-native.mjs: created
// unfocusable, shown inactive off screen, ignores the real mouse); input is sendInputEvent on the interface view; captures are
// this app's own view only.
// Usage: npx tsx qa/splitgroup-fit.mjs   (SPLITGROUP_EVIDENCE, default C:/ae/r6/splitgroup/evidence/fit)
import fs from 'node:fs/promises';
import path from 'node:path';
import {httpFixture,sleep} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';
import {startInactive,mouse,settledBox,focused,capture} from './split-native.mjs';

// SPLITGROUP_HIDDEN=1 keeps the window hidden (never shown, so it can never take focus); layout is measured all the same.
if(process.env.SPLITGROUP_HIDDEN!=='1')process.env.D_VISIBLE='1';else delete process.env.D_VISIBLE;
const out=process.env.SPLITGROUP_EVIDENCE||(process.platform==='win32'?'C:/ae/r6/splitgroup/evidence/fit':path.resolve('qa/artifacts/splitgroup/fit')),root=`.qa-profiles/splitfit-${Date.now()}`,rows=[];
await fs.mkdir(out,{recursive:true});
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
const site=await httpFixture((request,response)=>{const name=request.url.slice(1)||'docs';response.writeHead(200,{'content-type':'text/html'});response.end(`<title>${name==='long'?'A very long page title that has to fade at the end of the row':name[0].toUpperCase()+name.slice(1)}</title><body>${name}</body>`);});
const release=await takeSlot('splitgroup-fit');
let app,pointer,focusSeen=false;
/** Everything measured in CSS pixels: the sidebar's inner edge (scroll box minus its padding), every ordinary row's right edge,
 *  and for each split card its box, its outline's outer edge, its rows and close buttons, and whether its content overflows. */
const measure=()=>app.ui.evaluate(()=>{
 const shown=node=>node.getClientRects().length>0&&!node.closest('[hidden],[data-hidden],.sb-flip-ghost');
 const scroll=document.querySelector('.acira-sidebar .sb-scroll'),box=scroll.getBoundingClientRect(),inner=box.right-parseFloat(getComputedStyle(scroll).paddingRight);
 const siblings=[...document.querySelectorAll('.acira-sidebar .sb-tabs :is(.sb-tab,.sb-new-tab,.sb-group-header)')].filter(node=>shown(node)&&!node.closest('.sb-split-group')).map(node=>node.getBoundingClientRect().right);
 const cards=[...document.querySelectorAll('.acira-sidebar .sb-split-group')].filter(shown).map(card=>{const r=card.getBoundingClientRect(),style=getComputedStyle(card),outline=(parseFloat(style.outlineWidth)||0)+(parseFloat(style.outlineOffset)||0);
  const parts=[...card.querySelectorAll('.split-group-parent,.sb-tab')].filter(shown).map(node=>node.getBoundingClientRect().right),closes=[...card.querySelectorAll('.sb-tab-close,.sb-tab-solo')].filter(node=>shown(node)&&getComputedStyle(node).visibility!=='hidden').map(node=>node.getBoundingClientRect().right);
  const titles=[...card.querySelectorAll('.sb-tab-title,.split-group-open>span')].filter(shown).map(node=>({clip:getComputedStyle(node).overflow,over:node.scrollWidth>node.clientWidth}));
  // The card's own line (::after, inset 0) and the rows inside it: every row starts and ends inside the line.
  const lefts=[...card.querySelectorAll('.split-group-parent,.sb-tab')].filter(shown).map(node=>node.getBoundingClientRect().left);
  return {nested:!!card.dataset.nested,left:r.left,right:r.right,outlineRight:r.right+outline,partsRight:Math.max(...parts),partsLeft:Math.min(...lefts),closeRight:closes.length?Math.max(...closes):null,overflow:card.scrollWidth-card.clientWidth,titles};});
 // Group rows start right of the rail: the gap between the rail's right edge and each member row's left edge.
 const gaps=[...document.querySelectorAll('.acira-sidebar .sb-group-members')].filter(shown).flatMap(list=>{const rail=list.getBoundingClientRect().left+parseFloat(getComputedStyle(list,'::before').left)+parseFloat(getComputedStyle(list,'::before').width);return [...list.children].filter(node=>shown(node)&&node.matches('.sb-tab,.sb-split-group')).map(node=>node.getBoundingClientRect().left-rail);});
 const mirrors=document.querySelectorAll('.acira-sidebar .sb-split-group [data-split-mirror]').length;
 // A header's hover "+" never sits over its name (the name gives up the button's width whether or not it shows), and New tab stays one line.
 const adds=[...document.querySelectorAll('.acira-sidebar :is(.sb-split-group,.sb-group)>.sb-header-add')].filter(shown).map(add=>{const name=add.parentElement.querySelector(':scope>.split-group-parent .split-group-open>span,:scope>.sb-group-header>.sb-group-name');return name?add.getBoundingClientRect().left-name.getBoundingClientRect().right:null;}).filter(gap=>gap!==null);
 const newTab=document.querySelector('.acira-sidebar .sb-new-tab>span:nth-child(2)');
 return {gaps,mirrors,adds,newTabLines:newTab?Math.round(newTab.offsetHeight/18):1,inner,scrollRight:box.right,siblingRight:siblings.length?Math.max(...siblings):null,siblingSpread:siblings.length?Math.max(...siblings)-Math.min(...siblings):0,cards};
});
const check=(label,m)=>{
 if(!m.cards.length){note(false,`${label}: no split card on screen`);return;}
 if(m.gaps.length)note(Math.min(...m.gaps)>=5&&Math.max(...m.gaps)-Math.min(...m.gaps)<=1,`${label} group rows start right of the rail: gap ${Math.min(...m.gaps).toFixed(1)}–${Math.max(...m.gaps).toFixed(1)}px over ${m.gaps.length} rows`);
 note((!m.adds.length||Math.min(...m.adds)>=-.5)&&m.newTabLines<=1,`${label} header "+" clear of the names (gaps ${m.adds.map(gap=>gap.toFixed(1)).join(',')||'-'}), New tab on ${m.newTabLines} line`);
 for(const card of m.cards){
  const dr=Math.abs(card.right-m.siblingRight),fits=card.outlineRight<=m.inner+.5+8/* the scroll box padding is where the outline may draw */&&card.right<=m.inner+.5;
  const inside=card.partsRight<=card.right+.5&&card.partsLeft>=card.left-.5&&(card.closeRight===null||card.closeRight<=card.right+.5)&&card.overflow<=0;
  const clipped=card.titles.filter(title=>title.over&&title.clip==='visible').length;
  note(dr<=1&&fits&&inside&&!clipped,`${label} ${card.nested?'nested':'top-level'} card: right ${card.right.toFixed(1)} vs rows ${m.siblingRight?.toFixed(1)} (Δ${dr.toFixed(1)}), inner edge ${m.inner.toFixed(1)}, outline ${card.outlineRight.toFixed(1)}, rows ${card.partsLeft.toFixed(1)}–${card.partsRight.toFixed(1)}, buttons ${card.closeRight?.toFixed(1)??'-'}, overflow ${card.overflow}, unclipped long titles ${clipped}`);
 }
};
const guard=async()=>{if(await focused(app))focusSeen=true;};
const shot=async name=>{await pointer.move(1200,820);await sleep(450);await capture(app,path.join(out,name+'.png'));await guard();};
const step=async(name,fn)=>{try{await fn();}catch(error){note(false,`${name}: ${String(error.message||error).slice(0,240)}`);}};
const hoverHeader=async()=>{const hb=await settledBox(app,'.sb-split-group[data-nested] .split-group-open');await pointer.move(hb.x+hb.width/2,hb.y+hb.height/2);await sleep(300);};
try{
 app=await startInactive({root});pointer=mouse(app);
 note(!app.placed.focused&&!app.placed.focusable,`fixture window shown inactive off screen, unfocusable: ${JSON.stringify(app.placed)}`);
 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',interfaceScale:100,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});
 const first=(await app.state()).activeTabId;
 await app.act({type:'tab.navigate',url:`http://127.0.0.1:${site.port}/docs`});
 for(const page of ['long','news','maps','music'])await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/${page}`,background:true});
 const seeded=(await app.state()).tabs;const [b,c,d,e]=['long','news','maps','music'].map(page=>seeded.find(tab=>tab.url===`http://127.0.0.1:${site.port}/${page}`)?.id);if(![b,c,d,e].every(Boolean))throw Error('Fixture website IDs are missing');
 await app.act({type:'tab.group.create',tabId:b,name:'New group',color:'blue'});const g=(await app.state()).tabGroups[0].id;
 await app.act({type:'tab.group.assign',tabIds:[c],groupId:g});
 await app.act({type:'tab.select',id:b});await app.act({type:'split.open',tabIds:[b,c]});
 // A free split too (Maps + Music, both loose) and later a mixed one.
 await app.act({type:'tab.select',id:d});await app.act({type:'split.open',tabIds:[d,e]});await app.act({type:'tab.select',id:first});
 await app.ui.locator('.sb-split-group[data-nested]').waitFor({timeout:8000}).catch(async error=>{const s=await app.state();console.log(JSON.stringify({splits:s.windowUi.splitGroups,groups:s.tabGroups,tabs:s.tabs.map(tab=>[tab.id,tab.group,tab.url]),vertical:s.settings.verticalTabs,ui:s.windowUi.workspaceOpen,dom:await app.ui.evaluate(()=>({cards:document.querySelectorAll('.sb-split-group').length,tabs:document.querySelectorAll('.sb-tab').length,sidebar:!!document.querySelector('.acira-sidebar')}))}).slice(0,1500));throw error;});
 if(process.env.SPLITGROUP_MIXED_ONLY!=='1'){
 for(const [theme,scale,width] of [['dark',100,240],['light',100,240],['dark',100,220],['light',150,240],['dark',150,220],['dark',100,320]]){
  await step(`${theme} ${scale}% ${width}px`,async()=>{
   await app.act({type:'settings.update',patch:{appearance:theme,interfaceScale:scale,sidebarWidth:width}});await sleep(600);
   check(`${theme} ${scale}% ${width}px rest`,await measure());await shot(`fit-${theme}-${scale}-${width}`);
   // Hover and current: the nested card's header hovered, a pane current.
   const header=app.ui.locator('.sb-split-group[data-nested] .split-group-open');const hb=await header.boundingBox();await app.ui.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await sleep(250);
   check(`${theme} ${scale}% ${width}px hover`,await measure());
  if(process.env.SPLITGROUP_MIXED_ONLY!=='1'){
 // The split in the group carries a long name: it must end before the header's hover "+" at every width.
 await app.act({type:'split.rename',groupId:(await app.state()).windowUi.splitGroups.find(item=>item.tabIds.includes(b)).id,name:'Reading list for the quarterly review'});await sleep(300);
 // [appearance, interface scale, sidebar width (CSS px; 220 is the narrowest), window width (DIP; 900 is the smallest window)]
 for(const [theme,scale,width,windowWidth=1300] of [['dark',100,240],['light',100,240],['dark',100,220],['light',150,240],['dark',150,220],['light',150,220,900],['dark',150,320,900],['dark',100,220,900],['dark',100,320]]){
  const label=`${theme} ${scale}% ${width}px${windowWidth!==1300?` in a ${windowWidth}px window`:''}`;
  await step(label,async()=>{
   await app.main(({BaseWindow},width)=>{const window=BaseWindow.getAllWindows()[0],bounds=window.getBounds();if(bounds.width!==width)window.setBounds({...bounds,width});},windowWidth);
   await app.act({type:'settings.update',patch:{appearance:theme,interfaceScale:scale,sidebarWidth:width}});await sleep(700);
   const tag=`${theme}-${scale}-${width}${windowWidth!==1300?'-w'+windowWidth:''}`;
   check(`${label} rest`,await measure());await shot(`fit-${tag}`);
   // Hover: the nested card's header under the pointer (native mouse move).
   await hoverHeader();check(`${label} hover`,await measure());await capture(app,path.join(out,`fit-${tag}-hover.png`));
  });
 }
 await app.main(({BaseWindow})=>{const window=BaseWindow.getAllWindows()[0];window.setBounds({...window.getBounds(),width:1300});});
 await app.act({type:'settings.update',patch:{appearance:'dark',interfaceScale:100,sidebarWidth:240}});await sleep(500);
 await step('current pane',async()=>{await app.act({type:'split.group.select',id:(await app.state()).windowUi.splitGroups.find(item=>item.tabIds.includes(b)).id});await sleep(600);check('split shown (current + lit rows)',await measure());await shot('fit-dark-current');
  await hoverHeader();check('split shown, header hovered',await measure());});
 await step('fold motion',async()=>{
  // Sample every frame while the split folds and unfolds (its own disclosure), then while the group collapses and expands.
  const sample=async(label,act)=>{const frames=[];const t0=Date.now();await act();while(Date.now()-t0<700){frames.push(await measure());}
   const worst=frames.flatMap(frame=>frame.cards.map(card=>({d:Math.abs(card.right-frame.siblingRight),o:card.outlineRight-frame.inner-8,c:card.overflow}))).reduce((a,x)=>({d:Math.max(a.d,x.d),o:Math.max(a.o,x.o),c:Math.max(a.c,x.c)}),{d:0,o:-99,c:0});
   note(worst.d<=1&&worst.o<=.5&&worst.c<=0,`${label}: ${frames.length} samples, worst Δright ${worst.d.toFixed(1)}, worst outline past inner+padding ${worst.o.toFixed(1)}, worst overflow ${worst.c}`);};
  const id=(await app.state()).windowUi.splitGroups.find(item=>item.tabIds.includes(b)).id;
  await sample('split fold',()=>app.act({type:'split.group.toggle',id}));await sample('split unfold',()=>app.act({type:'split.group.toggle',id}));
  const header=`.sb-group-header[data-group-header="${g}"]`,press=async()=>{const hb=await settledBox(app,header);await pointer.click(hb.x+hb.width/3,hb.y+hb.height/2);};
  await sample('group collapse (split on screen)',press);await shot('fit-dark-group-collapsed');
  await sample('group expand',press);
 });
 }
 await step('mixed',async()=>{
  for(const split of (await app.state()).windowUi.splitGroups||[])await app.act({type:'split.unsplit',groupId:split.id});
  // Split placement follows global tab order, not pane order. Put the grouped anchor before the loose tab explicitly.
  await app.act({type:'tab.drop',from:b,to:d,position:'before',groupId:g});
  await app.act({type:'tab.select',id:b});await app.act({type:'split.open',tabIds:[b,d]});await sleep(600);
  // 28 Oct (no mirrors): the loose tab moves into the split's group; the card is the only place it shows.
  const m=await measure(),rowsOfD=await app.ui.evaluate(id=>[...document.querySelectorAll(`.acira-sidebar .sb-tab[data-tab-id="${id}"]`)].map(node=>!!node.closest('.sb-split-group')),d);
  check('mixed (group + loose)',m);note(m.mirrors===0&&rowsOfD.length===1&&rowsOfD[0],`Maps joined the group: one row, inside the card (${rowsOfD.join(',')}), no mirrors (${m.mirrors})`);
  await shot('fit-dark-mixed');await app.act({type:'settings.update',patch:{appearance:'light',interfaceScale:150,sidebarWidth:220}});await sleep(700);check('mixed light 150% 220px',await measure());await shot('fit-light-150-220-mixed');
  await app.act({type:'settings.update',patch:{language:'de'}});await sleep(700);check('mixed light 150% 220px German',await measure());await shot('fit-light-150-220-mixed-de');
  await app.act({type:'settings.update',patch:{language:'en',interfaceScale:100,appearance:'dark'}});
 });
 await guard();note(!focusSeen,`the fixture never held focus (checked at every capture)`);
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result.txt'),rows.join('\n')+'\n');console.log(`evidence: ${out}`);
}

if(rows.some(row=>row.startsWith('FAIL')))process.exitCode=1;
