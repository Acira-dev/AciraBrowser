import fs from'node:fs/promises';import path from'node:path';import{spawn}from'node:child_process';import{createRequire}from'node:module';import{randomUUID}from'node:crypto';import{_electron}from'playwright';
/** Explicit existing-install precondition for UI/lifecycle fixtures. Fresh-key
 * product acceptance uses the separate bare startup-main-native journey. */
export async function launchPreparedNative(options, launch=prepared=>_electron.launch(prepared)){
 const profile=path.resolve(options.env?.ACIRA_BROWSER_TEST_DATA||''),allowed=path.resolve('.qa-profiles')+path.sep;if(!profile.startsWith(allowed))throw Error('Prepared native UI fixtures require an explicit disposable .qa-profiles directory.');
 await fs.mkdir(profile,{recursive:true});const actual=await fs.realpath(profile),base=await fs.realpath(path.resolve('.qa-profiles'));if(!actual.startsWith(base+path.sep))throw Error('Fixture profile escapes the dedicated QA directory.');
 const appEnv={...process.env,...options.env};
 // A disposable Acira profile alone does not isolate browser import discovery.
 // Preserve explicit QA fixtures, but never inherit the user's real OS roots.
 for(const [key,folder]of [['APPDATA','fixture-roaming'],['LOCALAPPDATA','fixture-local']]){
  const requested=appEnv[key]&&path.resolve(appEnv[key]);
  appEnv[key]=requested&&requested.startsWith(allowed)?requested:path.join(profile,folder);
  await fs.mkdir(appEnv[key],{recursive:true});
  if(!(await fs.realpath(appEnv[key])).startsWith(base+path.sep))throw Error('OS profile fixture escapes the dedicated QA directory.');
 }
 delete appEnv.ELECTRON_RUN_AS_NODE;
 const nonce=randomUUID(),marker=path.join(profile,'native-key-'+nonce+'.json'),executable=createRequire(import.meta.url)('electron'),env={...appEnv,ACIRA_PREPARE_PROFILE:profile,ACIRA_PREPARE_NONCE:nonce};
 let failure;const child=spawn(executable,[path.resolve('qa/prepare-native-profile.cjs')],{env,windowsHide:true,stdio:'ignore'});child.on('error',error=>failure=error);const until=Date.now()+25000;let result;
 while(Date.now()<until){if(failure)throw failure;try{result=JSON.parse(await fs.readFile(marker,'utf8'));if(result.nonce===nonce)break;}catch{}await new Promise(resolve=>setTimeout(resolve,30));}
 if(!result?.ready)throw Error(result?.error||'Native fixture key preparation did not finish.');
 while(Date.now()<until){let alive=true;try{process.kill(result.pid,0);}catch{alive=false;}if(!alive)break;await new Promise(resolve=>setTimeout(resolve,30));}
 try{process.kill(result.pid,0);throw Error('Native key preparer did not close normally.');}catch(error){if(error.code!=='ESRCH')throw error;}
 await fs.unlink(marker);return launch({...options,env:appEnv});
}
