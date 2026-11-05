'use strict';
const fs=require('node:fs');
const {execFile}=require('node:child_process');
const ACTION='computer.acira.browser.verify';
function subject({pid=process.pid,uid=process.getuid?.(),readFile=fs.readFileSync}={}){
 if(!Number.isSafeInteger(pid)||pid<=0||!Number.isSafeInteger(uid)||uid<=0)throw Error('Linux verification requires an ordinary user.');
 const stat=String(readFile('/proc/'+pid+'/stat','utf8')),end=stat.lastIndexOf(')'),start=stat.slice(end+1).trim().split(/\s+/)[19];
 if(end<0||!/^\d+$/.test(start||''))throw Error('Linux process identity is unavailable.');
 return `${pid},${start},${uid}`;
}
function createLinuxAuthentication({run=execFile,getSubject=subject,timeoutMs=90000}={}){
 return {verify(){
  let identity;try{identity=getSubject();}catch{return Promise.resolve({ok:false,code:'unavailable'});}
  return new Promise(resolve=>{
   run('/usr/bin/pkcheck',['--action-id',ACTION,'--process',identity,'--allow-user-interaction'],{timeout:timeoutMs,windowsHide:true,maxBuffer:16384,env:{...process.env,LC_ALL:'C'}},(error)=>{
    if(!error)return resolve({ok:true,method:'linux-polkit'});
    resolve({ok:false,code:error.killed?'timeout':error.code===1?'cancelled':error.code===2||error.code==='ENOENT'?'unavailable':'failed'});
   });
  });
 }};
}
module.exports={ACTION,subject,createLinuxAuthentication};
