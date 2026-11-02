import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url), root=process.cwd(), out=path.join(root,'qa/editor-pass');
await fs.mkdir(out,{recursive:true});
const {createInitialState,persistedSnapshot}=require('../desktop/runtime.cjs');
const seed=createInitialState();seed.demo.frozen=true;seed.settings.interfaceScale=100;seed.settings.automaticCompact=false;seed.settings.bookmarksBar=false;seed.windowUi.workspaceOpen=true;
seed.tabs.forEach(t=>t.panelOpen=false);
const profile=path.join(out,'visual-profile');await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
let app;
const results={errors:[],captures:[],checks:[]};
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:profile}});
 const ui=await app.firstWindow();ui.on('pageerror',e=>results.errors.push(e.message));ui.on('console',m=>{if(m.type()==='error')results.errors.push(m.text());});
 await ui.waitForFunction(()=>window.__acira&&document.querySelector('.ed-start-composition'));
 await ui.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));});
 const capture=async(name)=>{
   const data=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()==='http://127.0.0.1:5188/');for(let i=0;i<3;i++){await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});await new Promise(resolve=>setTimeout(resolve,120));}const image=await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});return image.toPNG().toString('base64');});
   await fs.writeFile(path.join(out,name+'.png'),Buffer.from(data,'base64'));results.captures.push(name);
 };
 for(const [width,height]of [[1440,900],[1920,1080],[900,700]]){
   await app.evaluate(({BaseWindow},size)=>BaseWindow.getAllWindows()[0].setContentSize(...size),[width,height]);await ui.waitForTimeout(300);
   await capture('expanded-'+width);
 }
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setContentSize(1440,900));
 await ui.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
 await ui.waitForFunction(()=>document.querySelector('.ed-rail').getBoundingClientRect().width===0);
 await capture('collapsed-1440');
 await ui.getByRole('button',{name:'Search mode',exact:true}).click();await ui.waitForTimeout(300);
 results.checks.push({modeMenu:await ui.getByRole('menuitemradio').allTextContents()});
 await capture('mode-menu');
 await ui.getByRole('button',{name:'Search mode',exact:true}).click();await ui.waitForTimeout(180);
 const openingFrames=[];
 await ui.getByRole('button',{name:'Search mode',exact:true}).click();const began=Date.now();
 for(const requestedMs of [0,50,100,300]){
   await ui.waitForTimeout(Math.max(0,requestedMs-(Date.now()-began)));
   const foreground=await ui.locator('.ed-mode-menu>div').evaluate(n=>({opacity:getComputedStyle(n).opacity,filter:getComputedStyle(n).filter,inlineFilter:n.style.filter}));
   const observedMs=Date.now()-began;
   const data=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()==='http://127.0.0.1:5188/');return(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64');});
   const file=`formation-${requestedMs}.png`;await fs.writeFile(path.join(out,file),Buffer.from(data,'base64'));
   openingFrames.push({requestedMs,observedMs,file,...foreground});
 }
 results.formation={scope:'Electron renderer foreground; native compositor review remains separate',frames:openingFrames};
 if(openingFrames.at(-1).filter!=='none')throw new Error('Foreground retained a finished blur effect');
 await ui.getByRole('button',{name:'Search mode',exact:true}).click();
 await ui.getByRole('button',{name:'Expand sidebar',exact:true}).click();
 await ui.getByRole('button',{name:'Settings',exact:true}).click();await ui.locator('.browser-settings').waitFor();await capture('settings-experience');
 await ui.getByRole('button',{name:'Appearance',exact:true}).click();await capture('settings-appearance');
 await ui.getByRole('button',{name:'Workspace',exact:true}).click();await ui.locator('.ed-start-composition').waitFor();
 const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action);
 const ids=await ui.evaluate(()=>window.__acira.getState().tabs.slice(-2).map(t=>t.id));
 await act({type:'tab.group.create',tabId:ids[0],name:'Research',color:'blue'});
 await ui.waitForFunction(()=>window.__acira.getState().tabGroups.some(g=>g.name==='Research'));
 const group=await ui.evaluate(()=>window.__acira.getState().tabGroups.find(g=>g.name==='Research'));
 await act({type:'tab.group.assign',tabIds:ids,groupId:group.id});
 await capture('group-blue');
 await act({type:'tab.group.update',id:group.id,patch:{color:'red'}});await capture('group-red');
}catch(error){results.errors.push(error.stack);throw error;}
finally{if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(out,'visual-report.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));}
