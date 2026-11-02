// Hold real compositor frames to inspect the sidebar / toolbar join without touching the user's preview.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const require=createRequire(import.meta.url),stamp=Date.now(),root=path.resolve('.qa-profiles/sidebar-join-'+stamp),out=path.resolve('qa/artifacts/sidebar-join-'+stamp);await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const fixture=await httpFixture((req,res)=>res.end('<title>Join fixture</title><style>body{background:#00d060}</style>'));
const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,makeTab}=require('../desktop/runtime.cjs'),state=createInitialState(),profile=state.activeBrowserProfileId;
state.tabs=[makeTab('join-web','Join fixture','http://127.0.0.1:'+fixture.port+'/',profile),makeTab('join-home','New tab','acira://new',profile)];state.activeTabId='join-web';Object.assign(state.settings,{onboardingComplete:true,askBeforeClosing:false,verticalTabs:true,reducedMotion:false,animationSpeed:'premium',sidebarPeek:{full:true,compact:true,focus:true},appearance:'dark',sidebarWidth:240});Object.assign(state.windowUi,{workspaceOpen:false,webWorkspaceOpen:false,view:'compact'});const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',state);db.close();let app;const report={passed:false,frames:[]};
try{
app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve('desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
await app.main(({BaseWindow,screen})=>{const w=BaseWindow.getAllWindows()[0];w.setBounds({x:-17000,y:100,width:1280,height:820});w.showInactive();w.isFocused=()=>true;screen.getCursorScreenPoint=()=>{const b=w.getContentBounds();return{x:b.x+700,y:b.y+400};};});await sleep(800);
await app.ui.evaluate(()=>{const original=document.startViewTransition.bind(document);window.joinReady=0;document.startViewTransition=update=>{window.joinReady=0;document.documentElement.style.setProperty('--edge-ms','2000ms');const transition=original(update);transition.ready.then(()=>window.joinReady=performance.now());return transition;};});
for(const id of ['join-web','join-home']){
await app.act({type:'tab.select',id});await sleep(500);
for(const side of [true,false]){
 await app.ui.evaluate(()=>{window.joinReady=0;});await app.cmd({type:'edge',tabId:id,keys:{top:false,side},...(side?{}:{dismiss:'side'})});await poll(()=>app.ui.evaluate(()=>window.joinReady),Boolean,'Slow compositor frames ready');
 for(const phase of [.02,.35,.7]){
  await poll(()=>app.ui.evaluate(()=>performance.now()-window.joinReady),value=>value>=phase*2000,'Intermediate frame');
  const detail=await app.ui.evaluate(phase=>{const fields=['transform','width','height','objectPosition','overflow','clipPath','opacity','zIndex'];const styles=selector=>{const node=document.querySelector(selector);if(!node)return null;const cs=getComputedStyle(node),r=node.getBoundingClientRect();return{box:{x:r.x,y:r.y,width:r.width,height:r.height},transition:cs.viewTransitionName,...Object.fromEntries(fields.map(key=>[key,cs[key]]))};};const pseudo=name=>{const cs=getComputedStyle(document.documentElement,`::view-transition-${name}`);return Object.fromEntries(fields.map(key=>[key,cs[key]]));};return{phase,selectorSupport:CSS.supports('selector(::view-transition-old(acira-toolbar):not(:only-child))'),root:{...document.documentElement.dataset},nodes:Object.fromEntries(['.browser-shell','.acira-persistent-toolbar','.navigation-controls','.acira-sidebar','.page-area'].map(selector=>[selector,styles(selector)])),pseudo:Object.fromEntries(['group(acira-toolbar)','new(acira-toolbar)','old(acira-toolbar)','group(acira-sidebar)','group(acira-edge-shell)'].map(name=>[name,pseudo(name)])),animations:document.getAnimations().filter(a=>a.effect?.pseudoElement?.startsWith('::view-transition')).map(a=>({name:a.animationName,pseudo:a.effect.pseudoElement,duration:a.effect.getComputedTiming().duration}))};},phase);
  const img=await app.main(async({webContents})=>(await webContents.getAllWebContents().find(w=>w.getURL()==='acira-browser-ui://ui/index.html').capturePage()).toPNG().toString('base64'));await fs.writeFile(path.join(out,`${id}-${side?'in':'out'}-${phase}.png`),Buffer.from(img,'base64'));report.frames.push({id,side,...detail});
 }
 await poll(()=>app.ui.evaluate(()=>document.documentElement.dataset.modeSwitch||null),value=>value===null,'Transition settled');await sleep(200);
}
}
report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}finally{await app?.close();await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
