import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

// A website playing sound: its tab shows a speaker, clicking it mutes the page, and the tab menu offers the same.
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/tab-audio');
const {createInitialState,persistedSnapshot}=require('../desktop/runtime.cjs');
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
const seed=createInitialState();seed.settings.interfaceScale=100;
await fs.writeFile(path.join(out,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
const page='<!doctype html><title>Tone fixture</title><p>Tone</p><script>const c=new AudioContext();const o=c.createOscillator(),g=c.createGain();g.gain.value=.02;o.connect(g).connect(c.destination);o.start();</script>';
const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(page);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const report={checks:[],errors:[]};
const check=(name,result)=>{assert.ok(result,name);report.checks.push(name);console.log('PASS '+name);};
const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:out}});
try{
 const ui=await app.firstWindow();await ui.waitForFunction(()=>window.__acira&&window.acira);ui.on('pageerror',e=>report.errors.push(e.message));
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setContentSize(1440,900));
 await ui.evaluate(url=>window.acira.dispatch({type:'tab.navigate',url}),origin);
 const state=()=>ui.evaluate(()=>window.acira.getSnapshot());
 const waitFor=async(fn,ms=8000)=>{const end=Date.now()+ms;for(;;){if(await fn())return true;if(Date.now()>end)return false;await ui.waitForTimeout(150);}};
 const tabId=(await state()).activeTabId;
 check('A tab playing sound shows a speaker',await waitFor(async()=>(await state()).tabs.find(t=>t.id===tabId)?.audible===true)&&await waitFor(()=>ui.locator('.tab-audio').first().isVisible()));
 await ui.locator('.tab-audio').first().evaluate(button=>button.click());
 const muted=()=>app.evaluate(({webContents},origin)=>webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin))?.isAudioMuted(),origin);
 check('Clicking the speaker mutes the page',await waitFor(async()=>(await state()).tabs.find(t=>t.id===tabId)?.muted===true&&await muted()===true));
 check('A muted tab says so',await ui.locator('.tab-audio.is-muted').count()===1);
 await ui.locator('.tab-audio').first().evaluate(button=>button.click());
 check('Clicking again unmutes it',await waitFor(async()=>await muted()===false));
 check('No renderer errors',report.errors.length===0);
}finally{await app.close().catch(()=>{});server.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
