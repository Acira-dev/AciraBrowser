// Actual main-process acceptance. Owned loopback documents report their viewport autonomously.
// Run: electron qa/mac-page-zoom.cjs [desktop-directory] [report-path]
const {app,ipcMain,webContents,BaseWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
fs.mkdirSync('.qa-profiles',{recursive:true});fs.mkdirSync('qa/artifacts',{recursive:true});
const profile=fs.mkdtempSync(path.resolve('.qa-profiles/page-zoom-'));
Object.assign(process.env,{ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_PREVIEW_RECORD:'1',ACIRA_DEV:'0'});
const reports=[];let seq=0;
const serve=(req,res)=>{
 if(req.url.startsWith('/report?')){reports.push({...JSON.parse(new URL(req.url,'http://local').searchParams.get('m')),seq:++seq});res.end('ok');return;}
 res.setHeader('content-type','text/html');res.end(`<!doctype html><title>Owned page zoom</title><style>body{font:20px system-ui;margin:24px}.probe{width:200px;height:100px;background:#369}</style><h1>Page zoom</h1><div class=probe></div><p>Only this page should grow.</p><script>function report(){fetch('/report?m='+encodeURIComponent(JSON.stringify({path:location.pathname,width:innerWidth,height:innerHeight,dpr:devicePixelRatio}))).catch(()=>{})}addEventListener('resize',report);addEventListener('load',report);setInterval(report,120);</script>`);
};
const servers=[http.createServer(serve),http.createServer(serve)];
const routes=new Map(),handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,fn)=>{routes.set(channel,fn);return handle(channel,fn)};
const desktop=path.resolve(process.argv[2]||'desktop');require(path.join(desktop,'main.cjs'));
const call=(ui,channel,...args)=>routes.get(channel)({sender:ui,senderFrame:ui.mainFrame},...args),snapshot=ui=>call(ui,'acira:snapshot');
const all=()=>webContents.getAllWebContents().filter(w=>!w.isDestroyed()),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(fn,test,label){for(let i=0;i<300;i++){const value=await fn();if(test(value))return value;await wait(25)}throw Error(label)}
const out={checks:[],desktop,profile,scope:'Hidden native Acira main; real web page viewport/DPR from autonomous owned loopback pages. Disposable profile, no personal browsing state.'};
let done=false;app.on('before-quit',event=>{if(!done)event.preventDefault()});const deadline=setTimeout(()=>finish(Error('Page zoom deadline')),45000);
function finish(error){if(done)return;done=true;clearTimeout(deadline);out.passed=!error;if(error)out.error=String(error.stack||error);out.hidden=BaseWindow.getAllWindows().every(w=>!w.isVisible());fs.writeFileSync(process.argv[3]||'qa/artifacts/mac-page-zoom.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));for(const server of servers)server.close();app.exit(error?1:0)}
app.whenReady().then(async()=>{
 for(const server of servers)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const roots=servers.map(server=>'http://127.0.0.1:'+server.address().port);
 const ui=await poll(()=>all().find(w=>w.getURL()==='acira-browser-ui://ui/index.html'),Boolean,'Browser UI');
 async function open(url,privacy,target=ui){
  await call(target,'acira:dispatch',{type:'tab.new',url,...(privacy?{privacy}:{})});const id=snapshot(target).activeTabId;
  const page=await poll(()=>all().find(w=>w.getURL()===url),Boolean,'Page '+url);
  await poll(()=>snapshot(target).tabs.find(t=>t.id===id),v=>!v.loading&&!v.error,'Loaded '+url);return {id,page};
 }
 const zoom=(tab,value,target=ui)=>call(target,'acira:browser-command',{type:'zoom',tabId:tab.id,zoom:value});
 const a=await open(roots[0]+'/a');const baseline=await poll(()=>reports.findLast(r=>r.path==='/a'),Boolean,'Baseline');
 await zoom(a,200);const enlarged=await poll(()=>reports.findLast(r=>r.path==='/a'&&r.dpr>baseline.dpr*1.9),Boolean,'Actual scaling');
 assert(Math.abs(enlarged.width-baseline.width/2)<4);assert.equal(snapshot(ui).tabs.find(t=>t.id===a.id).zoom,200);assert.equal(ui.getZoomFactor(),1);
 out.viewport={baseline,enlarged,chromeFactor:ui.getZoomFactor()};out.checks.push('200% halves website viewport, doubles DPR, and leaves browser controls at100%');
 const b=await open(roots[0]+'/b');assert.equal(b.page.getZoomFactor(),2);out.checks.push('Another ordinary tab on the same origin inherits200%');
 const p=await open(roots[0]+'/private','private');assert.equal(p.page.getZoomFactor(),1);assert.equal(snapshot(ui).tabs.find(t=>t.id===p.id).zoom,100);out.checks.push('A private tab on that origin starts independently at100%');
 await zoom(p,150);assert.equal(p.page.getZoomFactor(),1.5);assert.equal(a.page.getZoomFactor(),2);assert.equal(b.page.getZoomFactor(),2);assert.equal(snapshot(ui).originZooms['profile-personal'][roots[0]],200);out.checks.push('Private150% leaves both ordinary pages and saved site preference at200%');
 await zoom(a,250);assert.equal(b.page.getZoomFactor(),2.5);assert.equal(p.page.getZoomFactor(),1.5);assert.equal(snapshot(ui).tabs.find(t=>t.id===p.id).zoom,150);out.checks.push('Ordinary250% synchronizes ordinary siblings while preserving private150%');
 const old=seq;p.page.reload();await poll(()=>reports.findLast(r=>r.path==='/private'&&r.seq>old),Boolean,'Private reload');assert.equal(p.page.getZoomFactor(),1.5);out.checks.push('Reload retains the private tab own150%');
 const c=await open(roots[1]+'/other');assert.equal(c.page.getZoomFactor(),1);await zoom(c,120);assert.equal(a.page.getZoomFactor(),2.5);assert.equal(p.page.getZoomFactor(),1.5);out.checks.push('A different origin starts100% and can zoom independently');
 await zoom(b,110);assert(Math.abs(a.page.getZoomFactor()-1.1)<0.001);assert.equal(c.page.getZoomFactor(),1.2);assert.equal(p.page.getZoomFactor(),1.5);out.checks.push('A targeted background-tab command scales its origin, without affecting active other-origin or private content');
 await zoom(a,100);assert.equal(a.page.getZoomFactor(),1);assert.equal(b.page.getZoomFactor(),1);out.checks.push('Reset100% restores both ordinary siblings');
 await call(ui,'acira:dispatch',{type:'settings.update',patch:{interfaceScale:125}});assert.equal(ui.getZoomFactor(),1.25);assert.equal(c.page.getZoomFactor(),1.2);assert.equal(p.page.getZoomFactor(),1.5);out.checks.push('125% interface scale remains independent of page zoom');
 await call(ui,'acira:dispatch',{type:'browser.profile.create',name:'Zoom isolation'});const otherId=snapshot(ui).browserProfiles.find(profile=>profile.id!=='profile-personal').id;
 await call(ui,'acira:dispatch',{type:'browser.profile.select',id:otherId});const otherUi=await poll(()=>all().find(w=>w.getURL()==='acira-browser-ui://ui/index.html'&&snapshot(w).activeBrowserProfileId===otherId),Boolean,'Other profile');
 const d=await open(roots[0]+'/profile',undefined,otherUi);assert.equal(d.page.getZoomFactor(),1);await zoom(d,175,otherUi);assert.equal(a.page.getZoomFactor(),1);assert.equal(p.page.getZoomFactor(),1.5);out.checks.push('A separate browser profile has its own site zoom');
 finish();
}).catch(finish);
