'use strict';
// Cold-start timing. cpu[name] is the main process's own CPU time (ms, user+system) at each mark: unlike the wall-clock marks it hardly changes when the machine is busy. Marks are milliseconds since the process started (Node's performance.now() counts from there), so
// "window-show" is the time from launch to the first window being shown. Cheap enough to leave on; nothing is written unless asked:
//   ACIRA_STARTUP_TRACE=<file>    write the marks as JSON when the window has been shown
//   ACIRA_STARTUP_PROFILE=<file>  also write a main-thread CPU profile of everything up to that point (open it in DevTools)
const {performance}=require('node:perf_hooks');
const marks={},cpu={};
let session=null;
if(process.env.ACIRA_STARTUP_PROFILE){
  try{const inspector=require('node:inspector');session=new inspector.Session();session.connect();session.post('Profiler.enable');session.post('Profiler.setSamplingInterval',{interval:250});session.post('Profiler.start');}catch{session=null;}
}
// ACIRA_STARTUP_REQUIRES=<file>: time every require() (inclusive, with nesting) so slow modules show up by name.
const requireTimes=[];
if(process.env.ACIRA_STARTUP_REQUIRES){
  try{const Module=require('node:module'),original=Module._load,basename=require('node:path').basename;let depth=0;Module._load=function(request,parent,isMain){const begin=performance.now();depth++;try{return original.apply(this,arguments);}finally{depth--;requireTimes.push({request,depth,ms:Math.round((performance.now()-begin)*10)/10,from:parent&&parent.filename?basename(parent.filename):''});}};}catch{}
}
function mark(name){
  if(name in marks)return;
  marks[name]=Math.round(performance.now()*10)/10;
  const used=process.cpuUsage();cpu[name]=Math.round((used.user+used.system)/100)/10;
}
/** Call once the first window is on screen. */
function done(){
  const file=process.env.ACIRA_STARTUP_TRACE;
  if(file){try{require('node:fs').writeFileSync(file,JSON.stringify({timeOrigin:performance.timeOrigin,epoch:Date.now(),marks,cpu},null,1));}catch{}}
  if(process.env.ACIRA_STARTUP_REQUIRES){try{require('node:fs').writeFileSync(process.env.ACIRA_STARTUP_REQUIRES,JSON.stringify(requireTimes));}catch{}}
  if(session){const profileFile=process.env.ACIRA_STARTUP_PROFILE,active=session;session=null;active.post('Profiler.stop',(error,result)=>{try{if(!error&&profileFile)require('node:fs').writeFileSync(profileFile,JSON.stringify(result.profile));}catch{}try{active.disconnect();}catch{}});}
}
module.exports={mark,done,marks,cpu};
