import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/tab-drag');
const {createInitialState,reduceDemo,persistedSnapshot}=require('../desktop/runtime.cjs');
await fs.mkdir(out,{recursive:true});
// A disposable profile shaped like a real strip: one ungrouped tab, then a three-tab group at the end.
let seed=createInitialState();
seed.demo.frozen=true;seed.settings.interfaceScale=100;seed.settings.automaticCompact=false;seed.settings.bookmarksBar=false;seed.settings.reducedMotion=false;seed.windowUi.workspaceOpen=true;
seed.tabs.forEach(t=>t.panelOpen=false);
seed=reduceDemo(seed,{type:'tab.new'});
seed.tabGroups=[];seed.tabs.forEach(t=>t.group='');
const ids=seed.tabs.slice(0,4).map(t=>t.id);
seed=reduceDemo(seed,{type:'tab.group.create',tabId:ids[1],name:'Work',color:'red'});
seed=reduceDemo(seed,{type:'tab.group.assign',tabIds:ids.slice(2),groupId:seed.tabGroups[0].id});
const profile=path.join(out,'profile');await fs.rm(profile,{recursive:true,force:true});await fs.mkdir(profile,{recursive:true});
await fs.writeFile(path.join(profile,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
const report={checks:[],errors:[],strips:[],limits:['Input is dispatched through Chromium, so it does not exercise Windows hit-testing of drag regions; the strip itself is declared no-drag for that case.']};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:profile}});
 const ui=await app.firstWindow();ui.on('pageerror',e=>report.errors.push(e.message));
 if(process.env.DRAG_DEBUG){app.process().stdout?.on('data',d=>process.stdout.write('[main] '+d));app.process().stderr?.on('data',d=>process.stdout.write('[main!] '+d));ui.on('console',m=>console.log('[ui]',m.text().slice(0,300)));}
 await ui.waitForFunction(()=>window.acira&&document.querySelector('.tabs-strip [data-group-tray]'));
 await ui.waitForTimeout(900);
 if(process.env.DRAG_DEBUG)await ui.evaluate(()=>{for(const type of ['pointercancel','lostpointercapture','pointerup'])document.addEventListener(type,e=>console.log('event',type,Math.round(e.clientX),Math.round(e.clientY),e.target?.className?.toString?.().slice(0,30)),true);});
 const strip=()=>ui.evaluate(()=>window.acira.getSnapshot().then(s=>s.tabs.map(t=>`${t.id}${t.group?'@'+t.group:''}`).join(' ')));
 const group=id=>ui.evaluate(id=>window.acira.getSnapshot().then(s=>s.tabs.find(t=>t.id===id)?.group||''),id);
 const order=()=>ui.evaluate(()=>window.acira.getSnapshot().then(s=>s.tabs.map(t=>t.id)));
 const drag=async(id,dx,dy,name)=>{
  const box=await ui.locator(`.tabs-strip .browser-tab[data-tab-id="${id}"]`).boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await ui.mouse.move(x,y);await ui.mouse.down();
  for(let step=1;step<=20;step++){await ui.mouse.move(x+dx*step/20,y+dy*step/20);await ui.waitForTimeout(16);}
  await ui.waitForTimeout(200);
  const cue=await ui.evaluate(id=>({intent:document.querySelector(`.tabs-strip .browser-tab[data-tab-id="${id}"]`)?.dataset.dropIntent||'',joining:document.querySelectorAll('.tabs-strip [data-group-drop-target]').length,leaving:document.querySelectorAll('.tabs-strip [data-group-drop-leaving]').length}),id);
  await ui.screenshot({path:path.join(out,`${name}-mid.png`),clip:{x:0,y:0,width:1440,height:48},timeout:3000}).catch(()=>{});
  await ui.mouse.up();
  // Motion delivers onDragEnd on the next frame; a hidden test window only renders frames on input.
  for(let pump=0;pump<6;pump++){await ui.mouse.move(8,300+pump);await ui.waitForTimeout(60);}
  await ui.waitForTimeout(500);
  const after=await strip();report.strips.push({name,cue,after});console.log(name,JSON.stringify(cue),after);return cue;
 };
 console.log('start',await strip());
 const [first,,second,third]=await order(),groupName=await group(third);
 check('The seeded group sits at the end of the strip',groupName==='Work'&&(await order()).at(-1)===third);
 let cue=await drag(third,+(process.env.FAR||420),0,'far-out');
 check('Pulling the last grouped tab far past the strip end shows a leave cue',cue.intent==='leave'&&cue.leaving===1);
 check('Releasing past the strip end removes the tab from its group',await group(third)==='');
 cue=await drag(third,-190,0,'join');
 check('Dragging an outside tab onto the group shows a join cue',cue.intent==='join'&&cue.joining===1);
 check('Releasing over the group joins it',await group(third)==='Work');
 const before=await order();cue=await drag(third,-190,0,'reorder');
 check('Reordering inside the group keeps membership and changes order',await group(third)==='Work'&&JSON.stringify(await order())!==JSON.stringify(before));
 await drag(first,1100,0,'to-end');
 check('An ungrouped tab dragged past the end lands last, outside the group',(await order()).at(-1)===first&&await group(first)==='');
 await drag(second,380,-14,'drift-out');
 check('A pull-out with upward drift still leaves the group',await group(second)==='');
 await drag(third,0,64,'pull-down');
 check('Pulling a grouped tab below the strip detaches it',await group(third)==='');
}catch(error){report.errors.push(String(error.stack||error));throw error;}
finally{await app?.close().catch(()=>{});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks.length,errors:report.errors}));
