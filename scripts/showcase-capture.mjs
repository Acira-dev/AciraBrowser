import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

// The suggested sample task at real speed in a hidden Electron app, captured at its beats: thinking, the plan streaming
// in, a store visit, quarantine, the approval, done, and the chat going dark once you leave it. Prints the timeline.
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/showcase');
const {createInitialState,persistedSnapshot}=require('../desktop/runtime.cjs');
const {SHOWCASE_PROMPT}=await import('../src/runtime/experience.ts').catch(()=>({SHOWCASE_PROMPT:"Find the Aria ANC headphones at Volta, Harbor Audio, Meridian and Pulse and try the code ACIRA20 at each checkout. Buy the cheapest one if it's under $250, but ask me first."}));
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
const seed=createInitialState();seed.settings.aiEnabled=true;seed.demo.speed=1;seed.settings.reducedMotion=false;seed.settings.interfaceScale=100;seed.settings.automaticCompact=false;
const theme=process.argv[2]||'light';seed.settings.appearance=theme==='dark'?'dark':'light';if(theme==='deepblue'){seed.settings.colorPreset='Deep Blue';seed.settings.browserTint='#293c55';seed.settings.accentColor='#47678e';}
const profile=await fs.mkdtemp(path.join(out,'profile-'));
await fs.writeFile(path.join(profile,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
const errors=[],timeline=[];let app;const t0=Date.now(),at=()=>((Date.now()-t0)/1000).toFixed(1)+'s';
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:profile}});
 const ui=await app.firstWindow();ui.on('pageerror',e=>errors.push(e.message));
 await ui.waitForFunction(()=>window.__acira&&window.acira);await ui.evaluate(()=>document.fonts.ready);
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setContentSize(1440,900));
 const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action);
 const state=()=>ui.evaluate(()=>window.acira.getSnapshot());
 const waitFor=async(predicate,ms=240000)=>{const end=Date.now()+ms;for(;;){if(await predicate())return true;if(Date.now()>end)return false;await ui.waitForTimeout(150);}};
 // A hidden window does not advance CSS animations, so finish the one-shot ones and settle the endless ones before a frame.
 const settle=()=>ui.evaluate(()=>{for(const a of document.getAnimations()){try{if(a.effect?.getTiming().iterations===Infinity)a.currentTime=1200;else a.finish();}catch{}}});
 const capture=async name=>{await settle();const data=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()==='http://127.0.0.1:5188/');await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});return(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64');});await fs.writeFile(path.join(out,`${name}-${theme}.png`),Buffer.from(data,'base64'));timeline.push(`${at()} ${name}`);console.log(at(),name);};
 const run=async()=>(await state()).runs[0];
 await act({type:'run.start',prompt:SHOWCASE_PROMPT,tabId:'tab-home'});
 await ui.locator('.acira-card[data-kind="boundaries"]').waitFor();await ui.waitForTimeout(900);await capture('01-boundaries');
 await act({type:'run.boundaries.confirm',id:(await run()).id});const started=Date.now();
 await ui.waitForTimeout(1200);await capture('02-thinking');
 await waitFor(async()=>(await ui.locator('.ed-msg-assistant[data-streaming]').count())>0,10000);await ui.waitForTimeout(700);await capture('03-plan-streaming');
 await waitFor(async()=>(await run()).browsers.some(b=>b.page==='checkout'));await ui.waitForTimeout(2500);console.log('dom at checkout:',JSON.stringify(await ui.evaluate(()=>{const aura=document.querySelector('.agent-aura'),sc=document.querySelector('.agent-browser-scroll');return {aura:!!aura,auraShadow:aura&&getComputedStyle(aura).boxShadow.slice(0,90),auraBox:aura&&aura.getBoundingClientRect().width,scroll:sc&&[sc.scrollWidth,sc.clientWidth],cursor:!!document.querySelector('.agent-cursor')};})));await capture('04-volta-checkout');
 await act({type:'run.browser.display',id:(await run()).id,display:'mini'});await ui.waitForTimeout(700);await capture('04b-minimized');
 await act({type:'run.browser.display',id:(await run()).id,display:'expanded'});await ui.waitForTimeout(700);await capture('04c-expanded');
 await act({type:'run.browser.display',id:(await run()).id,display:'side'});
 await waitFor(async()=>(await run()).events.some(e=>/quarantine/i.test(e)));await ui.waitForTimeout(1500);await capture('05-quarantine-testing');
 await waitFor(async()=>((await run()).quarantined||[]).length>0);await ui.waitForTimeout(900);await capture('06-quarantine-blocked');
 await waitFor(async()=>(await run()).status==='waiting');const waited=((Date.now()-started)/1000).toFixed(0);await ui.waitForTimeout(1500);console.log('dom at approval:',JSON.stringify(await ui.evaluate(()=>({live:document.querySelector('.at-live')?.textContent,review:!!document.querySelector('.op-review'),header:document.querySelector('.at-state')?.textContent}))));await capture('07-approval');
 const approval=(await state()).approvals.find(a=>a.status==='pending');await act({type:'approval.decide',id:approval.id,decision:'approved'});
 await waitFor(async()=>(await run()).status==='completed');await ui.waitForTimeout(3500);await capture('08-done');
 await ui.locator('.at-fold').first().click();await ui.waitForTimeout(600);await capture('09-steps-open');
 const doneTab=(await state()).activeTabId;await act({type:'tab.new'});await ui.waitForTimeout(1200);
 const preset=await ui.locator(`[data-tab-id="${doneTab}"] .tab-agent-icon .dot-matrix`).first().getAttribute('data-preset').catch(()=>null);
 await capture('10-left-chat');
 console.log(JSON.stringify({secondsToApproval:Number(waited),doneTabPresetAfterLeaving:preset,errors}));
}finally{if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(out,`timeline-${theme}.txt`),timeline.join('\n'));}
