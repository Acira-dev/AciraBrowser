import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/research-audit');
const {createInitialState,reduceDemo,persistedSnapshot}=require('../desktop/runtime.cjs');
await fs.mkdir(out,{recursive:true});
let seed=reduceDemo(createInitialState(),{type:'demo.journey',context:'personal'});
seed.demo.frozen=true;seed.settings.interfaceScale=100;seed.settings.automaticCompact=false;seed.settings.bookmarksBar=false;seed.settings.reducedMotion=true;seed.windowUi.workspaceOpen=true;
seed.tabs.forEach(tab=>tab.panelOpen=false);seed=reduceDemo(seed,{type:'tab.new'});
const profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
const report={checks:[],errors:[],captures:[],limits:['Hidden Electron renderer images do not capture OS backdrop pixels or physical dragging.']};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:profile}});
 const ui=await app.firstWindow();ui.on('pageerror',error=>report.errors.push(error.message));
 await ui.waitForFunction(()=>window.__acira&&document.querySelector('.ed-workspace'));
 await ui.evaluate(()=>sessionStorage.removeItem('acira-study-tab-views'));
 const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action),state=()=>ui.evaluate(()=>window.acira.getSnapshot());
 const settle=()=>ui.waitForTimeout(100);
 const size=async(w,h)=>{await app.evaluate(({BaseWindow},size)=>BaseWindow.getAllWindows()[0].setContentSize(...size),[w,h]);await settle();};
 const capture=async(name,page=ui)=>{await page.evaluate(()=>document.fonts.ready);const data=await app.evaluate(async({webContents},url)=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()===url);for(let n=0;n<2;n++){await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});await new Promise(r=>setTimeout(r,90));}return(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64');},page.url());await fs.writeFile(path.join(out,name+'.png'),Buffer.from(data,'base64'));report.captures.push(name);};
 await size(1440,900);await capture('start-1440');
 const homeId=(await state()).activeTabId;
 await ui.getByRole('button',{name:'Bookmarks',exact:true}).click();await ui.locator('.ed-library h1').waitFor();
 const libraryId=(await state()).activeTabId;
 await act({type:'tab.new'});await ui.locator('.ed-start-composition').waitFor();
 check('A fresh tab opens Start after another tab opened Bookmarks',await ui.locator('.ed-start-composition').isVisible());
 await act({type:'tab.select',id:libraryId});await ui.locator('.ed-library h1').waitFor();
 check('Returning to the library tab retains its own view',(await ui.locator('.ed-library h1').textContent())==='Bookmarks');
 let before=await state();const row=ui.locator('.ed-bookmark-row .ed-page-row').first();await row.click({modifiers:['Control']});await settle();let after=await state();
 check('Ctrl-click a saved page opens a background tab',after.tabs.length===before.tabs.length+1&&after.activeTabId===before.activeTabId);
 before=after;await row.click({button:'middle'});await settle();after=await state();
 check('Middle-click a saved page opens a background tab',after.tabs.length===before.tabs.length+1&&after.activeTabId===before.activeTabId);
 await row.click({button:'right'});const overlay=app.context().pages().find(page=>page.url().includes('view=overlay'));
 await overlay.getByRole('button',{name:'Open in new tab',exact:true}).waitFor();
 check('Saved pages expose the original bookmark context menu',true);
 await ui.evaluate(()=>window.acira.closeOverlay());
 await act({type:'tab.select',id:after.tabs.at(-1).id});await settle();
 const websiteId=(await state()).activeTabId;const websiteUrl=(await state()).tabs.find(t=>t.id===websiteId).url;
 await ui.getByRole('button',{name:'Settings',exact:true}).click();await ui.locator('.browser-settings').waitFor();
 check('Settings preserves the previously open website',(await state()).tabs.find(t=>t.id===websiteId)?.url===websiteUrl&&(await state()).activeTabId!==websiteId);
 const settingsId=(await state()).activeTabId;
 const navigation=ui.getByRole('navigation',{name:'Settings sections'});
 report.settings=[];
 for(const name of ['Your experience','Profiles','Appearance','Tabs','Search engine','Privacy','Shortcuts','Acira','About Acira']){
   await navigation.getByRole('button',{name,exact:true}).click();await settle();
   const details=await navigation.locator('button').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,font:getComputedStyle(n).fontFamily,shadow:getComputedStyle(n).boxShadow})));
   check(`${name}: settings navigation stays 32px and shadow-free`,details.every(n=>Math.abs(n.height-32)<.1&&n.shadow==='none'&&n.font.includes('Geist')));
   report.settings.push({name,details});
   await capture('settings-'+name.toLowerCase().replaceAll(' ','-'));
 }
 await ui.getByRole('textbox',{name:'Search settings',exact:true}).fill('motion');
 check('Settings search finds controls, not only section names',await ui.locator('.bs-search-results').getByRole('button',{name:'Appearance',exact:true}).isVisible());
 check('Settings search keeps navigation stable',await navigation.getByRole('button').count()===9);
 await ui.locator('.bs-search-results').getByRole('button',{name:'Appearance',exact:true}).click();
 check('Search result opens the matching real setting',await ui.getByRole('switch',{name:'Reduce motion',exact:true}).isVisible());
 await ui.getByRole('button',{name:'Settings',exact:true}).click();
 check('Repeating Settings reuses its existing tab',(await state()).activeTabId===settingsId);
 for(const scale of [100,125]){
   await act({type:'settings.update',patch:{interfaceScale:scale}});await size(900,700);
   for(const name of ['Your experience','Appearance','Profiles']){
     await navigation.getByRole('button',{name,exact:true}).click();await settle();
     const overflow=await ui.locator('.browser-settings').evaluate(root=>{const page=root.querySelector('.bs-main');return{page:page.scrollWidth-page.clientWidth,root:root.scrollWidth-root.clientWidth};});
     check(`${name}: no horizontal clipping at 900px / ${scale}% interface`,overflow.page<=1&&overflow.root<=1);
     await capture(`narrow-${name.toLowerCase().replaceAll(' ','-')}-${scale}`);
   }
 }
 await act({type:'settings.update',patch:{interfaceScale:100}});await size(1440,900);
 await ui.getByRole('button',{name:'History',exact:true}).click();await capture('history');
 await ui.getByRole('button',{name:'Agent tasks',exact:true}).click();await capture('tasks');
 await ui.getByRole('button',{name:'Inbox',exact:true}).click();await capture('inbox');
 for(const scale of [100,125]){
   await act({type:'settings.update',patch:{interfaceScale:scale}});await size(900,700);
   await ui.getByRole('button',{name:'Agent tasks',exact:true}).click();await settle();
   const rows=await ui.locator('.ed-task-list-row').evaluateAll(nodes=>nodes.map(row=>{
     const bounds=row.getBoundingClientRect(),title=row.querySelector('.ed-task-identity').getBoundingClientRect(),controls=row.querySelector('.task-controls').getBoundingClientRect();
     return {identityWidth:title.width,stacked:controls.top>=title.bottom,bounded:controls.right<=bounds.right+1,overflow:row.scrollWidth-row.clientWidth};
   }));
   check(`Task actions fit below readable titles at 900px / ${scale}%`,rows.length>0&&rows.every(row=>row.identityWidth>=160&&row.stacked&&row.bounded&&row.overflow<=1));
   await capture(`narrow-tasks-${scale}`);
   await ui.getByRole('button',{name:'Inbox',exact:true}).click();await settle();
   check(`Inbox review action fits at 900px / ${scale}%`,await ui.locator('.attention-row').evaluateAll(rows=>rows.length>0&&rows.every(row=>row.scrollWidth<=row.clientWidth+1&&row.querySelector(':scope>.btn').getBoundingClientRect().left>=row.getBoundingClientRect().left)));
   await capture(`narrow-inbox-${scale}`);
 }
 await act({type:'settings.update',patch:{interfaceScale:100}});await size(1440,900);
 await act({type:'tab.select',id:homeId});await ui.getByRole('button',{name:'Workspace',exact:true}).click();
 check('Mode chevron honors its requested 12px size',await ui.locator('.ed-search-mode svg').evaluate(n=>n.getBoundingClientRect().width===12));
 await ui.getByRole('button',{name:'Search mode',exact:true}).click();await ui.getByRole('menuitemradio',{name:'Ask Acira',exact:true}).click();await settle();
 report.focusAfterMode=await ui.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),html:document.activeElement?.outerHTML.slice(0,400)}));
 await capture('start-mode');
 check('Mode choice returns focus to the editor',await ui.getByRole('textbox',{name:'Ask Acira',exact:true}).evaluate(n=>n===document.activeElement));
 await capture('start-mode');
 check('No uncaught renderer errors',report.errors.length===0);
 await ui.evaluate(()=>sessionStorage.setItem('acira-study-tab-views','null'));await ui.reload();
 await ui.locator('.ed-start-composition').waitFor();
 check('Invalid session-only navigation state recovers to the workspace',await ui.locator('.ed-start-composition').isVisible());
}catch(error){report.errors.push(error.stack);process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));}
