// Artwork controls: shown vs hidden (eye only), light and dark, on a disposable profile.
import fs from 'node:fs/promises';import path from 'node:path';import{createRequire}from'node:module';
import{startApp,sleep}from'./d-harness.mjs';
const require=createRequire(import.meta.url),stamp=Date.now(),root=path.resolve('.qa-profiles/r8-painting-hide'),out=path.resolve('qa/artifacts/r8-painting-hide');
await fs.rm(root,{recursive:true,force:true});await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs'),initial=createInitialState(),profile=initial.activeBrowserProfileId;
Object.assign(initial.settings,{onboardingComplete:true,askBeforeClosing:false,reducedMotion:false,verticalTabs:false});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',initial);db.close();
let app;
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve('desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 await app.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];w.setBounds({x:-17000,y:100,width:1280,height:850});w.showInactive();});
 await app.ui.locator('.nt-search').waitFor();
 for(const theme of ['light','dark']){
  await app.act({type:'settings.update',patch:{appearance:theme}});
  for(const style of ['full','framed']){
   await app.ui.evaluate(({profile,style})=>{const key='acira-new-tab:'+profile;localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)||'{}'),artStyle:style,artVisible:true}));window.dispatchEvent(new StorageEvent('storage',{key}));},{profile,style});
   await sleep(600);
   const eye=app.ui.locator('.nt-cover-visibility');
   const n0=await app.ui.locator('.nt-art-controls .nt-change').count();
   await app.ui.screenshot({path:path.join(out,`${theme}-${style}-shown.png`)});
   await eye.focus();await eye.click();await sleep(500);
   const n1=await app.ui.locator('.nt-art-controls .nt-change').count(),focus=await app.ui.evaluate(()=>document.activeElement?.className);
   await app.ui.screenshot({path:path.join(out,`${theme}-${style}-hidden.png`)});
   console.log(theme,style,'buttons shown',n0,'hidden',n1,'focus',focus);
   await eye.click();await sleep(500);
   console.log(' back',await app.ui.locator('.nt-art-controls .nt-change').count());
  }
 }
}finally{await app?.close?.();}
