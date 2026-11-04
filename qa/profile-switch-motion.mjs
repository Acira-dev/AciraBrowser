// Profiles as spaces: a switch goes straight from one space to the next (founder, 3 Nov: "how it expands and glitches, then gets good").
// Records every frame of real switches on a disposable profile (three profiles, heavy local pages in each) and fails on any in-between
// state: the incoming list re-ordered, the last space's rows drawn as fading pictures, the space row or its pill taking more than one
// layout, the space row and the footer drifting sideways, a strip chip away from its final width or place, a page view resized.
// Smoothness is not judged (a busy machine drops frames); only what each frame shows. Tabs are opened with tabs on top and the layout
// is then changed with only Personal on screen, so Client's and Studio's own tab-layout switches are out of date when they come on screen. `node qa/profile-switch-motion.mjs [repo]`
// runs another checkout's main and interface (a base copy, to see it fail there).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,sleep} from './d-harness.mjs';

const stamp=Date.now(),root=path.resolve('.qa-profiles/profile-switch-'+stamp),out=path.resolve(process.env.PROFILE_SWITCH_OUT||'qa/artifacts/profile-switch-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
// Heavy local pages (a long article over a grid of cards): no network, and every profile has its own addresses.
const fixture=await httpFixture((req,res)=>{const name=decodeURIComponent(req.url.slice(1))||'Page';res.setHeader('Content-Type','text/html');res.end(`<title>${name}</title><style>body{font:15px system-ui;margin:24px}.g{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.g div{height:90px;border-radius:6px;background:linear-gradient(#ccd,#eef)}</style><h1>${name}</h1><p>${'The quick brown fox jumps over the lazy dog. '.repeat(60)}</p><div class="g">${'<div></div>'.repeat(600)}</div>`);});
const site=name=>'http://127.0.0.1:'+fixture.port+'/'+encodeURIComponent(name);
const SPACES={Personal:['Guardian','BBC News','Wikipedia','GitHub'],Client:['Verge','Hacker News','Stack Overflow','CNN','Reuters'],Studio:['Figma','Playground','MDN']};
const report={passed:false,nativePlatform:process.platform,cases:[],problems:[]};
// Every frame: the sidebar, its space row (each cell and the pill), the footer, the tab rows (not FLIP's fading pictures) and strip chips.
const RECORDER=()=>{const r=el=>{if(!el)return null;const b=el.getBoundingClientRect();return [b.x,b.y,b.width,b.height].map(v=>Math.round(v*2)/2);},q=s=>document.querySelector(s);
 const frame=()=>({sidebar:r(q('.acira-sidebar')),ws:r(q('.sb-workspaces')),foot:r(q('.sb-foot')),footName:q('.sb-foot-profile')?.textContent?.trim()??'',pill:r(q('.sb-ws-pill')),
  cells:[...document.querySelectorAll('.sb-ws')].map(c=>[c.dataset.ws||'+',...r(c),c.getAttribute('aria-checked')==='true']),
  rows:[...document.querySelectorAll('.acira-sidebar .sb-scroll [data-tab-id]:not(.sb-flip-ghost)')].map(el=>[el.dataset.tabId,Math.round(el.getBoundingClientRect().y)]),
  ghosts:document.querySelectorAll('.acira-sidebar .sb-flip-ghost').length,
  arriving:document.querySelector('.acira-sidebar .sb-scroll')?.getAnimations({subtree:true}).filter(a=>a.id==='sb-arrive'||a.id==='sb-flip').length??0,
  chips:[...document.querySelectorAll('.tab-strip-container [data-tab-id]:not([data-leaving])')].map(el=>{const b=el.getBoundingClientRect();return [el.dataset.tabId,Math.round(b.x),Math.round(b.width)];}),
  leaving:document.querySelectorAll('.tab-strip-container [data-tab-id][data-leaving]').length});
 const T=window.__switchTrace={frames:[],on:false};
 T.start=()=>{T.frames=[];T.on=true;const loop=()=>{if(!T.on)return;T.frames.push(frame());requestAnimationFrame(loop);};requestAnimationFrame(loop);};
 T.stop=()=>{T.on=false;return T.frames;};};
const json=value=>JSON.stringify(value);
/** The sidebar during a switch, from the frame its footer names the new profile. */
function sidebarProblems(c){
 const f=c.frames,problems=[],start=f.findIndex(x=>x.footName!==f[0].footName);
 if(start<1)return [`no frame named the new profile (${f.length} frames)`];
 const after=f.slice(start),finalIds=f.at(-1).rows.map(row=>row[0]);
 const rows=new Set(after.map(x=>{const own=x.rows.filter(row=>finalIds.includes(row[0]));return json(own.map(row=>[row[0],row[1]-(own[0]?.[1]??0)]));}));
 c.rowLayouts=rows.size;if(rows.size!==1)problems.push(`the new space's rows took ${rows.size} layouts (their order or spacing changed mid-switch)`);
 const stale=after.filter(x=>x.rows.some(row=>!finalIds.includes(row[0]))).length;if(stale)problems.push(`${stale} frames still list the last space's rows`);
 c.ghostFrames=after.filter(x=>x.ghosts>0).length;if(c.ghostFrames)problems.push(`${c.ghostFrames} frames draw the last space's rows as fading pictures over the new ones`);
 c.arrivingFrames=after.filter(x=>x.arriving>0).length;if(c.arrivingFrames)problems.push(`${c.arrivingFrames} frames show the new space's rows sliding in as if just opened`);
 const open=x=>x.cells.findIndex(cell=>cell[5]),rowStart=f.findIndex(x=>open(x)!==open(f[0]));
 const row=new Set(f.slice(rowStart).map(x=>json([x.cells.map(cell=>[cell[1],cell[3]]),x.pill&&[x.pill[0],x.pill[2]]])));
 c.spaceRowLayouts=row.size;if(row.size!==1)problems.push(`the space row and its pill took ${row.size} layouts`);
 c.driftFrames=f.filter(x=>x.sidebar&&x.ws&&x.foot&&(Math.abs(x.ws[0]-x.sidebar[0])>.5||Math.abs(x.foot[0]-x.sidebar[0])>.5)).length;
 if(c.driftFrames)problems.push(`${c.driftFrames} frames show the space row and the footer shifted sideways`);
 return problems;
}
/** A tab strip during a switch: the new space's chips at their final widths and spacing (to 1px; the strip as a whole slides 16px,
 * workspaceMotion.ts) in every frame from the first one that shows them, except at most one: framer draws the frame after the strip
 * has read its room once more with the old spacing. The old strip took 25-40 frames to settle, its chips sliding up to 168px. */
function stripProblems(c){
 const f=c.frames,finalChips=f.at(-1).chips,finalIds=finalChips.map(chip=>chip[0]),start=f.findIndex(x=>x.chips.some(chip=>finalIds.includes(chip[0])));
 if(start<1||!finalChips.length)return [`no frame showed the new space's tabs (${f.length} frames)`];
 const widthOf=new Map(finalChips.map(chip=>[chip[0],chip[2]])),placeOf=new Map(finalChips.map(chip=>[chip[0],chip[1]-finalChips[0][1]]));
 let width=0,place=0,missing=0,off=0;
 for(const x of f.slice(start)){const own=x.chips.filter(chip=>finalIds.includes(chip[0]));if(own.length!==finalIds.length){missing++;continue;}
  let w=0,p=0;for(const chip of own){w=Math.max(w,Math.abs(chip[2]-widthOf.get(chip[0])));p=Math.max(p,Math.abs(chip[1]-own[0][1]-placeOf.get(chip[0])));}
  if(w>1||p>1)off++;width=Math.max(width,w);place=Math.max(place,p);}
 const leaving=f.slice(start).filter(x=>x.leaving>0).length;
 Object.assign(c,{chipFramesOff:off,chipWidthOff:width,chipPlaceOff:place,chipsMissingFrames:missing,leavingFrames:leaving});
 const problems=[];if(leaving)problems.push(`${leaving} frames still draw the last space's tabs leaving the strip`);if(off>1)problems.push(`the new space's tabs took ${off} frames to reach their places (up to ${place}px off, widths up to ${width}px off)`);if(missing)problems.push(`${missing} frames lacked some of the new space's tabs`);
 return problems;
}
/** Two clicks on the space pills within one frame: the footer goes to the second space and never back to the first (each click is an
 * optimistic switch; the first one's update, held for its view transition, landed after the second and showed the first space). */
function raceProblems(c){
 const names=c.frames.map(x=>x.footName).filter((name,index,all)=>index===0||name!==all[index-1]);c.footerNames=names;
 const second=names.findIndex(name=>name.endsWith(c.expect));
 if(second<0)return [`the footer never named ${c.expect} (${names.join(' > ')})`];
 return names.length>second+1?[`after ${c.expect} the footer went back to ${names.slice(second+1).join(' > ')}`]:[];
}
let app;
try{
 app=await startApp({root,args:['--use-mock-keychain'],main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 if(process.platform==='darwin')assert.equal(await app.main(({app})=>app.commandLine.hasSwitch('use-mock-keychain')),true,'every launch here uses the mock keychain');
 // Off screen, and no taller than the display's work area: macOS trims a taller window at odd moments, which reads as a page resize.
 await app.main(({BaseWindow,screen})=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html')),area=screen.getPrimaryDisplay().workArea;w.setBounds({x:-17000,y:area.y+10,width:1280,height:Math.min(820,area.height-20)});w.showInactive();});
 // Every bounds a website's view is given during a switch (a page resized and restored would show here).
 await app.main(({WebContentsView})=>{globalThis.__switchViews=[];let proto=WebContentsView.prototype;while(proto&&!Object.hasOwn(proto,'setBounds'))proto=Object.getPrototypeOf(proto);const real=proto.setBounds;
  proto.setBounds=function(bounds,...rest){try{const url=this.webContents?.getURL?.()||'';if(globalThis.__switchViewsOn&&/^https?:/.test(url))globalThis.__switchViews.push({url,width:bounds.width,height:bounds.height});}catch{}return real.call(this,bounds,...rest);};});
 await app.act({type:'settings.update',patch:{askBeforeClosing:false,reducedMotion:false,appearance:'dark',interfaceScale:100}});
 await app.act({type:'browser.profile.create',name:'Client'});await app.act({type:'browser.profile.create',name:'Studio'});
 await app.act({type:'settings.update',patch:{spaces:'profiles',verticalTabs:false}});await app.act({type:'ui.update',patch:{view:'full',workspaceOpen:true,webWorkspaceOpen:true}});await sleep(600);
 const s=await app.state(),profiles=Object.fromEntries(s.browserProfiles.filter(p=>!p.private).map(p=>[p.name,p.id])),space=name=>s.workspaces.find(w=>w.browserProfileId===profiles[name]).id;
 for(const [name,pages] of Object.entries(SPACES)){await app.act({type:'workspace.select',id:space(name)});await sleep(400);for(const page of pages){await app.act({type:'tab.new',url:site(page),browserProfileId:profiles[name]});await sleep(150);}}
 await app.act({type:'workspace.select',id:space('Personal')});await sleep(3000);
 // Sidebar tabs, chosen while Personal is on screen: Client's and Studio's switches still say tabs on top.
 await app.act({type:'settings.update',patch:{verticalTabs:true}});await sleep(1200);
 await app.ui.evaluate(RECORDER);
 const order=Object.keys(SPACES),pill=name=>app.ui.locator('.sb-ws').nth(order.indexOf(name));
 const traced=async(label,kind,run,expect)=>{
  await app.main(()=>{globalThis.__switchViews.length=0;globalThis.__switchViewsOn=true;});
  await app.ui.evaluate(()=>window.__switchTrace.start());await sleep(200);await run();await sleep(1300);
  const frames=await app.ui.evaluate(()=>window.__switchTrace.stop()),views=await app.main(()=>{globalThis.__switchViewsOn=false;return globalThis.__switchViews.splice(0);});
  const c={label,frames,views:views.length,expect},problems=kind==='strip'?stripProblems(c):kind==='race'?raceProblems(c):sidebarProblems(c);
  // 1.3 s after the switch every tab strip has its motion back (hover fades, the sound meter, a dropped tab's glide).
  if(kind==='strip'){c.stripMotion=await app.ui.evaluate(()=>[...document.querySelectorAll('.tab-strip-container[data-reduced-motion],.acira-compact-tabs[data-reduced-motion]')].map(el=>el.getAttribute('data-reduced-motion')));if(c.stripMotion.some(value=>value!=='false'))problems.push(`the tab strip is still in reduced motion after the switch (${c.stripMotion.join(',')})`);}c.frames=frames.length;if(process.env.PROFILE_SWITCH_FRAMES==='1')await fs.writeFile(path.join(out,'frames-'+report.cases.length+'.json'),json(frames));
  const sizes=new Set(views.map(v=>v.width+'x'+v.height));if(sizes.size>1)problems.push(`a page view took ${sizes.size} sizes (${[...sizes].join(', ')})`);
  Object.assign(c,{problems});report.cases.push(c);for(const problem of problems)report.problems.push(`${label}: ${problem}`);
  console.log((problems.length?'FAIL ':'PASS ')+label+(problems.length?' - '+problems.join('; '):''));
 };
 await traced('Sidebar, dark, 100%: a click on Studio (a space to the right; its switch out of date)','sidebar',()=>pill('Studio').click());
 await traced('Sidebar, dark, 100%: a click on Client (a space to the left; its switch out of date)','sidebar',()=>pill('Client').click());
 await traced('Sidebar, dark, 100%: the profile panel switches to Personal','sidebar',()=>app.act({type:'browser.profile.select',id:profiles.Personal,here:true}));
 await traced('Sidebar: Client then Studio clicked within one frame','race',()=>app.ui.evaluate(()=>{const cells=document.querySelectorAll('.sb-ws'),press=el=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));press(cells[1]);press(cells[2]);}),'Studio');
 await app.act({type:'workspace.select',id:space('Personal')});await sleep(900);
 await app.act({type:'settings.update',patch:{appearance:'light',interfaceScale:150}});await sleep(900);
 await traced('Sidebar, light, 150%: a click on Studio','sidebar',()=>pill('Studio').click());
 await traced('Sidebar, light, 150%: Next space to Personal','sidebar',()=>app.act({type:'workspace.select',id:space('Personal')}));
 await app.act({type:'settings.update',patch:{appearance:'dark',interfaceScale:100,verticalTabs:false}});await sleep(900);
 await traced('Tabs on top: Personal to Client (its switch out of date)','strip',()=>app.act({type:'workspace.select',id:space('Client')}));
 await traced('Tabs on top: Client to Personal','strip',()=>app.act({type:'workspace.select',id:space('Personal')}));
 await app.act({type:'ui.update',patch:{view:'compact'}});await sleep(900);
 await traced('Tabs on top, Compact: Personal to Studio (its switch out of date)','strip',()=>app.act({type:'workspace.select',id:space('Studio')}));
 report.passed=!report.problems.length;
 if(!report.passed)process.exitCode=1;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;}
finally{await app?.close();await fixture.close();await fs.rm(root,{recursive:true,force:true});await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,problems:report.problems.length,error:report.error,out}));}
