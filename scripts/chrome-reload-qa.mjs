import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';

// Reloading or zooming a website must never act on Acira's own interface. On Windows and Linux, Electron's default
// menu carries Reload, Force reload and zoom accelerators that target whichever web contents has focus; with focus in
// the chrome that reloaded the whole interface (it vanished over the acrylic, then rebuilt). Acira handles these keys
// itself, so its menu must not carry those roles.
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/chrome-reload');
const {createInitialState,persistedSnapshot}=require('../desktop/runtime.cjs');
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'demo-state.json'),JSON.stringify(persistedSnapshot(createInitialState())));
const report={checks:[],errors:[]};
const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Reload fixture</title><p>Reload fixture</p>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const check=(name,result)=>{assert.ok(result,name);report.checks.push(name);console.log('PASS '+name);};
const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:out}});
try{
 const ui=await app.firstWindow();await ui.waitForFunction(()=>window.__acira&&window.acira);ui.on('pageerror',e=>report.errors.push(e.message));
 const roles=await app.evaluate(({Menu})=>{const walk=menu=>(menu?.items||[]).flatMap(item=>[String(item.role||'').toLowerCase(),...walk(item.submenu)]).filter(Boolean);return walk(Menu.getApplicationMenu());});
 check('No menu accelerator can reload or zoom the interface',!roles.some(role=>['reload','forcereload','zoomin','zoomout','resetzoom'].includes(role)));
 const loads=await app.evaluate(async({Menu,BaseWindow,webContents})=>{const chrome=webContents.getAllWebContents().find(w=>w.getURL()==='http://127.0.0.1:5188/');let started=0;chrome.on('did-start-loading',()=>started++);const walk=menu=>(menu?.items||[]).flatMap(item=>[item,...walk(item.submenu)]);for(const item of walk(Menu.getApplicationMenu()).filter(item=>item.role&&!/devtools|quit|close|minimize/i.test(item.role)))item.click(undefined,BaseWindow.getAllWindows()[0],chrome);await new Promise(r=>setTimeout(r,1200));return started;});
 check('Menu commands aimed at the interface never reload it',loads===0);
 await ui.evaluate(url=>window.acira.dispatch({type:'tab.navigate',url}),origin);
 await ui.waitForFunction(()=>window.__acira.getState().tabs.some(tab=>tab.title==='Reload fixture'),null,{timeout:15000});
 await app.evaluate(({webContents},origin)=>{globalThis.__pageLoads=0;globalThis.__chromeLoads=0;webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin)).on('did-start-loading',()=>globalThis.__pageLoads++);webContents.getAllWebContents().find(w=>w.getURL()==='http://127.0.0.1:5188/').on('did-start-loading',()=>globalThis.__chromeLoads++);},origin);
 // Synthetic CDP keys skip Electron's before-input-event in hidden windows, so deliver Ctrl+R the way Electron does.
 await app.evaluate(({webContents})=>{const chrome=webContents.getAllWebContents().find(w=>w.getURL()==='http://127.0.0.1:5188/');chrome.emit('before-input-event',{preventDefault(){}},{type:'keyDown',key:'r',code:'KeyR',control:true,shift:false,alt:false,meta:false,isAutoRepeat:false});});
 await ui.waitForTimeout(1200);
 const counts=await app.evaluate(()=>({page:globalThis.__pageLoads,chrome:globalThis.__chromeLoads}));
 check('Ctrl+R from the interface reloads the page, not the interface',counts.page>=1&&counts.chrome===0);
 check('No renderer errors',report.errors.length===0);
}finally{await app.close().catch(()=>{});server.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
