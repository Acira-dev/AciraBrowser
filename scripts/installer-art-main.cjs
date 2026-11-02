'use strict';
// Renders the installer scene bitmaps (NSIS needs BMP) from the design concept page, for each theme, stage and screen scale.
//   install-<theme>-<stage>-<scale>.bmp   stage 1 = start of copy (p .12), stage 2 = finishing up (p .9); scales 100/150/200
//   uninstall-<theme>-100.bmp             branded splash shown by the uninstaller
// The page is docs/launch/concepts/installer-creation.html (?p=<progress>&theme=<dark|light>; the install stages add &grow=auto so the coloured beams are
// drawn in as at that progress, like the animated frames; the uninstall splash does not). The live parts (progress line,
// percentage, buttons) are hidden here: the installer draws its own progress line over the bitmap.
// Run once per theme/scene (a second window fails to load in one process; navigations inside one window are fine):
//   node_modules/electron/dist/electron.exe scripts/installer-art-main.cjs            (renders everything)
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'packaging','installer');fs.mkdirSync(out,{recursive:true});
const concept=process.env.ACIRA_INSTALLER_CONCEPT||path.join(root,'docs','launch','concepts','installer-creation.html');
const W=560,H=340,THEMES=['dark'],SCALES=[1,1.5,2],STAGES={1:.12,2:.9};
const hide='.track,.pct,.close,.side,.btn{display:none!important}';
function bmp(bgra,w,h){const row=Math.ceil(w*3/4)*4,data=Buffer.alloc(54+row*h);data.write('BM');data.writeUInt32LE(data.length,2);data.writeUInt32LE(54,10);data.writeUInt32LE(40,14);data.writeInt32LE(w,18);data.writeInt32LE(h,22);data.writeUInt16LE(1,26);data.writeUInt16LE(24,28);data.writeUInt32LE(row*h,34);
 for(let y=0;y<h;y++){const src=(h-1-y)*w*4,dst=54+y*row;for(let x=0;x<w;x++){data[dst+x*3]=bgra[src+x*4];data[dst+x*3+1]=bgra[src+x*4+1];data[dst+x*3+2]=bgra[src+x*4+2];}}return data;}
app.commandLine.appendSwitch('force-device-scale-factor','1');
// a throwaway profile: Chromium remembers page zoom per origin, and a stale zoom from an earlier run skews the render
app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'acira-art-')));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:W*2,height:H*2,useContentSize:true,frame:false,webPreferences:{offscreen:true}});
 const shoot=async(query,scale,after)=>{
  win.setContentSize(Math.round(W*scale),Math.round(H*scale));win.webContents.setZoomFactor(scale);await win.loadFile(concept,{query});
  await win.webContents.insertCSS(hide);await win.webContents.executeJavaScript('Promise.all([document.fonts.ready,window.ready]).then(()=>true)');await new Promise(r=>setTimeout(r,1500));
  if(after)await win.webContents.executeJavaScript(after);
  await new Promise(r=>setTimeout(r,900));
  const w=Math.round(W*scale),h=Math.round(H*scale),image=await win.webContents.capturePage({x:0,y:0,width:w,height:h}),size=image.getSize();
  return {data:bmp(image.toBitmap(),size.width,size.height),size,png:image.toPNG()};
 };
 for(const theme of THEMES){
  for(const [stage,p] of Object.entries(STAGES))for(const scale of SCALES){
   const shot=await shoot({p:String(p),theme,grow:'auto'},scale),name=`install-${theme}-${stage}-${Math.round(scale*100)}.bmp`;
   fs.writeFileSync(path.join(out,name),shot.data);console.log(name,shot.size.width+'x'+shot.size.height);
   if(scale===1)fs.writeFileSync(path.join(out,`install-${theme}-${stage}-preview.png`),shot.png);
  }
  const un=await shoot({p:'0.5',theme},1,"document.getElementById('title').textContent='Removing Acira';document.getElementById('status').textContent='Your data stays unless you choose to remove it.'");
  fs.writeFileSync(path.join(out,`uninstall-${theme}-100.bmp`),un.data);fs.writeFileSync(path.join(out,`uninstall-${theme}-preview.png`),un.png);console.log(`uninstall-${theme}-100.bmp`,un.size.width+'x'+un.size.height);
 }
 app.quit();
});
