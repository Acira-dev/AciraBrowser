'use strict';
// The OS gate in front of reveal, copy, export and delete-all. Windows Hello (UserConsentVerifier: fingerprint, face, PIN);
// when Hello isn't set up, the Windows account password prompt (CredUI) instead. Both run in a short-lived powershell.exe
// from System32 with a fixed script and no user data in the command; Acira never sees the account password. A successful check
// unlocks the actions for a short window. If neither can run the answer is "no", never "allow".
const {execFile}=require('node:child_process');
const path=require('node:path');
const {tr}=require('./text.cjs');

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

const HELLO_SCRIPT=[
 "$ErrorActionPreference = 'Stop'",
 'try {',
 ' Add-Type -AssemblyName System.Runtime.WindowsRuntime',
 ' [void][Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]',
 " $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
 ' function Wait-Op($op, $type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$task.Wait(-1); $task.Result }',
 ' $availability = Wait-Op ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])',
 " if (\"$availability\" -ne 'Available') { Write-Output ('unavailable:' + $availability); exit 0 }",
 ' $result = Wait-Op ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($env:ACIRA_GATE_MESSAGE)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])',
 " Write-Output ('result:' + $result)",
 "} catch { Write-Output 'error' }",
].join('\n');

// CredUI fallback: the system dialog lists only the signed-in account; LogonUser checks what was typed and the account
// must be the current Windows user. The typed secret exists only inside this child process.
const CRED_SCRIPT=[
 "$ErrorActionPreference = 'Stop'",
 "Add-Type -TypeDefinition @'",
 'using System; using System.Runtime.InteropServices; using System.Text;',
 'public static class AciraCred {',
 ' [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct CREDUI_INFO { public int cbSize; public IntPtr hwndParent; public string pszMessageText; public string pszCaptionText; public IntPtr hbmBanner; }',
 ' [DllImport("credui.dll", CharSet = CharSet.Unicode)] static extern int CredUIPromptForWindowsCredentials(ref CREDUI_INFO ui, int authError, ref uint authPackage, IntPtr inBuf, uint inSize, out IntPtr outBuf, out uint outSize, ref bool save, int flags);',
 ' [DllImport("credui.dll", CharSet = CharSet.Unicode)] static extern bool CredUnPackAuthenticationBuffer(int flags, IntPtr buf, uint size, StringBuilder user, ref int userLen, StringBuilder domain, ref int domLen, StringBuilder pwd, ref int pwdLen);',
 ' [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LogonUser(string user, string domain, string pwd, int type, int provider, out IntPtr token);',
 ' [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);',
 ' [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr ptr);',
 ' public static string Verify(string message) {',
 '  CREDUI_INFO ui = new CREDUI_INFO(); ui.cbSize = Marshal.SizeOf(ui); ui.pszCaptionText = "Acira"; ui.pszMessageText = message;',
 '  uint package = 0; IntPtr outBuf; uint outSize; bool save = false;',
 '  int rc = CredUIPromptForWindowsCredentials(ref ui, 0, ref package, IntPtr.Zero, 0, out outBuf, out outSize, ref save, 0x200);',
 '  if (rc != 0) return "";',
 '  try {',
 '   StringBuilder user = new StringBuilder(513), domain = new StringBuilder(337), pwd = new StringBuilder(257);',
 '   int userLen = 513, domLen = 337, pwdLen = 257;',
 '   if (!CredUnPackAuthenticationBuffer(0, outBuf, outSize, user, ref userLen, domain, ref domLen, pwd, ref pwdLen)) return "";',
 '   string name = user.ToString(), dom = domain.ToString();',
 '   if (dom.Length == 0 && name.Contains("\\\\")) { int slash = name.IndexOf((char)92); dom = name.Substring(0, slash); name = name.Substring(slash + 1); }',
 '   IntPtr token;',
 '   bool ok = LogonUser(name, dom.Length == 0 ? null : dom, pwd.ToString(), 2, 0, out token);',
 '   pwd.Length = 0;',
 '   if (!ok) return "";',
 '   CloseHandle(token);',
 '   return (dom.Length == 0 ? "" : dom + "\\\\") + name;',
 '  } finally { CoTaskMemFree(outBuf); }',
 ' }',
 '}',
 "'@",
 "if ($env:ACIRA_GATE_COMPILE_ONLY -eq '1') { Write-Output 'compiled'; exit 0 }",
 'try {',
 ' $who = [AciraCred]::Verify($env:ACIRA_GATE_MESSAGE)',
 " if (-not $who) { Write-Output 'result:Failed'; exit 0 }",
 " $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name",
 " $mine = $me.Split('\\')[-1]; $theirs = $who.Split('\\')[-1]",
 " if ($theirs -ieq $mine) { Write-Output 'result:Verified' } else { Write-Output 'result:Failed' }",
 "} catch { Write-Output 'error' }",
].join('\n');

const encode=script=>Buffer.from(script,'utf16le').toString('base64');
const powershellPath=env=>path.join(env.SystemRoot||env.windir||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
function runScript(script,message,{exec=execFile,env=process.env,timeoutMs=90000}={}){
 return new Promise(resolve=>{
  try{
   exec(powershellPath(env),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encode(script)],{windowsHide:true,timeout:timeoutMs,env:{...env,ACIRA_GATE_MESSAGE:message},maxBuffer:64*1024},(error,stdout)=>{
    if(error&&error.killed)return resolve({code:'timeout'});
    resolve({stdout:String(stdout||'').trim()});
   });
  }catch{resolve({code:'failed'});}
 });
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

/** Real verifier. Test switch ACIRA_PASSWORDS_TEST_GATE=allow|deny only works in an unpackaged run inside an isolated test profile. */
function windowsVerifier({exec=execFile,env=process.env,platform=process.platform,timeoutMs=90000,packaged}={}){
 return async function verify(reason='generic'){
  const testing=env.ACIRA_PASSWORDS_TEST_GATE&&testSwitchesAllowed({env,packaged});
  if(testing)return env.ACIRA_PASSWORDS_TEST_GATE==='allow'?{ok:true,method:'test'}:NOT.cancelled;
  if(platform!=='win32')return NOT.unavailable;
  const message=MESSAGES[reason]?tr('pw.verify.'+reason,MESSAGES[reason]):tr('pw.verify.generic',MESSAGES.generic);
  const hello=await runScript(HELLO_SCRIPT,message,{exec,env,timeoutMs});
  if(hello.code==='timeout')return NOT.timeout;
  const out=hello.stdout||'';
  if(out==='result:Verified')return {ok:true,method:'hello'};
  if(out==='result:Canceled')return NOT.cancelled;
  if(out.startsWith('unavailable:')||out==='result:DeviceNotPresent'||out==='result:NotConfiguredForUser'||out==='result:DisabledByPolicy'){
   const credential=await runScript(CRED_SCRIPT,message,{exec,env,timeoutMs});
   if(credential.code==='timeout')return NOT.timeout;
   return credential.stdout==='result:Verified'?{ok:true,method:'credential'}:credential.stdout==='result:Failed'?NOT.cancelled:NOT.unavailable;
  }
  return out==='result:RetriesExhausted'||out==='result:DeviceBusy'?NOT.failed:NOT.failed;
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

/** Short unlock window around a verifier. One prompt at a time; a prompt in flight is shared. */
function createGate({verify,now=Date.now,windowMs=60000}){
 let until=0,pending=null;
 return {
  async ensure(reason){
   if(now()<until)return {ok:true,method:'cached'};
   if(pending)return pending;
   pending=(async()=>{try{const result=await verify(reason);if(result.ok)until=now()+windowMs;return result;}catch{return NOT.failed;}finally{pending=null;}})();
   return pending;
  },
  lock(){until=0;},
  get unlocked(){return now()<until;},
  remainingMs:()=>Math.max(0,until-now()),
 };
}
module.exports={createGate,windowsVerifier,platformVerifier,testSwitchesAllowed,MESSAGES,HELLO_SCRIPT,CRED_SCRIPT,runScript};
