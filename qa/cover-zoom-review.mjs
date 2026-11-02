// Native page and chrome input, on a disposable profile and owned loopback sites.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import{createRequire}from'node:module';
import{startApp,httpFixture,poll,sleep}from'./d-harness.mjs';
const require=createRequire(import.meta.url),stamp=Date.now(),root=path.resolve('.qa-profiles/cover-zoom-'+stamp),out=path.resolve('qa/artifacts/cover-zoom-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs'),initial=createInitialState(),profile=initial.activeBrowserProfileId;
Object.assign(initial.settings,{onboardingComplete:true,askBeforeClosing:false,reducedMotion:false,verticalTabs:false,appearance:'dark'});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',initial);db.close();
const report={passed:false,platform:process.platform,checks:[],errors:[]};let app;
const fixture=await httpFixture((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Zoom review</title><style>body{margin:0}#square{width:100px;height:100px;background:steelblue}input{margin:16px}</style><div id="square"></div><input aria-label="Draft"><div style="height:2000px"></div>');});
const check=async(name,fn)=>{const detail=await fn();report.checks.push({name,detail});console.log('PASS '+name);};
const stateZoom=async()=>{const s=await app.state();return s.tabs.find(t=>t.id===s.activeTabId).zoom;};
const prefs=patch=>app.ui.evaluate(({profile,patch})=>{const key='acira-new-tab:'+profile;localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)||'{}'),...patch}));window.dispatchEvent(new StorageEvent('storage',{key}));},{profile,patch});
const key=async(page,keyCode)=>app.main(({webContents},[url,keyCode])=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()===url);wc.focus();for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode,modifiers:[process.platform==='darwin'?'meta':'control']});},[page.url(),keyCode]);
const wheel=async(page,deltaY,count=1)=>{const cdp=await app.context.newCDPSession(page);try{for(let i=0;i<count;i++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:350,y:260,deltaX:0,deltaY,modifiers:2});await sleep(18);}}finally{await cdp.detach();}};
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve('desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 app.ui.setDefaultTimeout(7000);app.ui.on('pageerror',error=>report.errors.push(String(error)));
 await app.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];w.setBounds({x:-17000,y:100,width:1280,height:850});w.showInactive();});
 await app.ui.locator('.nt-search').waitFor();await prefs({artStyle:'framed'});
 await check('Homepage keyboard zoom advances one normal step per press and resets',async()=>{
  for(const [code,value]of [['=',110],['=',125],['=',150],['-',125],['0',100]]){await key(app.ui,code);await poll(stateZoom,z=>z===value,'Homepage zoom '+value);}
 });
 await check('Homepage pinch distance stays proportional instead of racing to the zoom limit',async()=>{
  await wheel(app.ui,-.5,40);const z=await stateZoom();assert(z>=120&&z<=123,'Expected about 122%, got '+z);await key(app.ui,'=');await poll(stateZoom,z=>z===125,'Keyboard picks next standard step after pinch');await key(app.ui,'0');await poll(stateZoom,z=>z===100,'Reset');return z;
 });
 for(const [style,scale,width]of [['framed',100,1280],['full',100,1280],['framed',150,900],['full',150,900]])await check(`Cover picker: ${style}, interface ${scale}%, window ${width}px`,async()=>{
  await app.main(({BaseWindow},width)=>BaseWindow.getAllWindows()[0].setSize(width,800),width);
  await app.act({type:'settings.update',patch:{interfaceScale:scale}});await prefs({artStyle:style});await sleep(450);
  const next=app.ui.locator('.nt-next'),eye=app.ui.getByRole('button',{name:'Hide workspace cover',exact:true}),arrow=app.ui.getByRole('button',{name:'Change workspace cover',exact:true});
  const a=await next.boundingBox(),b=await eye.boundingBox();assert(a.x+a.width<b.x);assert.equal(await eye.innerText(),'');assert.equal(await eye.locator('svg').count(),1);
  await arrow.click();const dialog=app.ui.getByRole('dialog',{name:'Workspace cover',exact:true});await dialog.waitFor();await sleep(350);
  const label=dialog.locator('.workspace-cover-collection>span'),select=dialog.getByRole('combobox',{name:'Collection'}),gallery=dialog.getByRole('radiogroup',{name:'Workspace cover'});
  const l=await label.boundingBox(),s=await select.boundingBox(),g=await gallery.boundingBox(),d=await dialog.boundingBox();assert(l.y+l.height+5<=s.y,'Collection label and field have separate rows');assert(s.y+s.height+10<=g.y,'Gallery starts below collection field');assert(s.x>=d.x&&s.x+s.width<=d.x+d.width,'Field fits picker');assert.equal(await select.locator('option').count(),6);assert(await gallery.getByRole('radio').count()>5);
  await app.ui.screenshot({path:path.join(out,`${style}-${scale}.png`)});
  await app.ui.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await eye.click();await app.ui.getByRole('button',{name:'Show workspace cover',exact:true}).click();
  return {picker:d,collection:s};
 });
 await app.act({type:'settings.update',patch:{interfaceScale:100}});
 const url='http://127.0.0.1:'+fixture.port+'/';await app.act({type:'tab.new',url});const page=await app.waitWeb(url);await page.locator('#square').waitFor();const baseline=await page.evaluate(()=>devicePixelRatio);
 await check('Website keyboard zoom changes real rendered pixels and preserves the draft',async()=>{
  await page.getByLabel('Draft').fill('Keep this draft');for(const [code,value]of [['=',110],['=',125],['-',110],['0',100]]){await key(page,code);await poll(stateZoom,z=>z===value,'Website zoom '+value);await poll(()=>page.evaluate(()=>devicePixelRatio),dpr=>Math.abs(dpr/baseline-value/100)<.01,'Rendered pixel scale '+value);}
  assert.equal(await page.getByLabel('Draft').inputValue(),'Keep this draft');
 });
 await check('Website small gestures use proportional zoom and large wheel notches use normal steps',async()=>{
  await wheel(page,-.5,40);const z=await stateZoom();assert(z>=120&&z<=123,'Expected about 122%, got '+z);await key(page,'0');await poll(stateZoom,z=>z===100,'Website reset');await sleep(300);await wheel(page,-120);await poll(stateZoom,z=>z===110,'Single wheel notch');await sleep(300);await wheel(page,120);await poll(stateZoom,z=>z===100,'Reverse wheel');assert.equal(await page.getByLabel('Draft').inputValue(),'Keep this draft');return z;
 });
 await check('Keyboard zoom clears temporary native pinch magnification',async()=>{
  const cdp=await app.context.newCDPSession(page);
  try{
   const baseDpr=await page.evaluate(()=>devicePixelRatio),windows=process.platform==='win32';
   await cdp.send('Input.synthesizePinchGesture',{x:150,y:120,scaleFactor:1.5,relativeSpeed:800,gestureSourceType:windows?'default':'touch'});
   const pinch=await poll(async()=>({visual:await page.evaluate(()=>visualViewport.scale),dpr:await page.evaluate(()=>devicePixelRatio),zoom:await stateZoom()}),m=>windows?m.dpr/baseDpr>1.1:m.visual>1.1,'Native pinch');
   const expected=windows?require('../page-zoom-levels.json').find(value=>value>Math.round(pinch.zoom)):110;
   await key(page,'=');await poll(stateZoom,z=>z===expected,'Keyboard step after native pinch');await sleep(200);
   const m=await page.evaluate(()=>({visual:visualViewport.scale,dpr:devicePixelRatio}));report.pinchThenKey={...m,pinch,expected,baseDpr};
   assert(Math.abs(m.visual-1)<.01,'Temporary pinch must not compound keyboard zoom: '+JSON.stringify(m));assert(Math.abs(m.dpr/baseDpr-expected/100)<.01,'Keyboard page scale matches its displayed zoom');await key(page,'0');await poll(stateZoom,z=>z===100,'Reset native pinch');
   if(windows){await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});await poll(()=>page.evaluate(()=>visualViewport.scale),s=>s>1.1,'Injected temporary visual scale');await key(page,'=');await poll(stateZoom,z=>z===110,'Keyboard step clears temporary visual scale');await poll(()=>page.evaluate(()=>visualViewport.scale),s=>Math.abs(s-1)<.01,'Temporary visual scale cleared');report.windowsTransientVisualReset=true;await key(page,'0');}
   return report.pinchThenKey;
  }finally{await cdp.detach();}
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}finally{await app?.close();await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));}
