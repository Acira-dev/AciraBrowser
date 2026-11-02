// Founder regression (29 Oct): a split pane that came from Google's sign-in (a tab a page opened with window.open and then closed with
// window.close()) left a tab whose page was gone. Everything in main that walks the pages then threw, so the pane rows and the card header
// "glitched": the click changed the state in main but the interface never heard (commitAction broadcasts last).
// This rig makes that tab (a page opens a child, the child closes itself), puts it in a split with a second page — in both orders: the child
// closing while the split is on screen, and the split made after it closed — and clicks the rows and the header with native input
// (webContents.sendInputEvent on the interface view). Checks: no error from main, the tab is gone from tabs and splits (not left dead), and
// every click lands (the interface sees the new state). Isolated profile under .qa-profiles, inactive off-screen window, one native slot.
// Usage: npx tsx qa/split-dead-pane.mjs   (SPLIT_DEAD_EVIDENCE, default C:/ae/r3/split-click/dead)
import fs from 'node:fs/promises';
import path from 'node:path';
import {httpFixture,sleep,poll} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';
import {startInactive,mouse,settledBox} from './split-native.mjs';

const out=process.env.SPLIT_DEAD_EVIDENCE||'C:/ae/r3/split-click/dead',root=`.qa-profiles/splitdead-${Date.now()}`,rows=[];
await fs.mkdir(out,{recursive:true});
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
// "/" opens a child with window.open (keeps window.opener, so Acira adopts the window as a tab); "/child" closes itself after ?t ms like a sign-in page.
const site=await httpFixture((request,response)=>{const url=new URL(request.url,'http://x'),name=url.pathname.slice(1)||'opener';response.writeHead(200,{'content-type':'text/html'});
 const body=name==='opener'?'<button id="open" onclick="window.open(\'/child?t=\'+(window.__t||1800))">open</button>':name==='child'?`<script>setTimeout(()=>window.close(),${Number(url.searchParams.get('t'))||1800})</script>`:'';
 response.end(`<title>${name==='child'?'Gmail':name[0].toUpperCase()+name.slice(1)}</title><body style="font:16px system-ui;padding:24px">${name}${body}</body>`);});
const release=await takeSlot('split-dead-pane');
let app,pointer;
const shot=async name=>{await Promise.race([app.ui.screenshot({path:path.join(out,name+'.png')}),sleep(6000)]).catch(()=>{});};
const rowSel=id=>`.acira-sidebar .sb-tab[data-tab-id="${id}"] .sb-tab-main`;
const soloSel=id=>`.acira-sidebar .sb-split-group .sb-tab[data-tab-id="${id}"] .sb-tab-solo`;
const press=async selector=>{const b=await settledBox(app,selector);await pointer.click(b.x+Math.min(60,b.width/2),b.y+b.height/2);await sleep(800);};
const mainErrors=()=>app.logs.join('').split(/\r?\n/).filter(line=>/TypeError|ReferenceError|Cannot read propert|has been destroyed|Object has been destroyed|Uncaught/.test(line)&&!/DevTools|devtools/.test(line));
const opener=()=>app.web(url=>url.startsWith(`http://127.0.0.1:${site.port}/`)&&!/\/(child|yt|mail)/.test(url));
async function scenario(label,{splitFirst}){
 const base=`http://127.0.0.1:${site.port}`;
 await app.act({type:'tab.navigate',url:base+'/'});await sleep(700);
 const home=(await app.state()).activeTabId;
 await app.act({type:'tab.new',url:base+'/yt',background:true});await sleep(700);
 const yt=(await app.state()).tabs.find(tab=>tab.url.endsWith('/yt')).id;
 const page=await poll(opener,Boolean,'opener page',8000);
 await page.evaluate(ms=>{window.__t=ms;},splitFirst?5200:1500);
 await page.click('#open');
 const child=await poll(async()=>(await app.state()).tabs.find(tab=>tab.url.includes('/child'))?.id,Boolean,'child tab',8000);
 note(!!child,`${label}: the sign-in style child opened as a tab (adopted window)`);
 if(splitFirst){await app.act({type:'split.open',tabIds:[child,yt]});await sleep(700);}
 // The child closes itself (window.close()).
 await sleep(splitFirst?5600:2600);
 let s=await app.state();const left=s.tabs.some(tab=>tab.id===child);
 note(!left,`${label}: the tab its page closed is gone from the tab list (left ${left})`);
 note(!(s.windowUi.splitGroups||[]).some(g=>g.tabIds.includes(child))&&!s.windowUi.split?.tabIds?.includes(child),`${label}: and from every split`);
 // The split the dead tab was in (if it is still there, the founder's state) or, once it is gone, a split of two live pages: row clicks and the
 // header must land (the interface must hear each new state).
 await app.act({type:'tab.select',id:home});
 s=await app.state();let g=(s.windowUi.splitGroups||[]).find(item=>item.tabIds.includes(yt)&&item.tabIds.length>1);
 if(!g){await app.act({type:'split.open',tabIds:[home,yt]});await sleep(900);s=await app.state();g=s.windowUi.splitGroups.find(item=>item.tabIds.includes(yt));}
 const other=g.tabIds.find(id=>id!==yt);
 await app.act({type:'split.group.select',id:g.id});await sleep(700);
 await press(rowSel(yt));let v=await app.state();note(v.activeTabId===yt&&v.windowUi.split?.groupId===g.id,`${label}: a pane row click selects it (active ${v.activeTabId===yt}, split shown ${v.windowUi.split?.groupId===g.id})`);
 await press(soloSel(yt));v=await app.state();note(v.activeTabId===yt&&!v.windowUi.split,`${label}: Open alone shows YouTube by itself`);
 await press(rowSel(other));v=await app.state();note(v.activeTabId===other&&v.windowUi.split?.groupId===g.id,`${label}: alone, then the other pane row (${other===child?'the dead tab':'a live page'}) brings the split back, focused on it`);
 await press(rowSel(yt));await press(soloSel(yt));await press(`.acira-sidebar .sb-split-group[data-split-container="${g.id}"] .split-group-open`);v=await app.state();
 note(v.windowUi.split?.groupId===g.id,`${label}: alone, then the card header brings the split back`);
 const errors=mainErrors();note(errors.length===0,`${label}: no error from main${errors.length?': '+errors.slice(0,3).join(' | ').slice(0,300):''}`);
 await shot(label);
 await app.act({type:'split.unsplit',groupId:g.id});await sleep(400);
}
/** Any other way a pane's page goes away behind Acira's back (its contents destroyed while its tab stays): the page entry must not stay as a view with no contents. */
async function destroyedPane(){
 const base=`http://127.0.0.1:${site.port}`;
 await app.act({type:'tab.navigate',url:base+'/mail'});await sleep(600);const home=(await app.state()).activeTabId;
 await app.act({type:'tab.new',url:base+'/gone',background:true});await sleep(800);const gone=(await app.state()).tabs.find(tab=>tab.url.endsWith('/gone')).id;
 await app.act({type:'split.open',tabIds:[home,gone]});await sleep(800);
 const closed=await app.main(({webContents})=>{const wc=webContents.getAllWebContents().find(item=>item.getURL().endsWith('/gone'));if(!wc)return false;wc.close({waitForBeforeUnload:false});return true;});
 note(closed,'destroyed pane: the page of one split pane is destroyed behind the browser back');await sleep(1200);
 const g=(await app.state()).windowUi.splitGroups.find(item=>item.tabIds.includes(home))?.id;
 // Any dispatch walks the pages; the one a click on a row makes must reach the interface.
 await app.act({type:'tab.select',id:home,individual:true});await sleep(500);
 let s=await app.state();note(s.activeTabId===home,'destroyed pane: a dispatch after it still returns and the interface hears it (the old code threw in main)');
 await sleep(900);s=await app.state();
 note(!s.tabs.some(tab=>tab.id===gone)&&!(s.windowUi.splitGroups||[]).some(item=>item.tabIds.includes(gone)),'destroyed pane: its tab is closed and gone from every split (treated as a closed pane)');
 const errors=mainErrors();note(errors.length===0,'destroyed pane: no error from main'+(errors.length?': '+errors.slice(0,3).join(' | ').slice(0,300):''));
}
try{
 app=await startInactive({root});pointer=mouse(app);
 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',interfaceScale:100,sidebarWidth:260,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});
 for(const [name,run] of [['closed-before-split',()=>scenario('closed-before-split',{splitFirst:false})],['closed-inside-split',()=>scenario('closed-inside-split',{splitFirst:true})],['destroyed pane',destroyedPane]]){
  if(process.env.ONLY==='destroyed'&&name!=='destroyed pane')continue;
  // A main that throws makes the dispatch reject: that is a failed check, not a crashed rig.
  try{await run();}catch(error){note(false,`${name}: ${String(error.message).split(String.fromCharCode(10))[0].slice(0,260)}`);}
 }
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result.txt'),rows.join('\n')+'\n');console.log(`evidence: ${out}`);
}
