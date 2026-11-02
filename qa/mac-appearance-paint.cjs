// Exercise the real main process and compiled renderer, not just theme tokens.
// All state belongs to a disposable hidden profile. Renderer access is read-only.
const {app,ipcMain,webContents,BaseWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
assert.equal(process.platform,'darwin');
const desktop=path.resolve(process.argv[2]||'desktop');
const output=path.resolve(process.argv[3]||'qa/artifacts/mac-appearance-paint.json');
fs.mkdirSync('.qa-profiles',{recursive:true});
const profile=fs.mkdtempSync(path.resolve('.qa-profiles/mac-appearance-paint-'));
const visible=process.env.ACIRA_APPEARANCE_VISIBLE==='1';
Object.assign(process.env,{ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:visible?'0':'1',ACIRA_DEV:'0'});
new(require(path.resolve(__dirname,'../desktop/accounts/onboarding.cjs')).OnboardingStore)({directory:path.join(profile,'setup')}).update('profile-personal',{complete:true,step:'finish'});
const routes=new Map(),register=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>{routes.set(channel,fn);return register(channel,fn)};
const {inspectMaterial}=require(path.resolve(__dirname,'../desktop/mac-material.cjs'));
const {themeTokens}=require(path.join(desktop,'runtime.cjs'));
require(path.join(desktop,'main.cjs'));
const call=(ui,channel,...args)=>routes.get(channel)({sender:ui,senderFrame:ui.mainFrame},...args);
const snapshot=ui=>call(ui,'acira:snapshot');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={checks:[],cases:[],scope:'Actual Mac main, compiled renderer computed paint and public AppKit inspection. Disposable profile only. capturePage alpha is checked only with a visible display surface; physical desktop blur is qualified separately.'};
let done=false;
const deadline=setTimeout(()=>finish(Error('Appearance paint deadline')),90000);
app.on('before-quit',event=>{if(!done)event.preventDefault()});
function finish(error){
 if(done)return;done=true;clearTimeout(deadline);
 report.passed=!error;report.product=desktop;report.hidden=BaseWindow.getAllWindows().every(window=>!window.isVisible());
 if(error)report.error=String(error.stack||error);
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));app.exit(error?1:0);
}
async function poll(fn,accept,label){
 for(let attempt=0;attempt<400;attempt++){const value=await fn();if(accept(value))return value;await wait(25)}
 throw Error(label);
}
const readPaint=ui=>ui.executeJavaScript(`(()=>{
 const app=document.querySelector('.app');if(!app)return null;
 const style=getComputedStyle(app),layer=selector=>{const element=document.querySelector(selector);if(!element)return null;const css=getComputedStyle(element),rect=element.getBoundingClientRect();return {color:css.backgroundColor,image:css.backgroundImage,display:css.display,bounds:rect.toJSON()}};
 return {material:document.documentElement.dataset.material,appearance:document.documentElement.dataset.materialAppearance,finish:style.getPropertyValue('--finish').trim(),opacity:Number(style.getPropertyValue('--material-opacity')),top:Number(style.getPropertyValue('--chrome-veil-top')),bottom:Number(style.getPropertyValue('--chrome-veil-bottom')),sidebar:style.getPropertyValue('--sidebar-rgb').trim(),toolbar:style.getPropertyValue('--toolbar-rgb').trim(),app:layer('.app'),rail:layer('.ed-rail'),bar:layer('.browser-toolbar'),roots:['html','body','#root'].map(layer)};
})()`);
const alpha=color=>color==='transparent'?0:color.startsWith('rgba(')?Number(color.slice(5,-1).split(',')[3]):1;
const owner=ui=>BaseWindow.getAllWindows().find(window=>window.contentView.children.some(view=>view.webContents===ui));
async function update(ui,patch){
 await call(ui,'acira:dispatch',{type:'settings.update',patch});
 const settings=snapshot(ui).settings,expected=themeTokens(settings,settings.appearance==='dark');
 const material=settings.reducedTransparency?'none':'vibrancy';
 return poll(()=>readPaint(ui),paint=>paint&&paint.material===material&&(material==='none'||paint.appearance===expected['--chrome-tone'])&&Math.abs(paint.opacity-Number(expected['--material-opacity']))<.001&&paint.sidebar===expected['--sidebar-rgb']&&paint.toolbar===expected['--toolbar-rgb']&&paint.finish===expected['--finish'],'Renderer and native material consumed the appearance update');
}
function glass(paint,label){
 assert.equal(paint.material,'vibrancy',label+' native provider');
 assert.equal(alpha(paint.app.color),0,label+' root has no opaque undercoat');
 assert(paint.app.image.startsWith('linear-gradient('),label+' shared frame veil');
 assert(paint.top<1&&paint.bottom<1,label+' translucent veil');
 assert(paint.roots.every(layer=>alpha(layer.color)===0&&layer.image==='none'),label+' document roots remain transparent');
 if(paint.rail&&paint.rail.display!=='none')assert.equal(alpha(paint.rail.color),0,label+' no second opaque sidebar');
 report.checks.push(label);
}
app.whenReady().then(async()=>{
 const ui=await poll(()=>webContents.getAllWebContents().find(contents=>!contents.isDestroyed()&&contents.getURL()==='acira-browser-ui://ui/index.html'),Boolean,'Main renderer');
 await poll(()=>readPaint(ui),Boolean,'Painted app');
 const base={appearance:'light',colorPreset:'Porcelain',browserTint:'#f8fbff',accentColor:'#1769c2',glassOpacity:40,translucentOpacity:40,reducedTransparency:false,reducedMotion:true,verticalTabs:true,sidebarColor:undefined,toolbarColor:undefined};
 const low=await update(ui,base);glass(low,'40% Porcelain exposes the native backing in expanded sidebar mode');report.cases.push({name:'porcelain40',paint:low});
 if(visible){
  const image=await poll(()=>ui.capturePage().catch(()=>null),value=>value&&!value.isEmpty(),'Visible capture surface');
  const size=image.getSize(),bytes=image.toBitmap(),x=8,y=Math.min(310,size.height-10),pixel=Array.from(bytes.subarray((y*size.width+x)*4,(y*size.width+x)*4+4));
  report.framePixel={x,y,bgra:pixel,size};assert(pixel[3]>0&&pixel[3]<255,'Actual frame pixel retains alpha instead of painting opaque');
  fs.writeFileSync(output.replace(/\.json$/, '-40.png'),image.toPNG());report.checks.push('Captured frame pixel is translucent');
 }
 const high=await update(ui,{glassOpacity:85});glass(high,'85% retains glass without an opaque sidebar');assert(high.top>low.top&&high.bottom>low.bottom);report.checks.push('Opacity changes the computed frame alpha live');
 if(visible){
  const highPixel=await poll(async()=>{try{const image=await ui.capturePage(),bytes=image.toBitmap(),{width}=image.getSize(),{x,y}=report.framePixel;return bytes[(y*width+x)*4+3]}catch{return null}},value=>value>report.framePixel.bgra[3]+20&&value<255,'Captured higher opacity');
  report.higherOpacityPixelAlpha=highPixel;report.checks.push('85% increases captured frame alpha while retaining translucency');
 }
 report.cases.push({name:'porcelain85',paint:high});
 const custom=await update(ui,{glassOpacity:40,sidebarColor:'#cc365d',toolbarColor:'#287e75'});
 assert(custom.app.image.includes('204, 54, 93'));assert(custom.bar.color.includes('40, 126, 117'));assert(alpha(custom.bar.color)<1);glass(custom,'Custom frame and toolbar paint their own live colors through glass');report.cases.push({name:'custom',paint:custom});
 const solid=await update(ui,{glassOpacity:100});
 await poll(()=>inspectMaterial(owner(ui)),effects=>effects.length===0,'Native material disabled at solid endpoint');assert.equal(solid.opacity,1);assert.equal(alpha(solid.bar.color),1);report.checks.push('100% is solid and disables native material');
 if(visible){
  report.solidPixelAlpha=await poll(async()=>{try{const image=await ui.capturePage(),bytes=image.toBitmap(),{width}=image.getSize(),{x,y}=report.framePixel;return bytes[(y*width+x)*4+3]}catch{return null}},value=>value===255,'Captured solid opacity');
  report.checks.push('100% paints an opaque native frame pixel');
 }
 const restored=await update(ui,{reducedTransparency:false});assert.equal(snapshot(ui).settings.glassOpacity,40);glass(restored,'Glass toggle restores the remembered 40% and live colors');
 await poll(()=>inspectMaterial(owner(ui)),effects=>effects.length>0,'Native material restored');
 const finishes=[['Porcelain','#f8fbff','#1769c2'],['Burgundy','#4d1821','#4d1821'],['Deep Blue','#293c55','#47678e'],['Ocean Blue','#99c9e8','#266a98'],['iPhone Blue','#315b89','#477fb8'],['Emerald Green','#176b53','#208361'],['Alpine Green','#345c50','#487667'],['Deep Purple','#57345f','#885494'],['Desert Titanium','#b5a596','#79634f'],['Natural Titanium','#bbc0c7','#56616d'],['Silver','#f7f7f7','#3d6e9c'],['Black Titanium','#262c33','#65778e']];
 for(const appearance of ['light','dark'])for(const [colorPreset,browserTint,accentColor] of finishes){
  const paint=await update(ui,{appearance,colorPreset,browserTint,accentColor,sidebarColor:undefined,toolbarColor:undefined});
  glass(paint,`${colorPreset} / ${appearance}: one translucent frame`);report.cases.push({name:colorPreset,appearance,paint});
  const effects=await poll(()=>inspectMaterial(owner(ui)),value=>value.length&&value.every(effect=>effect.tone===paint.appearance),'Native material tone follows finish');assert(effects.every(effect=>effect.state===0&&effect.blendingMode===0));
 }
 await update(ui,{...base,verticalTabs:false});
 const horizontal=await poll(()=>readPaint(ui),paint=>!paint.rail||paint.rail.bounds.width===0,'Horizontal tabs');glass(horizontal,'Horizontal layout keeps the shared glass frame');
 await call(ui,'acira:dispatch',{type:'ui.update',patch:{focusMode:true}});
 const focus=await poll(()=>ui.executeJavaScript("document.querySelector('.browser-shell')?.dataset.layout==='focus'"),Boolean,'Focus mode');assert(focus);glass(await readPaint(ui),'Focus layout keeps the shared glass frame');
 await call(ui,'acira:dispatch',{type:'ui.update',patch:{focusMode:false}});
 await update(ui,{...base});
 const ordinarySettings=JSON.stringify(snapshot(ui).settings);
 ipcMain.emit('acira:open',{sender:ui,senderFrame:ui.mainFrame},'private');
 const privateUi=await poll(()=>webContents.getAllWebContents().find(contents=>!contents.isDestroyed()&&contents!==ui&&contents.getURL()==='acira-browser-ui://ui/index.html'&&snapshot(contents)?.browserProfiles.some(item=>item.private)),Boolean,'Private renderer');
 const privatePaint=await poll(()=>readPaint(privateUi),paint=>paint?.material==='vibrancy', 'Private paint');glass(privatePaint,'Private window retains its ephemeral glass finish');
 assert.equal(JSON.stringify(snapshot(ui).settings),ordinarySettings);report.checks.push('Private glass does not mutate ordinary profile preferences');
 finish();
}).catch(finish);
