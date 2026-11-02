// R4-58 QA in the real app: on local stand-ins of each engine's result page (never a real engine), hovering a result shows the
// Preview chip beside its title; clicking it opens Peek growing from the title (frame strip at ~60Hz), Copy link copies, Esc closes
// back toward the link (strip), and the Settings › Tabs › Link preview row. Window shots for light and dark.
// node qa/r4-preview.mjs --out <dir> [--scale 1.5] [--engines google,bing]   (take a native slot first; D_VISIBLE is forced)
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const require=createRequire(import.meta.url);
const {page:serp}=require('../tests/fixtures/search-preview/pages.cjs');
process.env.D_VISIBLE='1';
const arg=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:null;
const out=path.resolve(arg('--out')||'C:/ae/r4/preview/evidence'),scale=Number(arg('--scale')||1),engines=(arg('--engines')||'google,bing,duckduckgo,brave,startpage,ecosia').split(',');
await fs.mkdir(out,{recursive:true});
const article=i=>`<!doctype html><meta charset="utf-8"><title>Result ${i} — example article</title><style>body{margin:0;font:16px/1.6 Georgia,serif;background:#fbfaf7;color:#222}main{max-width:680px;margin:0 auto;padding:48px 24px}h1{font:600 34px/1.2 system-ui}p{margin:0 0 18px}</style><main><h1>Result ${i}: a long article</h1>${Array.from({length:40},(_,k)=>`<p>Paragraph ${k+1}. A calm page to scroll inside the preview, with enough text to need it. The quick brown fox jumps over the lazy dog.</p>`).join('')}</main>`;
let base='';
const site=await httpFixture((req,res)=>{const u=new URL(req.url,'http://x');res.setHeader('content-type','text/html; charset=utf-8');
 const m=/^\/acira-serp\/([a-z]+)\/search$/.exec(u.pathname);if(m)return res.end(serp(m[1],{theme:u.searchParams.get('theme')||'light',dest:i=>`${base}/site/${m[1]}-${i}`}));
 const a=/^\/site\/([a-z]+-\d+)$/.exec(u.pathname);if(a){setTimeout(()=>res.end(article(a[1])),350);return;}res.statusCode=404;res.end('no');});
base=`http://127.0.0.1:${site.port}`;
const results=[];const check=(ok,label)=>{results.push({ok,label});console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const t=await startApp({args:scale!==1?[`--force-device-scale-factor=${scale}`]:[]});
const tag=scale===1?'100':String(Math.round(scale*100));
async function shot(name){const png=await t.main(async({BaseWindow,desktopCapturer})=>{const w=BaseWindow.getAllWindows()[0];w.focus();const [cw,ch]=w.getSize();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:Math.round(cw*2),height:Math.round(ch*2)}});const id=w.getMediaSourceId();const s=sources.find(x=>x.id===id)||sources.find(x=>/Acira/i.test(x.name));return s?s.thumbnail.toPNG().toString('base64'):null;});if(png){const file=path.join(out,`${name}-${tag}.png`);await fs.writeFile(file,Buffer.from(png,'base64'));return file;}return null;}
// ~60Hz frames of the Peek frame view (card, scrim and loader) while it opens or closes; the page view is native and shows once formed.
async function strip(name,trigger,ms=620){
 await t.main(async({BaseWindow},ms)=>{globalThis.__strip=[];const w=BaseWindow.getAllWindows()[0];const t0=Date.now();
  globalThis.__stripRun=(async()=>{while(Date.now()-t0<ms){const frame=w.contentView.children.find(v=>{try{return v.webContents?.getURL().endsWith('peek-frame.html');}catch{return false;}});const now=Date.now()-t0;if(frame&&!frame.webContents.isDestroyed()){try{const img=await frame.webContents.capturePage();globalThis.__strip.push({ms:now,png:img.resize({width:Math.round(img.getSize().width/2)}).toPNG().toString('base64')});}catch{}}await new Promise(r=>setTimeout(r,8));}})();},ms);
 await trigger();await sleep(ms+120);
 const frames=await t.main(async()=>{await globalThis.__stripRun;const f=globalThis.__strip;globalThis.__strip=[];return f;});
 const dir=path.join(out,`${name}-${tag}`);await fs.mkdir(dir,{recursive:true});
 for(const [i,f] of frames.entries())await fs.writeFile(path.join(dir,`${String(i).padStart(2,'0')}-${f.ms}ms.png`),Buffer.from(f.png,'base64'));
 const gaps=frames.slice(1).map((f,i)=>f.ms-frames[i].ms);return {count:frames.length,median:gaps.sort((a,b)=>a-b)[gaps.length>>1]||0,dir};
}
const peekInfo=()=>t.main(({BaseWindow})=>{const c=BaseWindow.getAllWindows()[0].contentView.children,top=c.at(-1),frame=c.at(-2);return {count:c.length,url:top?.webContents?.getURL?.()||'',frame:frame?.webContents?.getURL?.()||'',visible:top?.getVisible?.()};});
const esc=()=>t.main(({BaseWindow})=>{const wc=BaseWindow.getAllWindows()[0].contentView.children.at(-1).webContents;for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'Escape'});});
try{
 await t.main(({BaseWindow})=>{for(const w of BaseWindow.getAllWindows())w.setBounds({x:60,y:40,width:1400,height:900});});
 const home=(await t.state()).activeTabId;
 for(const theme of ['light','dark']){
  await t.act({type:'settings.update',patch:{appearance:theme}});
  for(const engine of engines){
   const first=engine===engines[0];
   await t.act({type:'tab.navigate',tabId:home,url:`${base}/acira-serp/${engine}/search?q=acira+browser&theme=${theme}`});
   const page=await t.waitWeb(u=>u.includes(`/acira-serp/${engine}/`)&&u.includes(`theme=${theme}`));await page.waitForLoadState('domcontentloaded');await sleep(400);
   // Hover the second result's snippet (not its title): the chip appears at the end of the title line.
   const geo=await page.evaluate(()=>{const titles=[...document.querySelectorAll('main h3,main h2,main .title')],h=titles[1];const r=document.createRange();r.selectNodeContents(h);const l=[...r.getClientRects()].filter(b=>b.width>0),last=l.at(-1);const snip=h.closest('.MjjYud,.b_algo,article,.snippet,.w-gl__result,.result').querySelector('.VwiC3b,p,.result-snippet,.snippet-description');const s=snip.getBoundingClientRect();return {end:last.right,mid:last.top+last.height/2,top:Math.min(...l.map(b=>b.top)),left:Math.min(...l.map(b=>b.left)),snip:{x:s.x+30,y:s.y+s.height/2},host:!!document.querySelector('acira-preview')};});
   const before=await page.evaluate(()=>JSON.stringify([...document.querySelectorAll('main *')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height];})));
   await page.mouse.move(geo.snip.x+4,geo.snip.y);await page.mouse.move(geo.snip.x,geo.snip.y);await sleep(450);
   const shown=await page.evaluate(()=>!!document.querySelector('acira-preview'));
   const after=await page.evaluate(()=>JSON.stringify([...document.querySelectorAll('main *')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height];})));
   check(shown,`${theme} ${engine}: hovering a result shows the Preview chip`);check(before===after,`${theme} ${engine}: nothing in the page moved`);
   if(first||engine==='bing')await shot(`chip-${engine}-${theme}`);
   // Click the chip (it sits 8px after the title's last line, 24px tall, about 78px wide).
   const peekBefore=await peekInfo();
   const click=async()=>{await page.mouse.move(geo.end+8+30,geo.mid);await sleep(60);await page.mouse.down();await page.mouse.up();};
   const opened=first?await strip(`open-${engine}-${theme}`,click):(await click(),null);
   const info=await poll(peekInfo,i=>i.url.includes(`/site/${engine}-1`),'peek opened',8000).catch(()=>peekInfo());
   check(info.url.includes(`/site/${engine}-1`)&&info.frame.endsWith('peek-frame.html'),`${theme} ${engine}: the chip opens Peek for that result (${info.url.split('/').pop()})`);
   check(page.url().includes('/acira-serp/'),`${theme} ${engine}: the results page stays`);
   if(opened)check(opened.count>=12&&opened.median<=24,`${theme}: open strip ${opened.count} frames, median gap ${opened.median}ms`);
   if(first){
    await sleep(900);const frameUi=t.context.pages().find(p=>{try{return p.url().endsWith('peek-frame.html');}catch{return false;}});
    await shot(`peek-${engine}-${theme}`);
    // Scroll inside the preview, then Copy link.
    const peekPage=await t.waitWeb(u=>u.includes(`/site/${engine}-1`));await peekPage.mouse.move(400,300);await peekPage.mouse.wheel(0,900);await sleep(400);
    check(await peekPage.evaluate(()=>scrollY>200),`${theme}: scrolling inside the preview works`);
    if(frameUi){await frameUi.click('#copy');await sleep(250);const text=await t.main(({clipboard})=>clipboard.readText());check(text.includes(`/site/${engine}-1`),`${theme}: Copy link copies the preview's address`);await shot(`peek-copied-${engine}-${theme}`);}
    const closed=await strip(`close-${engine}-${theme}`,esc,520);
    const gone=await poll(peekInfo,i=>i.count===peekBefore.count,'peek closed',5000).catch(()=>peekInfo());
    check(gone.count===peekBefore.count,`${theme}: Esc closes the preview (close strip ${closed.count} frames, median ${closed.median}ms)`);
   }else{await esc();await poll(peekInfo,i=>i.count===peekBefore.count,'peek closed',5000).catch(()=>{});}
   await sleep(300);
  }
 }
 // Settings › Tabs › Link preview.
 await t.act({type:'settings.update',patch:{appearance:'light'}});
 await t.act({type:'tab.navigate',tabId:home,url:'acira://settings'}).catch(()=>{});await sleep(1500);
 const ui=t.context.pages().find(p=>{try{return p.url()==='acira-browser-ui://ui/index.html';}catch{return false;}});
 if(ui)await ui.evaluate(()=>{const nav=[...document.querySelectorAll('button,a,[role="tab"]')].find(e=>e.textContent.trim()==='Tabs');nav?.click();});await sleep(900);
 const row=ui?await ui.evaluate(()=>{const el=document.querySelector('[data-setting="link-preview"]');if(!el)return null;el.scrollIntoView({block:'center'});return el.textContent.slice(0,240);}):null;
 check(Boolean(row)&&/Link preview/.test(row),`Settings › Tabs shows the Link preview row (${row?.slice(0,90)})`);await sleep(400);await shot('settings-link-preview-light');
 await t.act({type:'settings.update',patch:{appearance:'dark'}});await sleep(600);await shot('settings-link-preview-dark');
}finally{await t.close();site.close?.();await fs.writeFile(path.join(out,`results-${tag}.json`),JSON.stringify(results,null,1));}
