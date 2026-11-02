'use strict';
// Renders the art of the uninstall launcher (packaging/installer/acira-uninstall.exe) from the installer design concept.
// One text-free scene per light level is shared by every language; each language adds small layers drawn over it (this is what keeps a language
// at a few hundred KB instead of four full scenes):
//   uninstall/<theme>-base5.jpg, <theme>-base9.jpg      scene without any text or buttons at 200% (5 = question/removing, 9 = removed)
//   uninstall/<theme>-<lang>-t<scene>.png               title + status of scene q/r/k/d as transparent PNG (matted over black and white: exact alpha), 200%,
//                                                       rows TEXT_Y0..TEXT_Y0+TEXT_H of the 1120 x 680 scene
//   uninstall/<theme>-<lang>-n-<i>.jpg                  the three buttons of the question in their normal state (cropped, 200%)
//   uninstall/<theme>-<lang>-hover-<i>.jpg              the same in their hover state
//   uninstall/layout.txt (English) / layout-<lang>.txt  button rectangles in 560 x 340 logical pixels: "<n> x y w h"
// English files have no language tag. The launcher composes the four scenes at start-up and swaps in the hover crops.
//   node_modules/electron/dist/electron.exe scripts/uninstall-art-main.cjs
const {app,BrowserWindow,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'packaging','installer','uninstall');
for(const f of fs.existsSync(out)?fs.readdirSync(out):[])if(/\.(jpg|png|txt)$/.test(f))fs.unlinkSync(path.join(out,f)); // regenerate the whole set
fs.mkdirSync(out,{recursive:true});
const concept=process.env.ACIRA_INSTALLER_CONCEPT||path.join(root,'docs','launch','concepts','installer-creation.html');
const W=560,H=340,S=2,TEXT_Y0=380,TEXT_H=240; // the launcher draws the text layers at y = TEXT_Y0 (see AciraUninstall.cs)
const baseHide='.track,.pct,.close,.side,.btn,.text{display:none!important}';
const hide='.track,.pct,.close,.side,.btn:not(.q-btn){display:none!important}.q{position:absolute;left:28px;bottom:26px;display:flex;gap:8px;align-items:center}.q .btn.text{height:32px;line-height:32px}body .q-btn.danger{color:#ff6b6b!important}body.theme-light .q-btn.danger{color:#c42b1c!important}.q-btn.danger.hv.text{color:#ff6b6b!important;background:rgba(255,107,107,.12)!important}body.theme-light .q-btn.danger.hv.text{color:#c42b1c!important;background:rgba(196,43,28,.08)!important}.q-btn.hv.primary{background:var(--btn-hover)!important}.q-btn.hv.text{color:rgb(var(--ink))!important;background:rgb(var(--line)/.06)!important}';
const textOnly='html,body{background:transparent!important}.win{background:BG!important;box-shadow:none!important;border:0!important}#art,.scrim,.track,.pct,.close,.side,.btn{display:none!important}.text{animation:none!important;opacity:1!important;transform:none!important;visibility:visible!important}';
const STRINGS=JSON.parse(fs.readFileSync(path.join(root,'packaging','installer','strings.json'),'utf8')),LOCS=Object.keys(STRINGS).filter(k=>k!=='note');
const sceneFor=loc=>{const u=STRINGS[loc].uninstall;return {q:{p:.5,title:u.q[0],status:u.q[1],buttons:true},r:{p:.5,title:u.r[0],status:u.r[1]},k:{p:.9,title:u.k[0],status:u.k[1]},d:{p:.9,title:u.d[0],status:u.d[1]}};};
app.commandLine.appendSwitch('force-device-scale-factor','1');
// a throwaway profile: Chromium remembers page zoom per origin, and a stale zoom from an earlier run skews the render
app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'acira-art-')));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:W*S,height:H*S,useContentSize:true,frame:false,webPreferences:{offscreen:true,zoomFactor:S}}); // zoomFactor here applies to every load; setZoomFactor after navigation does not
 const wc=win.webContents,grab=()=>wc.capturePage({x:0,y:0,width:W*S,height:H*S});
 const open=async(theme,p,lang)=>{win.setContentSize(W*S,H*S);await win.loadFile(concept,{query:{p:String(p),theme}});await wc.executeJavaScript(`document.documentElement.lang=${JSON.stringify(lang)}`);await wc.executeJavaScript('Promise.all([document.fonts.ready,window.ready]).then(()=>true)');await sleep(1500);};
 const diff=(a,b)=>{const x=a.toBitmap(),y=b.toBitmap();let n=0,max=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);if(d>2)n++;if(d>max)max=d;}return {pixelsOver2:n,max};};
 for(const theme of ['dark']){
  // 1. the shared text-free scenes
  const bases={};
  for(const [name,p] of [['5',.5],['9',.9]]){
   await open(theme,p,'en');const css=await wc.insertCSS(baseHide);await sleep(900);
   const image=await grab();bases[name]=image;fs.writeFileSync(path.join(out,`${theme}-base${name}.jpg`),image.toJPEG(90));console.log(`${theme}-base${name}.jpg`);
   await wc.removeInsertedCSS(css);
  }
  // 2. per language: text layers, buttons
  for(const loc of LOCS){
   const tag=loc==='en'?'':loc+'-',SCENES=sceneFor(loc),lang=STRINGS[loc].lang;let layout=[];
   for(const [key,sc] of Object.entries(SCENES)){
    await open(theme,sc.p,lang);
    const setText=`(()=>{document.getElementById('title').textContent=${JSON.stringify(sc.title)};document.getElementById('status').textContent=${JSON.stringify(sc.status)};${sc.buttons?"document.querySelector('.copy').style.bottom='84px';":''}const w=document.getElementById('win').getBoundingClientRect(),r=document.querySelector('.text').getBoundingClientRect();return [Math.round(r.left-w.left),Math.round(r.top-w.top),Math.round(r.width),Math.round(r.height)];})()`;
    const textRect=await wc.executeJavaScript(setText);
    if(textRect[1]*S<TEXT_Y0||(textRect[1]+textRect[3])*S>TEXT_Y0+TEXT_H)throw new Error(`text block ${loc}/${key} outside the layer rows: ${textRect}`);
    // text alpha: the same page with only the text, over black and over white; the difference is exact alpha and colour
    const shoot=async bg=>{const css=await wc.insertCSS(textOnly.replace('BG',bg));await sleep(150);const img=await grab();await wc.removeInsertedCSS(css);return img.toBitmap();};
    const k=await shoot('#000'),w=await shoot('#fff'),width=W*S,rows=TEXT_H,o=Buffer.alloc(width*rows*4);
    for(let y=0;y<rows;y++)for(let x=0;x<width;x++){const i=((TEXT_Y0+y)*width+x)*4,j=(y*width+x)*4;let d=0;for(let c=0;c<3;c++)d+=w[i+c]-k[i+c];const a=Math.max(0,Math.min(255,255-Math.round(d/3)));o[j]=k[i];o[j+1]=k[i+1];o[j+2]=k[i+2];o[j+3]=a;}
    fs.writeFileSync(path.join(out,`${theme}-${tag}t${key}.png`),nativeImage.createFromBitmap(o,{width,height:rows}).toPNG());
    if(!sc.buttons)continue;
    // the question's buttons (normal and hover), cropped from the full scene; layout in logical pixels
    await open(theme,sc.p,lang);await wc.insertCSS(hide);
    const rects=await wc.executeJavaScript(`(()=>{document.getElementById('title').textContent=${JSON.stringify(sc.title)};document.getElementById('status').textContent=${JSON.stringify(sc.status)};const c=document.querySelector('.copy');c.style.bottom='84px';const q=document.createElement('div');q.className='q';${JSON.stringify(STRINGS[loc].labels)}.forEach((t,i)=>{const b=document.createElement('button');b.className='btn q-btn '+(i===2?'primary':i===1?'text danger':'text');b.textContent=t;b.dataset.i=i;q.appendChild(b)});document.getElementById('win').appendChild(q);const w=document.getElementById('win').getBoundingClientRect();return [...document.querySelectorAll('.q-btn')].map(b=>{const r=b.getBoundingClientRect();return [Math.round(r.left-w.left),Math.round(r.top-w.top),Math.round(r.width),Math.round(r.height)]});})()`);
    await sleep(900);layout=rects;
    const full=await grab();
    // the shared scene must match this render where the buttons sit (same art every load), else the crops would show as boxes
    {const bg=await (async()=>{const css=await wc.insertCSS(baseHide+'.q{display:none!important}');await sleep(200);const im=await grab();await wc.removeInsertedCSS(css);return im;})();const d=diff(bg,bases['5']);console.log(loc,'art vs shared base',JSON.stringify(d));}
    for(let i=0;i<rects.length;i++){const [x,y,bw,bh]=rects[i];fs.writeFileSync(path.join(out,`${theme}-${tag}n-${i}.jpg`),full.crop({x:x*S,y:y*S,width:bw*S,height:bh*S}).toJPEG(92));}
    for(let i=0;i<rects.length;i++){
     await wc.executeJavaScript(`document.querySelectorAll('.q-btn').forEach((b,j)=>b.classList.toggle('hv',j===${i}))`);await sleep(250);
     const hv=await grab(),[x,y,bw,bh]=rects[i];
     fs.writeFileSync(path.join(out,`${theme}-${tag}hover-${i}.jpg`),hv.crop({x:x*S,y:y*S,width:bw*S,height:bh*S}).toJPEG(92));
    }
   }
   fs.writeFileSync(path.join(out,loc==='en'?'layout.txt':`layout-${loc}.txt`),layout.map((r,i)=>[i,...r].join(' ')).join('\n')+'\n');console.log(loc,'layout',JSON.stringify(layout));
  }
 }
 app.quit();
});
