import {nativePage} from './native-helpers.mjs';
import {launchPreparedNative} from './prepared-native.mjs';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const root=process.cwd(),data=path.join(root,'.qa-profiles','smoke-'+Date.now()),out=path.join(root,'qa','artifacts');
await fs.mkdir(data,{recursive:true});await fs.mkdir(out,{recursive:true});
const require=createRequire(import.meta.url),{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs'),db=new BrowserDatabase(path.join(data,'browser.sqlite'));db.saveWindow('main',createInitialState());db.close();
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(req.url==='/popup'){res.end('<script>opener.postMessage("authenticated", location.origin);window.close()</script>');return;}res.end('<!doctype html><title>Acira fixture</title><h1>Ordinary website</h1><input id="draft"><button id="popup" onclick="window.open(\'/popup\',\'auth\',\'width=400,height=400\')">Sign in</button><script>window.addEventListener("message",e=>{if(e.data==="authenticated")document.querySelector("h1").textContent="Signed in"})</script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let app;const errors=[];
try{
 app=await launchPreparedNative({executablePath:process.env.ACIRA_TEST_EXECUTABLE,args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1'},timeout:30000});
 const ui=await nativePage(app,'acira-browser-ui://ui/index.html');ui.on('pageerror',e=>errors.push(e.message));ui.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await ui.waitForFunction(()=>Boolean(window.acira));await ui.locator('.ed-start-composition').waitFor();
 const act=a=>ui.evaluate(a=>window.acira.dispatch(a),a),state=()=>ui.evaluate(()=>window.acira.getSnapshot());
 await act({type:'settings.update',patch:{colorPreset:'Burgundy',accentColor:'#4d1821',browserTint:'#4d1821',appearance:'light',reducedMotion:true}});
 await ui.waitForTimeout(400);await ui.screenshot({path:path.join(out,'browser-burgundy.png')});
 assert.equal(await ui.getByText('Ask Acira',{exact:true}).count(),0);
 await act({type:'tab.new',url:`http://127.0.0.1:${server.address().port}/`});
 let website;for(let i=0;i<50;i++){website=app.context().pages().find(p=>p.url().startsWith('http://127.0.0.1:'));if(website)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(website,'Native website view is created');await website.locator('h1').waitFor();
 await website.locator('#draft').fill('Working input');await website.locator('#popup').click();await website.getByRole('heading',{name:'Signed in'}).waitFor();
 const current=await state();assert.equal(current.tabs.at(-1).contentKind,'web');assert.equal(current.tabs.at(-1).browserProfileId,'profile-personal');
 console.log(JSON.stringify({checks:['workspace','no agent action','native website','form input','popup opener authentication'],errors,versions:await app.evaluate(()=>process.versions)},null,2));assert.deepEqual(errors,[]);
}finally{await app?.close();server.close();}
