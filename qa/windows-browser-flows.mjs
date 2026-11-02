// Real Windows acceptance uses the actual caption, web views and isolated data.
// --renderer-only is a local macOS diagnostic and cannot qualify Windows itself.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const rendererOnly=process.argv.includes('--renderer-only');
if(process.platform!=='win32'&&!rendererOnly)throw Error('Run on Windows, or explicitly select --renderer-only diagnostics.');
const candidate=process.argv.slice(2).find(value=>!value.startsWith('--'));
const require=createRequire(import.meta.url),{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs');
const stamp=Date.now(),root=path.resolve('.qa-profiles/windows-flows-'+stamp),out=path.resolve(process.env.WINDOWS_FLOWS_OUT||'qa/artifacts/windows-flows-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const initial=createInitialState();Object.assign(initial.settings,{onboardingComplete:true,askBeforeClosing:false,reducedMotion:true,language:'en',appearance:'light'});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',initial);db.close();
const report={passed:false,nativeWindows:process.platform==='win32',rendererOnly,checks:[],errors:[],canonicalAppUntouched:true};
let app,server;
const save=()=>fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
const closePopup=async()=>{const layout=await app.ui.evaluate(()=>window.acira.getBrowserLayout());if(layout?.overlay)await app.ui.evaluate(id=>window.acira.closeOverlay(id),layout.overlay.id);await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()),l=>!l?.overlay,'Popup dismissed');};
const mainWindow=fn=>app.main(({BaseWindow},fn)=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'));return {size:w.getContentSize(),pages:w.contentView.children.filter(v=>v.webContents?.getURL().startsWith('http://127.0.0.1:')&&v.getVisible()).map(v=>({url:v.webContents.getURL(),bounds:v.getBounds()}))};});
async function check(name,fn){try{const detail=await fn();report.checks.push({name,passed:true,...(detail?{detail}:{})});console.log('PASS '+name);await save();}catch(error){report.checks.push({name,passed:false,error:String(error.stack||error)});throw error;}}
async function openWorkspace(){
 const trigger=app.ui.locator('[data-workspace-new]').filter({visible:true});
 if(await trigger.count()){await trigger.click();return;}
 await app.ui.locator('.sb-foot-profile,.toolbar-optional-profile,.toolbar-overflow-profile').filter({visible:true}).first().click();
 const profile=await poll(()=>app.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'Profile menu');
 await profile.locator('[data-profile-workspace-new]').click();
}
async function newPage(base,name){await app.act({type:'tab.new',url:base+'/'+name});const web=await app.waitWeb(base+'/'+name);await web.locator('input').fill('Draft '+name);return{id:(await app.state()).activeTabId,web,url:base+'/'+name};}
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_TEST_QUIET_NETWORK:'1',ACIRA_QA_MAIN:path.resolve(candidate||'.','desktop/main.cjs')}});
 app.ui.setDefaultTimeout(10000);const listen=p=>p.on('pageerror',error=>report.errors.push(error.message));app.context.pages().forEach(listen);app.context.on('page',listen);
 if(rendererOnly)await app.ui.evaluate(()=>document.documentElement.dataset.platform='win32');
 server=await httpFixture((request,response)=>{response.setHeader('Content-Type','text/html');response.end('<title>Windows browser fixture '+request.url+'</title><h1>Browser fixture</h1><input aria-label="Fixture draft">');});
 const base='http://127.0.0.1:'+server.port;
 await check('New tabs preserve the preceding live website and input',async()=>{const p=await newPage(base,'first');for(let i=0;i<8;i++)await app.act({type:'tab.new'});await app.act({type:'tab.select',id:p.id});assert.equal(await p.web.locator('input').inputValue(),'Draft first');});
 await check('New-tab button opens a usable page',async()=>{const count=(await app.state()).tabs.length;await app.ui.getByRole('button',{name:'New tab',exact:true}).filter({visible:true}).first().click();await poll(()=>app.state(),s=>s.tabs.length===count+1,'New-tab button');await app.ui.locator('.nt-page').filter({visible:true}).waitFor();});
 if(report.nativeWindows)await check('Windows Ctrl+T opens a tab from the native website view',async()=>{
  const current=await app.state(),website=current.tabs.find(t=>t.url===base+'/first');await app.act({type:'tab.select',id:website.id});
  const count=(await app.state()).tabs.length;
  await app.main(({webContents},url)=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()===url);wc.focus();for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'T',modifiers:['control']});},base+'/first');
  await poll(()=>app.state(),s=>s.tabs.length===count+1,'Windows native Ctrl+T');
 });
 await check('A new browser window opens and closes without losing the original window',async()=>{
  const previous=app.ui;await previous.evaluate(()=>window.acira.openWindow('normal'));
  const other=await poll(()=>app.context.pages().find(p=>p!==previous&&p.url()==='acira-browser-ui://ui/index.html'),Boolean,'Second browser window');await other.waitForFunction(()=>Boolean(window.acira?.getSnapshot));await other.locator('.browser-shell').waitFor();
  await other.evaluate(()=>window.acira.windowControl('close'));await poll(()=>app.context.pages().includes(other),shown=>!shown,'Second window closed');assert(app.context.pages().includes(previous));
 });
 await check('New workspace editor fits and its create action works',async()=>{
  await app.act({type:'settings.update',patch:{verticalTabs:true}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true}});
  await openWorkspace();
  const overlay=await poll(()=>app.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'Native workspace popup');await overlay.locator('#ws-edit-name').waitFor();
  const layout=await app.ui.evaluate(()=>window.acira.getBrowserLayout());
  if(report.nativeWindows)assert(layout.overlay.bounds.y>=Math.max(layout.captionHeight||0,layout.pageBounds?.y||0)+7,'Workspace form starts below Windows header');
  await overlay.locator('#ws-edit-name').fill('Windows flow workspace');await overlay.locator('form.ws-edit button[type=submit]').scrollIntoViewIfNeeded();await overlay.locator('form.ws-edit button[type=submit]').click();
  await poll(()=>app.state(),s=>s.workspaces.some(w=>w.name==='Windows flow workspace')&&s.activeWorkspaceId===s.workspaces.find(w=>w.name==='Windows flow workspace').id,'Workspace created and selected');
 });
 const work=(await app.state()).activeWorkspaceId,original=(await app.state()).workspaces.find(w=>w.id!==work).id;
 const pages=[];for(const name of ['alpha','beta','gamma','delta'])pages.push(await newPage(base,name));
 await check('Switching workspaces restores their tabs and live form state',async()=>{await app.act({type:'workspace.select',id:original});assert.equal((await app.state()).activeWorkspaceId,original);await app.act({type:'workspace.select',id:work});await app.act({type:'tab.select',id:pages[0].id});assert.equal(await pages[0].web.locator('input').inputValue(),'Draft alpha');});
 await app.main(({BaseWindow})=>BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html')).setSize(1600,1000));
 await app.act({type:'settings.update',patch:{verticalTabs:false,interfaceScale:100}});
 for(const layout of ['columns','rows','grid'])await check('Native split view: '+layout,async()=>{
  await app.act({type:'split.close'});await app.act({type:'split.open',tabIds:pages.slice(0,layout==='grid'?4:2).map(p=>p.id),layout});
  const count=layout==='grid'?4:2;await poll(()=>mainWindow(),r=>r.pages.length===count,'Correct number of visible native split panes');
  const frame=await mainWindow();for(const p of frame.pages){assert(p.bounds.width>0&&p.bounds.height>0);assert(p.bounds.x>=0&&p.bounds.y>=0&&p.bounds.x+p.bounds.width<=frame.size[0]+1&&p.bounds.y+p.bounds.height<=frame.size[1]+1);}
  for(let i=0;i<frame.pages.length;i++)for(let j=i+1;j<frame.pages.length;j++){const a=frame.pages[i].bounds,b=frame.pages[j].bounds;assert(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<1||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<1,'Native panes do not overlap');}
  if(layout==='columns'){
   const before=frame.pages.map(p=>p.bounds.width),separator=app.ui.getByRole('separator').filter({visible:true}).first();await separator.press('ArrowRight');
   await poll(()=>mainWindow(),r=>r.pages.some((p,i)=>Math.abs(p.bounds.width-before[i])>1),'Keyboard split resize updates native pane bounds');await separator.press('Home');
  }
  return {panes:count};
 });
 await check('Closing split view keeps every tab and website draft',async()=>{await app.act({type:'split.close'});for(const p of pages){await app.act({type:'tab.select',id:p.id});assert.equal(await p.web.locator('input').inputValue(),'Draft '+p.url.split('/').at(-1));}await poll(()=>mainWindow(),r=>r.pages.length===1,'Only the active native page is visible');});
 for(const scale of [100,125,150])for(const view of ['full','compact','focus','seamless'])await check(`Tabs and page bounds at ${scale}% in ${view}`,async()=>{
  await app.act({type:'settings.update',patch:{interfaceScale:scale,windowView:view}});await app.act({type:'ui.update',patch:{view}});
  await app.act({type:'tab.new'});await app.ui.locator('.nt-page').filter({visible:true}).waitFor();
  const heading=await app.ui.locator('.nt-workspace-title h1').evaluate(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}));assert(heading.width>150,'New-tab heading keeps a usable width');
  await app.act({type:'tab.select',id:pages[0].id});await poll(()=>mainWindow(),r=>r.pages.length===1&&r.pages[0].url===pages[0].url,'Website returns after new tab');assert.equal(await pages[0].web.locator('input').inputValue(),'Draft alpha');
 });
 await app.act({type:'settings.update',patch:{windowView:'full',verticalTabs:true}});await app.act({type:'ui.update',patch:{view:'full',workspaceOpen:true,webWorkspaceOpen:true}});
 for(const [width,height,scale]of [[900,600,100],[900,600,125],[900,600,150],[1280,800,150]])await check(`Workspace form remains reachable at ${width}x${height}, ${scale}%`,async()=>{
  await app.main(({BaseWindow},size)=>BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html')).setSize(...size),[width,height]);await app.act({type:'settings.update',patch:{interfaceScale:scale}});await sleep(200);
  await openWorkspace();const overlay=await poll(()=>app.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'Workspace overlay');await overlay.locator('#ws-edit-name').waitFor();
  const l=await app.ui.evaluate(()=>window.acira.getBrowserLayout());if(report.nativeWindows)assert(l.overlay.bounds.y>=Math.max(l.captionHeight||0,l.pageBounds?.y||0)+7);
  await overlay.locator('#ws-edit-name').fill('Reachable workspace');const create=overlay.locator('form.ws-edit button[type=submit]');await create.scrollIntoViewIfNeeded();assert(await create.isVisible());assert(await create.isEnabled());
  await overlay.screenshot({path:path.join(out,`workspace-${width}-${height}-${scale}.png`)});await closePopup();
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=String(error.stack||error);process.exitCode=1;console.error(error);}
finally{await app?.close();await server?.close();report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({passed:report.passed,nativeWindows:report.nativeWindows,checks:report.checks.length,failed:report.checks.filter(c=>!c.passed).map(c=>c.name),failure:report.failure,out},null,2));}
