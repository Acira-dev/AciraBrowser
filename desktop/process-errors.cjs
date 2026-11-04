'use strict';
// An exception nobody caught in the main process used to stop the whole browser behind Electron's modal "A JavaScript error occurred in the main process"
// until OK was clicked (seen when a log write hit a full disk). Now it is written to main.log in the profile folder and Acira keeps running; a promise
// rejection nobody handled is logged the same way. A start that fails before any window exists is explained and Acira quits (startupFailed), like a
// profile database that cannot be opened (database-open.cjs). main.log is capped (MAX_BYTES, one older copy kept) and a burst of the same error is
// written once, so a repeating failure cannot fill the disk; a log write that fails is dropped, never thrown.
// main.log holds no web address, file path, e-mail or IP address (scrub): an error's text often carries the page, the download or the person's own
// folder name, and the file may be attached to a bug report. The handlers are installed on main.cjs's first line, before the profile folder is known:
// entries wait in memory until setFile, and an exception that stops main.cjs from loading at all (a broken build) is explained (onLoadFailure)
// instead of Electron's raw box with the stack in it.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const MAX_BYTES=1024*1024,MAX_TEXT=4000,BURST=60*1000,BURST_LINES=20,WAITING=20;

function describe(error){
 if(error&&typeof error==='object'&&typeof error.stack==='string'&&error.stack)return error.stack;
 if(error&&typeof error==='object'&&'message' in error)return String(error.name||'Error')+': '+String(error.message);
 try{return typeof error==='string'?error:JSON.stringify(error)??String(error);}catch{return String(error);}
}

const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** A folder as it may appear in a message: as given, a Windows one also with forward slashes, and as in a file: URL. */
const spellings=folder=>{const plain=String(folder),windows=/^[A-Za-z]:|\\/.test(plain);return [...new Set([plain,...(windows?[plain.replace(/\\/g,'/')]:[]),encodeURI(plain.replace(/\\/g,'/'))])].filter(item=>item.length>1);};
/** File endings of Acira's own code and data: a dotted name that ends in one is a file of Acira's (main.cjs, window-state.json, resources.pak), not a
 *  host. A person's own documents (.pdf, .docx, .jpg) are not on this list, so their names go like host names. */
const OWN_FILES=new Set(['cjs','mjs','js','json','ts','tsx','html','css','sqlite','log','node','asar','map','wasm','bin','dylib','dll','exe','plist','pak','dat']);
/** Endings that name a computer though no top-level domain of the internet has them: reserved for examples and tests, and the ones local networks use. */
const LOCAL_TLDS=new Set(['example','test','invalid','localhost','local','localdomain','internal','intranet','lan','home','corp','private']);
let parseHost=null;
/** Whether a host name can end in `label` (com, bank, xn--p1ai, local…). Without the list (a build that cannot load tldts) every label counts as one, so
 *  nothing that may be a host is kept. */
function isTld(label){
 const name=label.toLowerCase();if(LOCAL_TLDS.has(name))return true;
 try{parseHost??=require('tldts').parse;return parseHost('x.'+name,{extractHostname:false,validateHostname:false,detectIp:false}).isIcann===true;}catch{return true;}
}
/** A dotted name in an error is code, not a host or a person's file, when it ends in one of Acira's own file endings, or when no host can end the way it
 *  does and it is shaped like code: a later part in camelCase (mainWindow.webContents.send, Intl.DateTimeFormat, wc.getURL), or three parts or more ending
 *  in a word of five letters or more (overlay.bounds.width). contract.pdf, JoSmithTaxes.pdf and a host in capitals (MyBank.com) still go. */
function isCode(name,last){
 if(OWN_FILES.has(last.toLowerCase()))return true;
 if(isTld(last))return false;
 const labels=name.split('.');
 return labels.slice(1).some(label=>/[a-z][A-Z]/.test(label))||labels.length>=3&&/^[a-z]{5,}$/i.test(last);
}
/** The text with what could say who the person is, or what they browse, replaced. Acira's own folders become a name (<app>, <profile>, <home>, <temp>),
 *  keeping what follows <app> and <profile> (Acira's own file names). Then, erring on the side of removing too much: web addresses; e-mail addresses;
 *  any other path, from where it starts to the end of its part of the message (names may hold spaces and brackets: "D:\\Clients (2025)\\Acme"); IPv6
 *  and IPv4 addresses; every dotted name that could be a host (bank.example.com, with what follows it) unless it is code (isCode), and none on a stack
 *  line ("    at fn (<app>/desktop/main.cjs:12:3)"), whose names are Acira's code; long tokens. Acira's own error words, versions, and the stack's
 *  function names and line numbers stay. */
function scrub(text,{app=path.dirname(__dirname),profile=null,home=os.homedir(),temp=os.tmpdir()}={}){
 let out=String(text);
 const roots=[[app,'<app>'],[profile,'<profile>'],[temp,'<temp>'],[home,'<home>']].filter(([folder])=>folder).flatMap(([folder,name])=>spellings(folder).map(spelling=>[spelling,name])).sort((a,b)=>b[0].length-a[0].length);
 for(const [spelling,name] of roots)out=out.replace(new RegExp(escape(spelling)+'(?=$|[\\\\/\'"\\s:),])','gi'),name);
 // a person's own files under their home or temp folder: everything after it goes too, to the end of that part of the message
 out=out.replace(/(['"])<(home|temp)>[\\/][^'"]*\1/g,'$1<$2>/…$1').replace(/<(home|temp)>[\\/](?:[^\n'")]|\)(?=[\\/]))*/g,'<$1>/…');
 out=out.replace(/\b(?:data|blob|javascript):(?=\S)[^\s'"]*/gi,'<url>').replace(/\b[a-z][a-z0-9+.-]{1,24}:\/\/[^\s'"<>()[\]{}]*/gi,'<url>');
 out=out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,'<email>');
 // a path: quoted, it ends at its quote; unquoted, at the end of its part of the message (a line, a closing bracket or quote), as names may hold spaces;
 // a bracket followed by a separator is part of a folder name ("Clients (2025)/")
 out=out.replace(/(['"])(?:[A-Za-z]:[\\/]|\\\\|\/)[^'"]*\1/g,'$1<path>$1');
 out=out.replace(/(^|[\s(=,[])(?:[A-Za-z]:[\\/]|\\\\[^\s\\]+\\|\/(?=[^\s/]+\/))(?:[^\n'")]|\)(?=[\\/]))*/g,'$1<path>');
 // IPv6 (with "::" or all eight groups, optionally a zone) and IPv4; "net::ERR_FAILED" and times like 14:44:36 are neither
 out=out.replace(/(?<![\w:.])(?=[0-9a-f:]*::|(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4})(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:%[\w.]+)?(?![\w:])/gi,'<ip>');
 out=out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'<ip>');
 out=out.split('\n').map(line=>/^\s*at\s/.test(line)?line:line.replace(/(?<![\w.\-/\\<@%])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z](?:[a-z0-9-]{0,61}[a-z0-9])?))\.?(?:[/?#:][^\s'"<>()]*)?/gi,(match,host,last)=>isCode(host,last)?match:'<host>')).join('\n');
 out=out.replace(/\b[A-Za-z0-9_-]{40,}\b/g,'<token>');
 return out;
}

function createProcessErrors({file=null,now=Date.now,echo=(...args)=>console.error(...args),maxBytes=MAX_BYTES,fileSystem=fs,folders={},onLoadFailure=null}={}){
 let windowStart=0,linesInWindow=0,lastText='',repeats=0,target=file,known={...folders},loaded=false;const waiting=[];
 function write(text){
  if(!target){if(waiting.length<WAITING)waiting.push(text);return false;}
  try{
   fileSystem.mkdirSync(path.dirname(target),{recursive:true});
   let size=0;try{size=fileSystem.statSync(target).size;}catch{}
   if(size+text.length>maxBytes){try{fileSystem.renameSync(target,target+'.1');}catch{}}
   fileSystem.appendFileSync(target,text,{mode:0o600});
   return true;
  }catch{return false;/* a full disk or a read-only folder: the browser keeps running without the line */}
 }
 /** Writes one entry: the time, what kind of failure, and the scrubbed stack. Returns whether it reached the file. */
 function record(kind,error){
  const at=now(),raw=describe(error).slice(0,MAX_TEXT);let text;try{text=scrub(raw,known);}catch{text='(the message could not be cleaned, so it was left out)';}
  if(at-windowStart>=BURST){if(repeats)write(new Date(at).toISOString()+' (the error above repeated '+repeats+' more times)\n');windowStart=at;linesInWindow=0;repeats=0;lastText='';}
  // a repeat is only counted, not even echoed: an echo to a broken stderr raises the same error again, which must not loop
  if(text===lastText){repeats++;return false;}
  if(++linesInWindow>BURST_LINES)return false;
  lastText=text;
  try{echo('Acira '+kind+':',raw);}catch{}
  return write(new Date(at).toISOString()+' '+kind+': '+text.replace(/\n/g,'\n    ')+'\n');
 }
 /** The profile folder is known: entries written so far go to `next`, and its own path is scrubbed from now on. */
 function setFile(next,more={}){target=next;Object.assign(known,more);for(const text of waiting.splice(0))write(text);}
 /** Listening is what stops Electron's modal: its own handler only shows it while it is the only listener. An exception before the next turn of the event
  *  loop is one that stopped main.cjs (which loads in one go) from loading: onLoadFailure, once. Any later one is logged and Acira keeps running. */
 function install(source=process,{later=setImmediate}={}){
  const onException=error=>{const failed=!loaded&&onLoadFailure;loaded=true;record(failed?'Load failed':'Uncaught exception',error);if(failed)try{onLoadFailure(error);}catch{}};
  const onRejection=reason=>{record('Unhandled rejection',reason);};
  source.on('uncaughtException',onException);source.on('unhandledRejection',onRejection);
  try{later(()=>{loaded=true;});}catch{loaded=true;}
  return ()=>{source.removeListener('uncaughtException',onException);source.removeListener('unhandledRejection',onRejection);};
 }
 function markLoaded(){loaded=true;}
 return {record,install,setFile,markLoaded,get file(){return target;}};
}

/** The start-up chain failed. With a window open the browser is usable, so it is only logged. With none, the person is told and Acira quits instead of
 *  running on with nothing on screen. Nothing in the profile is changed. */
function startupFailed(error,{record,hasWindow,showError,quit,closeSplash=()=>{},t=require('./browser-services/tx.cjs').t}){
 try{record('Start-up failed',error);}catch{}
 if(hasWindow())return false;
 const reason=String((error&&error.message)||error||'Unknown error').replace(/\s+/g,' ').slice(0,300);
 try{closeSplash();}catch{}
 let title='Acira',text=reason;try{title=t('main.startupFailedTitle');text=reason+'\n\n'+t('main.startupFailedText');}catch{/* the catalog itself did not load */}
 try{showError(title,text);}catch{}
 try{quit();}catch{}
 return true;
}

/** The secure start (startup-gate.cjs) could not get ready: the system's secure storage is unavailable, or what it protects could not be read. Explained
 *  like startupFailed, in the system's language (the profile's own language setting is not read yet); the gate's reason, an English sentence of ours,
 *  goes to main.log and not into the message. Nothing in the profile is changed. When the reason is about the links Acira was asked to open (the gate's
 *  "Startup links …" sentences: they could not be kept for Windows' first-start restart, or the ones kept could not be read), one sentence says so,
 *  since the person would otherwise not know those links were dropped. */
const LINKS_REASON=/^Startup links |^Too many startup links /;
function secureStartFailed(result,{record,showError,quit,closeSplash=()=>{},t=require('./browser-services/tx.cjs').t}){
 const reason=String((result&&result.error)||'Secure website-session storage is unavailable.').replace(/\s+/g,' ').slice(0,300);
 try{record('Secure start failed',new Error(reason));}catch{}
 try{closeSplash();}catch{}
 let title='Acira',text=reason;try{title=t('main.secureStartFailedTitle');text=t('main.secureStartFailedText');if(LINKS_REASON.test(reason)){const links=t('main.secureStartLinksText');text+=(/。$/.test(text)?'':' ')+links;}}catch{/* the catalog itself did not load */}
 try{showError(title,text);}catch{}
 try{quit();}catch{}
}

/** The system's language before Acira has read any setting or set up its translator: a POSIX locale variable when one is set (a start from a terminal), else
 *  the system's first preferred language, else ICU's. app.getLocale() is still empty at this point on Windows. */
function systemLocale({env=process.env,app=null,intl=()=>Intl.DateTimeFormat().resolvedOptions().locale}={}){
 const posix=[env.LC_ALL,env.LC_MESSAGES,env.LANG].find(value=>value&&!/^(?:C|POSIX)(?:[.@]|$)/i.test(value));
 if(posix)return posix.split(/[.@]/)[0].replace(/_/g,'-');
 try{const first=app?.getPreferredSystemLanguages?.()?.[0];if(first)return first;}catch{}
 try{return intl()||'en';}catch{return 'en';}
}

/** main.cjs's first line: the handlers, before anything else can fail. A failed load is written to main.log in the profile folder (worked out here, since
 *  main.cjs did not get as far as setting it), explained in the system's language, and Acira quits. */
function installEarly({electron=()=>require('electron'),env=process.env,source=process}={}){
 const errors=createProcessErrors({onLoadFailure:error=>{
  const {app,dialog}=electron();
  try{if(!errors.file){const profile=env.ACIRA_BROWSER_TEST_DATA||path.join(app.getPath('appData'),require('./build-identity.cjs').dataFolder);errors.setFile(path.join(profile,'main.log'),{profile});}}catch{}
  // the translator is not set up yet: the catalog is put in the system's language here (English when even the catalog failed to load)
  try{require('./i18n.cjs').setMainLocale('system',systemLocale({env,app}));}catch{}
  startupFailed(error,{record(){},hasWindow:()=>false,showError:(title,text)=>{if(env.ACIRA_BROWSER_TEST_HIDDEN!=='1')dialog.showErrorBox(title,text);},quit:()=>app.exit(1)});
 }});
 errors.install(source);
 return errors;
}

module.exports={createProcessErrors,installEarly,startupFailed,secureStartFailed,systemLocale,describe,scrub,MAX_BYTES};
