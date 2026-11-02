'use strict';
// An exception nobody caught in the main process used to stop the whole browser behind Electron's modal "A JavaScript error occurred in the main process"
// until OK was clicked (seen when a log write hit a full disk). Now it is written to main.log in the profile folder and Acira keeps running; a promise
// rejection nobody handled is logged the same way. A start that fails before any window exists is explained and Acira quits (startupFailed), like a
// profile database that cannot be opened (database-open.cjs). main.log is capped (MAX_BYTES, one older copy kept) and a burst of the same error is
// written once, so a repeating failure cannot fill the disk; a log write that fails is dropped, never thrown.
const fs=require('node:fs'),path=require('node:path');
const MAX_BYTES=1024*1024,MAX_TEXT=4000,BURST=60*1000,BURST_LINES=20;

function describe(error){
 if(error&&typeof error==='object'&&typeof error.stack==='string'&&error.stack)return error.stack;
 if(error&&typeof error==='object'&&'message' in error)return String(error.name||'Error')+': '+String(error.message);
 try{return typeof error==='string'?error:JSON.stringify(error)??String(error);}catch{return String(error);}
}

function createProcessErrors({file,now=Date.now,echo=(...args)=>console.error(...args),maxBytes=MAX_BYTES,fileSystem=fs}){
 let windowStart=0,linesInWindow=0,lastText='',repeats=0;
 function write(text){
  try{
   fileSystem.mkdirSync(path.dirname(file),{recursive:true});
   let size=0;try{size=fileSystem.statSync(file).size;}catch{}
   if(size+text.length>maxBytes){try{fileSystem.renameSync(file,file+'.1');}catch{}}
   fileSystem.appendFileSync(file,text,{mode:0o600});
   return true;
  }catch{return false;/* a full disk or a read-only folder: the browser keeps running without the line */}
 }
 /** Writes one entry: the time, what kind of failure, and the stack. Returns whether it reached the file. */
 function record(kind,error){
  const at=now(),text=describe(error).slice(0,MAX_TEXT);
  if(at-windowStart>=BURST){if(repeats)write(new Date(at).toISOString()+' (the error above repeated '+repeats+' more times)\n');windowStart=at;linesInWindow=0;repeats=0;lastText='';}
  // a repeat is only counted, not even echoed: an echo to a broken stderr raises the same error again, which must not loop
  if(text===lastText){repeats++;return false;}
  if(++linesInWindow>BURST_LINES)return false;
  lastText=text;
  try{echo('Acira '+kind+':',text);}catch{}
  return write(new Date(at).toISOString()+' '+kind+': '+text.replace(/\n/g,'\n    ')+'\n');
 }
 /** Listening is what stops Electron's modal: its own handler only shows it while it is the only listener. */
 function install(target=process){
  const onException=error=>{record('Uncaught exception',error);};
  const onRejection=reason=>{record('Unhandled rejection',reason);};
  target.on('uncaughtException',onException);target.on('unhandledRejection',onRejection);
  return ()=>{target.removeListener('uncaughtException',onException);target.removeListener('unhandledRejection',onRejection);};
 }
 return {record,install,file};
}

/** The start-up chain failed. With a window open the browser is usable, so it is only logged. With none, the person is told and Acira quits instead of
 *  running on with nothing on screen. Nothing in the profile is changed. */
function startupFailed(error,{record,hasWindow,showError,quit,closeSplash=()=>{},t=require('./browser-services/tx.cjs').t}){
 try{record('Start-up failed',error);}catch{}
 if(hasWindow())return false;
 const reason=String((error&&error.message)||error||'Unknown error').replace(/\s+/g,' ').slice(0,300);
 try{closeSplash();}catch{}
 try{showError(t('main.startupFailedTitle'),reason+'\n\n'+t('main.startupFailedText'));}catch{}
 try{quit();}catch{}
 return true;
}

module.exports={createProcessErrors,startupFailed,describe,MAX_BYTES};
