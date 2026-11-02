// Stream H QA: after first-run setup the browser must fill the whole window (founder bug: only the top part painted,
// desktop visible below). Measures every layer — window, chrome view bounds, renderer viewport, .app/.browser-root.
// node qa/h-setup-viewport.mjs [--path finish|defaults|skip] [--shots dir] [--sidebar]   (D_VISIBLE=1 recommended)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,poll,sleep} from './d-harness.mjs';
const arg=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const route=arg('--path','finish'),shots=arg('--shots',null);
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
// Empty app-data folders: the import step must never see (or import) this PC's real browser profiles.
const empty=path.resolve(`.qa-profiles/h-empty-${Date.now()}`);await fs.mkdir(path.join(empty,'local'),{recursive:true});await fs.mkdir(path.join(empty,'roaming'),{recursive:true});
const t=await startApp({skipSetup:false,env:{LOCALAPPDATA:path.join(empty,'local'),APPDATA:path.join(empty,'roaming')}});
async function measure(label){
 const main=await t.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];const [cw,ch]=w.getContentSize();const views=w.contentView.children.map(v=>({b:v.getBounds(),visible:v.getVisible?.()}));return {content:{width:cw,height:ch},views};});
 const dom=await t.ui.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {top:Math.round(b.top),height:Math.round(b.height)};};return {inner:{w:innerWidth,h:innerHeight},doc:document.documentElement.clientHeight,body:r('body'),root:r('#root'),app:r('.app'),browser:r('.browser-root'),page:r('.page-area'),panel:Boolean(document.querySelector('.fr-yours-host')),zoom:devicePixelRatio};});
 console.log(label,JSON.stringify({main,dom}));return {main,dom};
}
const fills=({main,dom})=>{const chrome=main.views[0].b;return chrome.height===main.content.height&&dom.inner.h>=main.content.height-2&&dom.app&&dom.app.height>=dom.inner.h-2&&dom.browser&&dom.browser.height>=dom.inner.h-2;};
try{
 await poll(()=>t.ui.locator('.setup-dialog').count(),n=>n===1,'setup visible',20000);
 await measure('setup');
 if(route==='skip'){await t.ui.getByRole('button',{name:'Skip setup'}).first().click();}
 else if(route==='defaults'){await t.ui.getByRole('button',{name:'Use defaults'}).first().click();}
 else for(let i=0;i<14;i++){
  const start=t.ui.getByRole('button',{name:'Start browsing'});if(await start.count()&&await start.first().isVisible()){await start.first().click();break;}
  // The welcome and each step animate in and keep their buttons disabled until ready: wait for one to be clickable.
  let clicked=false;const end=Date.now()+9000;while(!clicked&&Date.now()<end){for(const name of ['Get started','Continue','Next','Not now','Skip']){const b=t.ui.getByRole('button',{name,exact:true});if(await b.count()&&await b.first().isVisible()&&await b.first().isEnabled()){await b.first().click();clicked=true;break;}}if(!clicked)await sleep(200);}
  if(!clicked){console.log('buttons:',(await t.ui.locator('.setup-dialog button:visible').allInnerTexts()).join(' | '));break;}await sleep(700);
 }
 await poll(()=>t.ui.locator('.setup-dialog').count(),n=>n===0,'setup closed',15000);
 if(route==='finish')await poll(()=>t.ui.locator('.fr-yours-host').count(),n=>n===1,'Make it yours open',8000).catch(()=>{});
 await sleep(1200);
 const after=await measure('after');
 if(shots){await fs.mkdir(shots,{recursive:true});const png=await t.main(async({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];const img=await w.contentView.children[0].webContents.capturePage();return img.toPNG().toString('base64');});await fs.writeFile(path.join(shots,`setup-${route}.png`),Buffer.from(png,'base64'));}
 if(process.argv.includes('--probe')){console.log('grid rows:',await t.ui.evaluate(()=>getComputedStyle(document.querySelector('.app')).gridTemplateRows+' / children: '+[...document.querySelector('.app').children].map(e=>e.className.split(' ')[0]).join(',')));await t.ui.evaluate(()=>{document.querySelector('.fr-yours-host').style.position='fixed';});await sleep(300);await measure('probe-fixed-host');}
 check(fills(after),`${route}: browser fills the window after setup`);
 if(process.argv.includes('--sidebar')){await t.act({type:'settings.update',patch:{verticalTabs:true}});await sleep(900);check(fills(await measure('sidebar')),`${route}: fills in sidebar-tabs mode`);}
 if(process.argv.includes('--resize')){
  for(const [name,fn] of [['resize',({BaseWindow})=>BaseWindow.getAllWindows()[0].setBounds({x:60,y:60,width:1100,height:760})],['maximize',({BaseWindow})=>BaseWindow.getAllWindows()[0].maximize()],['restore',({BaseWindow})=>BaseWindow.getAllWindows()[0].unmaximize()]]){await t.main(fn);await sleep(900);check(fills(await measure(name)),`${route}: fills after ${name}`);}
 }
}finally{await t.close();}
