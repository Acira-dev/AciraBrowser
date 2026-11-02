// Hidden actual-main split geometry and lower glass endpoint checks. Owned loopback documents only.
const {app,ipcMain,webContents,BaseWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
fs.mkdirSync('.qa-profiles',{recursive:true});const profile=fs.mkdtempSync(path.resolve('.qa-profiles/mac-split-glass-'));
Object.assign(process.env,{ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_DEV:'0'});
// Mark only this disposable fixture profile set up before the renderer loads.
new (require(path.resolve('desktop/accounts/onboarding.cjs')).OnboardingStore)({directory:path.join(profile,'setup')}).update('profile-personal',{complete:true,step:'finish'});
const routes=new Map(),handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,f)=>{routes.set(c,f);return handle(c,f)};
const product=path.resolve(process.argv[2]||'desktop');require(path.join(product,'main.cjs'));
const call=(ui,c,...a)=>routes.get(c)({sender:ui,senderFrame:ui.mainFrame},...a),snap=ui=>call(ui,'acira:snapshot'),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,ok,label){for(let i=0;i<450;i++){const v=await fn();if(ok(v))return v;await wait(25)}throw Error(label)}
const server=http.createServer((q,r)=>r.end('<!doctype html><title>Owned split '+q.url+'</title><p>Owned pane</p>'));
const report={checks:[],scope:'Actual hidden Mac main and renderer layout, four owned loopback pages. Native view bounds/state only; no physical pixel or timing claim.'};let done=false;
const deadline=setTimeout(()=>finish(Error('Split/glass deadline')),40000);app.on('before-quit',e=>{if(!done)e.preventDefault()});
function finish(error){if(done)return;done=true;clearTimeout(deadline);report.passed=!error;report.product=product;if(error)report.error=String(error.stack||error);report.hidden=BaseWindow.getAllWindows().every(w=>!w.isVisible());fs.writeFileSync(process.argv[3]||'qa/artifacts/mac-split-glass.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));server.close();app.exit(error?1:0)}
app.whenReady().then(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+server.address().port;
 const ui=await poll(()=>webContents.getAllWebContents().find(w=>!w.isDestroyed()&&w.getURL()==='acira-browser-ui://ui/index.html'),Boolean,'UI');
 await call(ui,'acira:dispatch',{type:'settings.update',patch:{onboardingComplete:true,reducedMotion:true,glassOpacity:40,translucentOpacity:40}});
 assert.equal(snap(ui).settings.glassOpacity,40);report.checks.push('Native settings boundary accepts forty-percent glass and remembered opacity');
 await call(ui,'acira:dispatch',{type:'settings.update',patch:{reducedTransparency:true}});assert.equal(snap(ui).settings.glassOpacity,100);report.checks.push('Solid endpoint remembers lower glass choice');
 await call(ui,'acira:dispatch',{type:'settings.update',patch:{reducedTransparency:false}});assert.equal(snap(ui).settings.glassOpacity,40);report.checks.push('Returning to glass restores forty percent');
 const ids=[];for(let i=0;i<4;i++){await call(ui,'acira:dispatch',{type:'tab.new',url:root+'/'+i});ids.push(snap(ui).activeTabId);}
 await call(ui,'acira:dispatch',{type:'split.open',tabIds:ids,layout:'grid'});
 await poll(()=>call(ui,'acira:get-layout'),l=>l?.views?.length===4,'Four renderer layout panes');
 const owner=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(c=>c.webContents===ui));
 const panes=()=>owner.contentView.children.filter(c=>c.webContents&&!c.webContents.isDestroyed()&&c.webContents.getURL().startsWith(root)&&c.getVisible());
 await poll(()=>{report.lastLayout=call(ui,'acira:get-layout');report.children=owner.contentView.children.map(c=>({type:c.constructor.name,url:c.webContents?.getURL(),visible:c.getVisible(),bounds:c.getBounds()}));report.state=snap(ui).windowUi;return panes()},v=>v.length===4,'Four native page views');const before=panes().map(v=>v.getBounds());
 for(let i=0;i<before.length;i++)for(let j=i+1;j<before.length;j++){const a=before[i],b=before[j];assert(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}
 report.checks.push('Four visible native page panes fit without overlapping');
 await call(ui,'acira:dispatch',{type:'split.resize',cols:[.4,.6],rows:[.55,.45]});
 await poll(()=>panes().map(v=>v.getBounds()),v=>v.length===4&&v.some((b,i)=>b.width!==before[i]?.width),'Native split resize');
 assert.deepEqual(snap(ui).windowUi.split.cols,[.4,.6]);report.checks.push('Grid edge/corner fractions resize the native panes');
 await call(ui,'acira:dispatch',{type:'split.swap',a:ids[0],b:ids[3]});assert.equal(snap(ui).windowUi.split.tabIds[0],ids[3]);report.checks.push('Swapping panes retains the same four tabs');
 await call(ui,'acira:dispatch',{type:'split.remove',tabId:ids[1]});assert.equal(snap(ui).windowUi.split.tabIds.length,3);assert(snap(ui).tabs.some(t=>t.id===ids[1]));report.checks.push('Removing a pane retiles three and keeps its tab');
 await call(ui,'acira:dispatch',{type:'split.close'});assert.equal(snap(ui).windowUi.split,null);assert(ids.every(id=>snap(ui).tabs.some(t=>t.id===id)));report.checks.push('Exiting split retains every owned tab');
 finish();
}).catch(finish);
