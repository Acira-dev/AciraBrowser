import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/chrome-responsive');
const {createInitialState,reduceDemo,persistedSnapshot}=require('../desktop/runtime.cjs');
await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(path.join(out,'profile-'));
let seed=createInitialState();seed.demo.frozen=true;seed.settings.reducedMotion=true;seed.settings.interfaceScale=100;seed.settings.automaticCompact=false;seed.settings.bookmarksBar=false;seed.windowUi.workspaceOpen=true;seed.windowUi.webWorkspaceOpen=false;seed.tabs.forEach(t=>t.panelOpen=false);
for(let i=0;i<12;i++)seed=reduceDemo(seed,{type:'tab.new'});
const members=seed.tabs.slice(-5).map(t=>t.id);
seed=reduceDemo(seed,{type:'tab.group.create',tabId:members[0],name:'Research and reference pages',color:'blue'});
const group=seed.tabGroups.find(g=>g.name==='Research and reference pages');
seed=reduceDemo(seed,{type:'tab.group.assign',tabIds:members,groupId:group.id});
await fs.writeFile(path.join(profile,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
const report={checks:[],layouts:[],errors:[],scope:'Isolated Electron responsive control geometry, keyboard focus and group interactions.'};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:profile}});
 const ui=await app.firstWindow();ui.on('pageerror',e=>report.errors.push(e.message));await ui.locator('.ed-workspace').waitFor();
 const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action);
 const state=()=>ui.evaluate(()=>window.acira.getSnapshot());
 for(const [width,height,scale]of [[1440,900,100],[900,700,100],[900,700,125]]){
  await act({type:'settings.update',patch:{interfaceScale:scale}});
  await app.evaluate(({BaseWindow},size)=>BaseWindow.getAllWindows()[0].setContentSize(...size),[width,height]);
  for(const expanded of [true,false]){
   await act({type:'ui.update',patch:{workspaceOpen:expanded}});await ui.waitForTimeout(240);
   const geometry=await ui.evaluate(id=>{
    const row=document.querySelector('.acira-tab-row').getBoundingClientRect(),tray=document.querySelector(`[data-group-tray="${id}"]:not(.compact)`).getBoundingClientRect();
    const controls=[...document.querySelectorAll('.acira-tab-row button:not(:disabled)')].filter(n=>!n.closest('[aria-hidden=true],[inert]')&&n.getBoundingClientRect().width>0).map(n=>({label:n.getAttribute('aria-label'),...Object.fromEntries(['left','right','top','bottom'].map(k=>[k,n.getBoundingClientRect()[k]])),inViewport:!!n.closest('.tab-strip-viewport')}));
    return{row:{left:row.left,right:row.right,top:row.top,bottom:row.bottom},tray:{top:tray.top,bottom:tray.bottom},controls,overflow:document.documentElement.scrollWidth>innerWidth};
   },group.id);
   report.layouts.push({width,height,scale,expanded,...geometry});
   const label=`${width}/${scale}/${expanded?'expanded':'hidden'}`;
   check(`${label}: grouped surface retains top and bottom breathing room`,geometry.tray.top>=geometry.row.top+2.9&&geometry.tray.bottom<=geometry.row.bottom-2.9);
   check(`${label}: permanent header actions stay inside their row`,!geometry.overflow&&geometry.controls.filter(c=>!c.inViewport).every(c=>c.left>=geometry.row.left&&c.right<=geometry.row.right+.5&&c.top>=geometry.row.top&&c.bottom<=geometry.row.bottom+.5));
   await act({type:'tab.group.update',id:group.id,patch:{collapsed:true}});await ui.waitForTimeout(100);
   check(`${label}: collapsing group preserves membership and hides member hit targets`,(await state()).tabs.filter(t=>t.group===group.name).length===members.length&&await ui.locator(`.browser-tab[data-tab-group="${group.id}"]:not([inert])`).count()===0);
   await act({type:'tab.group.update',id:group.id,patch:{collapsed:false}});await ui.waitForTimeout(100);
   check(`${label}: group expansion restores every member`,await ui.locator(`.browser-tab[data-tab-group="${group.id}"]:not([inert])`).count()===members.length);
  }
 }
 // Focus mode hides the standard header but must expose the correct restore button.
 await act({type:'settings.update',patch:{interfaceScale:100}});await act({type:'ui.update',patch:{workspaceOpen:true}});
 await ui.evaluate(()=>window.acira.browserCommand({type:'ui',tabId:window.__acira.getState().activeTabId,action:'focus-mode'}));await ui.waitForTimeout(150);
 await ui.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await ui.waitForTimeout(100);
 report.focus=await ui.evaluate(()=>({element:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),headerInert:document.querySelector('.acira-focus-row')?.inert}));
 check('Focus-mode collapse focuses its own visible restore control',await ui.evaluate(()=>document.activeElement?.getAttribute('aria-label')==='Expand sidebar'&&!!document.activeElement.closest('.acira-focus-row')));
 await ui.keyboard.press('Enter');await ui.waitForTimeout(100);
 check('Keyboard restores navigation in focus mode',await ui.getByRole('button',{name:'Collapse sidebar',exact:true}).isVisible());
 await ui.keyboard.press('Escape');await ui.waitForTimeout(100);
 check('Escape returns focus to the visible sidebar restore action',await ui.evaluate(()=>document.activeElement?.getAttribute('aria-label')==='Expand sidebar'&&!document.activeElement.closest('[inert]')));
 await ui.keyboard.press('Control+Shift+e');await ui.waitForTimeout(100);
 check('Original sidebar shortcut expands navigation',await ui.getByRole('button',{name:'Collapse sidebar',exact:true}).isVisible());
 await ui.keyboard.press('Control+Shift+e');await ui.waitForTimeout(100);
 check('Original sidebar shortcut fully hides navigation',await ui.locator('.ed-rail').evaluate(n=>n.getBoundingClientRect().width===0&&n.inert));
 await act({type:'ui.update',patch:{workspaceOpen:true,focusMode:false}});
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setContentSize(1050,700));await ui.waitForTimeout(200);
 const chooseSplit=async()=>{await ui.getByRole('button',{name:'Acira menu',exact:true}).click();const overlay=app.context().pages().find(p=>p.url().includes('view=overlay'));await overlay.getByRole('button',{name:'Split view',exact:true}).click();await overlay.locator('.popup-content-split .tab-result').first().click();await ui.waitForTimeout(180);};
 await chooseSplit();
 check('Split placement accounts for the full expanded sidebar width',(await state()).windowUi.split===null);
 await ui.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await chooseSplit();
 check('Hiding navigation frees enough width to open the same split',(await state()).windowUi.split!==null);
 await act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true}});
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setContentSize(1400,800));await ui.waitForTimeout(200);
 await ui.getByRole('button',{name:'Toggle Acira agent',exact:true}).click();await ui.waitForTimeout(100);
 check('Assistant does not squeeze split pages below the supported canvas width',!(await state()).tabs.find(t=>t.id===(seed.activeTabId)).panelOpen);
 check('No renderer errors',report.errors.length===0);
}catch(error){report.errors.push(error.stack);process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));}
