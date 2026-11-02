// Native API integration in a dedicated disposable profile; never attach to a
// running browser or change the user's settings. Run with Electron on macOS.
const {app,BaseWindow,WebContentsView,nativeTheme}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {windowChrome,windowMaterial,materialOptions}=require('../desktop/platform.cjs');
const {setMaterialAppearance,inspectMaterial}=require('../desktop/mac-material.cjs');
assert.equal(process.platform,'darwin');
const base=path.resolve(__dirname,'../.qa-profiles');fs.mkdirSync(base,{recursive:true});
const directory=fs.mkdtempSync(path.join(base,'mac-native-'));
app.setPath('userData',directory);
app.setPath('sessionData',directory);
let window,view,checks=0;
const check=(name,value)=>{assert.ok(value,name);checks++;};
app.whenReady().then(async()=>{
 try{
  window=new BaseWindow({width:1000,height:700,show:false,backgroundColor:'#00000000',...windowChrome(),...materialOptions(windowMaterial())});
  view=new WebContentsView({webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.contentView.addChildView(view);view.setBounds({x:232,y:80,width:768,height:620});
  await view.webContents.loadURL('data:text/html,<title>Material test</title><p>Opaque website fixture</p>');
  check('Traffic lights are native and integrated',JSON.stringify(window.getWindowButtonPosition())===JSON.stringify({x:12,y:12}));
  check('Native title strip adds no height',window.getSize()[1]===window.getContentSize()[1]);
  for(const appearance of ['light','dark']){
   nativeTheme.themeSource=appearance;
   for(const tone of ['light','dark']){
    const effects=setMaterialAppearance(window,tone);
    check('Live AppKit effect exists',effects.length>0);
    check('Only the sidebar material follows the finish',effects.every(effect=>effect.tone===tone&&effect.state===0&&effect.blendingMode===0&&effect.material===7));
    const dark=await view.webContents.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches");
    check('Website appearance stays independent',dark===(appearance==='dark'));
   }
  }
  window.setVibrancy(null);check('Reduced transparency removes AppKit effect',inspectMaterial(window).length===0);
  window.setVibrancy('sidebar');const restored=setMaterialAppearance(window,'dark');check('Restored material accepts the finish again',restored.length>0&&restored.every(effect=>effect.tone==='dark'));
  console.log(JSON.stringify({checks,passed:true,version:process.versions.electron,arch:process.arch}));
 }catch(error){console.error(error);process.exitCode=1;}
 finally{view?.webContents.close();window?.close();app.quit();}
});
app.on('will-quit',()=>fs.rmSync(directory,{recursive:true,force:true}));
