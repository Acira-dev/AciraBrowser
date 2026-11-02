// Stream H QA: multi-pane split internals in the real app. Two, three and four panes; each layout's native views sit exactly on
// their panes; the edge and the shared corner resize by drag and by keys; closing a member keeps the rest. Local pages only, one
// Electron instance (closed in finally), ≤ 6 tabs.   node qa/h-split-panes.mjs [--shots dir]   (D_VISIBLE=1 recommended)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const colors={one:'#e8f0fe',two:'#fce8e6',three:'#e6f4ea',four:'#fef7e0'};
const site=await httpFixture((req,res)=>{const n=req.url.slice(1);res.writeHead(200,{'content-type':'text/html'});res.end(`<title>${n}</title><body style="margin:0;background:${colors[n]||'#fff'};font:24px system-ui;display:grid;place-items:center;height:100vh">${n} <a id="more" href="/five" style="font-size:16px">five</a> <a id="peek" href="/six" style="font-size:16px">six</a>`);});
const base=`http://127.0.0.1:${site.port}`;
const t=await startApp({root:path.resolve(`.qa-profiles/h-split-panes-${Date.now()}`)});
async function capture(name){if(!shots)return;await fs.mkdir(shots,{recursive:true});await sleep(500);const png=await t.main(async({BaseWindow,desktopCapturer})=>{const w=BaseWindow.getAllWindows()[0];const [cw,ch]=w.getSize();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:cw,height:ch}});const s=sources.find(x=>x.id===w.getMediaSourceId());return s?s.thumbnail.toPNG().toString('base64'):'';});if(png)await fs.writeFile(path.join(shots,`${name}.png`),Buffer.from(png,'base64'));}
/** Native view bounds per tab vs each pane's DOM box (window coordinates at 100% interface scale). */
async function fit(label){
 await sleep(500);
 const panes=await t.ui.evaluate(()=>[...document.querySelectorAll('.page-pane')].map(n=>{const r=n.getBoundingClientRect(),h=n.querySelector('.split-label')?.offsetHeight||0;return {x:Math.round(r.left),y:Math.round(r.top+h),w:Math.round(r.width),h:Math.round(r.height-h)};}));
 const views=await t.main(({BaseWindow})=>BaseWindow.getAllWindows()[0].contentView.children.map(v=>{try{const u=v.webContents.getURL();return /127\.0\.0\.1/.test(u)&&v.getVisible()?{u,...v.getBounds()}:null;}catch{return null;}}).filter(Boolean));
 const ok=panes.length===views.length&&panes.every(p=>views.some(v=>Math.abs(v.x-p.x)<=2&&Math.abs(v.y-p.y)<=2&&Math.abs(v.width-p.w)<=2&&Math.abs(v.height-p.h)<=2));
 check(ok,`${label}: ${views.length} website views sit on their ${panes.length} panes${ok?'':` ${JSON.stringify({panes,views})}`}`);return {panes,views};
}
try{
 await t.main(({BaseWindow})=>{for(const w of BaseWindow.getAllWindows())w.setBounds({x:40,y:40,width:1500,height:960});});
 const first=(await t.state()).activeTabId;await t.act({type:'tab.navigate',tabId:first,url:`${base}/one`});
 for(const n of ['two','three','four'])await t.act({type:'tab.new',url:`${base}/${n}`,background:true});
 let s=await poll(t.state,s=>s.tabs.length===4,'four tabs');const [a,b,c,d]=s.tabs.map(x=>x.id);
 await t.act({type:'tab.select',id:a});
 await t.act({type:'split.open',tabIds:[a,b]});await poll(t.state,s=>s.windowUi.split?.layout==='columns','two panes');await fit('side by side');
 await t.act({type:'split.layout',layout:'rows'});await fit('top and bottom');
 await t.act({type:'split.add',tabId:c});s=await poll(t.state,s=>s.windowUi.split?.tabIds.length===3,'three panes');check(s.windowUi.split.layout==='three-columns','a third tab makes three columns');await fit('three columns');
 for(const layout of ['top-two-bottom-one','left-one-right-two']){await t.act({type:'split.layout',layout});await fit(layout);}
 await capture('split-three');
 await t.act({type:'split.add',tabId:d,layout:'grid'});await poll(t.state,s=>s.windowUi.split?.layout==='grid','grid');await fit('2x2 grid');
 // Drag the shared corner: both edges follow; the views follow the panes.
 const corner=await t.ui.locator('.split-handle[data-kind=corner]').boundingBox();check(Boolean(corner),'the 2x2 grid has a shared corner handle');
 await t.ui.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await t.ui.mouse.down();await t.ui.mouse.move(corner.x+corner.width/2-150,corner.y+corner.height/2+90,{steps:8});await t.ui.mouse.up();
 s=await poll(t.state,s=>s.windowUi.split.cols[0]<.45&&s.windowUi.split.rows[0]>.55,'corner moved',5000).catch(()=>t.state());
 check(s.windowUi.split.cols[0]<.45&&s.windowUi.split.rows[0]>.55,`dragging the corner moves both edges (cols ${s.windowUi.split.cols}, rows ${s.windowUi.split.rows})`);
 await fit('after the corner drag');await capture('split-grid');
 // Keys on an edge: Right widens the left column, Home evens it.
 const before=s.windowUi.split.cols[0];await t.ui.locator('.split-handle[data-kind=col]').focus();await t.ui.keyboard.press('ArrowRight');
 s=await poll(t.state,x=>x.windowUi.split.cols[0]>before,'key resize',3000).catch(()=>t.state());check(s.windowUi.split.cols[0]>before,'ArrowRight on the edge widens the left panes');
 await t.ui.keyboard.press('Home');s=await poll(t.state,x=>Math.abs(x.windowUi.split.cols[0]-.5)<.01,'home',3000).catch(()=>t.state());check(Math.abs(s.windowUi.split.cols[0]-.5)<.01,'Home evens the columns');
 // The minimum pane: a huge drag stops at 320px.
 const edge=await t.ui.locator('.split-handle[data-kind=col]').boundingBox();await t.ui.mouse.move(edge.x+edge.width/2,edge.y+40);await t.ui.mouse.down();await t.ui.mouse.move(edge.x+2000,edge.y+40,{steps:6});await t.ui.mouse.up();await sleep(400);
 const {panes}=await fit('after a drag to the edge');check(Math.min(...panes.map(p=>p.w))>=318,`no pane goes under 320px (narrowest ${Math.min(...panes.map(p=>p.w))}px)`);
 // Closing a member keeps the rest.
 await t.act({type:'tab.close',id:d});s=await poll(t.state,s=>s.windowUi.split?.tabIds.length===3,'three left',5000).catch(()=>t.state());check(s.windowUi.split?.tabIds.length===3,'closing one of four keeps three panes');await fit('three after a close');
 // A pane's close button removes just that pane.
 await t.ui.locator('.page-pane').nth(2).getByRole('button',{name:/Remove from split view/}).click();s=await poll(t.state,s=>s.windowUi.split?.tabIds.length===2,'two left',5000).catch(()=>t.state());check(s.windowUi.split?.tabIds.length===2,'a pane close button removes just that pane');
 // Alt+click a link inside a pane: it joins the split as another pane (up to four).
 const active=(await t.state()).activeTabId,activeUrl=(await t.state()).tabs.find(x=>x.id===active).url;
 const page=await t.waitWeb(u=>u===activeUrl);await page.click('#more',{modifiers:['Alt']});
 s=await poll(t.state,s=>s.windowUi.split?.tabIds.length===3,'alt+click adds a pane',8000).catch(()=>t.state());check(s.windowUi.split?.tabIds.length===3&&s.tabs.some(x=>x.url.endsWith('/five')&&s.windowUi.split.tabIds.includes(x.id)),'Alt+click a link in a split adds it as a third pane');await fit('after Alt+click');
 // Peek, then Open in split: the preview joins as the fourth pane.
 await page.click('#peek',{modifiers:['Shift']});await poll(()=>t.ui.evaluate(()=>window.acira.peek({type:'peek.state'})).then(r=>r?.peek?.url||r?.url||''),u=>/six/.test(String(u)),'peek open',8000).catch(()=>null);
 await t.ui.evaluate(()=>window.acira.peek({type:'peek.split'}));
 s=await poll(t.state,s=>s.windowUi.split?.tabIds.length===4,'peek adds a pane',8000).catch(()=>t.state());check(s.windowUi.split?.tabIds.length===4&&s.tabs.some(x=>x.url.endsWith('/six')&&s.windowUi.split.tabIds.includes(x.id)),'Peek "Open in split" adds the preview as a fourth pane');await fit('after Peek open in split');
 // The split shortcuts, as real key presses on the page (registry defaults): exit, a layout, pane focus, close pane.
 const press=(keyCode,modifiers)=>t.main(({BaseWindow},{keyCode,modifiers})=>{const w=BaseWindow.getAllWindows()[0];const v=w.contentView.children.find(c=>{try{return c.webContents.isFocused()&&/127.0.0.1/.test(c.webContents.getURL());}catch{return false;}})||w.contentView.children.find(c=>{try{return /127.0.0.1/.test(c.webContents.getURL())&&c.getVisible();}catch{return false;}});for(const type of ['keyDown','keyUp'])v.webContents.sendInputEvent({type,keyCode,modifiers});return true;},{keyCode,modifiers});
 await press('0',['control','shift']);s=await poll(t.state,s=>s.windowUi.split===null,'exit',5000).catch(()=>t.state());check(s.windowUi.split===null,'Ctrl+Shift+0 exits split view');
 await press('3',['control','shift']);s=await poll(t.state,s=>s.windowUi.split?.layout==='three-columns',' three',5000).catch(()=>t.state());check(s.windowUi.split?.layout==='three-columns'&&s.windowUi.split.tabIds[0]===s.activeTabId,'Ctrl+Shift+3 splits into three columns, current tab first');await fit('after Ctrl+Shift+3');
 const was=s.activeTabId;await press('F6',['control']);s=await poll(t.state,x=>x.activeTabId!==was,'focus next',5000).catch(()=>t.state());check(s.activeTabId===s.windowUi.split.tabIds[1],'Ctrl+F6 moves to the next pane');
 await press('F4',['control','shift']);s=await poll(t.state,x=>x.windowUi.split?.tabIds.length===2,'close pane',5000).catch(()=>t.state());check(s.windowUi.split?.tabIds.length===2,'Ctrl+Shift+F4 closes the current pane');
}finally{await t.close();await site.close();}
