// Compare the final native window, including AppKit glass and the website beneath it.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{createRequire}from'node:module';
import{startApp,httpFixture,poll,sleep}from'./d-harness.mjs';
const require=createRequire(import.meta.url),{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,makeTab}=require('../desktop/runtime.cjs');
const stamp=Date.now(),root=path.resolve('.qa-profiles/sidebar-backdrop-'+stamp),out=path.resolve(process.env.SIDEBAR_BACKDROP_OUT||'qa/artifacts/sidebar-backdrop-'+stamp);await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const fixture=await httpFixture((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Backdrop fixture</title><style>html,body{margin:0;height:100%;background:#00ff00}</style><script>window.nonce=Math.random();</script>');});
const url='http://127.0.0.1:'+fixture.port+'/',s=createInitialState();s.tabs=[makeTab('backdrop-page','Backdrop fixture',url,s.activeBrowserProfileId)];s.activeTabId='backdrop-page';Object.assign(s.settings,{onboardingComplete:true,askBeforeClosing:false,verticalTabs:true,reducedMotion:true,sidebarWidth:240,sidebarPeek:{full:true,compact:true,focus:true}});Object.assign(s.windowUi,{workspaceOpen:true,webWorkspaceOpen:true});
const report={passed:false,nativePlatform:process.platform,checks:[]};let app;
try{
 for(const appearance of (process.env.FRAME_APPEARANCE?[process.env.FRAME_APPEARANCE]:['light','dark']))for(const view of ['compact','focus','full']){
 const caseRoot=path.join(root,appearance+'-'+view);await fs.mkdir(caseRoot,{recursive:true});
 const state=structuredClone(s);state.settings.appearance=appearance;state.windowUi.view=view;
 const db=new BrowserDatabase(path.join(caseRoot,'browser.sqlite'));db.saveWindow('main',state);db.close();
 app=await startApp({root:caseRoot,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1',ACIRA_BROWSER_TEST_HIDDEN:'0'}});
 await app.main(({app:electronApp,BaseWindow,screen})=>{const w=BaseWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html')),a=screen.getDisplayMatching(w.getBounds()).workArea;w.setBounds({x:a.x+50,y:a.y+50,width:Math.min(1280,a.width-100),height:Math.min(820,a.height-100)});w.show();electronApp.focus({steal:true});w.focus();w.isFocused=()=>true;screen.getCursorScreenPoint=()=>{const b=w.getContentBounds();return{x:b.x+700,y:b.y+400};};});
 const page=await app.waitWeb(url);
 const capture=async(name,points)=>{const data=await app.main(async({BaseWindow,desktopCapturer,screen},points)=>{const w=BaseWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html')),b=w.getBounds(),c=w.getContentBounds(),sf=screen.getDisplayMatching(b).scaleFactor;let source;for(let attempt=0;attempt<3;attempt++){source=(await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:Math.round(b.width*sf),height:Math.round(b.height*sf)}})).find(s=>s.id===w.getMediaSourceId());if(source&&!source.thumbnail.isEmpty())break;await new Promise(resolve=>setTimeout(resolve,150));}if(!source||source.thumbnail.isEmpty())throw Error('Owned window capture unavailable');const img=source.thumbnail,size=img.getSize(),bmp=img.toBitmap(),k=size.width/b.width;const pixel=p=>{const x=Math.round((c.x-b.x+p[0])*k),y=Math.round((c.y-b.y+p[1])*k),at=(y*size.width+x)*4;return[...bmp.subarray(at,at+4)];};return{points:points.map(pixel),png:img.toPNG().toString('base64')};},points);await fs.writeFile(path.join(out,name+'.png'),Buffer.from(data.png,'base64'));return data.points;};
 await poll(()=>app.ui.locator('.ed-rail.is-expanded:not(.is-peek)').count(),n=>n===1,'Original docked sidebar visible');await sleep(450);
  const points=await app.ui.evaluate(()=>{const r=document.querySelector('.ed-rail').getBoundingClientRect();return[[r.width*.72,innerHeight*.55],[r.width*.42,innerHeight*.65]];});
  const original=await capture(appearance+'-'+view+'-original',points);
  await app.act({type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false}});await sleep(350);const before=await page.evaluate(()=>({width:innerWidth,height:innerHeight,nonce}));
  await app.ui.evaluate(()=>window.acira.browserCommand({type:'edge',tabId:'backdrop-page',keys:{top:false,side:true}}));await app.ui.locator('.ed-rail.is-peek').waitFor({state:'visible'});await sleep(500);

  report.paint=await app.ui.evaluate(()=>{const a=document.querySelector('.app'),c=getComputedStyle(a,'::before');return{image:c.backgroundImage,color:c.backgroundColor,base:getComputedStyle(a).getPropertyValue('--sf-base-default'),platform:document.documentElement.dataset.platform,legacy:a.style.getPropertyValue('--sf-window-base'),links:[...document.styleSheets].map(s=>s.href)};});
  const hover=await capture(appearance+'-'+view+'-hover',points);
  const cornerPoints=await app.ui.evaluate(()=>{const r=document.querySelector('.page-area').getBoundingClientRect();return[[r.left+1,r.top+1],[r.left+9,r.top+9],[r.left+1,r.bottom-2],[r.left+9,r.bottom-10]];});
  const cornerPixels=await capture(appearance+'-'+view+'-rounded-corners',cornerPoints);
  assert(cornerPixels[0][1]-cornerPixels[0][0]<40&&cornerPixels[2][1]-cornerPixels[2][0]<40,'Both left page corners must have the curved frame cut-out');
  assert(cornerPixels[1][1]-cornerPixels[1][0]>120&&cornerPixels[3][1]-cornerPixels[3][0]>120,'The page just inside the curve must remain visible');
  await page.evaluate(()=>{document.documentElement.style.background='#ff00ff';document.body.style.background='#ff00ff';});await sleep(250);const changed=await capture(appearance+'-'+view+'-changed-page',points);
  const difference=(a,b)=>Math.max(...a.flatMap((rgba,i)=>rgba.slice(0,3).map((v,k)=>Math.abs(v-b[i][k]))));
  const row={appearance,view,original,hover,changed,originalDifference:difference(original,hover),pageBleed:difference(hover,changed)};report.checks.push(row);console.log(JSON.stringify(row));
  assert(row.originalDifference<=8,'Overlay must retain the original composited sidebar finish');assert(row.pageBleed<=2,'Changing website colors must not change the sidebar material');assert.deepEqual(await page.evaluate(()=>({width:innerWidth,height:innerHeight,nonce})),before);
  await app.close();app=null;
 }
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;}finally{await app?.close();await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,error:report.error,out}));}
