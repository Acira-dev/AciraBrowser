import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchPreparedNative} from './prepared-native.mjs';
import {nativePage} from './native-helpers.mjs';
const data=await fs.mkdtemp(path.resolve('.qa-profiles/mac-menu-lifecycle-'));
let app;const report={profile:data,checks:[]};
try{
 app=await launchPreparedNative({args:[path.resolve('desktop/main.cjs')],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_DEV:'0'}});
 const normal=await nativePage(app,'acira-browser-ui://ui/index.html');await normal.waitForFunction(()=>Boolean(window.acira));
 await normal.evaluate(()=>window.acira.openWindow('private'));
 let privateUI;for(let i=0;i<150;i++){for(const p of app.context().pages()){if(p===normal||!p.url().includes('acira-browser-ui://ui/index.html')||p.url().includes('?'))continue;if(await p.evaluate(async()=> (await window.acira?.getSnapshot())?.browserProfiles?.[0]?.private)){privateUI=p;break;}}if(privateUI)break;await new Promise(r=>setTimeout(r,100));}assert(privateUI,'private runtime appeared');
 await privateUI.evaluate(()=>window.acira.windowControl('close'));
 for(let i=0;i<150&&app.context().pages().includes(privateUI);i++)await new Promise(r=>setTimeout(r,100));assert(!app.context().pages().includes(privateUI));
 const before=await normal.evaluate(async()=> (await window.acira.getSnapshot()).tabs.length);
 await app.evaluate(({Menu,BaseWindow})=>{const owner=BaseWindow.getAllWindows().find(w=>w.getTitle()==='Acira');const item=Menu.getApplicationMenu().items.find(m=>m.label==='File').submenu.items.find(m=>m.label==='New Tab');item.click(item,owner,{});});
 await normal.waitForFunction(async n=>(await window.acira.getSnapshot()).tabs.length===n+1,before,{timeout:10000});report.checks.push('Actual app-global File > New Tab targets the surviving ordinary window after the newer private window closes');
 const quit=app.waitForEvent('close',{timeout:15000});
 await app.evaluate(({Menu})=>{const item=Menu.getApplicationMenu().items[0].submenu.items.find(m=>m.label==='Quit Acira');item.click(item,undefined,{});});await quit;app=null;report.checks.push('Actual app-global Quit exits normally with no window owner, including encrypted session shutdown');report.passed=true;
}catch(e){report.passed=false;report.error=String(e.stack||e);throw e;}finally{await fs.writeFile(path.resolve('../../work/clean-release-20261027/native-menu-repair.json'),JSON.stringify(report,null,2)+'\n');await app?.close();}
console.log(JSON.stringify(report,null,2));
