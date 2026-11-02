// Actual native spelling-policy ownership in a private tab, not a fake session.
const {app,ipcMain,webContents,BaseWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.resolve('.qa-profiles/private-spelling-')),output=path.resolve(process.argv[2]||'qa/artifacts/mac-private-spelling.json');
Object.assign(process.env,{ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:root,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_DEV:'0'});
new(require('../desktop/accounts/onboarding.cjs').OnboardingStore)({directory:path.join(root,'setup')}).update('profile-personal',{complete:true,step:'finish'});
let policy;const mod=require('../desktop/browser-services/spellcheck-policy.cjs'),create=mod.createSpellcheckPolicy;mod.createSpellcheckPolicy=options=>(policy=create(options));
const routes=new Map(),handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>{routes.set(name,fn);return handle(name,fn)};
require('../desktop/main.cjs');
const report={passed:false,checks:[],scope:'Actual hidden Mac main and native ordinary/private sessions; policy status, real engine enable/disable and retirement. No personal data or OS authentication prompt.'},pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((_q,r)=>r.end('<!doctype html><title>Spelling ownership</title><textarea>Release notes</textarea>'));
let done=false;const timeout=setTimeout(()=>finish(Error('Private spelling deadline')),40000);
function finish(error){if(done)return;done=true;clearTimeout(timeout);report.passed=!error;if(error)report.error=String(error.stack||error);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));server.close();app.exit(error?1:0)}
async function poll(read,ok,label){for(let i=0;i<400;i++){const v=await read();if(ok(v))return v;await pause(25)}throw Error(label)}
app.whenReady().then(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const ui=await poll(()=>webContents.getAllWebContents().find(w=>w.getURL()==='acira-browser-ui://ui/index.html'),Boolean,'UI');
 const call=(c,...a)=>routes.get(c)({sender:ui,senderFrame:ui.mainFrame},...a),act=a=>call('acira:dispatch',a),snap=()=>call('acira:snapshot');
 const open=async(leaf,privacy)=>{await act({type:'tab.new',url:base+leaf,...(privacy?{privacy}:{})});const id=snap().activeTabId,wc=await poll(()=>webContents.getAllWebContents().find(w=>w.getURL()===base+leaf),Boolean,'Page');return {id,wc};};
 const normal=await open('/normal'),original=policy.status(normal.wc.session);assert.equal(original.privateMode,false);
 const privateTab=await open('/private','private'),ses=privateTab.wc.session,before=policy.status(ses);assert.equal(before.privateMode,true);assert.equal(before.languageMode,'system');assert.equal(before.customWordScope,'unavailable');report.checks.push('Private tab is an actual ephemeral canonical spelling owner using Mac system languages');
 const changed=policy.set(ses,{enabled:!before.current.enabled,languages:[]});assert.equal(changed.current.enabled,!before.current.enabled);assert.deepEqual(policy.status(normal.wc.session).current,original.current);report.checks.push('Actual private engine toggle is independent of the ordinary profile');
 await act({type:'tab.close',id:privateTab.id});await poll(()=>{try{policy.status(ses);return false;}catch{return true;}},Boolean,'Private policy retired');await poll(()=>ses.isSpellCheckerEnabled(),v=>v===before.current.enabled,'Private native baseline restored');assert.deepEqual(policy.status(normal.wc.session).current,original.current);report.checks.push('Closing private tab restores its native baseline and retires its policy without changing ordinary spelling');
 ipcMain.emit('acira:open',{sender:ui,senderFrame:ui.mainFrame},'private');
 const privateUi=await poll(()=>webContents.getAllWebContents().find(w=>w!==ui&&w.getURL()==='acira-browser-ui://ui/index.html'&&routes.get('acira:snapshot')({sender:w,senderFrame:w.mainFrame})?.browserProfiles.some(p=>p.private)),Boolean,'Private window');
 const state=routes.get('acira:snapshot')({sender:privateUi,senderFrame:privateUi.mainFrame}),windowSession=require('electron').session.fromPartition(state.browserProfiles[0].partition);
 const windowBefore=await poll(()=>{try{return policy.status(windowSession);}catch{return null;}},Boolean,'Private window spelling');assert.equal(windowBefore.privateMode,true);policy.set(windowSession,{enabled:!windowBefore.current.enabled,languages:[]});
 const owner=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents===privateUi));owner.close();await poll(()=>owner.isDestroyed(),Boolean,'Private window closed');await poll(()=>windowSession.isSpellCheckerEnabled(),v=>v===windowBefore.current.enabled,'Private window native baseline restored');assert.deepEqual(policy.status(normal.wc.session).current,original.current);report.checks.push('Private window closure restores its native spelling baseline and preserves ordinary policy');
 assert(BaseWindow.getAllWindows().every(w=>!w.isVisible()));finish();
}).catch(finish);
