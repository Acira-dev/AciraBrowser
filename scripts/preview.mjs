import './build-mac-material.mjs';
import {preservePreviewBuild,verifyPreservedBuild} from './preview-snapshot.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve('.'),profile=path.join(root,'.preview-profile');fs.mkdirSync(profile,{recursive:true});
const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs');
// Existing profiles are restored by Electron's own SQLite runtime. The launcher
// only seeds a new profile and never opens a live or recently closed database.
if(!fs.existsSync(path.join(profile,'browser.sqlite'))){const database=new BrowserDatabase(path.join(profile,'browser.sqlite'));const state=createInitialState();Object.assign(state.settings,{appearance:'light',colorPreset:'Burgundy',accentColor:'#4d1821',browserTint:'#4d1821',onboardingComplete:true});state.settings.stylePreferences.acira={appearance:'light',colorPreset:'Burgundy',accentColor:'#4d1821',browserTint:'#4d1821'};database.saveWindow('main',state);database.close();}
const executable=process.env.ACIRA_PREVIEW_EXECUTABLE||require('electron');if(!executable||!fs.existsSync(executable))throw new Error('Install Electron or supply a verified temporary ACIRA_PREVIEW_EXECUTABLE.');
const live=process.env.ACIRA_PREVIEW_LIVE==='1';
let vite;
if(live){
try{const response=await fetch('http://127.0.0.1:5194/',{signal:AbortSignal.timeout(1000)});if(!response.ok)throw new Error('Vite is not available');}catch{const log=fs.openSync(path.join(profile,'vite.log'),'a');vite=spawn(process.execPath,[path.join(root,'node_modules','vite','bin','vite.js'),'--host','127.0.0.1','--port','5194','--strictPort'],{cwd:root,env:process.env,detached:true,windowsHide:true,stdio:['ignore',log,log]});vite.unref();fs.closeSync(log);for(let i=0;i<30;i++){try{const response=await fetch('http://127.0.0.1:5194/');if(response.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}}
}
const preparedOnly=process.argv.includes('--prepare-only'),preparedPath=path.join(profile,'prepared-build.json');
const snapshot=live?null:process.argv.includes('--launch-prepared')?JSON.parse(fs.readFileSync(preparedPath,'utf8')):preservePreviewBuild({root,directory:path.join(profile,'builds')});
if(snapshot){const allowed=path.join(profile,'builds')+path.sep;if(!path.resolve(snapshot.launchPath).startsWith(allowed)||!fs.existsSync(path.join(snapshot.launchPath,'preview-manifest.json')))throw new Error('Prepared preview build is unavailable');verifyPreservedBuild(snapshot);fs.writeFileSync(preparedPath,JSON.stringify(snapshot,null,2));}
if(preparedOnly){console.log(JSON.stringify({prepared:snapshot.id,files:snapshot.files.length,launchPath:snapshot.launchPath}));process.exit(0);}
let current;try{current=JSON.parse(fs.readFileSync(path.join(profile,'processes.json'),'utf8'));process.kill(current.electron,0);}catch{current=null;}if(current)throw new Error('The preserved preview is already running. Close it normally before launching another.');
const launchPath=snapshot?.launchPath||path.join(root,'desktop','main.cjs');
const log=fs.openSync(path.join(profile,'electron.log'),'a'),env={...process.env,ACIRA_DEV:live?'1':'0',ACIRA_PREVIEW_RECORD:'1',ACIRA_BROWSER_TEST_DATA:profile};delete env.ACIRA_BROWSER_TEST_HIDDEN;delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_QA_RUN;/* the preview is the person's own browsing, never a QA run */
const child=spawn(executable,[launchPath],{cwd:root,env,detached:true,windowsHide:false,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);fs.writeFileSync(path.join(profile,'processes.json'),JSON.stringify({electron:child.pid,mode:live?'live':'built',launchPath,entry:snapshot?.entry||launchPath,build:snapshot?.id,vite:vite?.pid,profile,executable,started:new Date().toISOString()},null,2));console.log('Visible Acira preview launched from a coherent renderer/native build. Profile: '+profile);
