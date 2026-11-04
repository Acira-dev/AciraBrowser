'use strict';
// acira-verify.exe (packaging/installer/AciraVerify.cs): Acira's own small Windows program for what Electron has no API for: the Windows
// Hello and account password check, an executable's icon, a file's Authenticode signature (VPN apps, Acira's own updates). It is built and
// signed with the app and ships in its resources folder, so Acira never starts a script host on Windows (antivirus behaviour engines remove
// a browser that runs hidden scripts and then shows a Windows credential prompt). One job per run: the input goes on standard input, never
// on the command line or in the environment, and only plain lines come back. The window to put a prompt in front of travels as a number.
const {execFile}=require('node:child_process');
const path=require('node:path');
const HELPER='acira-verify.exe';

const electron=()=>{try{const value=require('electron');return value&&typeof value==='object'?value:null;}catch{return null;}};

/** Where the helper is: the packaged app's resources folder, or the build output in a development checkout. Never looked up on PATH. */
function helperPath({packaged,resourcesPath=process.resourcesPath,appPath}={}){
 const app=electron()?.app;
 if(packaged===undefined)packaged=app?.isPackaged===true;
 if(packaged)return resourcesPath?path.join(resourcesPath,HELPER):null;
 const root=appPath||(()=>{try{return app?.getAppPath?.();}catch{return null;}})();
 return root?path.join(root,'packaging','installer',HELPER):null;
}

/** The Acira window a prompt belongs in front of when the caller has none: the focused one, else a visible one, else none. Acira's own
 * windows are BaseWindows (the browser window, its dialogs, the share card), which BrowserWindow's lists leave out; BaseWindow's include both. */
function activeWindow(){
 try{
  const windows=electron()?.BaseWindow;
  const focused=windows?.getFocusedWindow?.();
  if(focused&&!focused.isDestroyed())return focused;
  return windows?.getAllWindows?.().find(win=>!win.isDestroyed()&&win.isVisible())||null;
 }catch{return null;}
}
/** A window's HWND as a decimal number ("0" for none; the helper then uses the foreground window). Window handles carry 32 bits on every Windows. */
function windowHandle(win){
 try{
  if(!win||win.isDestroyed?.())return '0';
  const handle=win.getNativeWindowHandle();
  return handle.length>=4?String(handle.readUInt32LE(0)):'0';
 }catch{return '0';}
}

/** The helper's environment: Acira's own, without its ACIRA_ variables (the helper reads none; test and timing switches stay in Acira). */
const helperEnv=(env=process.env)=>Object.fromEntries(Object.entries(env).filter(([name])=>!/^ACIRA_/i.test(name)));
/**
 * Runs one helper job. Resolves {stdout} (trimmed), or {code:'timeout'} when it ran too long or wrote too much (it is stopped), or
 * {code:'failed'} when it could not start (missing, or blocked by an antivirus: the error comes from spawn itself). Never rejects.
 */
function runHelper(args,input,{exec=execFile,helper=helperPath(),timeoutMs=10000,maxBuffer=64*1024,env=helperEnv()}={}){
 return new Promise(resolve=>{
  if(!helper)return resolve({code:'failed',stdout:''});
  let child;
  try{
   child=exec(helper,args,{windowsHide:true,timeout:timeoutMs,maxBuffer,env,encoding:'utf8'},(error,stdout)=>{
    if(error?.killed)return resolve({code:'timeout',stdout:''});
    if(error&&String(error.syscall||'').startsWith('spawn'))return resolve({code:'failed',stdout:''}); // it never ran
    if(error&&typeof error.code==='string')return resolve({code:'timeout',stdout:''}); // it ran: too much output, or it could not be stopped
    resolve({stdout:String(stdout||'').trim()});
   });
  }catch{return resolve({code:'failed',stdout:''});}
  try{child?.stdin?.on?.('error',()=>{});child?.stdin?.end?.(String(input??''),'utf8');}catch{}
 });
}

/**
 * electron-updater's check that a downloaded Windows update is signed by Acira (NsisUpdater.verifyUpdateCodeSignature; it is asked only once the
 * app is signed and its app-update.yml names a publisher). Its own check starts a command prompt and a script host; this one asks the helper, with the same
 * rule: a valid Authenticode signature whose signer is one of the publisher names (a plain name is the certificate's CN; a distinguished name
 * must match in every part it gives). null means signed by Acira; anything else is the reason, and the update is not installed.
 * A helper that cannot start (missing, or quarantined by an antivirus) skips the check, as electron-updater's own does when its script host
 * cannot run: the file is still the one the feed's SHA-512 names, and a copy without its helper must still be able to update to the build that
 * brings it back. A helper that runs and says invalid, or names someone else, or does not answer in time, is a "no".
 */
function updateSignatureCheck({helper,exec,packaged,log=(...args)=>console.warn(...args)}={}){
 return async(publisherNames,file)=>{
  const {parseDn}=require('builder-util-runtime');
  const names=(Array.isArray(publisherNames)?publisherNames:[publisherNames]).map(String);
  const result=await runHelper(['signature'],file,{helper:helper??helperPath({packaged}),exec,timeoutMs:20000});
  if(result.code==='failed'){try{log('[updates] Acira\'s signature helper could not start; the update is checked by its SHA-512 only.');}catch{}return null;}
  const [status='',,dn='']=String(result.stdout||'').split(/\r?\n/),subject=parseDn(dn);
  const matches=name=>{const wanted=parseDn(name);return wanted.size?[...wanted.keys()].every(key=>wanted.get(key)===subject.get(key)):Boolean(name)&&name===subject.get('CN');};
  if(!result.code&&status==='valid'&&names.some(matches))return null;
  return `publisherNames: ${names.join(' | ')}, signature: ${result.code||status||'none'}${subject.get('CN')?', signed by '+subject.get('CN'):''}`;
 };
}

module.exports={HELPER,helperPath,activeWindow,windowHandle,helperEnv,runHelper,updateSignatureCheck};
