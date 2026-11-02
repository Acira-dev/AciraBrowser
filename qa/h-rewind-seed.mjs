// Stream H: a lived-in Rewind profile for audits and captures. Local fake sites only (*.localhost → 127.0.0.1, each with its own
// title and icon), two app sessions today plus saved moments from yesterday and three days ago, two windows, ≤ 20 tabs at a time.
// One Electron instance at a time, closed in finally; every wait is bounded.
//   node qa/h-rewind-seed.mjs [--shots dir] [--keep]      (D_VISIBLE=1 for a visible window)
// Prints AUDIT lines (what a user would notice) and leaves the profile in .qa-profiles/h-rewind-seed-* when --keep is given.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const keep=process.argv.includes('--keep');
const note=(label,value='')=>console.log(`AUDIT ${label}${value===''?'':`: ${typeof value==='string'?value:JSON.stringify(value)}`}`);

// --- fake sites ------------------------------------------------------------------------------------------------------
const SITES={
 mail:['#d93025','Inbox (12) – Mail'],calendar:['#1a73e8','Week of 26 October – Calendar'],figma:['#a259ff','Launch site – Figma'],
 github:['#24292f','Pull requests · acira/browser'],linear:['#5e6ad2','ACI · Active issues'],docs:['#1e8e3e','Q4 launch plan – Docs'],
 notion:['#37352f','User research notes'],news:['#ff6600','Show HN: A browser that never loses tabs'],video:['#ff0033','Design systems at scale – Video'],
 maps:['#34a853','Lisbon – Maps'],stays:['#ff385c','Loft in Alfama, Lisbon – Stays'],flights:['#0770e3','Flights to Lisbon (LIS)'],
 overflow:['#f48024','How to debounce input in React – Stack Overflow'],mdn:['#83d0f2','CSS container queries – MDN'],wiki:['#636466','Electron (software) – Wikipedia'],
 bank:['#004b8d','Accounts overview – Bank'],shop:['#f3a847','Noise-cancelling headphones – Shop'],music:['#1db954','Focus playlist – Music'],
};
const crcTable=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c]);};
/** A 32px rounded square in the site's colour: enough for the local icon store to keep a real image per host. */
function png(hex){
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),S=32,rows=[];
 for(let y=0;y<S;y++){const row=Buffer.alloc(1+S*4);for(let x=0;x<S;x++){const dx=Math.max(6-x,x-25,0),dy=Math.max(6-y,y-25,0),inside=dx*dx+dy*dy<=36;row.set(inside?[r,g,b,255]:[0,0,0,0],1+x*4);}rows.push(row);}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(S,0);ihdr.writeUInt32BE(S,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
const site=await httpFixture((req,res)=>{
 const host=String(req.headers.host||'').split('.')[0],[color,title]=SITES[host]||['#888888','Untitled'];
 if(req.url==='/icon.png'){res.writeHead(200,{'content-type':'image/png','cache-control':'max-age=86400'});return res.end(png(color));}
 res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><meta charset=utf-8><title>${title}</title><link rel=icon href="/icon.png"><body style="font:15px system-ui;padding:48px"><h1>${title}</h1><p>${req.url}</p>`);
});
const url=(host,p='/')=>`http://${host}.localhost:${site.port}${p}`;
const root=path.resolve(`.qa-profiles/h-rewind-seed-${Date.now()}`);

// --- saved moments from earlier days (written as Rewind stores them) ---------------------------------------------------
const DAY=86400000;
function moment(at,reason,label,groups,tabs){
 const id=`cp-${at.toString(36)}-${Math.floor(Math.random()*0xffffffff).toString(16).padStart(8,'0')}`;
 const g=groups.map((x,i)=>({ref:`g${i}`,name:x[0],color:x[1],order:i,collapsed:false}));
 return {schemaVersion:1,id,ownerProfileId:'',sourceWindowId:'1',workspaceRef:null,createdAt:at,reason,label,payloadHash:id.slice(-8).padEnd(32,'0'),privacyEpoch:0,skipped:0,groups:g,
  tabs:tabs.map(([host,p,groupIndex],i)=>({ref:`t${i}`,groupRef:groupIndex===undefined?null:`g${groupIndex}`,order:i,title:SITES[host][1],url:url(host,p),pinned:false,active:i===0}))};
}
async function seedEarlier(t){
 const profileId=(await t.state()).activeBrowserProfileId,dir=path.join(await t.main(({app})=>app.getPath('userData')),'rewind',profileId);
 await fs.mkdir(dir,{recursive:true});
 const at=(days,h,m)=>{const d=new Date(Date.now()-days*DAY);d.setHours(h,m,0,0);return d.getTime();};
 const rows=[
  moment(at(3,9,40),'periodic','',[['Research','blue']],[['mail','/inbox'],['calendar','/week'],['notion','/research',0],['wiki','/Electron',0],['mdn','/container',0]]),
  moment(at(3,11,55),'tabs-close','4 tabs closed',[['Research','blue']],[['mail','/inbox'],['calendar','/week'],['notion','/research',0],['wiki','/Electron',0],['mdn','/container',0],['overflow','/q/1',0],['news','/item'],['video','/watch']]),
  moment(at(3,17,20),'window-close','',[],[['shop','/headphones'],['music','/focus'],['bank','/overview']]),
  moment(at(1,10,5),'periodic','',[['Q4 launch','purple']],[['mail','/inbox'],['figma','/file/launch',0],['docs','/q4-plan',0],['linear','/team/ACI',0],['github','/acira/pulls']]),
  moment(at(1,14,30),'group-close','Q4 launch',[['Q4 launch','purple']],[['mail','/inbox'],['figma','/file/launch',0],['docs','/q4-plan',0],['linear','/team/ACI',0],['github','/acira/pulls'],['github','/acira/issues/482']]),
  moment(at(1,18,45),'manual','',[['Lisbon trip','orange']],[['maps','/lisbon',0],['stays','/rooms/alfama',0],['flights','/lis',0],['mail','/inbox']]),
 ];
 for(const row of rows){row.ownerProfileId=profileId;await fs.writeFile(path.join(dir,`${row.id}.json`),JSON.stringify(row));}
 note('seeded earlier moments',rows.length);
}

async function openTabs(t,list,{select=true}={}){
 const s0=await t.state();
 await t.act({type:'tab.navigate',tabId:s0.activeTabId,url:url(...list[0])});
 for(const item of list.slice(1))await t.act({type:'tab.new',url:url(...item),background:true});
 let s=await poll(t.state,s=>s.tabs.length>=list.length,'tabs open');
 if(select){for(const tab of s.tabs){await t.act({type:'tab.select',id:tab.id});await sleep(250);}await poll(t.state,s=>s.tabs.every(x=>!/localhost/.test(x.title)),'titles',12000).catch(()=>{});}
 return t.state();
}
async function group(t,name,color,hosts){
 let s=await t.state();const ids=s.tabs.filter(x=>hosts.some(h=>x.url.includes(`//${h}.`))).map(x=>x.id);
 await t.act({type:'tab.group.create',tabId:ids[0],name,color});s=await poll(t.state,s=>s.tabGroups.some(g=>g.name===name),`group ${name}`);
 await t.act({type:'tab.group.assign',tabIds:ids,groupId:s.tabGroups.find(g=>g.name===name).id});return poll(t.state,s=>s.tabs.filter(x=>x.group===name).length===ids.length,`${name} filled`);
}
async function closeWhere(t,test){const s=await t.state();for(const tab of s.tabs.filter(test))await t.act({type:'tab.close',id:tab.id});await sleep(2300);}
const shot=async(t,name)=>{if(!shots)return;await fs.mkdir(shots,{recursive:true});await sleep(450);await t.ui.screenshot({path:path.join(shots,`${name}.png`),scale:'css'});};

let t=null;
try{
 // Session 1: a working morning in one window, then a trip-planning window that gets closed.
 t=await startApp({root});await t.act({type:'settings.update',patch:{appearance:'light'}});
 await seedEarlier(t);
 await openTabs(t,[['mail','/inbox'],['calendar','/week'],['figma','/file/launch'],['docs','/q4-plan'],['linear','/team/ACI'],['github','/acira/pulls'],['github','/acira/issues/482'],['maps','/lisbon'],['stays','/rooms/alfama'],['flights','/lis'],['news','/item'],['overflow','/q/1']]);
 await group(t,'Q4 launch','purple',['figma','docs','linear']);await group(t,'Lisbon trip','orange',['maps','stays','flights']);
 await closeWhere(t,x=>x.group==='Lisbon trip');
 await closeWhere(t,x=>/news|overflow/.test(x.url));
 await t.ui.evaluate(()=>window.acira.rewind({type:'rewind.save'}));
 await t.ui.evaluate(()=>window.acira.openWindow('normal'));
 const uiPages=()=>t.context.pages().filter(p=>{try{return p.url()==='acira-browser-ui://ui/index.html';}catch{return false;}});
 const second=await poll(()=>uiPages().find(p=>p!==t.ui),Boolean,'second window');await poll(()=>second.evaluate(()=>Boolean(window.acira?.getSnapshot)),Boolean,'second ready');
 const act2=a=>second.evaluate(a=>window.acira.dispatch(a),a);
 await act2({type:'tab.navigate',tabId:(await second.evaluate(()=>window.acira.getSnapshot())).activeTabId,url:url('shop','/headphones')});
 for(const item of [['music','/focus'],['video','/watch'],['mdn','/container']])await act2({type:'tab.new',url:url(...item)});
 await poll(()=>second.evaluate(()=>window.acira.getSnapshot()),s=>s.tabs.length===4,'second window tabs');await sleep(1500);
 await second.evaluate(()=>window.acira.windowControl('close'));await poll(()=>uiPages().length,n=>n===1,'second closed');
 await sleep(800);await t.close();t=null;

 // Session 2: the next launch restores the window; the user tidies up and later looks for something.
 t=await startApp({root,skipSetup:false});await sleep(1500);
 let s=await t.state();note('tabs after restart',s.tabs.length);
 await t.act({type:'tab.new',url:url('wiki','/Electron'),background:true});await t.act({type:'tab.new',url:url('notion','/research'),background:true});
 await sleep(800);await closeWhere(t,x=>/github|calendar/.test(x.url));

 // --- the 5-second test and every restore level, as a user (REWIND_REDESIGN.md §7) ------------------------------------
 const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
 const tabs=async()=>(await t.state()).tabs.length;
 const started=Date.now();await t.act({type:'tab.new',url:'acira://rewind'});
 await poll(()=>t.ui.locator('.rw-row').count(),n=>n>0,'rewind rows',10000);const opened=Date.now()-started;note('rows visible after (ms)',opened);check(opened<1500,`moments are on screen ${opened} ms after opening`);
 await sleep(500);
 const titles=await t.ui.locator('.rw-row-title').allTextContents();note('row titles',titles);
 check(!titles.some(x=>/^(Before|Saved automatically)/.test(x))&&titles.some(x=>/Lisbon trip/.test(x))&&titles.some(x=>/Q4 launch/.test(x)),'rows are named by what is in them (groups, sites), not why they were saved');
 const counts=await t.ui.locator('.rw-count').allTextContents();check(counts.some(x=>/\d+ not open/.test(x)),`rows say what you'd get back (${counts.slice(0,4).join(', ')})`);
 const icons=await t.ui.locator('.rw-timeline img.rw-favicon').count();check(icons>=3,`real site icons from the local store (${icons})`);
 const sessions=await t.ui.locator('.rw-session-label').allTextContents();note('sessions',sessions);
 check(sessions.some(x=>/^This session/.test(x))&&sessions.some(x=>/^Session · .*2 windows/.test(x))&&sessions.some(x=>/^Earlier/.test(x)),'timeline shows this session, the earlier session with its 2 windows, and older days');
 await shot(t,'rewind-v2-light');
 for(const [q,min] of [['alfama',1],['headphones',1],['482',1],['nothing-like-this',0]]){await t.ui.locator('.lib-search input').fill(q);await sleep(450);const n=await t.ui.locator('.rw-row').count();note(`search "${q}" rows`,n);check(min?n>=min:n===0,`search "${q}" → ${n} moment(s)`);}
 // The narrowing list moves on A's shared list motion (sharedMotion.useListMotion), not a hard cut.
 await t.ui.locator('.lib-search input').fill('');await sleep(500);await t.ui.locator('.lib-search input').fill('lisbon');
 const moving=await poll(()=>t.ui.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.target?.closest?.('.rw-days')).length),n=>n>0,'list motion',1500).catch(()=>0);
 check(moving>0,`filtering animates the timeline with the shared list motion (${moving} running)`);await sleep(400);
 await shot(t,'rewind-v2-search');
 await t.ui.locator('.lib-search input').fill('');await sleep(450);
 // Group: the Lisbon moment from this morning, one click, then Undo from the toast.
 await t.ui.locator('.rw-row',{has:t.ui.locator('.rw-why',{hasText:'Closed “Lisbon trip”'})}).first().click();
 await poll(()=>t.ui.locator('.rw-group-label',{hasText:'Lisbon trip'}).count(),n=>n===1,'Lisbon group in detail');
 await shot(t,'rewind-v2-detail-light');
 let before=await tabs();await t.ui.locator('.rw-group-label',{hasText:'Lisbon trip'}).locator('.rw-group-restore').click();
 s=await poll(t.state,s=>s.tabs.length===before+3&&s.toast?.action?.command?.type==='rewind.undo','group restored with an Undo toast');
 check(s.tabs.filter(x=>x.group==='Lisbon trip').length===3&&/restored to Lisbon trip/.test(s.toast.text),`one click brought the group back ("${s.toast.text} · Undo")`);
 await shot(t,'rewind-v2-restored');
 await t.ui.locator('.t-toast',{hasText:'restored to Lisbon trip'}).locator('.toast-action').click();
 s=await poll(t.state,s=>s.tabs.length===before,'undo from the toast');check(/Restore undone/.test(s.toast?.text||''),'Undo took exactly those tabs back ("Restore undone")');
 // Keyboard only: into the detail, restore one tab, Ctrl+Z.
 await t.ui.locator('.rw-row[aria-selected=true]').focus();await t.ui.keyboard.press('Enter');
 await poll(()=>t.ui.evaluate(()=>document.activeElement?.classList.contains('rw-tab')),Boolean,'focus in detail');
 before=await tabs();await t.ui.keyboard.press('Enter');await poll(t.state,x=>x.tabs.length===before+1&&x.toast?.action?.command?.type==='rewind.undo','tab restored by Enter');check(true,'Enter restores the focused tab');
 await t.ui.keyboard.press('Control+z');await poll(tabs,n=>n===before,'Ctrl+Z undo');check(true,'Ctrl+Z takes it back');
 await t.ui.keyboard.press('Escape');check(await t.ui.evaluate(()=>document.activeElement?.classList.contains('rw-row')),'Esc goes back to the moment');
 // Everything closed in one step, then undo.
 before=await tabs();const missing=Number((await t.ui.locator('.rw-detail-actions .acira-button-primary').textContent()).match(/\d+/)?.[0]||0);
 await t.ui.keyboard.press('Control+Enter');await poll(t.state,x=>x.tabs.length===before+missing&&x.toast?.action?.command?.type==='rewind.undo','restore all');check(missing>0,`Ctrl+Enter restored all ${missing} closed tabs`);
 await t.ui.keyboard.press('Control+z');await poll(tabs,n=>n===before,'undo all');
 // The whole moment as a window.
 const uiPagesNow=()=>t.context.pages().filter(p=>{try{return p.url()==='acira-browser-ui://ui/index.html';}catch{return false;}});
 const detailCount=Number((await t.ui.locator('.rw-detail-meta').textContent()).match(/(\d+) tabs?/)?.[1]||0);
 await t.ui.getByRole('button',{name:'Open in new window'}).click();
 const win=await poll(()=>uiPagesNow().find(p=>p!==t.ui),Boolean,'new window');await poll(()=>win.evaluate(()=>Boolean(window.acira?.getSnapshot)),Boolean,'new window ready');
 const ws=await poll(()=>win.evaluate(()=>window.acira.getSnapshot()),x=>x.tabs.length===detailCount,'window holds the moment',15000);
 check(ws.tabs.filter(x=>x.group==='Lisbon trip').length===3,`"Open in new window" opened all ${detailCount} tabs with the group`);
 await win.evaluate(()=>window.acira.windowControl('close'));await poll(()=>uiPagesNow().length,n=>n===1,'window closed');await sleep(400);
 // Keep, then Forget another moment.
 await t.ui.getByRole('button',{name:'Keep',exact:true}).click();
 await poll(()=>t.ui.locator('.rw-keys-kept').textContent(),x=>/Kept until you forget it/.test(x||''),'kept');check(true,'Keep holds the moment past the usual days');
 await shot(t,'rewind-v2-kept');
 const moments=await t.ui.locator('.rw-row').count();await t.ui.locator('.rw-row').last().click();await sleep(300);
 await t.ui.getByRole('button',{name:'Forget this moment'}).click();await t.ui.getByRole('button',{name:'Forget this moment'}).click();
 await poll(()=>t.ui.locator('.rw-row').count(),n=>n===moments-1,'forgotten');check(true,'Forget removes a moment in two deliberate steps');
 await t.act({type:'settings.update',patch:{appearance:'dark'}});await t.ui.locator('.rw-row').first().click();await shot(t,'rewind-v2-dark');
 await t.act({type:'settings.update',patch:{appearance:'light',interfaceScale:150}});await sleep(700);await shot(t,'rewind-v2-150');
 await t.act({type:'settings.update',patch:{interfaceScale:100}});
 note('profile',root);
}finally{if(t)await t.close();await site.close();if(!keep)await fs.rm(root,{recursive:true,force:true}).catch(()=>{});}
