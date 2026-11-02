import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/side-tabs');
const {createInitialState,reduceDemo,persistedSnapshot}=require('../desktop/runtime.cjs');
await fs.mkdir(out,{recursive:true});
// A disposable profile with the sidebar open and a small group, so the sidebar has tabs to list.
let seed=createInitialState();
seed.demo.frozen=true;seed.settings.interfaceScale=100;seed.settings.automaticCompact=false;seed.settings.bookmarksBar=false;seed.settings.reducedMotion=true;seed.windowUi.workspaceOpen=true;seed.windowUi.webWorkspaceOpen=true;
seed.tabs.forEach(t=>t.panelOpen=false);
seed=reduceDemo(seed,{type:'tab.new'});
const profile=path.join(out,'profile');await fs.rm(profile,{recursive:true,force:true});await fs.mkdir(profile,{recursive:true});
await fs.writeFile(path.join(profile,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
const report={checks:[],errors:[]};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:profile}});
 const ui=await app.firstWindow();ui.on('pageerror',e=>report.errors.push(e.message));
 await ui.waitForFunction(()=>window.acira&&document.querySelector('.ed-rail.is-expanded'));
 const setTabs=on=>ui.evaluate(on=>{localStorage.setItem('acira-rail-prefs',JSON.stringify({tabs:on,folded:{}}));window.dispatchEvent(new Event('acira-rail-prefs'));},on);
 const layout=()=>ui.evaluate(()=>window.acira.getBrowserLayout());
 const settle=async(test)=>{for(let i=0;i<40;i++){const value=await layout();if(test(value))return value;await ui.waitForTimeout(100);}return layout();};
 await setTabs(true);
 // Page bounds publish once the header has finished changing height.
 let native=await settle(l=>l.captionHeight===44&&(l.pageBounds?.y??99)<=48);
 const shape=await ui.evaluate(()=>{const toolbar=document.querySelector('.acira-persistent-toolbar').getBoundingClientRect(),controls=[...document.querySelectorAll('.acira-persistent-toolbar button,.acira-persistent-toolbar .address-bar')].filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect().right);return {side:!!document.querySelector('.browser-root.side-tabs'),strip:getComputedStyle(document.querySelector('.acira-tab-row')).display,top:toolbar.top,height:toolbar.height,right:Math.max(...controls),width:innerWidth,caption:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--caption-width'))||138,drag:getComputedStyle(document.querySelector('.acira-persistent-toolbar')).webkitAppRegion,addressDrag:getComputedStyle(document.querySelector('.acira-persistent-toolbar .address-bar')).webkitAppRegion,sidebarTabs:document.querySelectorAll('.ed-rail-tab').length};});
 check('Sidebar tabs replace the top strip',shape.side&&shape.strip==='none'&&shape.sidebarTabs>=2);
 check('The toolbar becomes the top row',shape.top===0&&shape.height>=40);
 check('Native window controls take the toolbar height',native.captionHeight===44);
 check('Toolbar controls stop short of the window controls',shape.right<=shape.width-shape.caption);
 check('Empty toolbar space drags the window while the address field stays usable',shape.drag==='drag'&&shape.addressDrag==='no-drag');
 const pageTop=native.pageBounds?.y??native.views[0]?.bounds.y;
 check('The page starts directly under the single top row',pageTop<=48);
 await ui.screenshot({path:path.join(out,'side-tabs.png')}).catch(()=>{});
 await ui.getByRole('button',{name:'Collapse sidebar'}).click();
 native=await settle(l=>l.captionHeight===36&&(l.pageBounds?.y??0)>=76);
 const restored=await ui.evaluate(()=>({side:!!document.querySelector('.browser-root.side-tabs'),strip:getComputedStyle(document.querySelector('.acira-tab-row')).display}));
 check('Closing the sidebar brings the strip back',!restored.side&&restored.strip!=='none'&&native.captionHeight===36);
 await ui.screenshot({path:path.join(out,'restored.png')}).catch(()=>{});
 await setTabs(false);
 check('No renderer errors',report.errors.length===0);
}finally{await app?.close().catch(()=>{});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));
