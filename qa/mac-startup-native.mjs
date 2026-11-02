import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const {BrowserDatabase}=require('../desktop/database.cjs');
const {createInitialState}=require('../desktop/runtime.cjs');
assert.equal(process.platform,'darwin');
const base=path.join(root,'.qa-profiles');await fs.mkdir(base,{recursive:true});
const directory=await fs.mkdtemp(path.join(base,'mac-startup-'));
let checks=0;
try{
 for(const fixture of [
  {finish:'Burgundy',tint:'#4d1821',appearance:'light',tone:'dark'},
  {finish:'Ocean Blue',tint:'#99c9e8',appearance:'light',tone:'light'},
  {finish:'Porcelain',tint:'#f8fbff',appearance:'light',tone:'light'},
  {finish:'Custom',tint:'#20847e',appearance:'dark',tone:'dark'},
  {finish:'Burgundy',tint:'#4d1821',appearance:'light',reducedTransparency:true},
  {finish:'Burgundy',tint:'#4d1821',appearance:'dark',disabled:true},
 ]){
  const profile=path.join(directory,String(checks));await fs.mkdir(profile);
  const state=createInitialState();Object.assign(state.settings,{appearance:fixture.appearance,colorPreset:fixture.finish,browserTint:fixture.tint,accentColor:fixture.tint,reducedTransparency:fixture.reducedTransparency??false,glassOpacity:60});
  const database=new BrowserDatabase(path.join(profile,'browser.sqlite'));database.saveWindow('main',state);database.close();
  const env={...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_PREVIEW_RECORD:'1',ACIRA_DEV:'0',ACIRA_MATERIAL:fixture.disabled?'none':'auto'};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[path.join(root,'qa/mac-startup-fixture.cjs')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  try{
   let record;
   for(let attempt=0;attempt<300;attempt++){
    try{record=JSON.parse(await fs.readFile(path.join(profile,'preview-build.json'),'utf8'));}catch{}
    if(record?.events.some(event=>event.event==='renderer-loaded'&&event.view==='browser')&&record.events.some(event=>event.event==='native-material'))break;
    if(child.exitCode!==null)throw new Error('Native startup failed: '+output);
    await delay(100);
   }
   const material=record?.events.findLast(event=>event.event==='native-material');
   assert.ok(material,'Native material diagnostics were recorded');checks++;
   assert.deepEqual(material.outer,material.content,'No separate title strip');checks++;
   assert.deepEqual(material.buttons,{x:12,y:12},'Native traffic lights stay integrated');checks++;
   if(fixture.tone){
    assert.equal(material.material,'vibrancy');checks++;
    assert.equal(material.appearance,fixture.tone);checks++;
    assert.ok(material.effects.length>0&&material.effects.every(effect=>effect.tone===fixture.tone&&effect.state===0&&effect.blendingMode===0));checks++;
   }else{assert.equal(material.material,'none');checks++;assert.deepEqual(material.effects,[]);checks++;}
   assert.ok(record.events.some(event=>event.event==='renderer-loaded'&&event.view==='browser'));checks++;
   console.log(`PASS ${fixture.finish} / ${fixture.appearance} / ${fixture.reducedTransparency?'solid':fixture.disabled?'disabled':'native'}`);
  }finally{
   if(child.exitCode===null)child.kill('SIGTERM');
   const stopped=await Promise.race([exited,delay(5000).then(()=>null)]);
   if(!stopped){child.kill('SIGKILL');await exited;throw new Error('Disposable browser failed to close normally');}
  }
 }
 console.log(JSON.stringify({passed:true,checks}));
}finally{await fs.rm(directory,{recursive:true,force:true});}
