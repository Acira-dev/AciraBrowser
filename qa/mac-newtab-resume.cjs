// Native frame regression: a decoded cover must never fold/fade when its tab returns.
// Trusted backend actions set up disposable tabs; renderer code only observes frames.
const {app,ipcMain,BaseWindow,webContents}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
assert.equal(process.platform,'darwin');
const desktop=path.resolve(process.argv[2]||'desktop'),out=path.resolve(process.argv[3]||'qa/artifacts/mac-newtab-resume.json');
fs.mkdirSync('.qa-profiles',{recursive:true});
const profile=fs.mkdtempSync(path.resolve('.qa-profiles/mac-newtab-resume-'));
Object.assign(process.env,{ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_DEV:'0'});delete process.env.ACIRA_BROWSER_TEST_HIDDEN;
// Only seed owned setup data from the source fixture helper. Immutable candidates
// bundle that helper into main.cjs rather than shipping it as a separate module.
new(require(path.resolve(__dirname,'../desktop/accounts/onboarding.cjs')).OnboardingStore)({directory:path.join(profile,'setup')}).update('profile-personal',{complete:true,step:'finish'});
const routes=new Map(),register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>{routes.set(name,fn);return register(name,fn)};
require(path.join(desktop,'main.cjs'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));let ui,finished=false;
const report={passed:false,checks:[],cases:[],profile,scope:'Actual native Mac main and compiled UI, visible owned window, trusted backend tab setup, read-only requestAnimationFrame observations. No personal profile or simulated DOM input. Desktop glass intensity is outside this test.'};
const call=(name,...args)=>routes.get(name)({sender:ui,senderFrame:ui.mainFrame},...args);
async function poll(fn,ok,label){for(let i=0;i<500;i++){const v=await fn();if(ok(v))return v;await pause(20)}throw Error(label)}
function finish(error){if(finished)return;finished=true;clearTimeout(deadline);report.passed=!error;if(error)report.error=String(error.stack||error);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));if(error)app.exit(1);else app.quit()}
const deadline=setTimeout(()=>finish(Error('Native cover deadline')),70000);
app.whenReady().then(async()=>{
 ui=await poll(()=>webContents.getAllWebContents().find(w=>w.getURL()==='acira-browser-ui://ui/index.html'),Boolean,'Main UI');
 await poll(()=>ui.executeJavaScript("!!document.querySelector('.app')"),Boolean,'Rendered UI');
 const owner=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents===ui));
 owner.setTitle('Acira cover regression — disposable profile');owner.setBounds({x:180,y:100,width:1100,height:760});owner.show();
 await call('acira:dispatch',{type:'settings.update',patch:{reducedMotion:false,animationSpeed:'premium'}});
 const ready=()=>poll(()=>ui.executeJavaScript("!!document.querySelector('.nt-art img[data-current]')?.complete&&document.querySelector('.nt-art img[data-current]').naturalWidth>0"),Boolean,'Decoded cover');
 await ready();await pause(600);const first=call('acira:snapshot').activeTabId;
 await call('acira:dispatch',{type:'tab.new'});await ready();await pause(600);const second=call('acira:snapshot').activeTabId;
 assert.notEqual(first,second);
 for(const id of [first,second,first,second]){
  await ui.executeJavaScript(`(()=>{window.__resumeFrames=[];const generation=window.__resumeGeneration=(window.__resumeGeneration||0)+1;let source=document.querySelector('.nt-page'),next=false;const sample=()=>{if(window.__resumeGeneration!==generation)return;const p=document.querySelector('.nt-page'),f=p?.querySelector('.nt-frame-wrap');if(p!==source)next=true;if(next&&p&&f){const s=getComputedStyle(f),child=f.querySelector('.nt-frame');window.__resumeFrames.push({at:performance.now(),scene:p.dataset.scene,resumed:p.dataset.resumed,opacity:+s.opacity,height:f.getBoundingClientRect().height,contentOpacity:+getComputedStyle(child).opacity,filter:s.filter});}requestAnimationFrame(sample)};requestAnimationFrame(sample);})()`);
  await call('acira:dispatch',{type:'tab.select',id});
  await poll(()=>ui.executeJavaScript('window.__resumeFrames.length'),n=>n>=20,'Return frames');await pause(550);
  const frames=await ui.executeJavaScript('window.__resumeGeneration++;window.__resumeFrames');
  report.cases.push({id,frames});assert(frames.length>=20);assert(frames.every(f=>f.scene===id+':home'&&f.resumed==='true'),'cached same-owner scene returns');assert(frames.every(f=>f.opacity===1&&f.height>100&&f.contentOpacity===1&&f.filter==='blur(0px)'),'no collapsed, faded or blurred return frame');
  report.checks.push(id+': all '+frames.length+' return frames retain the decoded cover at full opacity and nonzero height');
 }
 finish();
}).catch(finish);
