'use strict';
// Task manager (Beta 14.0): what each tab, extension and part of Acira costs right now, read from Electron's own process list.
// Nothing here runs on its own. The Task manager pop-up asks (service 'taskmanager.read', every 2 s while it is open) and this
// answers from app.getAppMetrics(); closing the pop-up sends 'taskmanager.close', which drops the one CPU baseline kept here.
// The first reading of a session has memory and no CPU yet (the pop-up shows a CPU figure only above 1 %, so nothing is missing on
// its first screen) and waits at most QUICK_MS for anything: the pop-up is measured and shown with it, at its final height. The one
// timer here is that bounded wait, inside a reading that was asked for.
// No timer, no listener, no 'web-contents-created' hook: a closed pop-up leaves nothing behind. Keep this file ASCII only
// (main's script text stays one byte per character, see memory electron-main-script-ascii-two-byte).
//
// Honest numbers: several tabs of one site can share one renderer process. A process is counted once and shown as one group with
// one figure; it is never divided between its tabs. Sleeping tabs and Acira's own pages have no process of their own: no figure.
const FRESH_MS=10000; // a CPU baseline older than this is not a baseline
const QUICK_MS=60;    // how long the first reading of a session waits for the process list (usually there in 20 to 40 ms)

/** Memory of one process in KB. macOS and Linux report the working set (resident memory); Windows also reports private bytes, the
 * part no other process shares, which is what its own Task Manager lists. */
function memoryKB(memory,platform=process.platform){
 if(!memory||typeof memory!=='object')return 0;
 if(platform==='win32'&&Number.isFinite(memory.privateBytes)&&memory.privateBytes>0)return memory.privateBytes;
 return Number.isFinite(memory.workingSetSize)&&memory.workingSetSize>0?memory.workingSetSize:0;
}

/** Which of Acira's own parts a process belongs to, or 'page' for a renderer (a tab, the interface or an extension). */
function partOf(metric){
 const type=String(metric.type||''),service=String(metric.serviceName||metric.name||'').toLowerCase();
 if(type==='Browser')return 'browser';
 if(type==='GPU')return 'graphics';
 if(type==='Tab'||type==='Renderer')return 'page';
 if(type==='Utility'&&/network/.test(service))return 'network';
 return 'other';
}

/** Pure: one reading. `metrics` is app.getAppMetrics(); `context` says which processes are this window's tabs, its interface and its
 * extensions; `baseline` maps pid -> [wall ms, cumulative CPU seconds] from the previous reading. Returns the answer and the next baseline. */
function compute({metrics,context,baseline=new Map(),now=Date.now(),platform=process.platform}){
 const byPid=new Map();
 for(const metric of Array.isArray(metrics)?metrics:[]){
  if(!metric||!Number.isInteger(metric.pid))continue;
  const before=baseline.get(metric.pid),cumulative=metric.cpu&&Number.isFinite(metric.cpu.cumulativeCPUUsage)?metric.cpu.cumulativeCPUUsage:null;
  const wall=before?now-before[0]:0,cpu=before&&cumulative!==null&&wall>=200&&cumulative>=before[1]?Math.round((cumulative-before[1])/(wall/1000)*1000)/10:null;
  byPid.set(metric.pid,{pid:metric.pid,part:partOf(metric),memoryKB:memoryKB(metric.memory,platform),cpu,cumulative});
 }
 const next=new Map();for(const item of byPid.values())if(item.cumulative!==null)next.set(item.pid,[now,item.cumulative]);
 const sum=list=>({memoryKB:list.reduce((total,item)=>total+item.memoryKB,0),cpu:list.some(item=>item.cpu!==null)?Math.round(list.reduce((total,item)=>total+(item.cpu||0),0)*10)/10:null});
 const used=new Set(),take=pids=>{const list=[];for(const pid of pids||[])if(byPid.has(pid)&&!used.has(pid)){used.add(pid);list.push(byPid.get(pid));}return list;};
 // Tabs: tabs that share a process become one group, in the order the tabs are listed.
 const order=[],groups=new Map();
 for(const tab of context.tabs||[]){
  if(!Number.isInteger(tab.pid)||!byPid.has(tab.pid))continue;
  if(!groups.has(tab.pid)){groups.set(tab.pid,{pid:tab.pid,tabIds:[]});order.push(tab.pid);}
  groups.get(tab.pid).tabIds.push(tab.id);
 }
 const tabs=order.map(pid=>{const item=byPid.get(pid);used.add(pid);return {tabIds:groups.get(pid).tabIds,memoryKB:item.memoryKB,cpu:item.cpu};});
 const interfaceProcesses=take(context.interfacePids);
 // An extension whose worker runs but whose process is not known yet (`listed`: the first reading does not wait for it) keeps its row, without a figure.
 const extensions=(context.extensions||[]).map(extension=>{const list=take(extension.pids);return list.length?{id:extension.id,name:extension.name,...sum(list)}:extension.listed?{id:extension.id,name:extension.name,memoryKB:0,cpu:null}:null;}).filter(Boolean);
 const rest=[...byPid.values()].filter(item=>!used.has(item.pid));
 const part=name=>rest.filter(item=>item.part===name);
 // Renderers nobody here owns: another window's tabs and interface, the sign-in and pop-up windows, extension workers.
 const own=[
  {id:'browser',...sum(part('browser'))},
  {id:'interface',...sum(interfaceProcesses)},
  {id:'graphics',...sum(part('graphics'))},
  {id:'network',...sum(part('network'))},
  {id:'otherPages',...sum(part('page'))},
  {id:'other',...sum(part('other'))},
 ].filter(item=>item.memoryKB>0);
 const total=sum([...byPid.values()]);
 return {answer:{at:now,platform,tabs,extensions,own,total},baseline:next};
}

/** `ps` lines "  1234 /path/Helper --type=renderer ... --renderer-client-id=7 ..." to Map(client id -> pid). Chromium's renderer client id is the number
 * webContents.getProcessId() and a service worker's renderProcessId report; the OS pid is what the process list is keyed by. */
function parseClientIds(text,live){
 const map=new Map();
 for(const line of String(text).split('\n')){const match=/^\s*(\d+)\s.*?--renderer-client-id=(\d+)/.exec(line);if(match&&(!live||live.has(Number(match[1]))))map.set(Number(match[2]),Number(match[1]));}
 return map;
}
/** macOS and Linux: one `ps` while the pop-up is open and a worker's process is unknown. Windows has no such list here: those processes stay under "Other windows and pages". */
function psClientIds(platform,execFile,live){
 if(platform==='win32')return Promise.resolve(new Map());
 return new Promise(resolve=>{try{execFile('ps',['-axww','-o','pid=,command='],{maxBuffer:16*1024*1024,timeout:3000},(error,out)=>resolve(error?new Map():parseClientIds(out,live)));}catch{resolve(new Map());}});
}

/** The window's own side of the reading: which OS process each tab's page, the interface views and each extension's pages run in. */
function windowContext({tabs,pages,views,webContents,names,workers}){
 const pidOf=wc=>{try{return wc&&!wc.isDestroyed()?wc.getOSProcessId():null;}catch{return null;}};
 const context={tabs:[],interfacePids:[],extensions:[],workers:(workers||[]).map(worker=>({id:worker.id,rph:worker.rph,name:(names&&names.get(worker.id))||worker.id}))};
 for(const tab of tabs||[]){const entry=pages.get(tab.id),wc=entry&&entry.view&&entry.view.webContents,pid=pidOf(wc);if(Number.isInteger(pid))context.tabs.push({id:tab.id,pid});}
 for(const view of views||[]){const pid=pidOf(view&&view.webContents);if(Number.isInteger(pid)&&!context.interfacePids.includes(pid))context.interfacePids.push(pid);}
 // Extension pages (popups, options, offscreen documents and background pages) run in a process named for the extension.
 const found=new Map();
 for(const wc of webContents||[]){
  let url='';try{url=wc.isDestroyed()?'':wc.getURL();}catch{}
  const match=/^chrome-extension:\/\/([a-z]{32})\//.exec(url);if(!match)continue;
  const pid=pidOf(wc);if(!Number.isInteger(pid))continue;
  if(!found.has(match[1]))found.set(match[1],{id:match[1],name:(names&&names.get(match[1]))||match[1],pids:[]});
  if(!found.get(match[1]).pids.includes(pid))found.get(match[1]).pids.push(pid);
 }
 context.extensions=[...found.values()];
 return context;
}

/** Which file of an extension is its icon at about 32 px: the smallest one of 32 px or more, else its largest. Relative to the extension's folder; null when it declares none. */
function iconFile(manifest){
 const icons=manifest&&typeof manifest.icons==='object'&&manifest.icons?manifest.icons:{};
 const sizes=Object.keys(icons).map(Number).filter(size=>Number.isFinite(size)&&size>0&&typeof icons[String(size)]==='string'&&icons[String(size)]).sort((a,b)=>a-b);
 if(!sizes.length)return null;
 const size=sizes.find(value=>value>=32)||sizes[sizes.length-1];
 return String(icons[String(size)]).replace(/^[\\/]+/,'');
}
/** An extension's icon as a small PNG data URL, or '' (no icon declared, a file outside its folder, an unreadable picture). `load` is nativeImage.createFromPath. */
function extensionIcon(extension,load,path=require('node:path')){
 try{
  const file=iconFile(extension&&extension.manifest);if(!file||!extension.path)return '';
  const full=path.resolve(extension.path,file),root=path.resolve(extension.path)+path.sep;
  if(!full.startsWith(root))return '';
  const image=load(full);if(!image||image.isEmpty())return '';
  const url=image.resize({width:32,height:32,quality:'best'}).toDataURL();
  return typeof url==='string'&&url.length<200000?url:'';
 }catch{return '';}
}

function createTaskManager({app,platform=process.platform,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),execFile=(...args)=>require('node:child_process').execFile(...args)}={}){
 let baseline=new Map(),readAt=0,clientPids=new Map(),asking=null;
 /** Extension service workers have no page of their own: their process is found through its renderer client id (cached; a pid that left the list is forgotten).
  *  `quick` (the first reading of a session) waits for that list for QUICK_MS at most: the pop-up gets its rows at once and opens at its final height;
  *  if the list is late, the workers' extensions are listed without a figure and it is there for the next reading. */
 async function settle(context,live,quick){
  const workers=context.workers||[];
  if(!workers.length)return context;
  if(workers.some(worker=>!clientPids.has(worker.rph))){
   /* ps lists every Electron and Chrome on the machine, and client ids repeat between them: only a pid of this app counts. */
   const ask=asking||(asking=psClientIds(platform,execFile,live).then(found=>{asking=null;for(const [rph,pid] of found)clientPids.set(rph,pid);}));
   await (quick?Promise.race([ask,wait(QUICK_MS)]):ask);
  }
  const extensions=new Map((context.extensions||[]).map(extension=>[extension.id,{...extension,pids:[...extension.pids]}]));
  for(const worker of workers){
   const pid=clientPids.get(worker.rph),known=Number.isInteger(pid);
   if(!known&&platform==='win32')continue; /* no process list to ask there: the worker stays under Acira's other pages rather than as a row that never gets a figure */
   if(!extensions.has(worker.id))extensions.set(worker.id,{id:worker.id,name:worker.name||worker.id,pids:[]});
   const entry=extensions.get(worker.id);
   if(known){if(!entry.pids.includes(pid))entry.pids.push(pid);}else entry.listed=true;
  }
  return {...context,extensions:[...extensions.values()]};
 }
 const sample=async contextOf=>{const metrics=app.getAppMetrics(),live=new Set(metrics.map(item=>item.pid));for(const [rph,pid] of clientPids)if(!live.has(pid))clientPids.delete(rph);const context=await settle(await contextOf(),live,!readAt),result=compute({metrics,context,baseline,now:now(),platform});baseline=result.baseline;readAt=now();return result.answer;};
 return {
  /** One reading, at once. CPU is the share since the reading before; a baseline older than FRESH_MS is dropped first, so the first reading of a session (and one after a long pause) has none. */
  async read(contextOf){
   if(readAt&&now()-readAt>FRESH_MS)baseline=new Map();
   return sample(contextOf);
  },
  /** The pop-up closed: drop the baseline. */
  close(){baseline=new Map();readAt=0;clientPids=new Map();asking=null;},
  /** Whether anything is held (the closed-state proof reads this). */
  held(){return baseline.size>0||readAt>0;},
 };
}
module.exports={createTaskManager,compute,windowContext,parseClientIds,memoryKB,partOf,iconFile,extensionIcon,FRESH_MS,QUICK_MS};
