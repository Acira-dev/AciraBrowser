import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,sleep} from './d-harness.mjs';
const out=path.resolve(process.argv[2]);await fs.mkdir(out,{recursive:true});
const edge=await fs.readFile('qa/m-edge-scan.js','utf8'),clip=await fs.readFile('qa/m-clip-scan.js','utf8');
const app=await startApp({root:'.qa-profiles/a-newtab-'+Date.now(),env:{ACIRA_BROWSER_TEST_HIDDEN:'0'}}),report=[];
const shot=async name=>{const data=await app.main(async({BaseWindow,desktopCapturer})=>{const w=BaseWindow.fromId(globalThis.__qaTargetWindow),s=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1440,height:900}});return s.find(s=>s.id===w.getMediaSourceId()).thumbnail.toPNG().toString('base64');});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(data,'base64'));};
const inspect=()=>{
 const page=document.querySelector('.nt-page'),rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
 const rgba=s=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=s;ctx.fillRect(0,0,1,1);const p=[...ctx.getImageData(0,0,1,1).data];return[p[0],p[1],p[2],p[3]/255];};
 const over=(f,b)=>f.slice(0,3).map((v,i)=>v*f[3]+b[i]*(1-f[3]));
 const lum=c=>c.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
 const full=page.dataset.style==='full'&&page.dataset.art==='on',colors=[];
 for(const [selector,pseudo] of [['.nt-title'],['.nt-caption h1'],['.nt-search input','::placeholder'],['.nt-tile-label'],['.nt-key'],['.nt-hint > span:first-child']]){
  const n=page.querySelector(selector);if(!n||!n.getClientRects().length)continue;
  const c=getComputedStyle(n,pseudo),chain=[];for(let p=n;p&&p!==page;p=p.parentElement)chain.push(getComputedStyle(p).backgroundColor);
  let bg=full?[229.5,229.5,229.5]:rgba(getComputedStyle(page).backgroundColor).slice(0,3);
  for(const color of chain.reverse())bg=over(rgba(color),bg);
  const fg=over(rgba(c.color),bg),a=lum(fg),b=lum(bg);colors.push({selector,pseudo,color:c.color,background:getComputedStyle(n).backgroundColor,contrastFloor:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),basis:full?'brightest artwork with minimum existing 10% scrim':'painted page',font:c.fontSize});
 }
 const search=page.querySelector('.nt-search'),stack=page.querySelector('.nt-stack'),tiles=page.querySelector('.nt-tiles'),scroll=page.querySelector('.nt-scroll');
 return{style:page.dataset.style,art:page.dataset.art,colors,search:search?rect(search):null,stack:stack?rect(stack):null,tiles:tiles?rect(tiles):null,alignment:search&&stack?Math.abs((search.getBoundingClientRect().left+search.getBoundingClientRect().right-stack.getBoundingClientRect().left-stack.getBoundingClientRect().right)/2):null,tileStackOverflow:tiles&&stack?[...tiles.children].filter(n=>n.getBoundingClientRect().left<stack.getBoundingClientRect().left-1||n.getBoundingClientRect().right>stack.getBoundingClientRect().right+1).length:0,scroll:scroll?{width:scroll.clientWidth,contentWidth:scroll.scrollWidth}:null,tileOverflow:tiles?[...tiles.children].filter(n=>n.getBoundingClientRect().left<page.getBoundingClientRect().left||n.getBoundingClientRect().right>page.getBoundingClientRect().right).length:0,key:page.querySelector('.nt-key')?{padding:getComputedStyle(page.querySelector('.nt-key')).padding,height:page.querySelector('.nt-key').getBoundingClientRect().height}:null};
};
try{
 await app.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];globalThis.__qaTargetWindow=w.id;w.setBounds({x:60,y:40,width:1440,height:900});w.showInactive();});
 const state=await app.state(),profile=state.activeBrowserProfileId;await app.act({type:'browser.profile.rename',id:profile,name:'Research workspace with a long name'});
 await app.act({type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false}});
 for(const scale of [100,150])for(const appearance of ['light','dark'])for(const variant of (process.env.A_VARIANTS?.split(',')||['framed','full','hidden','narrow','full-narrow','tiles-off','search-off','minimal','full-opaque'])){
  const name=`${appearance}-${scale}-${variant}`;
  await app.main(({BaseWindow},narrow)=>BaseWindow.fromId(globalThis.__qaTargetWindow).setBounds({x:60,y:40,width:narrow?900:1440,height:narrow?600:900}),variant.includes('narrow'));
  await app.act({type:'settings.update',patch:{appearance,interfaceScale:scale,verticalTabs:false,reducedTransparency:variant==='full-opaque'}});
  await app.ui.evaluate(({profile,variant})=>{const key='acira-new-tab:'+profile;localStorage.setItem(key,JSON.stringify({version:crypto.randomUUID(),artStyle:['full','full-narrow','tiles-off','search-off','full-opaque'].includes(variant)?'full':'framed',artwork:'met-436535',modules:{name:variant!=='minimal',mark:variant!=='minimal',search:!['search-off','minimal'].includes(variant),artwork:!['hidden','minimal'].includes(variant),shortcuts:!['tiles-off','minimal'].includes(variant),saved:false,recent:false},shortcuts:Array.from({length:8},(_,i)=>({id:'proof-'+i,title:'Research reference with a long label '+i,url:'https://reference'+i+'.example.test/',start:true,sidebar:false}))}));window.dispatchEvent(new StorageEvent('storage',{key}));},{profile,variant});
  await app.ui.mouse.move(10,150);await sleep(750);await app.ui.evaluate(edge);
  const data=await app.ui.evaluate(inspect),edgeHits=await app.ui.evaluate(()=>window.__edge.static().filter(h=>h.box?.includes('nt-')));
  const clipping=await app.ui.evaluate(clip),actualClip=await app.ui.evaluate(()=>[...document.querySelectorAll('.nt-page *')].filter(n=>n.clientWidth>0&&[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim())&&n.scrollWidth>n.clientWidth+1&&['hidden','clip'].includes(getComputedStyle(n).overflowX)&&getComputedStyle(n).textOverflow!=='ellipsis').map(n=>({selector:n.className,text:n.textContent,scroll:n.scrollWidth,width:n.clientWidth})));await shot(name);
  report.push({name,...data,edge:edgeHits,actualClip,clip:clipping});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 }
 console.log(JSON.stringify(report.map(r=>({name:r.name,contrast:r.colors.map(c=>[c.selector,+c.contrastFloor.toFixed(2)]),tileOverflow:r.tileOverflow,scroll:r.scroll,edge:r.edge,clip:r.clip}))));
}finally{await app.close();}
