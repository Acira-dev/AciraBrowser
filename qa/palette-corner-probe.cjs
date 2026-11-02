const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.resolve('.qa-profiles/palette-corner-probe'));
app.whenReady().then(async()=>{let win;try{
 win=new BrowserWindow({show:false,width:500,height:300,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
 await win.loadURL('data:text/html,<div id="field" style="width:320px;height:48px;border-radius:12px;border:1px solid gray">Field</div>');
 const result=await win.webContents.executeJavaScript(`(()=>{const field=document.getElementById('field'),supports=CSS.supports('corner-shape','superellipse(1.15)'),before=field.getBoundingClientRect();field.style.cornerShape='superellipse(1.15)';const s=getComputedStyle(field),after=field.getBoundingClientRect();return{supports,computed:s.cornerShape,radius:s.borderRadius,unchangedBounds:before.width===after.width&&before.height===after.height}})()`);
 const report={checkedAt:new Date().toISOString(),electron:process.versions.electron,chromium:process.versions.chrome,...result,qualification:'Hidden isolated feature probe using the pinned Electron runtime; no desktop input, product preview, native popup or website was opened.'};
 fs.writeFileSync(path.resolve('docs/design/color-research/production-qa/corner-support.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{win?.destroy();app.quit();}}).catch(error=>{console.error(error);app.exit(1);});
