import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,sleep} from './d-harness.mjs';
const out=path.resolve(process.argv[2]); await fs.mkdir(out,{recursive:true});
const app=await startApp({root:'.qa-profiles/a-b-focus-'+Date.now(),env:{ACIRA_BROWSER_TEST_HIDDEN:'0'}});
const report=[];
const shot=async name=>{const b64=await app.main(async({BaseWindow,desktopCapturer})=>{const w=BaseWindow.fromId(globalThis.__qaTargetWindow);if(!w)throw Error('target window closed');const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1280,height:800}});const source=sources.find(s=>s.id===w.getMediaSourceId());if(!source)throw Error('window source missing');return source.thumbnail.toPNG().toString('base64');});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(b64,'base64'));};
try {
 await app.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];globalThis.__qaTargetWindow=w.id;w.setBounds({x:60,y:40,width:1280,height:800});w.showInactive();});
 await app.act({type:'tab.new',url:'acira://history'}); await sleep(700);
 for(const scale of [100,150]) for(const appearance of ['light','dark']) {
  await app.act({type:'split.close'});
  await app.act({type:'settings.update',patch:{interfaceScale:scale,appearance,verticalTabs:false,toolbarLayout:'expanded'}}); await sleep(900);
  await app.ui.keyboard.press('Tab');
  for(const [label,selector] of [['tab','.tab-strip-viewport .browser-tab'],['reload','.navigation-controls button:last-child']]) {
   const rect=await app.ui.evaluate(selector=>{const n=document.querySelector(selector);if(!n)throw Error(selector);n.focus();const c=getComputedStyle(n);return{outline:c.outline,offset:c.outlineOffset,focusVisible:n.matches(':focus-visible')};},selector);
   await sleep(100);await shot(`${appearance}-${scale}-${label}`);report.push({appearance,scale,label,...rect});
  }
  const ids=(await app.state()).tabs.slice(0,2).map(t=>t.id);await app.act({type:'split.open',tabIds:ids,layout:'columns'});await sleep(500);
  const rect=await app.ui.evaluate(()=>{const n=document.querySelector('.split-label button');if(!n)throw Error('split button missing');n.focus();const c=getComputedStyle(n),r=n.getBoundingClientRect(),p=n.closest('.split-label').getBoundingClientRect();return{outline:c.outline,offset:c.outlineOffset,focusVisible:n.matches(':focus-visible'),gap:Math.min(r.top-p.top,p.bottom-r.bottom)};});
  await sleep(100);await shot(`${appearance}-${scale}-split`);report.push({appearance,scale,label:'split',...rect});
 }
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await app.close();}
