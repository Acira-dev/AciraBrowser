import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

// Adapted from the original browser's popup-readiness-native regression.
// This checks the real native lifecycle in a hidden, disposable Electron app.
// It does not claim to measure OS compositor pixels or physical mouse dragging.
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/formation-readiness');
const tokens=require('../design-tokens.json'),{createInitialState,persistedSnapshot}=require('../desktop/runtime.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={checks:[],errors:[],openings:[],limits:['Hidden native API and foreground timing; OS pixel review remains separate.']};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
await fs.mkdir(out,{recursive:true});
const profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
const seed=createInitialState();seed.demo.frozen=true;seed.settings.reducedMotion=false;seed.settings.reducedTransparency=false;seed.settings.interfaceScale=100;seed.settings.automaticCompact=false;seed.windowUi.workspaceOpen=false;seed.windowUi.webWorkspaceOpen=false;seed.tabs.forEach(tab=>tab.panelOpen=false);
await fs.writeFile(path.join(profile,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Formation fixture</title><style>body{margin:0;background:#fff;color:#25262b;font:16px sans-serif}.dark{margin-top:80px;height:500px;background:#18191e;color:white;padding:24px}input{margin:24px;padding:12px}</style><input aria-label="Preserved website draft"><div class="dark">Contrasting page content beneath the native overlay</div>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:profile}});
 const ui=await app.firstWindow();app.context().on('page',page=>page.on('pageerror',error=>report.errors.push(error.message)));ui.on('pageerror',error=>report.errors.push(error.message));
 await ui.waitForFunction(()=>window.__acira&&window.acira);
 await app.evaluate(({BaseWindow,View})=>{
   BaseWindow.getAllWindows()[0].setContentSize(1440,900);
   globalThis.formationTrace={values:new WeakMap(),frames:[],running:true};
   for(const method of ['setBackgroundBlur','setBackgroundColor']){const original=View.prototype[method];View.prototype[method]=function(value){const result=original.call(this,value),previous=formationTrace.values.get(this)||{};previous[method]=value;formationTrace.values.set(this,previous);return result;};}
   const sample=()=>{if(!formationTrace.running)return;const children=BaseWindow.getAllWindows()[0].contentView.children,host=children.find(view=>view.children.some(child=>child.webContents?.getURL().includes('view=overlay'))),candidate=children[children.indexOf(host)-1],material=candidate&&!candidate.webContents?candidate:null;if(host)formationTrace.frames.push({at:Date.now(),host:host.getVisible(),material:material?.getVisible()||false,blur:formationTrace.values.get(material)?.setBackgroundBlur??0,tint:formationTrace.values.get(material)?.setBackgroundColor??''});setTimeout(sample,8);};sample();
 });
 const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action);
 await act({type:'tab.navigate',url:origin});await ui.waitForFunction(()=>window.__acira.getState().tabs.some(tab=>tab.title==='Formation fixture'));
 const web=app.context().pages().find(page=>page.url().startsWith(origin));await web.getByRole('textbox',{name:'Preserved website draft'}).fill('Keep this local draft');
 const open=async kind=>{if(kind==='profile'&&await ui.getByRole('button',{name:'Expand sidebar',exact:true}).isVisible())await ui.getByRole('button',{name:'Expand sidebar',exact:true}).click();await ui.getByRole('button',{name:kind==='tabs'?'Your tabs (Alt+T)':kind==='profile'?'Switch profile':'Acira menu',exact:true}).click();};
 const dismiss=async()=>{await ui.evaluate(()=>window.acira.closeOverlay());await wait(tokens.motion.vaporExit+80);};
 await open('tabs');const overlay=app.context().pages().find(page=>page.url().includes('view=overlay'));
 await overlay.locator('.popup-surface:not([data-preparing])').waitFor();await wait(380);
 check('Cold tab viewer focuses its search after native readiness',await overlay.getByRole('textbox',{name:'Search tabs',exact:true}).evaluate(node=>node===document.activeElement));await dismiss();
 // Hidden windows need paint requests to advance RAF. This is a lifecycle
 // trace, not a benchmark: no assertion is made about these frame intervals.
 await app.evaluate(({webContents})=>{formationTrace.paint=true;const contents=webContents.getAllWebContents().find(w=>w.getURL().includes('view=overlay'));const paint=async()=>{if(!formationTrace.paint||contents.isDestroyed())return;await contents.capturePage(undefined,{stayHidden:true,stayAwake:true});if(formationTrace.paint)setTimeout(paint,16);};void paint();});
 await overlay.evaluate(()=>{
   window.formationFrames=[];window.formationSampling=true;
   const sample=()=>{if(!window.formationSampling)return;const surface=document.querySelector('.popup-surface'),foreground=surface?.querySelector('.ed-formation-fill');if(surface&&foreground){const style=getComputedStyle(surface),paint=getComputedStyle(foreground);window.formationFrames.push({at:Date.now(),preparing:surface.dataset.preparing==='true',visible:style.visibility!=='hidden'&&!surface.inert,opacity:Number(paint.opacity),filter:paint.filter,mask:paint.maskImage,maskPosition:paint.maskPosition,clip:getComputedStyle(surface.querySelector('.popup-contents')).clipPath});}requestAnimationFrame(sample);};requestAnimationFrame(sample);
 });
 const began=Date.now();await open('tabs');await overlay.locator('.popup-surface:not([data-preparing])').waitFor();await wait(tokens.motion.switcher+400);
 const frames=await overlay.evaluate(began=>window.formationFrames.filter(frame=>frame.at>=began),began),native=await app.evaluate((_electron,began)=>formationTrace.frames.filter(frame=>frame.at>=began-100),began);
 const visible=frames.filter(frame=>frame.visible&&frame.opacity>.01);
 report.openings.push({frames,native});
 check('Opening produces observable foreground frames',visible.length>=4);
 const expectedTint='#'+Math.round(tokens.material.tint*255).toString(16)+'FFFFFF';
 check('Native frost exists before every visible foreground frame',visible.every(frame=>{const material=native.filter(sample=>sample.at<=frame.at).at(-1);return material?.host&&material.material;}));
 // The frost condenses like vapor: its blur only rises while opening and settles on the material values.
 const frost=native.filter(sample=>sample.material).map(sample=>sample.blur);
 check('Native frost condenses to the material blur and tint',frost.every((blur,index)=>!index||blur>=frost[index-1])&&frost.at(-1)===tokens.material.blur&&native.filter(sample=>sample.material).at(-1).tint===expectedTint);
 check('Prepared foreground resolves from blur to fully crisp text',visible.some(frame=>frame.filter!=='none'&&frame.filter!=='blur(0px)')&&visible.at(-1).filter==='none');
 check('Formation leaves no mask or filter on the settled foreground',visible.at(-1).mask==='none'&&visible.at(-1).filter==='none');
 check('Opening never shrinks the text clipping rectangle',new Set(visible.map(frame=>frame.clip)).size===1);
 await dismiss();
 await open('tabs');await wait(70);await ui.evaluate(()=>window.acira.closeOverlay());await wait(35);await open('tabs');await wait(420);
 check('Rapid close/reopen rejects stale dismissal',await overlay.locator('.popup-surface:not([data-preparing])').count()===1&&await overlay.locator('[data-popup-scene]:not([inert])').count()===1);
 await overlay.getByRole('textbox',{name:'Search tabs',exact:true}).fill('formation');
 check('Input remains usable after an interrupted reveal',await overlay.getByRole('textbox',{name:'Search tabs',exact:true}).inputValue()==='formation');await dismiss();
 await open('profile');await wait(80);await open('menu');await wait(60);await open('profile');await wait(400);
 check('Switching menus during formation leaves only the current scene',/(^|:)profile$/.test(await overlay.locator('[data-popup-scene]:not([inert])').getAttribute('data-popup-scene')));await dismiss();
 check('Website draft survives all native overlays',await web.getByRole('textbox',{name:'Preserved website draft'}).inputValue()==='Keep this local draft');
 const hidden=await app.evaluate(()=>formationTrace.frames.at(-1));check('Dismissal releases both the native blur and foreground host',!hidden.host&&!hidden.material);
 await act({type:'settings.update',patch:{reducedMotion:true}});await open('tabs');await overlay.locator('.popup-surface:not([data-preparing])').waitFor();
 check('Reduced motion presents final foreground without blur or masking',await overlay.locator('.ed-formation-fill').evaluate(node=>getComputedStyle(node).filter==='none'&&getComputedStyle(node).maskImage==='none'));await dismiss();
 check('No renderer errors',report.errors.length===0);
}catch(error){report.errors.push(error.stack);process.exitCode=1;}
finally{if(app){await app.evaluate(()=>{if(globalThis.formationTrace){formationTrace.running=false;formationTrace.paint=false;}}).catch(()=>{});await app.close().catch(()=>{});}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));}
