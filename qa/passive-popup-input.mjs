// Native geometry acceptance complements the recorded OS wheel regression:
// injecting input directly into a website WC alone would bypass this bug.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const require=createRequire(import.meta.url),root=path.resolve('.qa-profiles/passive-popup-input-'+Date.now());
const out=path.resolve(process.env.PASSIVE_INPUT_OUT||'qa/artifacts/passive-popup-input-'+Date.now());
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const report={passed:false,platform:process.platform,checks:[],scope:'Actual native popup input bounds, renderer placement and actions using a disposable profile. OS wheel routing is verified separately; direct WC input is not a substitute.'};
const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs'),initial=createInitialState();
Object.assign(initial.settings,{onboardingComplete:true,askBeforeClosing:false,reducedMotion:true});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',initial);db.close();
const fixture=await httpFixture((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Popup input '+req.url+'</title><button>Website button</button><input aria-label="Draft"><div style="height:5000px">Scrollable website</div>');});
const base='http://127.0.0.1:'+fixture.port;
let app;
const check=async(name,fn)=>{if(process.env.PASSIVE_INPUT_ONLY&&!name.includes(process.env.PASSIVE_INPUT_ONLY))return;await fn();report.checks.push(name);console.log('PASS '+name);};
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()),l=>l?.visible===true,'Browsing ready',60000);
 await app.act({type:'tab.new',url:base+'/stay'});const stay=(await app.state()).activeTabId;
 await (await app.waitWeb(base+'/stay')).locator('button').waitFor();
 const layout=()=>app.ui.evaluate(()=>window.acira.getBrowserLayout());
 const popup=async kind=>{await poll(layout,l=>l.overlay?.kind===kind,kind+' layout');const p=await poll(()=>app.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'Popup renderer');await p.locator('.sheet-popup').waitFor();return p;};
 const inspect=()=>app.main(({BaseWindow})=>{for(const win of BaseWindow.getAllWindows())for(const host of win.contentView.children)for(const child of host.children||[])if(child.webContents?.getURL().includes('view=overlay'))return{host:host.getBounds(),child:child.getBounds(),visible:host.getVisible(),scale:child.webContents.getZoomFactor(),size:win.getContentSize()};});
 const bounded=async p=>{
  // An animated host can move after the renderer becomes visible. Compare each
  // renderer sample with current, stable native bounds instead of freezing the
  // first native observation for the entire poll.
  await poll(async()=>{
   const before=await inspect();
   const rendered=await p.evaluate(()=>{const stage=document.querySelector('.native-popup-stage').getBoundingClientRect(),panel=document.querySelector('.sheet-popup').getBoundingClientRect();return{stage:{x:stage.x,y:stage.y},panel:{x:panel.x,y:panel.y,width:panel.width,height:panel.height},width:innerWidth,height:innerHeight};});
   const native=await inspect();return{...rendered,native,stable:JSON.stringify(before)===JSON.stringify(native)};
  },r=>{
   const n=r.native;if(!r.stable||!n?.visible||n.child.x!==0||n.child.y!==0||n.child.width!==n.host.width||n.child.height!==n.host.height)return false;
   return(n.child.width<n.size[0]||n.child.height<n.size[1])&&Math.abs(r.stage.x+n.host.x/n.scale)<1&&Math.abs(r.stage.y+n.host.y/n.scale)<1&&r.panel.width>0&&r.panel.height>0&&r.panel.x>=-1&&r.panel.y>=-1&&r.panel.x+r.panel.width<=r.width+1&&r.panel.y+r.panel.height<=r.height+1;
  },'Visible popup fits the stable bounded native renderer');
 };
 const close=async()=>{const l=await layout();if(l.overlay)await app.ui.evaluate(id=>window.acira.closeOverlay(id),l.overlay.id);await poll(layout,l=>!l.overlay,'Popup closed');await sleep(350);};
 for(const scale of [80,90,100,110,125,150]){
  await check('Undo toast input and action at '+scale+'% interface size',async()=>{
   await app.act({type:'settings.update',patch:{interfaceScale:scale}});
   const url=base+'/close-'+scale;await app.act({type:'tab.new',url});const id=(await app.state()).activeTabId;await(await app.waitWeb(url)).locator('button').waitFor();
   await app.act({type:'tab.close',id});await poll(()=>app.state(),s=>s.activeTabId===stay&&!s.tabs.some(t=>t.id===id),'Closed tab selects remaining website');
   const p=await popup('toast');await bounded(p);
   await p.getByRole('button',{name:'Undo',exact:true}).last().click();
   await poll(()=>app.state(),s=>s.tabs.some(t=>t.url===url),'Undo restores tab');
   await app.act({type:'tab.select',id:stay});await close();
  });
  await check('Status notice input at '+scale+'% interface size',async()=>{await app.act({type:'toast',text:'Input remains available',tone:'status'});await bounded(await popup('toast'));await poll(layout,l=>!l.overlay,'Status notice expires normally');await sleep(350);});
  await check('Zoom popup input at '+scale+'% interface size',async()=>{await app.cmd({type:'ui',tabId:stay,action:'open',kind:'zoom'});const p=await popup('zoom');await bounded(p);assert.ok(await p.locator('button').count()>0);await close();});
  await check('Menu keeps window coordinates and outside-dismiss input at '+scale+'%',async()=>{
   await app.cmd({type:'ui',tabId:stay,action:'open',kind:'menu'});const p=await popup('menu');
   await poll(inspect,n=>n?.visible&&n.child.width===n.size[0]&&n.child.height===n.size[1]&&n.child.x===-n.host.x&&n.child.y===-n.host.y,'Menu input unchanged');
   await poll(()=>p.evaluate(()=>document.querySelector('.native-popup-stage').getBoundingClientRect().x),x=>Math.abs(x)<1,'Menu canvas origin restored');await close();
  });
 }
 await check('Animated notices also keep native input inside their popup while opening and closing',async()=>{
  await app.act({type:'settings.update',patch:{interfaceScale:100,reducedMotion:false}});
  await app.act({type:'toast',text:'Animated input fixture',tone:'error'});
  const p=await popup('toast');await bounded(p);
  await p.getByRole('button',{name:'Dismiss',exact:true}).last().click();
  await poll(layout,l=>!l.overlay,'Animated notice expires');await sleep(350);
  await app.act({type:'settings.update',patch:{reducedMotion:true}});
 });
 await check('Persistent error notice reload recovers its cropped viewport',async()=>{await app.act({type:'toast',text:'Owned error notice',tone:'error'});const p=await popup('toast');await bounded(p);await p.reload();await p.locator('.t-toast').waitFor();await bounded(p);await p.getByRole('button',{name:'Dismiss',exact:true}).last().click();});
 await check('Collapsed tab-group preview keeps a bounded input canvas and working rows',async()=>{
  await app.act({type:'tab.new',url:base+'/group-member'});const member=(await app.state()).tabs.find(t=>t.url===base+'/group-member');await(await app.waitWeb(member.url)).locator('button').waitFor();await app.act({type:'tab.select',id:stay});
  await app.act({type:'tab.group.create',tabId:member.id,name:'Input fixture'});
  const group=(await app.state()).tabGroups.find(g=>g.name==='Input fixture');
  await app.act({type:'tab.group.update',id:group.id,keepActive:true,patch:{collapsed:true}});
  await app.ui.locator('.tab-group-badge').filter({hasText:'Input fixture'}).hover();
  const p=await popup('group-preview');await bounded(p);await p.locator('.group-preview-row').first().click();
  await poll(()=>app.state(),s=>s.activeTabId===member.id,'Preview row selects its tab');
 });
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{if(app){report.layout=await app.ui.evaluate(()=>window.acira.getBrowserLayout()).catch(()=>null);await app.ui.screenshot({path:path.join(out,'interface.png')}).catch(()=>{});}await app?.close();await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,out}));}
