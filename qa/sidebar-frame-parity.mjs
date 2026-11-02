// Compare actual mounted chrome with an immutable build from before the hover change.
// No account, real profile or hardware pointer is used.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const require=createRequire(import.meta.url),{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,makeTab}=require('../desktop/runtime.cjs');
const baseline=process.argv[2];if(!baseline)throw Error('Pass the original immutable candidate, then the candidate to compare (or .).');
const stamp=Date.now(),out=path.resolve(process.env.SIDEBAR_PARITY_OUT||'qa/artifacts/sidebar-frame-parity-'+stamp);await fs.mkdir(out,{recursive:true});
const fixture=await httpFixture((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Frame fixture</title><input aria-label="Draft"><script>window.probe={nonce:Math.random(),resizes:0};onresize=()=>probe.resizes++;</script>');});
const snapshots=[],report={passed:false,baseline:path.resolve(baseline),candidate:path.resolve(process.argv[3]||'.'),checks:[],nativePlatform:process.platform};
try{
 for(const [index,candidate]of [baseline,process.argv[3]||'.'].entries()){
  const root=path.resolve('.qa-profiles/sidebar-parity-'+stamp+'-'+index);await fs.mkdir(root,{recursive:true});const s=createInitialState();s.tabs=[makeTab('frame-a','Frame fixture','http://127.0.0.1:'+fixture.port+'/',s.activeBrowserProfileId)];s.activeTabId='frame-a';Object.assign(s.settings,{onboardingComplete:true,askBeforeClosing:false,verticalTabs:true,reducedMotion:true,sidebarPeek:{full:true,compact:true,focus:true},sidebarWidth:240});const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',s);db.close();
  const app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(candidate,'desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
  try{
   await app.main(({BaseWindow,screen})=>{const w=BaseWindow.getAllWindows()[0];w.setSize(1280,820);w.isFocused=()=>true;screen.getCursorScreenPoint=()=>{const r=w.getContentBounds();return{x:r.x+700,y:r.y+400};};});const page=await app.waitWeb('http://127.0.0.1:'+fixture.port+'/');await page.locator('input').fill('Keep the page');const rows=[];
   for(const appearance of ['light','dark'])for(const view of ['compact','focus','full']){
    await app.ui.evaluate(()=>window.acira.browserCommand({type:'edge',tabId:'frame-a',dismiss:'side',keys:{top:false,side:false}}));await sleep(200);
    await app.act({type:'settings.update',patch:{appearance,interfaceScale:100}});await app.act({type:'ui.update',patch:{view,workspaceOpen:false,webWorkspaceOpen:false}});await sleep(350);
    const before=await page.evaluate(()=>({width:innerWidth,height:innerHeight,nonce:probe.nonce}));
    await app.ui.evaluate(()=>window.acira.browserCommand({type:'edge',tabId:'frame-a',keys:{top:false,side:true}}));await app.ui.locator('.ed-rail.is-peek').waitFor({state:'visible'});await sleep(400);
    const snapshot=await app.ui.evaluate(()=>{const selectors=['.ed-rail','.browser-shell','.browser-toolbar','.address-bar','.sb-scroll','.sb-foot'],properties=['backgroundColor','backgroundImage','border','borderRadius','boxShadow','padding','margin','font','gap','position','display'];return{chrome:selectors.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),cs=getComputedStyle(el);return{selector,rect:{x:r.x,y:r.y,width:r.width,height:r.height},style:Object.fromEntries(properties.map(key=>[key,cs[key]]))};}),frame:Object.fromEntries(['backgroundColor','backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat'].map(key=>[key,document.documentElement.dataset.sidebarOverlay==='native'?document.querySelector('.app').style.getPropertyValue('--sf-bg-'+({backgroundColor:'color',backgroundImage:'image',backgroundSize:'size',backgroundPosition:'position',backgroundRepeat:'repeat'}[key])):getComputedStyle(document.querySelector('.app'))[key]]))};});
    rows.push({appearance,view,...snapshot});if(index===1)assert.deepEqual(await page.evaluate(()=>({width:innerWidth,height:innerHeight,nonce:probe.nonce})),before,'Website size and document must stay unchanged during hover');
   }
   snapshots.push(rows);
  }finally{await app.close();}
 }
 assert.deepEqual(snapshots[1],snapshots[0],'The sidebar and top bar must retain the original geometry and styling');report.checks.push('Original sidebar and top-bar styling and geometry match in all three views, light and dark');report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify({...report,snapshots},null,2)+'\n');console.log(JSON.stringify(report));}
