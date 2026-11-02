import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,sleep,poll} from './d-harness.mjs';
const out=path.resolve(process.argv[2]);await fs.mkdir(out,{recursive:true});
const edge=await fs.readFile('qa/m-edge-scan.js','utf8'),clip=await fs.readFile('qa/m-clip-scan.js','utf8');
const app=await startApp({root:'.qa-profiles/a-tail-'+Date.now(),env:{ACIRA_BROWSER_TEST_HIDDEN:'0'}}),started=Date.now(),report={footer:[],menus:[]};
const shot=async name=>{const png=await app.main(async({BaseWindow,desktopCapturer})=>{const w=BaseWindow.fromId(globalThis.__qaTargetWindow),sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1280,height:800}});return sources.find(s=>s.id===w.getMediaSourceId()).thumbnail.toPNG().toString('base64');});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(png,'base64'));};
try{
 await app.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];globalThis.__qaTargetWindow=w.id;w.setBounds({x:60,y:40,width:1280,height:800});w.showInactive();});
 for(const appearance of ['light','dark']){
  await app.act({type:'settings.update',patch:{appearance,interfaceScale:150,verticalTabs:true}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true}});await sleep(900);
  await app.ui.evaluate(edge);const footer=app.ui.locator('.sb-foot-profile').first();await footer.hover();await sleep(650);await shot('footer-'+appearance+'-150');
  report.footer.push({appearance,edge:await footer.evaluate(el=>window.__edge.el(el))});
 }
 await app.act({type:'settings.update',patch:{verticalTabs:false}});await app.act({type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false}});
 for(const scale of (process.env.A_ONLY_150?[150]:[100,150]))for(const appearance of ['light','dark'])for(const reducedMotion of [false,true]){
  await app.act({type:'settings.update',patch:{appearance,interfaceScale:scale,reducedMotion}});await sleep(700);
  await app.ui.locator('[aria-label="Acira menu"]').filter({visible:true}).first().click();await poll(()=>app.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'overlay',5000);await sleep(650);
  const overlay=app.context.pages().find(p=>p.url().includes('view=overlay'));await overlay.evaluate(edge);
  const measurements=await overlay.evaluate(()=>{const popup=document.querySelector('.browser-popup.popup-content-menu'),scroll=popup.querySelector('.popup-scroll'),plane=popup.closest('.popup-sheet-plane');return{forming:plane?.hasAttribute('data-forming'),haze:document.querySelectorAll('[data-vapor-layer]').length,overflow:scroll.scrollHeight-scroll.clientHeight,cue:+getComputedStyle(popup,'::after').opacity,edge:window.__edge.static()};});
  await shot(`menu-${appearance}-${scale}-${reducedMotion?'reduced':'signature'}`);
  const end=await overlay.evaluate(async()=>{const popup=document.querySelector('.browser-popup.popup-content-menu'),scroll=popup.querySelector('.popup-scroll');scroll.scrollTop=scroll.scrollHeight;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return{cue:+getComputedStyle(popup,'::after').opacity,listOpacity:+getComputedStyle(scroll).opacity,scrollTop:scroll.scrollTop};});
  await shot(`end-${appearance}-${scale}-${reducedMotion?'reduced':'signature'}`);
  report.menus.push({appearance,scale,reducedMotion,...measurements,end,clip:await overlay.evaluate(clip)});if(end.listOpacity<.99||end.cue>.01)throw Error('scroll end hides content or keeps cue');
  if(measurements.forming||measurements.haze||measurements.overflow>1&&measurements.cue<.5||measurements.overflow<=1&&measurements.cue>.01)throw Error('menu cue or cleanup failure');
  await app.ui.keyboard.press('Escape');await sleep(300);
 }
 await sleep(Math.max(0,35000-(Date.now()-started)));
 report.uptime={elapsed:Date.now()-started,tabs:(await app.state()).tabs.length,errors:app.logs.filter(s=>/ReferenceError|TypeError|Uncaught|A JavaScript error/.test(s)),modals:await app.main(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.isModal?.()).length)};
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(report.uptime.errors.length||report.uptime.modals)throw Error('uptime failed');
}finally{await app.close();}
