// The loading line under the address field must go away when the page's main frame has finished loading, and never come
// back for work that happens after load (a long-poll fetch, an event stream, beacons, a late iframe that never ends).
// A normal navigation must still show it while it loads.
//   node qa/native-slot.mjs progress-line -- node qa/progress-line-settles.mjs [--google]
// Isolated profile under .qa-profiles; the window is off screen, unfocusable and ignores the mouse (the OS cursor and
// focus are never touched). Evidence (PNG crops of the toolbar, JSON timelines) goes to ACIRA_QA_EVIDENCE or qa/artifacts.
import {launchPreparedNative} from './prepared-native.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {poll,nativePage} from './native-helpers.mjs';
const require=createRequire(import.meta.url),{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs');
const stamp=Date.now(),data=path.resolve('.qa-profiles/progress-line-'+stamp),out=path.resolve(process.env.ACIRA_QA_EVIDENCE||'qa/artifacts/progress-line-'+stamp);
const withGoogle=process.argv.includes('--google'),SETTLE_MS=Number(process.env.SETTLE_MS||3000);
await fs.mkdir(data,{recursive:true});await fs.mkdir(out,{recursive:true});
const held=new Set();
const page=(title,body,script='')=>`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:0;padding:24px"><h1>${title}</h1>${body}<script>${script}</script>`;
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://x'),send=(body,type='text/html; charset=utf-8',wait=body.startsWith('<!doctype html><meta')?600:0)=>setTimeout(()=>{res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(body);},wait);
 switch(url.pathname){
  case '/plain':return send(page('Plain page','<p>Nothing else is going on.</p>'),'text/html; charset=utf-8',700);
  // A request that is never answered (a long poll) and an event stream, plus beacons every 700 ms, all started after load.
  case '/longpoll':return send(page('Long poll page','<p>Fetch, event stream and beacons keep going after load.</p>',`addEventListener('load',()=>setTimeout(()=>{fetch('/hold').catch(()=>{});new EventSource('/sse');setInterval(()=>fetch('/beacon',{keepalive:true}).catch(()=>{}),700);navigator.sendBeacon('/beacon','x');},300));`));
  // An iframe added after load whose response never ends.
  case '/late-iframe':return send(page('Late iframe page','<p>An iframe that never finishes is added after load.</p>',`addEventListener('load',()=>setTimeout(()=>{const f=document.createElement('iframe');f.src='/hold-frame';f.style.cssText='width:300px;height:80px';document.body.append(f);},600));`));
  // An iframe present from the start that answers after 2 s: the main load waits for it, then the line ends.
  case '/slow-iframe':return send(page('Slow iframe page','<iframe src="/frame-slow" style="width:300px;height:80px"></iframe>'));
  case '/frame-slow':return send('<!doctype html><p>slow frame</p>','text/html; charset=utf-8',2000);
  // Frames and hash changes that keep coming after load: iframes created and removed, one that navigates itself, fragment and pushState navigations.
  case '/churn':return send(page('Churn page','<p>Iframes, fragments and history changes after load.</p>',`addEventListener('load',()=>setTimeout(()=>{let n=0;setInterval(()=>{n++;const f=document.createElement('iframe');f.src='/frame-quick?n='+n;f.style.cssText='width:200px;height:40px';document.body.append(f);setTimeout(()=>f.remove(),400);if(n%2)location.hash='#h'+n;else history.pushState({},'','/churn?p='+n);},600);},300));`));
  case '/frame-quick':return send('<!doctype html><p>quick frame</p>');
  // A service worker with a fetch handler, and a page that talks to it after load.
  case '/sw':return send(page('Service worker page','<p>Registers a worker, then fetches through it.</p>',`navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>setInterval(()=>fetch('/beacon').catch(()=>{}),500));`));
  case '/sw.js':return send(`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('fetch',e=>e.respondWith(fetch(e.request)));`,'text/javascript');
  case '/slow-nav':return send(page('Slow navigation','<p>The server answered after 2.5 s.</p>'),'text/html; charset=utf-8',2500);
  case '/hold':case '/hold-frame':{res.writeHead(200,{'content-type':url.pathname==='/hold'?'application/json':'text/html; charset=utf-8','cache-control':'no-store'});res.write(url.pathname==='/hold'?'':'<!doctype html><p>frame that never finishes</p>');held.add(res);res.on('close',()=>held.delete(res));return;}
  case '/sse':{res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});const timer=setInterval(()=>res.write('data: tick\n\n'),500);res.on('close',()=>clearInterval(timer));return;}
  case '/beacon':res.writeHead(204);return res.end();
  default:res.writeHead(404);return res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const seed=createInitialState();seed.tabs[0]={...seed.tabs[0],url:origin+'/plain',contentKind:'web',title:'Plain page',history:[origin+'/plain'],historyIndex:0};seed.settings={...seed.settings,verticalTabs:false,windowView:'full',reducedMotion:false,...(process.env.SCALE?{interfaceScale:Number(process.env.SCALE)}:{})};
const db=new BrowserDatabase(path.join(data,'browser.sqlite'));db.saveWindow('main',seed);db.close();
const report={dsf:process.env.DSF||'1',origin,pages:{},captures:[],checks:[],failures:[]};let app,ui;
// Every page's navigation and loading events, as main sees them, so a stuck line can be traced to the event that started it.
const installLifeLog=()=>app.evaluate(({app,webContents})=>{globalThis.__life=[];const t0=Date.now();const hook=wc=>{if(wc.__lifeHooked)return;wc.__lifeHooked=true;const log=(name,extra='')=>{try{if(/^acira-browser-ui:/.test(wc.getURL()))return;globalThis.__life.push(`${String(Date.now()-t0).padStart(7)} ms wc${wc.id} ${name}${extra?' '+extra:''} [isLoading=${wc.isLoading()} mainFrame=${wc.isLoadingMainFrame()}]`);}catch{}};
 wc.on('did-start-loading',()=>log('did-start-loading'));wc.on('did-stop-loading',()=>log('did-stop-loading'));wc.on('did-start-navigation',d=>log('did-start-navigation',`${d.isMainFrame?'MAIN':'sub'}${d.isSameDocument?' same-doc':''} ${String(d.url).slice(0,60)}`));wc.on('did-redirect-navigation',d=>log('did-redirect',`${d.isMainFrame?'MAIN':'sub'} ${String(d.url).slice(0,60)}`));wc.on('did-navigate',(_e,u)=>log('did-navigate',String(u).slice(0,60)));wc.on('did-navigate-in-page',(_e,u,m)=>log('did-navigate-in-page',`${m?'MAIN':'sub'} ${String(u).slice(0,60)}`));wc.on('did-frame-finish-load',(_e,m)=>log('did-frame-finish-load',m?'MAIN':'sub'));wc.on('did-fail-load',(_e,c,d,u,m)=>log('did-fail-load',`${c} ${m?'MAIN':'sub'} ${String(u).slice(0,60)}`));};
 for(const wc of webContents.getAllWebContents())hook(wc);app.on('web-contents-created',(_e,wc)=>hook(wc));});
const dumpLife=()=>app.evaluate(()=>globalThis.__life.splice(0));
const toolbar=async name=>{const png=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(item=>item.getURL()==='acira-browser-ui://ui/index.html');const image=await wc.capturePage(),{width}=image.getSize();return image.crop({x:0,y:0,width,height:Math.min(image.getSize().height,110)}).toPNG().toString('base64');});const file=path.join(out,name+'.png');await fs.writeFile(file,Buffer.from(png,'base64'));report.captures.push(file);return file;};
// Samples the bar and the tab every 40 ms: the tab's loading/progress, the canvas' data-active, its computed
// visibility/opacity/transform and how many of its pixels are painted (alpha above 8/255).
const sample=(ms)=>ui.evaluate(ms=>new Promise(resolve=>{const rows=[],t0=performance.now();const id=setInterval(()=>{const node=document.querySelector('.navigation-progress[data-placement="address"]'),state=window.__qaState,tab=state?.tabs.find(item=>item.id===state.activeTabId),style=node&&getComputedStyle(node);let painted=0;if(node&&node.width&&node.height){const px=node.getContext('2d').getImageData(0,0,node.width,node.height).data;for(let i=3;i<px.length;i+=4)if(px[i]>8)painted++;}
 rows.push({t:Math.round(performance.now()-t0),loading:!!tab?.loading,progress:tab?.progress??null,active:node?.dataset.active??null,visibility:style?.visibility??null,opacity:style?.opacity??null,transform:style?.transform??null,painted,geo:node?`dpr ${devicePixelRatio} client ${node.clientWidth}x${node.clientHeight} bitmap ${node.width}x${node.height}`:null});
 if(performance.now()-t0>=ms){clearInterval(id);resolve(rows);}},40);}),ms);
// Change points only, so a timeline reads as a handful of lines.
const compact=rows=>{const keyOf=r=>[r.loading,r.progress===null?'-':r.progress.toFixed(2),r.active,r.visibility,r.painted>0?'painted':'clear'].join('|');const lines=[];let last='';for(const r of rows){const key=keyOf(r);if(key!==last){lines.push(`${String(r.t).padStart(6)} ms  loading=${r.loading} progress=${r.progress===null?'-':r.progress.toFixed(2)} active=${r.active} visibility=${r.visibility} opacity=${r.opacity} px=${r.painted}`);last=key;}}return lines;};
const navigate=async(url)=>{await ui.evaluate(url=>window.acira.dispatch({type:'tab.navigate',url}),url);};
/** Navigates, samples the bar until `total` ms, and checks that the last SETTLE_MS of it was hidden and clear. */
async function run(name,url,{total,expectShownWhileLoading=true,after,act}){
 if(process.env.PAGES&&!process.env.PAGES.split(',').includes(name))return;
 await dumpLife();const sampling=sample(total);await (act?act():navigate(url));const rows=await sampling;const life=await dumpLife();
 const shownWhileLoading=rows.some(r=>r.painted>0);
 const tail=rows.filter(r=>r.t>=total-SETTLE_MS),endedAt=rows.find(r=>!r.loading&&r.t>200)?.t??null,clearAt=rows.find(r=>r.painted===0&&r.t>(endedAt??0))?.t??null;
 const stuck=tail.filter(r=>r.painted>0||r.active==='true'||r.loading||r.visibility!=='hidden');
 const summary={geometry:rows.at(-1)?.geo,url,loadingEndedAtMs:endedAt,barClearAtMs:clearAt,shownWhileLoading,tailSamples:tail.length,tailNotHidden:stuck.length,tailLast:tail.at(-1)};
 report.pages[name]={summary,timeline:compact(rows),life};
 await toolbar(name+'-after');
 console.log(`\n== ${name} ${url}\n`+compact(rows).join('\n')+'\n   main events:\n   '+life.join('\n   ')+`\n-- loading ended ${endedAt} ms, bar clear ${clearAt} ms, shown while loading: ${shownWhileLoading}, tail samples not hidden: ${stuck.length}/${tail.length}`);
 // Every page is judged, so one run shows the whole picture instead of stopping at the first failure.
 const problems=[];if(expectShownWhileLoading&&!shownWhileLoading)problems.push('the line was never shown while the page loaded');if(stuck.length)problems.push(`the line was not hidden and clear for the last ${SETTLE_MS} ms (${stuck.length}/${tail.length} samples; first: ${JSON.stringify(stuck[0])})`);
 if(problems.length)report.failures.push(name+': '+problems.join('; '));else report.checks.push(name+': shown while loading, hidden and clear for the last '+SETTLE_MS+' ms');
 await after?.();
}
try{
 app=await launchPreparedNative({args:[path.resolve('desktop/main.cjs'),...(process.env.DSF?['--force-device-scale-factor='+process.env.DSF]:[])],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data}});app.context().setDefaultTimeout(10000);ui=await nativePage(app,'acira-browser-ui://ui/index.html');await ui.waitForFunction(()=>Boolean(window.acira));
 await app.evaluate(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];w.setFocusable(false);w.setIgnoreMouseEvents(true);w.setPosition(-20000,-20000);w.setSize(1200,760);w.showInactive();});
 await ui.evaluate(()=>{window.__qaState=null;window.acira.subscribe(state=>{window.__qaState=state;});});await ui.evaluate(()=>window.acira.dispatch({type:'tick'})).catch(()=>{});
 await poll(async()=>ui.evaluate(()=>{const s=window.__qaState,t=s?.tabs.find(x=>x.id===s.activeTabId);return !!t&&!t.loading&&t.title==='Plain page'&&!!document.querySelector('.navigation-progress[data-placement="address"]');}),Boolean,'first page loaded and the address line mounted',25000);
 await ui.waitForTimeout(1500);
 await installLifeLog();await toolbar('00-before');
 await run('plain',origin+'/plain',{total:SETTLE_MS+4000});
 await run('longpoll',origin+'/longpoll',{total:SETTLE_MS+6000});
 await run('late-iframe',origin+'/late-iframe',{total:SETTLE_MS+6000});
 await run('slow-iframe',origin+'/slow-iframe',{total:SETTLE_MS+7000});
 // A slow main navigation: the line is on screen while it loads.
 await run('churn',origin+'/churn',{total:SETTLE_MS+6000});
 await run('service-worker',origin+'/sw',{total:SETTLE_MS+5000});
 await run('slow-nav',origin+'/slow-nav',{total:SETTLE_MS+7000});
 if(withGoogle){const gmail='https://workspace.google.com/intl/en-US/gmail/';
  await run('google-gmail',gmail,{total:SETTLE_MS+14000});
  // The founder has visited before: a second visit (cache and service worker warm), a reload, and a typed address without the trailing slash (a redirect).
  await run('google-again',gmail,{total:SETTLE_MS+9000});
  await run('google-reload',gmail,{total:SETTLE_MS+9000,act:()=>ui.evaluate(async()=>{const s=await window.acira.getSnapshot();return window.acira.browserCommand({type:'reload',tabId:s.activeTabId});})});
  await run('google-no-slash','https://workspace.google.com/intl/en-US/gmail',{total:SETTLE_MS+9000});}
 report.status=report.failures.length?'failed':'passed';console.log('\n'+JSON.stringify({status:report.status,checks:report.checks,failures:report.failures,out},null,1));if(report.failures.length)process.exitCode=1;
}catch(error){report.status='failed';report.failure=error.message;console.error('\nFAILED: '+error.message);try{await toolbar('failure');}catch{}process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,1)).catch(()=>{});for(const res of held)res.destroy();await app?.close().catch(()=>{});server.close();}
