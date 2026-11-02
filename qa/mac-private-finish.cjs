// Actual main/native material regression in an owned hidden profile. No UI driver.
const {app,ipcMain,webContents,BaseWindow,nativeTheme}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const server=require('node:http').createServer((q,r)=>{r.end('<title>Owned private light page</title>')});
const directory=fs.mkdtempSync(path.resolve('.qa-profiles/mac-private-finish-'));
Object.assign(process.env,{ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:directory,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_PREVIEW_RECORD:'1',ACIRA_DEV:'0'});
const routes=new Map(),original=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,fn)=>{routes.set(channel,fn);return original(channel,fn);};
const {themeTokens}=require(path.resolve('desktop/runtime.cjs')), {inspectMaterial}=require(path.resolve('desktop/mac-material.cjs'));
require(path.resolve('desktop/main.cjs'));
const invoke=(wc,ch,...args)=>routes.get(ch)({sender:wc,senderFrame:wc.mainFrame},...args),wait=ms=>new Promise(r=>setTimeout(r,ms));
const all=()=>webContents.getAllWebContents().filter(w=>!w.isDestroyed());const chromes=()=>all().filter(w=>w.getURL()==='acira-browser-ui://ui/index.html');const snap=wc=>invoke(wc,'acira:snapshot');
const owner=wc=>BaseWindow.getAllWindows().find(w=>w.contentView.children.some(c=>c.webContents===wc));
async function poll(fn,ok,label){for(let i=0;i<300;i++){const v=await fn();if(ok(v))return v;await wait(25)}throw Error(label)}
let done=false;const report={checks:[],scope:'Actual hidden main, native AppKit material inspection, owned local website media-query. No physical UI or personal profile.'};
const deadline=setTimeout(()=>finish(false,Error('Deadline')),25000);app.on('before-quit',e=>{if(!done)e.preventDefault()});
function finish(passed,error){if(done)return;done=true;clearTimeout(deadline);report.passed=passed;if(error)report.error=String(error.stack||error);report.hidden=BaseWindow.getAllWindows().every(w=>!w.isVisible());fs.mkdirSync('qa/artifacts',{recursive:true});fs.writeFileSync('qa/artifacts/mac-private-finish.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));server.close();app.exit(passed?0:1)}
app.whenReady().then(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const ordinary=await poll(()=>chromes().find(w=>{try{return !!snap(w)}catch{return false}}),Boolean,'ordinary');
 await invoke(ordinary,'acira:dispatch',{type:'settings.update',patch:{appearance:'light',colorPreset:'Porcelain',browserTint:'#eeeeee',accentColor:'#62666d',reducedTransparency:false}});
 const saved=snap(ordinary).settings;await poll(()=>inspectMaterial(owner(ordinary)),v=>v.length&&v.every(e=>e.tone==='light'),'ordinary light');report.checks.push('Ordinary Porcelain material is light');
 ipcMain.emit('acira:open',{sender:ordinary,senderFrame:ordinary.mainFrame},'private');
 const privateUi=await poll(()=>chromes().find(w=>w!==ordinary&&snap(w)?.browserProfiles.some(p=>p.private)),Boolean,'private');
 const privateSettings=snap(privateUi).settings,expected=themeTokens({...privateSettings,windowFinish:'private'},false),actual=inspectMaterial(owner(privateUi));
 report.beforeComparison={expectedTone:expected['--chrome-tone'],actual,savedFinish:privateSettings.colorPreset,expectedFrame:expected['--frame']};
 if(process.env.EXPECT_BEFORE){assert.equal(expected['--chrome-tone'],'dark');assert(actual.length&&actual.every(e=>e.tone==='light'));report.checks.push('Reproduced native light material versus renderer dark private finish');finish(true);return;}
 assert(actual.length&&actual.every(e=>e.tone==='dark'));report.checks.push('Private native material matches renderer dark private finish');
 for(const key of ['appearance','colorPreset','browserTint','accentColor'])assert.equal(privateSettings[key],saved[key]);assert(!('windowFinish' in privateSettings));report.checks.push('Private finish is ephemeral; saved normal preferences are inherited without mutation');
 assert(inspectMaterial(owner(ordinary)).every(e=>e.tone==='light'));assert.equal(nativeTheme.themeSource,'light');report.checks.push('Ordinary native material and global page appearance remain light');
 await invoke(privateUi,'acira:dispatch',{type:'tab.new',url});
 const page=await poll(()=>all().find(w=>w.getURL()===url+'/'),Boolean,'private document');assert.equal(await page.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches"),false);report.checks.push('Private website media query retains Light appearance');
 await invoke(privateUi,'acira:dispatch',{type:'settings.update',patch:{reducedTransparency:true}});await poll(()=>inspectMaterial(owner(privateUi)),v=>v.length===0,'solid private');
 await poll(()=>invoke(privateUi,'acira:get-layout'),v=>v.reducedTransparency===true,'renderer solid layout published');
 assert.equal(owner(privateUi).getBackgroundColor().toLowerCase(),expected['--frame'].toLowerCase());report.checks.push('Reduced-transparency private window uses private solid frame without AppKit effect');
 await invoke(privateUi,'acira:dispatch',{type:'settings.update',patch:{reducedTransparency:false}});await poll(()=>inspectMaterial(owner(privateUi)),v=>v.length&&v.every(e=>e.tone==='dark'),'restored private');report.checks.push('Restored private material remains dark');ipcMain.emit('acira:window',{sender:privateUi,senderFrame:privateUi.mainFrame},'close');await poll(()=>privateUi.isDestroyed(),Boolean,'private retirement');finish(true);
}).catch(e=>finish(false,e));
