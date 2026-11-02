// Peek → "Open in split view" → close the peeked pane by every route; record which tab actually closes and what the window shows after.
// Also the reverse (close the original), Peek "Open as tab", and a split made from the tab menu (no regression).
// node qa/peek-split-close.mjs [--shots dir]   Profile under .qa-profiles (junction to an isolated dir); takes a native slot C:\ae\slot-N.lock.
// The window stays off-screen and never takes focus or the mouse: every press is synthetic (CDP / sendInputEvent).
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
process.env.D_VISIBLE='1';
const shots=process.argv.includes('--shots')?path.resolve(process.argv[process.argv.indexOf('--shots')+1]):null;
const SLOTS=['C:\\ae\\slot-1.lock','C:\\ae\\slot-2.lock','C:\\ae\\slot-3.lock'];
async function takeSlot(){for(let round=0;round<40;round++){for(const file of SLOTS){try{const h=await fs.open(file,'wx');await h.writeFile(`peeksplit ${new Date().toISOString()}`);await h.close();return file;}catch{}}await sleep(30000);}throw Error('no native slot free');}
const slot=await takeSlot();
const rows=[];let failed=0;
const site=await httpFixture((req,res)=>{const n=req.url.replace(/\W/g,'')||'root';res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><title>${n}</title><body style="margin:0;height:100vh;display:grid;place-items:center;font:30px system-ui;background:${n.startsWith('peek')?'#dfe9f6':n.startsWith('src')?'#f6efe2':'#e8f3e4'}"><a id="go" href="/deeper">${n}</a>`);});
const base=`http://127.0.0.1:${site.port}`;
let t;
try{
 t=await startApp({root:`.qa-profiles/peeksplit-${Date.now()}`});
 await t.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];w.setFocusable(false);w.setIgnoreMouseEvents(true);w.setSkipTaskbar(true);w.setBounds({x:-20000,y:-20000,width:1500,height:960});});
 await t.act({type:'settings.update',patch:{reducedMotion:true,verticalTabs:true}});
 const firstTab=(await t.state()).activeTabId;
 await t.act({type:'tab.navigate',tabId:firstTab,url:`${base}/start`});
 const urlOf=(s,id)=>s.tabs.find(x=>x.id===id)?.url||'';
 const short=u=>u.replace(base,'');
 // The WebContents showing a URL (pages and peek views alike), by suffix.
 const wcAction=(suffix,what)=>t.main(({webContents},[suffix,what])=>{const wc=webContents.getAllWebContents().find(c=>{try{return c.getURL().endsWith(suffix);}catch{return false;}});if(!wc)return 'none';if(what==='focus'){wc.focus();return 'ok';}if(what==='ctrlw'){for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'W',modifiers:['control']});return 'ok';}return 'none';},[suffix,what]);
 const focusedKey=()=>t.main(({webContents})=>{const wc=webContents.getFocusedWebContents();if(!wc)return {url:'(none)'};for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'W',modifiers:['control']});return {url:wc.getURL()};});
 const chromeKey=()=>t.main(({webContents})=>{const wc=webContents.getAllWebContents().find(c=>c.getURL()==='acira-browser-ui://ui/index.html');for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'W',modifiers:['control']});return 'ok';});
 const peekTop=()=>t.main(({BaseWindow})=>BaseWindow.getAllWindows()[0].contentView.children.at(-1)?.webContents?.getURL?.()||'');
 // Own window only, composed from its views (capturePage paints each one even off-screen), in their z-order.
 async function capture(name){if(!shots)return;await fs.mkdir(shots,{recursive:true});
  const layers=await t.main(async({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];const [cw,ch]=w.getContentSize();const out=[];for(const v of w.contentView.children){if(!v.webContents||v.getVisible?.()===false)continue;const b=v.getBounds();if(b.width<2||b.height<2)continue;try{const img=await v.webContents.capturePage();out.push({b,url:img.toDataURL()});}catch{}}return {cw,ch,out};});
  const b64=await t.ui.evaluate(async({cw,ch,out})=>{const c=document.createElement('canvas');c.width=cw;c.height=ch;const g=c.getContext('2d');for(const l of out){const img=new Image();img.src=l.url;await img.decode();g.drawImage(img,l.b.x,l.b.y,l.b.width,l.b.height);}return c.toDataURL('image/png').split(',')[1];},layers);
  await fs.writeFile(path.join(shots,name+'.png'),Buffer.from(b64,'base64'));}
 // Fresh trio per case: S (the page the peek comes from), R (a tab right of S), then the peek lands between them as F.
 let n=0;
 async function trio(){n++;await t.act({type:'split.close'});await t.act({type:'tab.new',url:`${base}/src${n}`});const s0=await t.state();const S=s0.activeTabId;await t.act({type:'tab.new',url:`${base}/right${n}`,background:true,afterId:S});const R=(await t.state()).tabs.find(x=>x.url.endsWith(`/right${n}`)).id;await poll(()=>t.web(u=>u.endsWith(`/src${n}`)),Boolean,'src page');return {S,R};}
 async function peekSplit(viaButton=true){const {S,R}=await trio();await sleep(300);
  await t.ui.evaluate(url=>window.acira.peek({type:'peek.open',url}),`${base}/peek${n}`);await poll(peekTop,u=>u.endsWith(`/peek${n}`),'peek open',10000);
  if(viaButton){const frame=await poll(()=>t.context.pages().find(p=>{try{return p.url().endsWith('peek-frame.html');}catch{return false;}}),Boolean,'peek frame');await frame.locator('#split').click();}
  else await t.ui.evaluate(()=>window.acira.peek({type:'peek.split'}));
  const s=await poll(t.state,s=>s.windowUi.split?.tabIds.length===2,'split open',8000);const F=s.windowUi.split.tabIds.find(id=>id!==S);
  await sleep(500);return {S,R,F,s};}
 async function record(route,target,keep,{S,R,F,s},act,expect={}){
  const before=s.tabs.map(x=>x.id),activeBefore=s.activeTabId;
  await act();await sleep(900);const after=await t.state();
  const closed=before.filter(id=>!after.tabs.some(x=>x.id===id)),gone=closed.length?closed:(s.windowUi.split?.tabIds||[]).filter(id=>!after.windowUi.split?.tabIds?.includes(id)&&id!==after.activeTabId);
  const name=id=>id===S?'original':id===F?'peeked':id===R?'neighbour':id;
  const shown=after.windowUi.split?`split ${after.windowUi.split.tabIds.map(name).join('+')}`:short(urlOf(after,after.activeTabId));
  const ok=(expect.closes===undefined?closed.length===1&&closed[0]===target:JSON.stringify(closed)===JSON.stringify(expect.closes))&&after.activeTabId===keep&&!after.windowUi.split;
  if(!ok)failed++;
  rows.push({route,acted:name(target),activeBefore:name(activeBefore),closed:closed.map(name).join(',')||'(none; left split)',activeAfter:name(after.activeTabId),shown,ok});
  console.log(`${ok?'ok  ':'FAIL'} ${route}: acted on ${name(target)}; active before ${name(activeBefore)}; closed ${closed.map(name).join(',')||'none'}; now showing ${shown}`);
  await capture(route.replace(/\W+/g,'-'));
  for(const id of [S,R,F])if((await t.state()).tabs.some(x=>x.id===id))await t.act({type:'tab.close',id});
 }
 const ribbonX=id=>t.ui.locator(`.page-pane[data-pane="${id}"] .split-label-close`).click();
 // 1. The pane ribbon's ×: the peeked pane leaves (2 panes: "Close split view", tab kept) and the original page remains on screen.
 {const c=await peekSplit();await capture('split-open');await record('pane ribbon x (peeked pane)',c.F,c.S,c,()=>ribbonX(c.F),{closes:[]});}
 // 2. Ctrl+W right after clicking the frame's "Open in split view" (keys go wherever focus is).
 {const c=await peekSplit();let where;await record('Ctrl+W right after Open in split view',c.F,c.S,c,async()=>{where=await focusedKey();});rows.at(-1).route+=` (focus: ${short(where.url)})`;console.log("   focus was in "+where.url);}
 // 3. Ctrl+W with the peeked pane focused.
 {const c=await peekSplit();await record('Ctrl+W, peeked pane focused',c.F,c.S,c,async()=>{await wcAction(`/peek${n}`,'focus');await sleep(200);await wcAction(`/peek${n}`,'ctrlw');});}
 // 4. Ctrl+W from the toolbar (close current tab).
 {const c=await peekSplit();await record('Ctrl+W from the toolbar (close current)',c.F,c.S,c,()=>chromeKey());}
 // 5. Sidebar row × and middle-click.
 {const c=await peekSplit();await record('sidebar row x',c.F,c.S,c,async()=>{await t.ui.locator(`.sb-tabs .sb-tab[data-tab-id="${c.F}"] .sb-tab-main`).hover();await sleep(150);await t.ui.locator(`.sb-tabs .sb-tab[data-tab-id="${c.F}"] .sb-tab-close`).click({force:true});});}
 {const c=await peekSplit();await record('sidebar row middle-click',c.F,c.S,c,()=>t.ui.locator(`.sb-tabs .sb-tab[data-tab-id="${c.F}"] .sb-tab-main`).click({button:'middle'}));}
 // 6. The strip: ×, middle-click, context menu "Close tab".
 await t.act({type:'settings.update',patch:{verticalTabs:false}});await sleep(600);
 // A split shows in the strip as its group; its members appear once the group is opened (disclosure).
 const stripTab=async id=>{const own=t.ui.locator(`.tabs-strip .browser-tab[data-tab-id="${id}"]`);if(!await own.count()){const open=t.ui.locator('.tabs-strip .split-group-disclosure');if(await open.count()){await open.first().click();await sleep(400);}}
  if(!await own.count())console.log('   strip has: '+JSON.stringify(await t.ui.evaluate(()=>[...document.querySelectorAll('.tabs-strip [data-tab-id], .tabs-strip [class*=split-group]')].map(n=>n.className+'|'+(n.dataset.tabId||'')).slice(0,12))));return own;};
 {const c=await peekSplit();await record('strip tab x',c.F,c.S,c,async()=>{const tab=await stripTab(c.F);await tab.hover();await sleep(150);await tab.locator('.tab-close, .standard-tab-icon-close').first().click({force:true});});}
 {const c=await peekSplit();await record('strip tab middle-click',c.F,c.S,c,async()=>(await stripTab(c.F)).click({button:'middle'}));}
 {const c=await peekSplit();await record('tab context menu > Close tab',c.F,c.S,c,async()=>{await (await stripTab(c.F)).click({button:'right'});const menu=await poll(async()=>{for(const p of t.context.pages()){try{const item=p.getByRole('menuitem',{name:/^Close tab/});if(await item.count())return item.first();}catch{}}return null;},Boolean,'context menu',4000).catch(()=>null);if(menu)await menu.click();else{console.log('   (menu surface not reachable from the driver: sending its Close tab action)');await t.ui.keyboard.press('Escape');await t.act({type:'tab.close',id:c.F});}});}
 await t.act({type:'settings.update',patch:{verticalTabs:true}});await sleep(400);
 // 7. The reverse: closing the original leaves the peeked page.
 {const c=await peekSplit();await record('pane ribbon x (original pane)',c.S,c.F,c,()=>ribbonX(c.S),{closes:[]});}
 {const c=await peekSplit();await record('Ctrl+W, original pane focused',c.S,c.F,c,async()=>{await wcAction(`/src${n}`,'focus');await sleep(200);await wcAction(`/src${n}`,'ctrlw');});}
 // 8. Keyboard Ctrl+Shift+Enter promotion, then Ctrl+W where focus is.
 {const c=await peekSplit(false);await record('peek.split (Ctrl+Shift+Enter) then Ctrl+W',c.F,c.S,c,async()=>{await focusedKey();});}
 // 9. Peek "Open as tab", then Ctrl+W: the peeked tab closes and the original comes back.
 {const {S,R}=await trio();await t.ui.evaluate(url=>window.acira.peek({type:'peek.open',url}),`${base}/peek${n}`);await poll(peekTop,u=>u.endsWith(`/peek${n}`),'peek open',10000);
  const frame=await poll(()=>t.context.pages().find(p=>{try{return p.url().endsWith('peek-frame.html');}catch{return false;}}),Boolean,'peek frame');await frame.locator('#tab').click();
  const s=await poll(t.state,s=>s.tabs.find(x=>x.id===s.activeTabId)?.url.endsWith(`/peek${n}`),'promoted tab active',8000);const F=s.activeTabId;await sleep(400);
  await record('Open as tab, then Ctrl+W',F,S,{S,R,F,s},async()=>{await focusedKey();});}
 // 10. A split made from the tab menu / picker (no regression): ribbon × and Ctrl+W on the second pane.
 for(const [route,how] of [['menu split: ribbon x (second pane)','ribbon'],['menu split: Ctrl+W (second pane focused)','key'],['menu split: sidebar x (second pane)','sidebar']]){
  const {S,R}=await trio();await sleep(300);await t.act({type:'split.open',tabIds:[S,R]});const s=await poll(t.state,s=>s.windowUi.split?.tabIds.length===2,'menu split');await sleep(400);
  await record(route,R,S,{S,R,F:'-',s},async()=>{if(how==='ribbon')await ribbonX(R);else if(how==='key'){await wcAction(`/right${n}`,'focus');await sleep(200);await wcAction(`/right${n}`,'ctrlw');}else{await t.ui.locator(`.sb-tabs .sb-tab[data-tab-id="${R}"] .sb-tab-main`).hover();await sleep(150);await t.ui.locator(`.sb-tabs .sb-tab[data-tab-id="${R}"] .sb-tab-close`).click({force:true});}},how==='ribbon'?{closes:[]}:{});
 }
 if(shots)await fs.writeFile(path.join(shots,'routes.json'),JSON.stringify(rows,null,1));
 console.log('\n| Route | Acted on | Active before | Closed | Active after | Window shows | OK |\n|---|---|---|---|---|---|---|');
 for(const r of rows)console.log(`| ${r.route} | ${r.acted} | ${r.activeBefore} | ${r.closed} | ${r.activeAfter} | ${r.shown} | ${r.ok?'yes':'NO'} |`);
 console.log(failed?`\n${failed} route(s) wrong`:'\nall routes correct');
 if(failed)process.exitCode=1;
}finally{try{await t?.close();}catch{}try{await site.close();}catch{}await fs.unlink(slot).catch(()=>{});}
