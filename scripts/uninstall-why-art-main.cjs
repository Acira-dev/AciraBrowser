'use strict';
// Renders the art of the uninstall launcher's reason card (Beta 14, the plan: "optional one-tap reason") in the 12 languages Acira ships and English.
// The card is the question's card (packaging/installer/uninstall/dark-base5.jpg is shared, never rewritten here) with this language's title and one
// line of explanation over it and eight quiet buttons under them: the seven reasons the usage function accepts, then Skip. Like the question's art, the
// launcher embeds pictures, not text, so every language reads the same in Inter-free, font-independent pixels. Nothing of the existing art is touched:
// this script writes (and first removes) only the files with "why" in their name.
//   uninstall/dark-why-<lang>-t.png            title + explanation as a transparent PNG (matted over black and white: exact alpha), 200%, rows TEXT_Y0..TEXT_Y0+TEXT_H of the 1120 x 680 scene
//   uninstall/dark-why-<lang>-n-<i>.png        the eight buttons in their normal state as transparent PNGs (matted the same way, 200%); 0..6 are the reasons in codes order, 7 is Skip
//   uninstall/dark-why-<lang>-hover-<i>.png    the same in their hover state. They are layers, not crops of a picture, so they sit on the shared scene whatever machine drew them
//                                              (a crop would carry its own copy of the background and show as a box wherever the two differed by a level or two)
//   uninstall/why-layout-<lang>.txt            "<i> x y w h" in 560 x 340 logical pixels, then "rtl" for a right-to-left language
// Text: packaging/installer/why-strings.json. A label that does not fit its 120 px button at 10.5 px stops the run (shorten the sentence).
//   ACIRA_WHY_PREVIEWS=<dir> also writes one composed picture per language there (what the launcher draws, plus the hover of the first button).
//   node_modules/.bin/electron scripts/uninstall-why-art-main.cjs
const {app,BrowserWindow,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'packaging','installer','uninstall');
const WHY=JSON.parse(fs.readFileSync(path.join(root,'packaging','installer','why-strings.json'),'utf8')),LOCS=Object.keys(WHY).filter(k=>/^[a-z]{2}$/.test(k));
const concept=process.env.ACIRA_INSTALLER_CONCEPT||path.join(root,'docs','launch','concepts','installer-creation.html');
const previews=process.env.ACIRA_WHY_PREVIEWS?path.resolve(process.env.ACIRA_WHY_PREVIEWS):null;
const W=560,H=340,S=2,TEXT_Y0=380,TEXT_H=240,COLS=4,MIN_FONT=10.5; // the launcher draws the text layer at y = TEXT_Y0 (AciraUninstall.cs)
const baseHide='.track,.pct,.close,.side,.btn,.text{display:none!important}';
const chipsCss='.track,.pct,.close,.side,.btn:not(.why-btn){display:none!important}.q{position:absolute;left:28px;right:28px;bottom:20px;display:grid;grid-template-columns:repeat('+COLS+',1fr);gap:8px}.q .btn.text{height:28px;line-height:28px;padding:0 6px;text-align:center;overflow:hidden;white-space:nowrap;background:rgb(var(--line)/.05)}.why-btn.hv.text{color:rgb(var(--ink))!important;background:rgb(var(--line)/.10)!important}';
const textOnly='html,body{background:transparent!important}.win{background:BG!important;box-shadow:none!important;border:0!important}#art,.scrim,.track,.pct,.close,.side,.btn{display:none!important}.text{animation:none!important;opacity:1!important;transform:none!important;visibility:visible!important}';
const chipsOnly='html,body{background:transparent!important}.win{background:BG!important;box-shadow:none!important;border:0!important}#art,.scrim,.track,.pct,.close,.side,.btn:not(.why-btn),.text:not(.why-btn){display:none!important}.why-btn{transition:none!important;animation:none!important}';
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'acira-why-art-'))); // a throwaway profile: a stale page zoom from an earlier run would skew the render
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const f of fs.existsSync(out)?fs.readdirSync(out):[])if(/why/.test(f)&&/\.(jpg|png|txt)$/.test(f))fs.unlinkSync(path.join(out,f)); // regenerate only this card's files
fs.mkdirSync(out,{recursive:true});if(previews)fs.mkdirSync(previews,{recursive:true});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:W*S,height:H*S,useContentSize:true,frame:false,webPreferences:{offscreen:true,zoomFactor:S}});
 const wc=win.webContents,grab=()=>wc.capturePage({x:0,y:0,width:W*S,height:H*S});
 const open=async(lang,dir)=>{win.setContentSize(W*S,H*S);await win.loadFile(concept,{query:{p:'0.5',theme:'dark'}});await wc.executeJavaScript(`document.documentElement.lang=${JSON.stringify(lang)};document.documentElement.dir=${JSON.stringify(dir)}`);await wc.executeJavaScript('Promise.all([document.fonts.ready,window.ready]).then(()=>true)');await sleep(1500);};
 const base5=nativeImage.createFromPath(path.join(out,'dark-base5.jpg'));
 for(const loc of LOCS){
  const s=WHY[loc],labels=[...s.reasons,s.skip];
  if(s.reasons.length!==WHY.codes.length)throw new Error(`${loc}: ${s.reasons.length} reasons for ${WHY.codes.length} codes`);
  await open(s.lang,s.dir);
  await wc.insertCSS(chipsCss); // before the buttons exist, so the fit below measures them as drawn
  // the card: title and one line of explanation (it may wrap to a second line), the eight buttons under them; the text block's bottom edge is fixed, so it grows upward
  const placed=await wc.executeJavaScript(`(()=>{document.getElementById('title').textContent=${JSON.stringify(s.title)};const st=document.getElementById('status');st.textContent=${JSON.stringify(s.status)};st.style.whiteSpace='normal';
   const c=document.querySelector('.copy');c.style.bottom='92px';const q=document.createElement('div');q.className='q';
   ${JSON.stringify(labels)}.forEach((t,i)=>{const b=document.createElement('button');b.className='btn text q-btn why-btn';b.textContent=t;b.dataset.i=i;q.appendChild(b)});document.getElementById('win').appendChild(q);
   const sizes=[];for(const b of q.children){let px=13;b.style.fontSize=px+'px';while(b.scrollWidth>b.clientWidth&&px>${MIN_FONT}){px-=0.25;b.style.fontSize=px+'px';}sizes.push([b.textContent,px,b.scrollWidth>b.clientWidth]);}
   const smallest=Math.min(...sizes.map(x=>x[1]));for(const b of q.children)b.style.fontSize=smallest+'px'; // one size for the whole card, the smallest any label needed
   const w=document.getElementById('win').getBoundingClientRect(),r=document.querySelector('.text').getBoundingClientRect();
   return {text:[Math.round(r.left-w.left),Math.round(r.top-w.top),Math.round(r.width),Math.round(r.height)],sizes,rects:[...q.children].map(b=>{const r=b.getBoundingClientRect();return [Math.round(r.left-w.left),Math.round(r.top-w.top),Math.round(r.width),Math.round(r.height)]})};})()`);
  const tooWide=placed.sizes.filter(x=>x[2]);if(tooWide.length)throw new Error(`${loc}: does not fit a button at ${MIN_FONT}px: ${tooWide.map(x=>x[0]).join(', ')}`);
  const [,ty,,th]=placed.text;if(ty*S<TEXT_Y0||(ty+th)*S>TEXT_Y0+TEXT_H)throw new Error(`${loc}: the text block is outside the layer rows: ${placed.text}`);
  if(ty+th>placed.rects[0][1]-4)throw new Error(`${loc}: the text block touches the buttons: text ends at ${ty+th}, buttons start at ${placed.rects[0][1]}`);
  console.log(loc,'text',JSON.stringify(placed.text),'smallest label',Math.min(...placed.sizes.map(x=>x[1])),'px');
  await sleep(600);
  // text alpha: the same page with only the text, over black and over white; the difference is exact alpha and colour
  const shoot=async bg=>{const css=await wc.insertCSS(textOnly.replace('BG',bg));await sleep(150);const img=await grab();await wc.removeInsertedCSS(css);return img.toBitmap();};
  const k=await shoot('#000'),w=await shoot('#fff'),width=W*S,rows=TEXT_H,o=Buffer.alloc(width*rows*4);
  for(let y=0;y<rows;y++)for(let x=0;x<width;x++){const i=((TEXT_Y0+y)*width+x)*4,j=(y*width+x)*4;let d=0;for(let c=0;c<3;c++)d+=w[i+c]-k[i+c];const a=Math.max(0,Math.min(255,255-Math.round(d/3)));o[j]=k[i];o[j+1]=k[i+1];o[j+2]=k[i+2];o[j+3]=a;}
  fs.writeFileSync(path.join(out,`dark-why-${loc}-t.png`),nativeImage.createFromBitmap(o,{width,height:rows}).toPNG());
  // the buttons, normal and hover, each as a transparent layer: the same page with only the buttons, over black and over white
  await sleep(900);
  const rects=await wc.executeJavaScript(`(()=>{const w=document.getElementById('win').getBoundingClientRect();return [...document.querySelectorAll('.why-btn')].map(b=>{const r=b.getBoundingClientRect();return [Math.round(r.left-w.left),Math.round(r.top-w.top),Math.round(r.width),Math.round(r.height)]});})()`);
  const layer=(blk,wht,[x,y,bw,bh])=>{const L=Buffer.alloc(bw*S*bh*S*4);for(let yy=0;yy<bh*S;yy++)for(let xx=0;xx<bw*S;xx++){const i=((y*S+yy)*W*S+(x*S+xx))*4,j=(yy*bw*S+xx)*4;let d=0;for(let c=0;c<3;c++)d+=wht[i+c]-blk[i+c];const a=Math.max(0,Math.min(255,255-Math.round(d/3)));L[j]=blk[i];L[j+1]=blk[i+1];L[j+2]=blk[i+2];L[j+3]=a;}return L;};
  const chipShoot=async bg=>{const css=await wc.insertCSS(chipsOnly.replace('BG',bg));await sleep(150);const img=await grab();await wc.removeInsertedCSS(css);return img.toBitmap();};
  const layers={n:[],hover:[]};
  for(const state of ['n','hover']){
   for(let i=0;i<rects.length;i++){
    await wc.executeJavaScript(`document.querySelectorAll('.why-btn').forEach((b,j)=>b.classList.toggle('hv',${state==='hover'}&&j===${i}))`);await sleep(120);
    const blk=await chipShoot('#000'),wht=await chipShoot('#fff'),L=layer(blk,wht,rects[i]);layers[state].push(L);
    fs.writeFileSync(path.join(out,`dark-why-${loc}-${state}-${i}.png`),nativeImage.createFromBitmap(L,{width:rects[i][2]*S,height:rects[i][3]*S}).toPNG());
   }
  }
  await wc.executeJavaScript("document.querySelectorAll('.why-btn').forEach(b=>b.classList.remove('hv'))");
  if(previews){ // what the launcher draws: the shared scene, this language's text layer, the eight buttons (and the first one hovered), all composed the way AciraUninstall.cs does
   const compose=hoverIndex=>{const bmp=Buffer.from(base5.toBitmap());const over=(L,x,y,lw,lh)=>{for(let yy=0;yy<lh;yy++)for(let xx=0;xx<lw;xx++){const j=(yy*lw+xx)*4,i=((y+yy)*W*S+(x+xx))*4,a=L[j+3];if(!a)continue;for(let c=0;c<3;c++)bmp[i+c]=Math.min(255,L[j+c]+Math.round(bmp[i+c]*(255-a)/255));bmp[i+3]=255;}};
    over(o,0,TEXT_Y0,W*S,TEXT_H);rects.forEach((r,i)=>over((i===hoverIndex?layers.hover:layers.n)[i],r[0]*S,r[1]*S,r[2]*S,r[3]*S));return nativeImage.createFromBitmap(bmp,{width:W*S,height:H*S}).toPNG();};
   fs.writeFileSync(path.join(previews,`why-${loc}.png`),compose(-1));fs.writeFileSync(path.join(previews,`why-${loc}-hover.png`),compose(0));
  }
  fs.writeFileSync(path.join(out,`why-layout-${loc}.txt`),rects.map((r,i)=>[i,...r].join(' ')).join('\n')+'\n'+(s.dir==='rtl'?'rtl\n':''));
 }
 app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
