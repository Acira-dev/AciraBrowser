// Actual AppKit hit regions versus the mounted browser, on an owned profile.
// A DOM-only screenshot misses the very controls this regression covers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, poll, sleep, httpFixture} from './d-harness.mjs';
const candidate=path.resolve(process.argv[2]||'.');
const out=path.resolve(process.env.MAC_CONTROLS_OUT||'qa/artifacts/mac-window-controls-'+Date.now());
await fs.mkdir(out,{recursive:true});
let app,server;
const report={passed:false,candidate,checks:[],failures:[],errors:[],scope:'Real AppKit button frames and hit testing against mounted UI in an isolated profile. Hidden layout matrix and a final visible reveal; interactive desktop checks are recorded separately.'};
try {
 app=await startApp({root:path.resolve('.qa-profiles/mac-window-controls-'+Date.now()),main:path.resolve('qa/mac-window-controls-entry.cjs'),env:{ACIRA_QA_MAIN:path.join(candidate,'desktop/main.cjs')}});
 const listen=p=>p.on('pageerror',e=>report.errors.push(String(e)));app.context.pages().forEach(listen);app.context.on('page',listen);
 await app.context.route('https://**/*',r=>r.abort());
 await app.act({type:'settings.update',patch:{reducedMotion:true,appearance:'light',addressSuggestions:false}});
 server=await httpFixture((_q,r)=>r.end('<title>Window controls fixture</title><h1>Live browser page</h1><button>Page control</button>'));
 const url='http://127.0.0.1:'+server.port+'/';
 await app.act({type:'tab.navigate',url});const web=await app.waitWeb(url);await web.locator('button').click();
 const native=()=>app.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'));return {bounds:w.getContentBounds(),buttons:JSON.parse(global.__aciraWindowButtons(w.getNativeWindowHandle())),visible:w.isVisible()};});
 for(const width of [900,1280]) for(const scale of [80,100,150]) for(const tabs of ['top','sidebar-open','sidebar-closed']) for(const view of ['full','compact','focus','seamless']) {
  await app.main(({BaseWindow},width)=>BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html')).setSize(width,800),width);
  await app.act({type:'settings.update',patch:{interfaceScale:scale,verticalTabs:tabs!=='top',windowView:view}});
  await app.act({type:'ui.update',patch:{view,workspaceOpen:tabs==='sidebar-open',webWorkspaceOpen:tabs==='sidebar-open'}});
  await sleep(300);
  const ui=await app.ui.evaluate(async()=>{
   const shell=document.querySelector('.browser-shell'),box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
   return {layout:await window.acira.getBrowserLayout(),mode:shell?.getAttribute('data-layout'),seamless:shell?.getAttribute('data-seamless'),controls:[...document.querySelectorAll('.browser-shell button,.browser-shell input,.ed-rail button')].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map(n=>({name:n.getAttribute('aria-label')||n.textContent?.trim(),...box(n)}))};
  });
  const frame=await native(), k=scale/100, failure=[];
  const overlap=(a,b)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.5&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.5;
  for(const b of frame.buttons) {
   if(ui.seamless==='hidden') {if(!b.hidden||b.receivesHit)failure.push({issue:'Hidden chrome leaves a live native button over the page',button:b});continue;}
   if(b.hidden||!b.enabled||!b.receivesHit)failure.push({issue:'Visible native control is not available',button:b});
   for(const c of ui.controls) if(overlap(b,{x:c.x*k,y:c.y*k,width:c.width*k,height:c.height*k}))failure.push({issue:'Browser control overlaps native window control',button:b,control:c});
   if(b.y<0||b.y+b.height>ui.layout.captionHeight*k+.5)failure.push({issue:'Window control extends below its header',button:b,captionHeight:ui.layout.captionHeight*k});
  }
  const entry={width,scale,tabs,view,...frame,mode:ui.mode,seamless:ui.seamless,captionHeight:ui.layout.captionHeight,failures:failure};report.checks.push(entry);
  if(failure.length)report.failures.push(entry);
 }
 // Revealing Seamless through the renderer's edge protocol restores native buttons;
 // leaving it restores them too, rather than leaving invisible click targets.
 await app.act({type:'settings.update',patch:{interfaceScale:100,verticalTabs:false,windowView:'seamless'}});
 await app.act({type:'ui.update',patch:{view:'seamless'}});
 // The production poller correctly sleeps for a hidden, unfocused window.
 // Show only this final owned fixture to exercise its real reveal path.
 await app.main(({BaseWindow,app})=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'));w.show();w.focus();app.focus({steal:true});});
 await app.cmd({type:'edge',tabId:(await app.state()).activeTabId,pin:{zone:'top',on:true}});
 await poll(()=>app.ui.locator('.browser-shell').getAttribute('data-seamless'),s=>s==='shown','Seamless toolbar revealed');
 const revealed=await native();assert(revealed.buttons.every(b=>!b.hidden&&b.receivesHit),'Revealed native controls are hittable');report.revealed=revealed;
 assert.equal(report.failures.length,0,'Native window-control collisions / hidden hit targets');assert.deepEqual(report.errors,[],'No renderer exceptions');report.passed=true;
} catch(error) {report.error=String(error.stack||error);process.exitCode=1;}
finally {await app?.close();await server?.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,cases:report.checks.length,failures:report.failures.map(c=>({width:c.width,scale:c.scale,tabs:c.tabs,view:c.view,issues:c.failures.slice(0,3)})),error:report.error,out},null,2));}
