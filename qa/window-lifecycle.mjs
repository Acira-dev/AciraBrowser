import {nativePage} from './native-helpers.mjs';
import {launchPreparedNative} from './prepared-native.mjs';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs');
const data=path.resolve('.qa-profiles/window-lifecycle');await fs.mkdir(data,{recursive:true});const seed=new BrowserDatabase(path.join(data,'browser.sqlite'));seed.saveWindow('main',createInitialState());seed.close();
let app;try{
 app=await launchPreparedNative({executablePath:process.env.ACIRA_TEST_EXECUTABLE,args:[path.resolve('desktop/main.cjs')],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1'}});
 const ui=await nativePage(app,'acira-browser-ui://ui/index.html');await ui.waitForFunction(()=>Boolean(window.acira));
 await ui.evaluate(()=>window.acira.openWindow('normal'));
 let normal;await assertEventually(async()=>{normal=app.context().pages().filter(p=>p.url().includes('acira-browser-ui://ui/index.html')&&!p.url().includes('?view=')).find(p=>p!==ui);return normal;});
 await normal.waitForFunction(()=>Boolean(window.acira));
 await normal.evaluate(()=>window.acira.dispatch({type:'bookmark.toggle',url:'https://example.org/window-bookmark'}));
 await assertEventually(async()=>{const state=await ui.evaluate(()=>window.acira.getSnapshot());return state.bookmarks.includes('https://example.org/window-bookmark');});
 await ui.evaluate(()=>window.acira.openWindow('private'));
 let privateUI;await assertEventually(async()=>{for(const page of app.context().pages()){if(page===ui||page===normal||!page.url().includes('acira-browser-ui://ui/index.html')||page.url().includes('?view='))continue;const state=await page.evaluate(()=>window.acira?.getSnapshot());if(state?.browserProfiles[0]?.private){privateUI=page;return true;}}});
 const privateState=await privateUI.evaluate(()=>window.acira.getSnapshot());assert.equal(privateState.bookmarks.length,0);assert.equal(privateState.browsingHistory.length,0);assert.equal(privateState.browserProfiles[0].partition.startsWith('persist:'),false);
 await privateUI.evaluate(()=>window.acira.dispatch({type:'tab.navigate',url:'https://private-fixture.invalid/path'}));
 await privateUI.evaluate(()=>window.acira.windowControl('close'));
 await assertEventually(async()=>!app.context().pages().includes(privateUI));
 const persisted=new BrowserDatabase(path.join(data,'browser.sqlite'));const rows=persisted.db.prepare('SELECT payload FROM windows').all();assert.ok(rows.length>=1);assert.equal(JSON.stringify(rows).includes('private-fixture'),false);assert.equal(JSON.stringify(rows).includes('Incognito'),false);persisted.close();
 console.log('PASS multiple windows, shared profile bookmarks, isolated nonpersistent incognito, no private restoration records');
}finally{await app?.close();}
async function assertEventually(fn){for(let i=0;i<80;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}assert.fail('Timed out waiting for window lifecycle');}
