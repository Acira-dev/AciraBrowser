'use strict';
// Renders the installer's animated scene (packaging/installer/anim/*.jpg) from the design concept, frame by frame.
//   <theme>-<scale>-p<NN>.jpg   progress frames: the light grows as progress rises (p = NN / (P-1)); time drifts with it; the coloured beams are
//                               not there at first and draw in from the light behind the mark (the page's rayGrow(p), full reach by p = .66)
//                               and, as they grow, turn a little (the page's rayTurn(p): ~7 degrees by p = .66, ~11 at 1, eased in from rest; its speed is the finish's own drift, so
//                               the bloom frames, which start from that angle, take over without a change of speed)
//   <theme>-<scale>-b<NN>.jpg   finish bloom: the light peaks and settles (done state), then the installer closes
// scale is 1x or 2x (the helper scales 2x down for 125-175% screens). The helper blends neighbouring frames at 60 fps.
// The page is docs/launch/concepts/installer-creation.html; its draw(ctx, w, h, t, p, done, doneT) is called directly.
//   node_modules/electron/dist/electron.exe scripts/installer-frames-main.cjs [dark|light] [quality]
const {app,BrowserWindow,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=process.env.ACIRA_FRAMES_OUT||path.join(root,'packaging','installer','anim');fs.mkdirSync(out,{recursive:true}); // ACIRA_FRAMES_OUT: render somewhere else (tests, before/after)
const concept=process.env.ACIRA_INSTALLER_CONCEPT||path.join(root,'docs','launch','concepts','installer-creation.html');
const W=560,H=340,P=+process.env.ACIRA_FRAMES_P||48,B=+process.env.ACIRA_FRAMES_B||32,SPAN=14,BLOOM=2.2;
const themes=process.argv[2]&&process.argv[2]!=='all'?[process.argv[2]]:['dark'],quality=+process.argv[3]||90;
// the status text is NOT baked into the frames: it is rendered separately (crisp PNG layers per screen scale, see below)
const hide='.track,.pct,.close,.side,.btn{display:none!important}.text{visibility:hidden!important}';
const STRINGS=JSON.parse(fs.readFileSync(path.join(root,'packaging','installer','strings.json'),'utf8')),LOCS=Object.keys(STRINGS).filter(k=>k!=='note');
const TEXT_SCALES=[1,1.25,1.5,1.75,2,2.5,3],OTHER_SCALES=[1,1.25,1.5,2,3]; // other languages skip 175% and 250% (the helper rescales the nearest layer): keeps each language small
// text layers are rendered for every language (en keeps the plain <theme>-t<pct>-<state>.png names); ACIRA_FRAMES_TEXT_ONLY=1 skips the scene frames
const TEXT_ONLY=Boolean(process.env.ACIRA_FRAMES_TEXT_ONLY),SKIP_TEXT=Boolean(process.env.ACIRA_FRAMES_SKIP_TEXT); // SKIP_TEXT=1 re-renders only the scene frames
const textOnly='html,body{background:transparent!important}.win{background:BG!important;box-shadow:none!important;border:0!important}#art,.scrim,.track,.pct,.close,.side,.btn{display:none!important}.text{animation:none!important;opacity:1!important;transform:none!important;visibility:visible!important}';
app.commandLine.appendSwitch('force-device-scale-factor','1');
// a throwaway profile: Chromium remembers page zoom per origin, and a stale zoom from an earlier run skews the render
app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'acira-art-')));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:W*2,height:H*2,useContentSize:true,frame:false,webPreferences:{offscreen:true}});
 await win.loadFile(concept);win.webContents.setZoomFactor(2); // zoom only sticks once a page of this origin has loaded
 let bytes=0;
 for(const theme of themes)for(const scale of TEXT_ONLY?[]:[2,1]){
  win.setContentSize(W*scale,H*scale);win.webContents.setZoomFactor(scale);await win.loadFile(concept,{query:{p:'0',t:'0',theme}});win.webContents.setZoomFactor(scale);
  await win.webContents.insertCSS(hide);await win.webContents.executeJavaScript('Promise.all([document.fonts.ready,window.ready]).then(()=>true)');await sleep(1500);
  const render=async(name,p,t,done,doneT)=>{
   await win.webContents.executeJavaScript(`(()=>{setUi(${p},false);if(${done}){setUi(1,true);document.getElementById('status').textContent='Opening Acira…';}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.filter='none';draw(ctx,W,H,${t},${p},${done},${doneT},rayGrow(${p}),rayTurn(${p}));return true})()`);
   await sleep(90);
   const image=await win.webContents.capturePage({x:0,y:0,width:W*scale,height:H*scale}),jpg=image.toJPEG(quality);
   fs.writeFileSync(path.join(out,`${theme}-${scale}x-${name}.jpg`),jpg);bytes+=jpg.length;
  };
  for(let k=0;k<P;k++){const p=k/(P-1);await render('p'+String(k).padStart(2,'0'),p,p*SPAN,false,0);}
  for(let k=0;k<B;k++){const dt=k/(B-1)*BLOOM;await render('b'+String(k).padStart(2,'0'),1,SPAN+dt,true,dt);}
  console.log(theme,scale+'x','total so far',(bytes/1048576).toFixed(2),'MB');
 }
 // Text layers: the same page with only the text, captured over black and over white; the difference gives exact alpha and colour (no halo).
 let tbytes=0;
 for(const theme of themes)for(const loc of SKIP_TEXT?[]:LOCS)for(const ts of (loc==='en'?TEXT_SCALES:OTHER_SCALES)){
  const STATES=STRINGS[loc].states,tag=loc==='en'?'':loc+'-';
  const pct=Math.round(ts*100),tw=Math.round(W*ts),th=Math.round(H*ts),y0=Math.round(220*ts),hh=Math.round(100*ts);
  win.setContentSize(tw,th);win.webContents.setZoomFactor(ts);await win.loadFile(concept,{query:{p:'0.5',t:'0',theme}});win.webContents.setZoomFactor(ts);
  await win.webContents.executeJavaScript('Promise.all([document.fonts.ready,window.ready]).then(()=>true)');await sleep(900);
  let cssKey=null;
  const shoot=async bg=>{ if(cssKey)await win.webContents.removeInsertedCSS(cssKey);cssKey=await win.webContents.insertCSS(textOnly.replace('BG',bg));await sleep(120);const img=await win.webContents.capturePage({x:0,y:y0,width:tw,height:hh});return {bmp:img.toBitmap(),size:img.getSize()}; };
  for(let n=0;n<STATES.length;n++){
   await win.webContents.executeJavaScript(`document.documentElement.lang=${JSON.stringify(STRINGS[loc].lang)};document.getElementById('title').textContent=${JSON.stringify(STATES[n][0])};document.getElementById('status').textContent=${JSON.stringify(STATES[n][1])};true`);
   const k=await shoot('#000'),w=await shoot('#fff'),{width,height}=k.size,out4=Buffer.alloc(width*height*4);
   for(let i=0;i<width*height;i++){const o=i*4;let d=0;for(let c=0;c<3;c++)d+=w.bmp[o+c]-k.bmp[o+c];const a=Math.max(0,Math.min(255,255-Math.round(d/3)));out4[o]=k.bmp[o];out4[o+1]=k.bmp[o+1];out4[o+2]=k.bmp[o+2];out4[o+3]=a;}
   const png=nativeImage.createFromBitmap(out4,{width,height}).toPNG();fs.writeFileSync(path.join(out,`${theme}-${tag}t${pct}-${n}.png`),png);tbytes+=png.length;
  }
 }
 console.log('frames',P,'+',B,'quality',quality,'total',(bytes/1048576).toFixed(2),'MB; text layers',(tbytes/1048576).toFixed(2),'MB');app.quit();
});
