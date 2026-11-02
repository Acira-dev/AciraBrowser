// Bounded native evidence for K's four requested refinements. One app, synthetic OS roots, <=1 tab.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {launchPreparedNative} from './prepared-native.mjs';
const fullWindow=process.argv.includes('--full-window'),only150=process.argv.includes('--150'),quick=process.argv.includes('--quick');
const root=process.cwd(),stamp=Date.now(),base=path.resolve('.qa-profiles/k-round2-'+stamp),data=path.join(base,'profile'),os=path.join(base,'os');
const out=path.resolve('qa/artifacts/k-round2-'+stamp),require=createRequire(import.meta.url);
await fs.mkdir(out,{recursive:true});await fs.mkdir(os,{recursive:true});
const chrome=path.join(os,'Google/Chrome/User Data');await fs.mkdir(path.join(chrome,'Default'),{recursive:true});
await fs.writeFile(path.join(chrome,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Fixture',user_name:'fixture@example.invalid'}}}}));
await fs.writeFile(path.join(chrome,'Default/Preferences'),'{}');
await fs.writeFile(path.join(chrome,'Default/Bookmarks'),JSON.stringify({version:1,roots:{bookmark_bar:{type:'folder',id:'1',name:'Bookmarks bar',children:[{type:'url',id:'2',name:'Fixture bookmark',url:'https://example.invalid/'}]},other:{type:'folder',id:'3',name:'Other',children:[]},synced:{type:'folder',id:'4',name:'Mobile',children:[]}}}));
const env={...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,APPDATA:os,LOCALAPPDATA:os,D_VISIBLE:'1',ACIRA_BROWSER_TEST_HIDDEN:'0',ACIRA_NO_SPLASH:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_DEV;
const report={out,base,captureTimes:{},capture:fullWindow?'native-desktop-window':'Electron-page-screenshot',qualification:'Real Electron chrome, prepared disposable native key, synthetic import paths, one app/one tab. Before build substitutes only saved onboarding source via Vite load plugin.',cases:[],errors:[]};
const edge=await fs.readFile(path.resolve('qa/m-edge-scan.js'),'utf8'),clip=await fs.readFile(path.resolve('qa/m-clip-scan.js'),'utf8');
let app,page,timer;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const hook=()=>{
 const names=new WeakMap(),p=WebGL2RenderingContext.prototype,q={draws:0,deletedPrograms:0,last:{},frames:[],poses:[]};window.__kGpu=q;
 const loc=p.getUniformLocation;p.getUniformLocation=function(prog,name){const v=loc.call(this,prog,name);if(v)names.set(v,name);return v;};
 const one=p.uniform1f;p.uniform1f=function(loc,value){const name=names.get(loc);if(this.canvas.classList.contains('fr-prism')){if(name==='t'&&window.__kFreeze!=null)value=window.__kFreeze;q.last[name]=value;}return one.call(this,loc,value);};
 const two=p.uniform2f;p.uniform2f=function(loc,x,y){if(this.canvas.classList.contains('fr-prism'))q.last[names.get(loc)]=[x,y];return two.call(this,loc,x,y);};
 const draw=p.drawArrays;p.drawArrays=function(...args){if(this.canvas.classList.contains('fr-prism')){q.draws++;if(names&&q.last.finale!=null&&q.frames.length<1200)q.frames.push({at:performance.now(),...q.last});if(q.poses.length<4000)q.poses.push({at:performance.now(),swing:q.last.swing,pose:q.last.pose,finale:q.last.finale});}return draw.apply(this,args);};
 const del=p.deleteProgram;p.deleteProgram=function(...args){if(this.canvas.classList.contains('fr-prism'))q.deletedPrograms++;return del.apply(this,args);};
};
const shot=async name=>{report.captureTimes[name]={start:await page.evaluate(()=>performance.timeOrigin+performance.now())};if(!fullWindow){await page.screenshot({path:path.join(out,name+'.png')});report.captureTimes[name].end=await page.evaluate(()=>performance.timeOrigin+performance.now());return;}const png=await app.evaluate(async({BaseWindow,desktopCapturer})=>{const w=BaseWindow.fromId(globalThis.__kWindowId);const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1440,height:900}});const source=sources.find(s=>s.id===w.getMediaSourceId());if(!source)throw Error('Native target window missing');return source.thumbnail.toPNG().toString('base64');});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(png,'base64'));report.captureTimes[name].end=await page.evaluate(()=>performance.timeOrigin+performance.now());};
const title=()=>page.evaluate(()=>document.querySelector('#fr-title')?.getAttribute('aria-label')||document.querySelector('#fr-title')?.textContent||'welcome');
const texts=()=>page.evaluate(()=>[...document.querySelectorAll('.fr-stage h1,.fr-stage p,.fr-stage button,.fr-stage label,.fr-stage span,.fr-stage dt,.fr-stage dd,.fr-stage small,.fr-stage a')].filter(e=>{const b=e.getBoundingClientRect();return b.width>3&&b.height>3&&e.textContent.trim()&&(!e.childElementCount||e.tagName==='H1')&&!e.closest('[aria-hidden=true],[inert]');}).map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return{text:e.textContent.trim().slice(0,60),color:s.color,size:s.fontSize,weight:s.fontWeight,box:[b.x,b.y,b.width,b.height]};}));
const scan=async(name,focus=true)=>{
 await page.evaluate(edge);const initial=await page.evaluate(()=>window.__edge.static());
 const findings=[],seen=new Set();
 if(focus)for(let i=0;i<28;i++){await page.keyboard.press('Tab');const r=await page.evaluate(()=>window.__edge.focus());if(!r)continue;const key=r.label+JSON.stringify(r.findings);if(seen.has(key))break;seen.add(key);if(r.findings.length)findings.push(r);}
 const hover=[];const targets=await page.evaluate(()=>window.__edge.candidates().filter(e=>e.closest('.fr-stage')).slice(0,48).map(e=>({point:window.__edge.rect(e),text:e.textContent.trim().slice(0,35)})));for(const target of targets){const [x,y]=target.point;await page.mouse.move(x,y);await page.waitForTimeout(20);const found=await page.evaluate(([x,y])=>{const e=document.elementFromPoint(x,y);return e?window.__edge.el(e.closest('button,a,label,li,[role=option]')||e):[];},[x,y]);if(found.length)hover.push({label:target.text,findings:found});}await page.mouse.move(2,2);const clipping=await page.evaluate(clip);
 return{name,edge:initial,focus:findings,hover,clip:clipping};
};
async function route(before){await app.evaluate(({protocol,net},args)=>{const fs=process.getBuiltinModule('fs'),path=process.getBuiltinModule('path'),{pathToFileURL}=process.getBuiltinModule('url');protocol.unhandle('acira-browser-ui');protocol.handle('acira-browser-ui',async request=>{const u=new URL(request.url),relative='.'+decodeURIComponent(u.pathname),baseline=path.resolve(args.root,'.qa-profiles/k-round2-baseline-dist',relative),current=path.resolve(args.root,'dist',relative);const file=args.before&&fs.existsSync(baseline)?baseline:current;const r=await net.fetch(pathToFileURL(file).toString());return r;});},{root,before});}
try{
 app=await launchPreparedNative({executablePath:require('electron'),args:[path.resolve('desktop/main.cjs'),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],env,timeout:30000});
 timer=setTimeout(()=>void app.close().catch(()=>{}),720000);timer.unref();
 app.process().stderr?.on('data',b=>{const s=String(b);if(/ReferenceError|TypeError|Uncaught/.test(s))report.errors.push(s.slice(0,400));});
 for(let i=0;i<160&&!page;i++){page=app.windows().find(p=>p.url().startsWith('acira-browser-ui://ui/index.html'));if(!page)await wait(150);}if(!page)throw Error('No UI page');
 await page.addInitScript(hook);page.on('pageerror',e=>{if(e.message!=='Transition was skipped')report.errors.push(e.message);});
 for(const before of (process.argv.includes('--after-only')?[false]:[true,false]))for(const [tone,zoom,lang]of[['dark',1,'en'],['light',1,'de'],['dark',1.5,'de'],['light',1.5,'en']].filter(c=>!only150||c[1]===1.5)){
  const name=(before?'before':'after')+'-'+tone+'-'+zoom*100+'-'+lang,c={name,tone,zoom,lang,views:[]};report.cases.push(c);console.log('START',name);
  await route(before);await page.evaluate(({tone,lang})=>{void window.acira.dispatch({type:'settings.update',patch:{appearance:tone,language:lang,reducedMotion:false}});},{tone,lang}).catch(error=>{if(!error.message.includes('context was destroyed'))throw error;});await page.waitForTimeout(600);await page.waitForLoadState('domcontentloaded');await page.evaluate(()=>window.acira.setup({type:'restart'}));
  await app.evaluate(({BaseWindow},s)=>{const w=(typeof globalThis.__kWindowId==='number'?BaseWindow.fromId(globalThis.__kWindowId):null)||BaseWindow.getAllWindows().sort((a,b)=>b.getBounds().width-a.getBounds().width)[0];globalThis.__kWindowId=w.id;w.setContentSize(s[0],s[1]);w.center();w.showInactive();},zoom===1?[1440,900]:[1350,900]);
  await page.reload();await page.waitForLoadState('domcontentloaded');await app.evaluate(({webContents},z)=>{for(const w of webContents.getAllWebContents())if(w.getURL().startsWith('acira-browser-ui://ui/index.html'))w.setZoomFactor(z);},zoom);
  await page.waitForSelector('.fr-stage',{timeout:20000});await page.waitForTimeout(2600);
  for(let step=0;step<9;step++){
   const key=name+'-'+String(step).padStart(2,'0');await page.evaluate(()=>{window.__kFreeze=6;});await page.waitForTimeout(60);await shot(key);const v={shot:key,title:await title(),texts:await texts(),viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,geometry:Object.fromEntries(['.fr-card','.fr-card > .fr-foot','.fr-foot-end [data-onboarding-next]'].map(key=>{const r=document.querySelector(key)?.getBoundingClientRect();return[key,r&&[r.x,r.y,r.width,r.height]];}))})),gpu:await page.evaluate(()=>({...window.__kGpu.last,draws:window.__kGpu.draws}))};c.views.push(v);await page.evaluate(()=>{window.__kFreeze=null;});
   if(!before&&!quick){v.scan=await scan(key);if(await page.locator('.fr-card .fr-more').count()){await page.locator('.fr-card .fr-more').first().click();await page.waitForTimeout(450);await shot(key+'-connection');v.connection=await scan(key+'-connection');const expand=page.locator('.fr-sheet .fr-more[aria-expanded=false]');if(await expand.count()){await expand.first().click();await page.waitForTimeout(250);v.providers=await scan(key+'-providers');}await page.locator('.fr-sheet .acira-seg button').nth(1).click();await page.waitForTimeout(250);await shot(key+'-proxy');v.proxy=await scan(key+'-proxy');await page.keyboard.press('Escape');await page.waitForTimeout(250);const usage=page.locator('.fr-card .fr-inline-link');if(await usage.count()){await usage.first().click();await page.waitForTimeout(250);await shot(key+'-usage');v.usage=await scan(key+'-usage');await page.keyboard.press('Escape');await page.waitForTimeout(250);}}}
   const progress=await page.evaluate(()=>window.acira.setup({type:'status'}));if(progress.progress?.step==='finish')break;
   const next=page.locator('.setup-dialog [data-onboarding-next]').first();if(!await next.count())throw Error('Missing next '+key);
   if(!before&&step===1){await page.evaluate(()=>{window.__kGpu.poses=[];});const at=Date.now();await next.click();for(const offset of [0,160,400,800,1050]){await wait(Math.max(0,at+offset-Date.now()));await shot(key+'-motion-'+offset);}v.poseTrace=await page.evaluate(()=>window.__kGpu.poses);}
   else await next.click();
   await page.waitForTimeout(1100);
  }
  if(!before){
   const primary=page.locator('.setup-dialog [data-onboarding-primary]');if(!await primary.count())throw Error('Finish not reached');
   await page.evaluate(()=>{window.__kGpu.frames=[];window.__kStarted=performance.now();window.__kGone=null;const o=new MutationObserver(()=>{if(!document.querySelector('.fr-ghost')){window.__kGone=performance.now();o.disconnect();}});o.observe(document.body,{childList:true});});
   c.finishBeforeClick=await page.evaluate(()=>({progressTitle:document.querySelector('#fr-title')?.getAttribute('aria-label'),allTitles:[...document.querySelectorAll('.fr-card h1')].map(e=>e.getAttribute('aria-label')||e.textContent),foot:document.querySelector('.fr-foot-end [data-onboarding-primary]')?.textContent}));if(c.finishBeforeClick.progressTitle!==c.views.at(-1).title)throw Error('Finish card is not settled');const started=Date.now();await primary.click();c.clickEpoch=await page.evaluate(()=>performance.timeOrigin+window.__kStarted);c.ghostTitles=await page.evaluate(()=>[...document.querySelectorAll('.fr-ghost h1')].map(e=>e.getAttribute('aria-label')||e.textContent));c.setupRemovedMs=await page.evaluate(()=>document.querySelector('.setup-dialog')?null:performance.now()-window.__kStarted);
   await shot(name+'-finale-pretyping');await page.locator('.address-bar input').click();await page.keyboard.type('immediate fixture input');c.immediateInput=await page.evaluate(()=>({ms:performance.now()-window.__kStarted,active:document.activeElement?.tagName,value:document.activeElement?.value,ghostPointerEvents:getComputedStyle(document.querySelector('.fr-ghost')||document.body).pointerEvents}));
   for(const offset of [0,180,400,700,1020,1250]){await wait(Math.max(0,started+offset-Date.now()));await shot(name+'-finale-'+offset);}
   c.finale=await page.evaluate(()=>({goneMs:window.__kGone-window.__kStarted,ghost:!!document.querySelector('.fr-ghost'),draws:window.__kGpu.draws,deletedPrograms:window.__kGpu.deletedPrograms,frames:window.__kGpu.frames}));
   await page.waitForTimeout(400);c.drawsLater=await page.evaluate(()=>window.__kGpu.draws);c.status=await page.evaluate(()=>window.acira.setup({type:'status'}));
   await page.keyboard.press('Escape');await page.waitForTimeout(300);await page.evaluate(()=>{window.__kKeys=[];for(const type of ['keydown','beforeinput','input','focusin'])document.addEventListener(type,e=>{if(window.__kKeys.length<150)window.__kKeys.push({type,key:e.key,data:e.data,at:performance.now(),active:document.activeElement?.className,value:document.activeElement?.value,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd});},true);});await page.keyboard.press('Control+l');await page.keyboard.type('keyboard fixture input');c.shortcut=await page.evaluate(()=>({value:document.activeElement?.value,keys:window.__kKeys}));
  }
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('DONE',name,c.views.length,'views');
 }
 if(!process.argv.includes('--no-reduced')){
 // Reduced motion: the field remains identical across two captures and step changes do not move its GPU pose.
 await page.evaluate(async()=>{await window.acira.dispatch({type:'settings.update',patch:{appearance:'light',language:'en',reducedMotion:true}});await window.acira.setup({type:'restart'});});await page.reload();await page.waitForSelector('.fr-stage');await page.waitForTimeout(1000);
 const reduced={};await shot('reduced-still-a');reduced.a=await page.evaluate(()=>({...window.__kGpu.last,draws:window.__kGpu.draws}));await page.waitForTimeout(1000);await shot('reduced-still-b');reduced.b=await page.evaluate(()=>({...window.__kGpu.last,draws:window.__kGpu.draws}));
 await page.locator('.setup-dialog [data-onboarding-next]').first().click();await page.waitForTimeout(700);reduced.step=await page.evaluate(()=>({...window.__kGpu.last,draws:window.__kGpu.draws}));
 await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('Escape');await page.waitForTimeout(150);reduced.end=await page.evaluate(()=>({ghost:!!document.querySelector('.fr-ghost'),...window.__kGpu.last,draws:window.__kGpu.draws,deletedPrograms:window.__kGpu.deletedPrograms}));await page.waitForTimeout(500);reduced.drawsLater=await page.evaluate(()=>window.__kGpu.draws);report.reduced=reduced;}
 report.status='captured';console.log('CAPTURED',out);
}catch(error){report.status='failed';report.failure=error.stack;throw error;}
finally{clearTimeout(timer);if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
