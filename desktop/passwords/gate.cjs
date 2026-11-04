'use strict';
// The OS gate in front of reveal, copy, export and delete-all, secured workspaces and saved Tor items. Windows Hello (UserConsentVerifier:
// fingerprint, face, PIN), held in front of the Acira window; when Hello isn't set up, the Windows account password prompt (CredUI)
// instead. Both run in acira-verify.exe (desktop/windows-helper.cjs), Acira's own signed helper: the message goes on its standard input,
// the window as a plain number, and a one-word answer comes back. Acira never sees the account password and starts no script host. A
// successful check unlocks the actions for a short window. If neither can run the answer is "no", never "allow".
const {tr}=require('./text.cjs');
const {helperPath,activeWindow,windowHandle,helperEnv,runHelper}=require('../windows-helper.cjs');

const MESSAGES={
 tor:'Open your saved Tor items in Acira',
 secured:'Unlock your secured workspace in Acira',
 reveal:'Show a saved password in Acira',
 copy:'Copy a saved password from Acira',
 export:'Export your Acira passwords',
 delete:'Delete all your Acira passwords',
 edit:'Change a saved password in Acira',
 generic:'Open your Acira passwords',
};
/** Hello answers that mean "Hello can't be used here": the account password prompt is offered instead. "error" too (Hello itself failed), and
 * no answer at all from a helper that did run (it ended without writing one, as a crash inside Windows' own code does). */
const HELLO_FALLBACK=new Set(['result:DeviceNotPresent','result:NotConfiguredForUser','result:DisabledByPolicy','error','']);

/**
 * One check in the helper (`hello` or `password`). A prompt is modal to the Acira window it is parented to; if the helper is stopped
 * while its prompt is up (a timeout), Windows could leave that window disabled, so it is enabled again when it was enabled before.
 */
async function runCheck(command,message,{win,exec,helper,timeoutMs,env}){
 let enabled=false;try{enabled=Boolean(win&&!win.isDestroyed()&&win.isEnabled());}catch{}
 try{return await runHelper([command,windowHandle(win)],message,{exec,helper,timeoutMs,env});}
 finally{try{if(enabled&&!win.isDestroyed()&&!win.isEnabled())win.setEnabled(true);}catch{}}
}

const NOT={
 get cancelled(){return {ok:false,code:'cancelled',message:tr('pw.gate.cancelled','Cancelled.')};},
 get failed(){return {ok:false,code:'failed',message:tr('pw.gate.failed','Couldn’t verify it’s you. Try again.')};},
 get unavailable(){return {ok:false,code:'unavailable',message:tr('pw.gate.unavailable','Acira can’t verify you on this PC. Set up Windows Hello or a Windows password and try again.')};},
 get timeout(){return {ok:false,code:'timeout',message:tr('pw.gate.timeout','That took too long. Try again.')};},
};

/**
 * The test switches (ACIRA_PASSWORDS_TEST_GATE, ACIRA_PASSWORDS_TEST_FILES) exist only for development runs inside an isolated test
 * profile. They are off unless the caller says `packaged: false` (main passes `app.isPackaged`) AND ACIRA_BROWSER_TEST_DATA is set, so
 * an installed app ignores them whatever the environment says, and a caller that forgets the flag fails closed.
 */
function testSwitchesAllowed({env=process.env,packaged}={}){return packaged===false&&Boolean(env.ACIRA_BROWSER_TEST_DATA);}

/**
 * Real verifier. Test switch ACIRA_PASSWORDS_TEST_GATE=allow|deny only works in an unpackaged run inside an isolated test profile.
 * The prompt goes in front of the window that asked (`window`), else the focused Acira window.
 */
function windowsVerifier({exec,env=process.env,platform=process.platform,timeoutMs=90000,packaged,helper,window:parentWindow=activeWindow}={}){
 return async function verify(reason='generic',{window:asked}={}){
  const testing=env.ACIRA_PASSWORDS_TEST_GATE&&testSwitchesAllowed({env,packaged});
  if(testing)return env.ACIRA_PASSWORDS_TEST_GATE==='allow'?{ok:true,method:'test'}:NOT.cancelled;
  if(platform!=='win32')return NOT.unavailable;
  const message=MESSAGES[reason]?tr('pw.verify.'+reason,MESSAGES[reason]):tr('pw.verify.generic',MESSAGES.generic);
  let win=null;try{win=asked&&!asked.isDestroyed?.()?asked:parentWindow?.()||null;}catch{}
  const options={win,exec,helper:helper??helperPath({packaged}),timeoutMs,env:helperEnv(env)};
  const hello=await runCheck('hello',message,options);
  const out=hello.stdout||'';
  if(hello.code==='timeout'||out==='timeout')return NOT.timeout;
  if(out==='result:Verified')return {ok:true,method:'hello'};
  if(out==='result:Canceled')return NOT.cancelled;
  if(!hello.code&&(out.startsWith('unavailable:')||HELLO_FALLBACK.has(out))){
   const credential=await runCheck('password',message,options);
   if(credential.code==='timeout'||credential.stdout==='timeout')return NOT.timeout;
   return credential.stdout==='result:Verified'?{ok:true,method:'credential'}:credential.stdout==='result:Canceled'?NOT.cancelled:credential.stdout==='result:Failed'?NOT.failed:NOT.unavailable;
  }
  return NOT.failed; // RetriesExhausted, DeviceBusy, a helper that could not start, anything unexpected
 };
}

/** macOS owns biometric/password verification; cancellation or failure never unlocks secrets. */
function platformVerifier({platform=process.platform,macAuthentication,env=process.env,...options}={}){
 if(platform==='win32')return windowsVerifier({platform,env,...options});
 return async function verify(reason='generic'){
  if(env.ACIRA_PASSWORDS_TEST_GATE&&testSwitchesAllowed({env,packaged:options.packaged}))return env.ACIRA_PASSWORDS_TEST_GATE==='allow'?{ok:true,method:'test'}:NOT.cancelled;
  if(platform!=='darwin')return {ok:false,code:'unavailable',message:tr("local.verificationUnavailable","Password verification isn’t available on this system.")};
  try{
   macAuthentication??=require('./mac-authentication.cjs').createMacAuthentication();
   const result=await macAuthentication.verify(MESSAGES[reason]||MESSAGES.generic);
   if(result?.ok===true&&result.method==='device-owner')return result;
   const code=['cancelled','failed','timeout','unavailable'].includes(result?.code)?result.code:'failed';
   return {ok:false,code,message:tr(code==='cancelled'?'local.macVerificationCancelled':'local.verificationUnavailable',code==='cancelled'?'macOS did not verify you. Your protected items stayed locked.':'Password verification isn’t available on this system.')};
  }catch{return {ok:false,code:'failed',message:tr('local.verificationUnavailable','Password verification isn’t available on this system.')};}
 };
}

/** Short unlock window around a verifier. One prompt at a time; a prompt in flight is shared. `window`: the Acira window that asked. */
function createGate({verify,now=Date.now,windowMs=60000}){
 let until=0,pending=null;
 return {
  async ensure(reason,window){
   if(now()<until)return {ok:true,method:'cached'};
   if(pending)return pending;
   pending=(async()=>{try{const result=await verify(reason,{window});if(result.ok)until=now()+windowMs;return result;}catch{return NOT.failed;}finally{pending=null;}})();
   return pending;
  },
  lock(){until=0;},
  get unlocked(){return now()<until;},
  remainingMs:()=>Math.max(0,until-now()),
 };
}
module.exports={createGate,windowsVerifier,platformVerifier,testSwitchesAllowed,MESSAGES};
