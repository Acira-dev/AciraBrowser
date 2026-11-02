// Stream H QA: Peek in the real app — Shift+click opens a floating preview, Esc closes, Open as tab keeps the same
// WebContents (history intact), Open in split, downloads blocked, private profile session. Optional window capture.
// node qa/h-peek.mjs [--shots dir]   (D_VISIBLE=1 for a visible window)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
process.env.D_VISIBLE='1';// a hidden window paints no frames, so pointer moves reach the page late: the press-and-hold checks need the window shown
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const site=await httpFixture((req,res)=>{const n=req.url.replace(/\W/g,'')||'root';if(n.startsWith('file'))return res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename=x.bin'}),res.end('data');res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><title>${n}</title><body style="font:16px system-ui;padding:40px;background:#f6f3ee"><h1>${n}</h1><p><a id="next" href="/article">Read the article</a></p><p><a id="deeper" href="/deeper">Deeper</a></p>${'<p>text</p>'.repeat(40)}`);});
const base=`http://127.0.0.1:${site.port}`;
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const t=await startApp({});
const peekInfo=()=>t.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0],c=w.contentView.children,top=c.at(-1),frame=c.at(-2);const url=top?.webContents?.getURL?.()||'';return {count:c.length,url,id:top?.webContents?.id,bounds:top?.getBounds?.(),frameUrl:frame?.webContents?.getURL?.()||'',content:w.getContentSize()};});
async function capture(name){if(!shots)return;await fs.mkdir(shots,{recursive:true});const png=await t.main(async({BaseWindow,desktopCapturer})=>{const w=BaseWindow.getAllWindows()[0];const [cw,ch]=w.getSize();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:cw,height:ch}});const id=w.getMediaSourceId();const s=sources.find(x=>x.id===id);return s?s.thumbnail.toPNG().toString('base64'):'';});if(png)await fs.writeFile(path.join(shots,`${name}.png`),Buffer.from(png,'base64'));}
try{
 await t.main(({BaseWindow})=>{for(const w of BaseWindow.getAllWindows())w.setBounds({x:40,y:40,width:1400,height:900});});
 const home=(await t.state()).activeTabId;
 await t.act({type:'tab.navigate',tabId:home,url:`${base}/home`});
 const page=await t.waitWeb(u=>u.endsWith('/home'));await page.waitForSelector('#next');
 const before=await peekInfo();
 await page.click('#next',{modifiers:['Shift']});
 let info=await poll(peekInfo,i=>i.url.endsWith('/article'),'peek opened',12000).catch(()=>peekInfo());
 check(info.url.endsWith('/article')&&info.frameUrl.endsWith('peek-frame.html'),'Shift+click opens the link in a peek (page view over a frame view)');
 check(info.bounds&&Math.abs(info.bounds.x+info.bounds.width/2-info.content[0]/2)<4&&info.bounds.width>info.content[0]*0.6,`peek centred, ${info.bounds?.width}x${info.bounds?.height}`);
 let s=await t.state();check(s.tabs.length===1&&page.url().endsWith('/home'),'no tab made, source page unchanged');
 await sleep(700);await capture('peek-open');
 // M33: thin, button-less scrollbars so nothing is clipped at the rounded corner. M34: the header bar (the controls row) starts at the card's top edge.
 const peekPageEarly=await t.waitWeb(u=>u.endsWith('/article'));
 check(await peekPageEarly.evaluate(()=>getComputedStyle(document.documentElement).scrollbarWidth)==='thin','peek page has thin scrollbars (M33)');
 const frameUi=t.context.pages().find(p=>{try{return p.url().endsWith('peek-frame.html');}catch{return false;}});
 const tops=frameUi?await frameUi.evaluate(()=>({card:Math.round(document.getElementById('card').getBoundingClientRect().top),controls:Math.round(document.getElementById('bar').getBoundingClientRect().top)})):null;
 check(Boolean(tops)&&tops.card===tops.controls,`header bar top matches the card top (${JSON.stringify(tops)}) (M34)`);
 if(shots){await fs.mkdir(shots,{recursive:true});const crop=await t.main(async({BaseWindow,desktopCapturer})=>{const w=BaseWindow.getAllWindows()[0];const [cw,ch]=w.getSize();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:cw,height:ch}});const s=sources.find(x=>x.id===w.getMediaSourceId());if(!s)return '';const size=s.thumbnail.getSize();return s.thumbnail.crop({x:Math.max(0,size.width-360),y:Math.max(0,size.height-240),width:Math.min(360,size.width),height:Math.min(240,size.height)}).toPNG().toString('base64');});if(crop)await fs.writeFile(path.join(shots,'peek-corner.png'),Buffer.from(crop,'base64'));}
 // Esc inside the peek closes it.
 await t.main(({BaseWindow})=>{const wc=BaseWindow.getAllWindows()[0].contentView.children.at(-1).webContents;for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'Escape'});});
 info=await poll(peekInfo,i=>i.count===before.count,'peek closed',5000).catch(()=>peekInfo());check(info.count===before.count,'Esc closes the peek');
 // Press and hold the link: the preview opens and grows from it; the release that follows does not navigate the page.
 {const box=await page.locator('#next').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await sleep(650);
  const held=await poll(peekInfo,i=>i.url.endsWith('/article'),'hold opened peek',6000).catch(()=>peekInfo());await page.mouse.up();await sleep(500);
  check(held.url.endsWith('/article')&&page.url().endsWith('/home'),'press and hold previews the link; letting go does not navigate');
  const frame=t.context.pages().find(p=>{try{return p.url().endsWith('peek-frame.html');}catch{return false;}});
  const origin=frame?await frame.evaluate(()=>getComputedStyle(document.getElementById('card')).transformOrigin):'';
  const anim=frame?await frame.evaluate(()=>[...document.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>r.type===7).map(r=>r.cssText).join(' ')):'';
  check(/px/.test(origin)&&!/^50% 50%/.test(origin),`the card grows from the held link (transform-origin ${origin})`);check(!/blur/.test(anim),'enter and exit animate transform and opacity only (no blur)');
  await t.main(({BaseWindow})=>{const wc=BaseWindow.getAllWindows()[0].contentView.children.at(-1).webContents;for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'Escape'});});await poll(peekInfo,i=>i.count===before.count,'closed again',5000);
  // Moving while holding is a drag or a selection, never a preview.
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+12,{steps:4});await sleep(650);await page.mouse.up();await sleep(300);
  {const after=await peekInfo();check(after.count===before.count,'moving while holding does not preview '+JSON.stringify({before:before.count,after:after.count,url:after.url,frame:after.frameUrl}));}}
 // Downloads never escape.
 await t.ui.evaluate(url=>window.acira.peek({type:'peek.open',url}),`${base}/article`);await poll(peekInfo,i=>i.url.endsWith('/article'),'peek again');
 await t.main(({BaseWindow},url)=>BaseWindow.getAllWindows()[0].contentView.children.at(-1).webContents.downloadURL(url),`${base}/file`);await sleep(1200);
 check(!((await t.state()).downloads||[]).length,'download from a peek is cancelled');
 // Navigate inside the peek, then Open as tab: same WebContents, back history intact.
 const peekPage=await t.waitWeb(u=>u.endsWith('/article'));await peekPage.click('#deeper');await poll(peekInfo,i=>i.url.endsWith('/deeper'),'peek navigated');
 const wcId=(await peekInfo()).id;
 const promoted=await t.ui.evaluate(()=>window.acira.peek({type:'peek.promote'}));
 s=await poll(t.state,s=>s.tabs.length===2&&s.activeTabId===promoted.tabId,'promoted tab active');
 const same=await poll(()=>t.main(({BaseWindow},id)=>BaseWindow.getAllWindows()[0].contentView.children.some(v=>v.webContents?.id===id&&v.getVisible()),wcId),Boolean,'same contents visible',5000).catch(()=>false);
 check(promoted.ok&&s.tabs[1].url.endsWith('/deeper')&&s.tabs[1].id===promoted.tabId,'Open as tab makes a tab right after the source');
 check(same,'the tab uses the very same WebContents');
 const back=await poll(t.state,s=>s.tabs.find(x=>x.id===promoted.tabId)?.canGoBack===true,'history',5000).then(()=>true,()=>false);check(back,'history intact (Back available)');
 // Open in split.
 await t.act({type:'tab.select',id:home});await sleep(300);
 await t.ui.evaluate(url=>window.acira.peek({type:'peek.open',url}),`${base}/beside`);await poll(peekInfo,i=>i.url.endsWith('/beside'),'peek for split');
 const split=await t.ui.evaluate(()=>window.acira.peek({type:'peek.split'}));
 s=await poll(t.state,s=>Boolean(s.windowUi.split),'split',5000).catch(()=>t.state());
 check(split.ok&&JSON.stringify(s.windowUi.split?.tabIds)===JSON.stringify([home,split.tabId]),'Open in split puts it beside the source');
 await sleep(700);await capture('peek-split');
 // Private window: the peek uses that window's private session.
 await t.ui.evaluate(()=>window.acira.openWindow('private'));
 const privateUi=await poll(()=>t.context.pages().find(p=>{try{return p.url()==='acira-browser-ui://ui/index.html'&&p!==t.ui;}catch{return false;}}),Boolean,'private window');
 await poll(()=>privateUi.evaluate(()=>Boolean(window.acira?.getSnapshot)),Boolean,'private ready');
 const ps=await privateUi.evaluate(()=>window.acira.getSnapshot());
 await privateUi.evaluate(async([tab,url])=>{await window.acira.dispatch({type:'tab.navigate',tabId:tab,url});},[ps.activeTabId,`${base}/private`]);
 await sleep(800);const r=await privateUi.evaluate(url=>window.acira.peek({type:'peek.open',url}),`${base}/article`);
 const sameSession=await t.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows().find(x=>/Private|Incognito/.test(x.getTitle()));if(!w)return 'no-window';const c=w.contentView.children,peekWc=c.at(-1).webContents,pageWc=c.find(v=>v.webContents?.getURL?.().endsWith('/private'))?.webContents;return Boolean(pageWc)&&peekWc.session===pageWc.session&&!peekWc.session.isPersistent();});
 check(r.ok&&sameSession===true,`private peek shares the private (non-persistent) session (${sameSession})`);
}finally{await t.close();await site.close();}
