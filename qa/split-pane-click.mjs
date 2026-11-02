// Regression rig (29 Oct): in a sidebar split card, a click on a pane row shows that pane's split focused on it, and a click on the
// card header (or the pane's Show split view button) brings the split back after a pane was opened alone. Real native input
// (webContents.sendInputEvent mouseDown/mouseUp on the interface view), an inactive off-screen window, isolated profile, one native
// slot. Plain split (never opened alone) and the Open-alone round trip, loose and inside a tab group.
// Usage: npx tsx qa/split-pane-click.mjs   (SPLIT_CLICK_EVIDENCE, default C:/ae/r3/split-click/evidence)
import fs from 'node:fs/promises';
import path from 'node:path';
import {httpFixture,sleep} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';
import {startInactive,mouse,settledBox} from './split-native.mjs';

const out=process.env.SPLIT_CLICK_EVIDENCE||'C:/ae/r3/split-click/evidence',root=`.qa-profiles/splitclick-${Date.now()}`,rows=[];
await fs.mkdir(out,{recursive:true});
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
// Pages that behave like the founder's: Gmail changes its title all the time (unread count), YouTube plays sound, both keep the state moving.
const site=await httpFixture((request,response)=>{const name=request.url.slice(1)||'docs';response.writeHead(200,{'content-type':'text/html'});
 const live=name==='mail'?'let n=0;setInterval(()=>{document.title="Inbox ("+(n++%9)+") - Mail";},150);':name==='news'?'const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=.02;osc.connect(gain).connect(ctx.destination);osc.start();ctx.resume();':'';
 response.end(`<title>${name[0].toUpperCase()+name.slice(1)}</title><body style="font:16px system-ui;padding:24px">${name}<script>${live}</script></body>`);});
const release=await takeSlot('split-pane-click');
let app,pointer;
const shot=async name=>{await Promise.race([app.ui.screenshot({path:path.join(out,name+'.png')}),sleep(6000)]).catch(()=>{});};
/** The point a native click should hit: the middle of the row's title button / the card header's open button, once settled. */
const at=async selector=>{const b=await settledBox(app,selector);return {x:b.x+Math.min(60,b.width/2),y:b.y+b.height/2};};
/** A hand: glide in from the page side, rest on the row (hover state: marquee, hover buttons), press, a pixel of jitter, release. */
const press=async selector=>{const p=await at(selector);await pointer.move(p.x+90,p.y-30);await pointer.glide(p.x,p.y,10,16);await sleep(Number(process.env.HOVER_MS)||350);await pointer.down(p.x,p.y);await sleep(70);await pointer.move(p.x+1,p.y);await pointer.up(p.x+1,p.y);await sleep(750);};
const rowSel=id=>`.acira-sidebar .sb-split-group .sb-tab[data-tab-id="${id}"] .sb-tab-main`;
const soloSel=id=>`.acira-sidebar .sb-split-group .sb-tab[data-tab-id="${id}"] .sb-tab-solo`;
const headerSel=id=>`.acira-sidebar .sb-split-group[data-split-container="${id}"] .split-group-open`;
const view=async()=>{const s=await app.state();return {active:s.activeTabId,shown:s.windowUi.split?.tabIds??null,group:s.windowUi.split?.groupId??null};};
const current=()=>app.ui.evaluate(()=>[...document.querySelectorAll('.acira-sidebar .sb-tabs .sb-tab[aria-current="true"]')].filter(node=>node.getClientRects().length).map(node=>node.dataset.tabId)).then(ids=>[...new Set(ids)]);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function round(label,mail,news,split){
 // Plain: the split is on screen; a click on each pane row leaves it on screen, focused on that pane.
 for(const id of [news,mail,news]){
  await press(rowSel(id));const v=await view(),c=await current();
  note(v.active===id&&v.group===split&&same(c,[id]),`${label}: click a pane row (native) -> active ${v.active===id}, split shown ${v.group===split}, one current row ${JSON.stringify(c)}`);
 }
 // Open alone on the news pane, then a click on the OTHER pane row brings the split back focused on it.
 await press(rowSel(news));await press(soloSel(news));let v=await view();
 note(v.active===news&&v.group===null,`${label}: Open alone shows the pane by itself (active ${v.active===news}, split shown ${v.group})`);
 await shot(`${label}-1-news-alone`);
 await press(rowSel(mail));v=await view();let c=await current();
 note(v.active===mail&&v.group===split&&same(c,[mail]),`${label}: alone, then click the other pane row -> split back, focused on it (active ${v.active===mail}, split shown ${v.group===split}, current ${JSON.stringify(c)})`);
 // Alone again, then the card header.
 await press(rowSel(news));await press(soloSel(news));v=await view();
 note(v.active===news&&v.group===null,`${label}: alone again (active ${v.active===news}, split shown ${v.group})`);
 await press(headerSel(split));v=await view();c=await current();
 note(v.group===split&&v.active===news&&same(c,[news]),`${label}: alone, then click the card header -> split back (split shown ${v.group===split}, active stays ${v.active===news}, current ${JSON.stringify(c)})`);
 // Alone, then the pane's own Show split view button, and the pane row itself.
 await press(soloSel(news));v=await view();
 await press(soloSel(news));v=await view();
 note(v.group===split&&v.active===news,`${label}: Open alone, then Show split view -> back (split shown ${v.group===split})`);
 await press(soloSel(news));await press(rowSel(news));v=await view();
 note(v.group===split&&v.active===news,`${label}: alone, then click the pane's own row -> split back (split shown ${v.group===split})`);
 await shot(`${label}-2-final`);
}
try{
 app=await startInactive({root});pointer=mouse(app);
 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',interfaceScale:100,sidebarWidth:260,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});
 await app.act({type:'tab.navigate',url:`http://127.0.0.1:${site.port}/docs`});
 for(const page of ['mail','news','maps','extra'])await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/${page}`,background:true});
 await sleep(900);const opened=(await app.state()).tabs,id=name=>opened.find(tab=>(tab.url||'').endsWith('/'+name)).id;
 const [docs,mail,news,maps,extra]=['docs','mail','news','maps','extra'].map(id);
 // A loose split (Gmail + YouTube in the founder's report).
 await app.act({type:'tab.select',id:mail});await app.act({type:'split.open',tabIds:[mail,news]});await sleep(900);
 let s=await app.state();const loose=s.windowUi.splitGroups.find(item=>item.tabIds.includes(mail)).id;
 await round('loose',mail,news,loose);
 // The same inside a tab group.
 await app.act({type:'tab.group.create',tabId:maps,name:'Research',color:'blue'});const g=(await app.state()).tabGroups.find(item=>item.name==='Research').id;
 await app.act({type:'tab.group.assign',tabIds:[extra],groupId:g});await app.act({type:'tab.select',id:maps});
 await app.act({type:'split.open',tabIds:[maps,extra]});await sleep(900);
 s=await app.state();const grouped=s.windowUi.splitGroups.find(item=>item.tabIds.includes(maps)).id;
 await round('grouped',maps,extra,grouped);
 // A grouped tab dropped on a loose split is also a pane of it (linked copy): the card lists a second row for it.
 await app.act({type:'tab.select',id:docs});await app.act({type:'split.open',tabIds:[docs,mail]});await sleep(700);
 s=await app.state();const looseTwo=s.windowUi.splitGroups.find(item=>item.tabIds.includes(docs)).id;
 await app.act({type:'tab.group.create',tabId:news,name:'Leisure',color:'green'});
 await app.act({type:'split.group.add',id:looseTwo,tabId:news});await sleep(900);
 s=await app.state();note(s.windowUi.splitGroups.find(item=>item.id===looseTwo)?.linked?.includes(news),'linked: News (in Leisure) is a linked copy in the loose split');
 await round('linked',docs,news,looseTwo);
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result.txt'),rows.join('\n')+'\n');console.log(`evidence: ${out}`);
}
