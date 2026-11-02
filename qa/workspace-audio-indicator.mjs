// Real native audio drives the background-workspace indicator. Windows styling
// can also be checked on Mac, explicitly as renderer diagnostics only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const require=createRequire(import.meta.url),root=path.resolve('.qa-profiles/workspace-audio-'+Date.now());
const out=path.resolve(process.env.WORKSPACE_AUDIO_OUT||'qa/artifacts/workspace-audio-'+Date.now());await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const report={passed:false,nativePlatform:process.platform,windowsNative:process.platform==='win32',checks:[],scope:'Native loopback audio, mounted shared workspace switcher, all interface scales; alternate platform CSS is explicitly renderer-only.'};let app;
const wav=Buffer.alloc(44+44100*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(Math.round(Math.sin((i-44)/2*2*Math.PI*440/22050)*3000),i);
const fixture=await httpFixture((req,res)=>{if(req.url==='/tone.wav'){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}res.setHeader('Content-Type','text/html');res.end('<title>Owned workspace audio</title><button onclick="document.querySelector(\'audio\').volume=.03;document.querySelector(\'audio\').play()">Play fixture</button><audio src="/tone.wav" loop></audio>');});
const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');let initial=createInitialState();
const mainId=initial.activeWorkspaceId;initial=reduceBrowser(initial,{type:'workspace.create',name:'Music'});const musicId=initial.activeWorkspaceId;
initial=reduceBrowser(initial,{type:'workspace.update',id:musicId,patch:{icon:'headphones',color:'#3388ff'}});
Object.assign(initial.settings,{onboardingComplete:true,askBeforeClosing:false,verticalTabs:true,reducedMotion:false});Object.assign(initial.windowUi,{workspaceOpen:true,webWorkspaceOpen:true});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',initial);db.close();
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()),l=>l?.visible===true,'Browsing ready',60000);
 await app.main(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.setPosition(400,150);win.showInactive();});
 await app.act({type:'tab.navigate',url:'http://127.0.0.1:'+fixture.port+'/'});const audioId=(await app.state()).activeTabId,p=await app.waitWeb('http://127.0.0.1:'+fixture.port+'/');await p.getByRole('button',{name:'Play fixture'}).click();
 await poll(()=>app.state(),s=>s.tabs.find(t=>t.id===audioId)?.audible,'Real native audio becomes audible');
 await app.act({type:'workspace.select',id:mainId});const cell=app.ui.locator('.sb-ws[data-ws="'+musicId+'"]');await cell.waitFor({state:'visible'});
 const visual=()=>cell.evaluate(el=>{const icon=el.querySelector('.sb-ws-identity'),meter=el.querySelector('.tab-sound-meter'),rail=el.querySelector('.sb-ws-rail'),box=el.querySelector('.sb-ws-icon').getBoundingClientRect(),r=meter?.getBoundingClientRect();return{playing:el.hasAttribute('data-playing'),icon:getComputedStyle(icon).display,meter:meter&&getComputedStyle(meter).display,canvas:!!meter?.querySelector('canvas'),fits:!r||r.width<=box.width+1&&r.height<=box.height+1,rail:!!rail,label:el.getAttribute('aria-label'),speaker:!!el.querySelector('.sb-ws-sound')};});
 for(const platform of ['darwin','win32'])for(const scale of [80,90,100,110,125,150]){
  await check(platform+' '+scale+'% uses one audio matrix and reveals the chosen icon on hover/focus',async()=>{
   await app.ui.evaluate(platform=>document.documentElement.dataset.platform=platform,platform);await app.act({type:'settings.update',patch:{interfaceScale:scale}});await app.ui.mouse.move(600,180);
   const idle=await poll(visual,v=>v.playing&&v.icon==='none'&&v.meter==='grid','Audio replaces identity');assert(idle.canvas&&idle.fits&&idle.rail&&!idle.speaker);assert.match(idle.label,/Music.*Playing sound/);
   await cell.hover();await poll(visual,v=>v.icon==='grid'&&v.meter==='none','Hover reveals identity');assert.equal(await cell.locator('.sb-ws-identity svg').count(),1);
   await app.ui.mouse.move(600,180);await app.ui.locator('.sb-ws[data-ws="'+mainId+'"]').focus();await app.ui.keyboard.press('ArrowRight');await poll(visual,v=>v.icon==='grid'&&v.meter==='none','Keyboard focus reveals identity');
   await app.ui.locator('.address-bar input').focus();await poll(visual,v=>v.icon==='none'&&v.meter==='grid','Audio returns without hover/focus');
  });
 }
 await app.act({type:'settings.update',patch:{interfaceScale:100}});
 await check('Audio matrix animates, while reduced motion holds a still pattern',async()=>{
  console.log('MATRIX_ENV '+JSON.stringify(await app.ui.evaluate(()=>({hidden:document.hidden,motion:matchMedia('(prefers-reduced-motion: reduce)').matches,effectiveReduced:document.querySelector('.app').dataset.reducedMotion}))));
  const canvas=cell.locator('canvas'),first=await canvas.evaluate(c=>c.toDataURL());await poll(()=>canvas.evaluate(c=>c.toDataURL()),v=>v!==first,'Matrix animates',8000);
  await app.act({type:'settings.update',patch:{reducedMotion:true}});await sleep(200);const still=await canvas.evaluate(c=>c.toDataURL());await sleep(250);assert.equal(await canvas.evaluate(c=>c.toDataURL()),still);
 });
 await check('Mute, pause and end restore the icon; resuming restores the matrix',async()=>{
  await app.act({type:'tab.mute',id:audioId,muted:true});await poll(visual,v=>!v.playing&&v.icon==='grid'&&!v.canvas,'Muted workspace is quiet');
  await app.act({type:'tab.mute',id:audioId,muted:false});await poll(visual,v=>v.playing&&v.canvas,'Unmute restores real audio');
  await p.evaluate(()=>document.querySelector('audio').pause());await poll(visual,v=>!v.playing&&v.icon==='grid','Paused workspace restores icon');
  await p.evaluate(()=>document.querySelector('audio').play());await poll(visual,v=>v.playing&&v.canvas,'Resume restores audio matrix');
 });
 await check('Custom icons and a crowded workspace row retain the same single slot',async()=>{
  for(const name of ['Study','Work','Reading'])await app.act({type:'workspace.create',name});await app.act({type:'workspace.select',id:mainId});await app.act({type:'workspace.update',id:musicId,patch:{icon:'book'}});
  await app.ui.mouse.move(600,180);await poll(visual,v=>v.playing&&v.icon==='none'&&v.meter==='grid'&&v.fits,'Crowded audio slot');await cell.hover();assert.ok(await cell.locator('.sb-ws-identity svg').count());await poll(visual,v=>v.icon==='grid'&&v.meter==='none','Custom study icon revealed');
 });
 await check('One primary click opens a playing workspace, including a fast click on its changing icon',async()=>{
  for(const scale of [80,100,150]){
   await app.act({type:'settings.update',patch:{interfaceScale:scale}});await app.ui.mouse.move(600,180);
   const box=await cell.boundingBox();assert(box);
   assert.equal(await cell.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;}),true,'The visual icon swap keeps one stable button hit target');
   await app.ui.mouse.move(box.x+box.width/2,box.y+box.height/2);await sleep(700);
   await app.ui.mouse.down();
   await poll(()=>app.state(),s=>s.activeWorkspaceId===musicId,'The first primary press selects the audible workspace');
   await app.ui.mouse.up();
   const actual=await app.main(({BaseWindow},url)=>BaseWindow.getAllWindows().flatMap(w=>w.contentView.children).filter(v=>v.webContents?.getURL()===url&&v.getVisible()).length,'http://127.0.0.1:'+fixture.port+'/');assert.equal(actual,1,'The live playing page is shown after the first click');
   await app.ui.locator('.sb-ws[data-ws="'+mainId+'"]').click();await poll(()=>app.state(),s=>s.activeWorkspaceId===mainId,'One click returns to Main');
  }
  await app.act({type:'settings.update',patch:{interfaceScale:100}});
 });
 await check('The top chip and live workspace menu animate audio; hover reveals the chosen icon',async()=>{
  await app.act({type:'settings.update',patch:{verticalTabs:false,reducedMotion:false}});await app.act({type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false}});
  const chip=app.ui.locator('.ws-chip').filter({visible:true}).first();await chip.waitFor({state:'visible'});await app.ui.mouse.move(700,180);
  const chipCanvas=chip.locator('.ws-chip-sound canvas');await chipCanvas.waitFor({state:'visible'});const first=await chipCanvas.evaluate(c=>c.toDataURL());await poll(()=>chipCanvas.evaluate(c=>c.toDataURL()),value=>value!==first,'Top bar audio animates');
  let menu,row,glyph;
  const open=async()=>{await chip.click();menu=await app.waitWeb(url=>url.includes('view=overlay'));menu.setDefaultTimeout(5000);const visibleMenu=menu.locator('.ws-menu').filter({visible:true}).last();await visibleMenu.waitFor({state:'visible'});row=visibleMenu.locator('.acira-menu-row-identity').filter({hasText:'Music'});glyph=row.locator('.workspace-playback-glyph');};
  const close=async()=>{const overlay=await app.ui.evaluate(()=>window.acira.getBrowserLayout().overlay);if(overlay)await app.ui.evaluate(id=>window.acira.closeOverlay(id),overlay.id);await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout().overlay),v=>!v,'Menu closed');};
  const state=()=>glyph.evaluate(el=>({playing:el.hasAttribute('data-playing'),icon:getComputedStyle(el.querySelector('.workspace-playback-identity')).display,meter:el.querySelector('.tab-sound-meter')&&getComputedStyle(el.querySelector('.tab-sound-meter')).display}));
  for(const platform of ['darwin','win32'])for(const scale of [80,100,150]){
   await app.ui.evaluate(platform=>document.documentElement.dataset.platform=platform,platform);await app.act({type:'settings.update',patch:{interfaceScale:scale}});await app.ui.mouse.move(700,180);
   const spacing=await chip.evaluate(el=>{const parts=[...el.children].map(node=>node.getBoundingClientRect());return parts.slice(1).map((box,i)=>box.left-parts[i].right);});assert(spacing.every(gap=>gap>=3),platform+' '+scale+'% workspace chip overlaps: '+JSON.stringify(spacing));
   await open();await menu.evaluate(platform=>document.documentElement.dataset.platform=platform,platform);await menu.mouse.move(700,30);
   await poll(state,v=>v.playing&&v.icon==='none'&&v.meter==='grid','Menu audio replaces icon');const label=await poll(()=>row.innerText(),value=>/Playing sound/.test(value),'Menu playing label');assert(!label.includes('♪'));
   await row.hover();await poll(state,v=>v.icon==='grid'&&v.meter==='none','Menu hover reveals custom icon');await row.focus();await poll(state,v=>v.icon==='grid'&&v.meter==='none','Menu keyboard focus reveals custom icon');await menu.locator('.acira-menu-row-identity').first().focus();await close();
  }
  await app.ui.evaluate(()=>document.documentElement.dataset.platform=navigator.platform.includes('Mac')?'darwin':'win32');await app.act({type:'settings.update',patch:{interfaceScale:100}});await open();await menu.mouse.move(700,30);await menu.screenshot({path:path.join(out,'workspace-menu-playing.png')});
  await p.evaluate(()=>document.querySelector('audio').pause());await poll(state,v=>!v.playing&&v.icon==='grid'&&!v.meter,'Open menu updates when audio pauses');assert.equal(await chip.locator('.ws-chip-sound').count(),0);
  await p.evaluate(()=>document.querySelector('audio').play());await poll(state,v=>v.playing&&v.meter==='grid','Open menu updates when audio resumes');
  await close();
  await app.act({type:'workspace.select',id:musicId});await app.ui.mouse.move(700,180);await chip.locator('.ws-chip-glyph .workspace-playback-glyph[data-playing] canvas').waitFor({state:'visible'});assert.equal(await chip.locator('.ws-chip-sound').count(),0);
  await app.act({type:'workspace.select',id:mainId});await app.act({type:'settings.update',patch:{verticalTabs:true}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true}});
 });
 await app.ui.evaluate(()=>document.documentElement.dataset.platform=navigator.platform.includes('Mac')?'darwin':'win32');await app.ui.mouse.move(600,180);await app.ui.screenshot({path:path.join(out,'workspace-playing.png')});await cell.hover();await app.ui.screenshot({path:path.join(out,'workspace-hover.png')});
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{await app?.close();await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,out}));}
