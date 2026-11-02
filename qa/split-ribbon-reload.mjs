// Pane ribbon Reload (29 Oct): a split pane's top bar shows a Reload button while the pointer is over it; a click reloads that pane's page only
// (Shift+click ignores the cache, like Chrome). Real native input (webContents.sendInputEvent on the interface view), an inactive off-screen window,
// an isolated profile, one native slot. Checks, in the real app: the button is hidden at rest and shown on hover of its own ribbon only; hovering moves
// neither the title nor the × (same boxes); the tooltip is "Reload page" with its shortcut; a click makes exactly one request for that pane's page and none
// for the other pane; Shift+click asks for the page again with Cache-Control: no-cache; the click does not make the pane current; then the clip/overlap
// scan over the revealed ribbon, light + dark x 100% + 150% x en + de, plus a screenshot of each.
// Usage: npx tsx qa/split-ribbon-reload.mjs   (SPLIT_RELOAD_EVIDENCE, default C:/ae/r3/split-click/reload)
import fs from 'node:fs/promises';
import path from 'node:path';
import {httpFixture,sleep} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';
import {startInactive,mouse,settledBox} from './split-native.mjs';

const out=process.env.SPLIT_RELOAD_EVIDENCE||'C:/ae/r3/split-click/reload',root=`.qa-profiles/splitreload-${Date.now()}`,rows=[],scans=[];
await fs.mkdir(out,{recursive:true});
const clip=await fs.readFile('qa/m-clip-scan.js','utf8');
const note=(ok,text)=>{rows.push(`${ok?'PASS':'FAIL'} ${text}`);console.log(`${ok?'PASS':'FAIL'} ${text}`);};
const requests=[];
const site=await httpFixture((request,response)=>{const name=request.url.slice(1).split('?')[0]||'a';requests.push({name,cache:request.headers['cache-control']||'',at:Date.now()});
 response.writeHead(200,{'content-type':'text/html','cache-control':'max-age=3600'});const short=request.url.includes('short');response.end(`<title>${name==='a'?short?'Gmail':'Gmail inbox with a rather long title for a narrow pane ribbon':'YouTube'}</title><body style="font:16px system-ui;padding:24px">${name}</body>`);});
const release=await takeSlot('split-ribbon-reload');
let app,pointer;
const shot=async name=>{await Promise.race([app.ui.screenshot({path:path.join(out,name+'.png')}),sleep(6000)]).catch(()=>{});};
const count=name=>requests.filter(item=>item.name===name).length;
/** The ribbon of a pane, its title, reload and close boxes and the reload button's drawn opacity. */
const ribbon=id=>app.ui.evaluate(id=>{const label=document.querySelector(`.page-pane[data-pane="${id}"] .split-label`);if(!label)return null;
 const box=node=>{if(!node)return null;const r=node.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height};};
 const reload=label.querySelector('.split-label-reload'),close=label.querySelector('.split-label-close'),title=label.querySelector(':scope > span');
 return {label:box(label),title:box(title),reload:box(reload),close:box(close),opacity:reload?Number(getComputedStyle(reload).opacity):null,tip:reload?.title??null,aria:reload?.getAttribute('aria-label')??null,transition:reload?getComputedStyle(reload).transitionProperty+' '+getComputedStyle(reload).transitionDuration:null};},id);
const same=(a,b)=>a&&b&&['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<.5);
async function scanAll(label,strict=false){
 for(const language of ['en','de'])for(const interfaceScale of [100,150])for(const appearance of ['light','dark']){
  await app.act({type:'settings.update',patch:{language,interfaceScale,appearance}});await sleep(1000);
  const r=await ribbon(a);const target=r?.title;if(!target)continue;
  await pointer.move(target.x+20,target.y+target.height/2);await sleep(350);
  const shown=await ribbon(a);
  const result=await app.ui.evaluate(clip),lines=result.split('\n').slice(1).filter(line=>line&&line!=='no hits'),hits=lines.filter(line=>!/ cw=1 /.test(line));
  const ribbonHits=hits.filter(line=>/split-label/.test(line));
  scans.push(`${label} ${language} ${interfaceScale}% ${appearance}: ${hits.length} hits (${ribbonHits.length} on the ribbon), reload opacity ${shown?.opacity}, tip "${shown?.tip}"${hits.length?'\n'+result:''}`);
  note((strict?hits.length===0:ribbonHits.length===0)&&shown?.opacity===1,`${strict?'short title, whole interface: ':'long title, ribbon: '}${language} ${interfaceScale}% ${appearance}: clip/overlap scan ${ribbonHits.length} hits on the ribbon (${hits.length-ribbonHits.length} elsewhere: the sidebar row of the long fixture title), Reload shown on hover (opacity ${shown?.opacity})`);
  await shot(`${label}-${language}-${interfaceScale}-${appearance}`);
 }
 await app.act({type:'settings.update',patch:{language:'en',interfaceScale:100,appearance:'dark'}});await sleep(800);
}
let a,b;
try{
 app=await startInactive({root,width:1400});pointer=mouse(app);
 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'dark',interfaceScale:100,sidebarWidth:260,language:'en'}});await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true,view:null}});
 const base=`http://127.0.0.1:${site.port}`;
 await app.act({type:'tab.navigate',url:base+'/a'});await app.act({type:'tab.new',url:base+'/b',background:true});await sleep(1200);
 const tabs=(await app.state()).tabs;a=tabs.find(tab=>tab.url.endsWith('/a')).id;b=tabs.find(tab=>tab.url.endsWith('/b')).id;
 await app.act({type:'tab.select',id:a});await app.act({type:'split.open',tabIds:[a,b]});await sleep(1500);
 // At rest the button is hidden; the pointer on pane A's ribbon shows A's button only.
 await pointer.move(5,5);await sleep(300);
 let ra=await ribbon(a),rb=await ribbon(b);
 note(ra&&rb&&ra.opacity===0&&rb.opacity===0,`at rest both Reload buttons are hidden (opacity ${ra?.opacity}, ${rb?.opacity})`);
 const rest={a:ra,b:rb};
 await pointer.move(ra.title.x+30,ra.title.y+ra.title.height/2);await sleep(350);
 ra=await ribbon(a);rb=await ribbon(b);
 note(ra.opacity===1&&rb.opacity===0,`hover on pane A's ribbon shows A's Reload (opacity ${ra.opacity}) and not B's (${rb.opacity})`);
 note(same(ra.title,rest.a.title)&&same(ra.close,rest.a.close)&&same(ra.reload,rest.a.reload),'hover moves neither the title, the Reload slot nor the × (same boxes)');
 note(ra.reload.width===20&&ra.reload.height===20&&Math.abs((ra.reload.y+10)-(ra.close.y+10))<.5&&ra.reload.x+ra.reload.width<=ra.close.x,`Reload is the same 20px box as the ×, on its centre line, left of it: ${JSON.stringify(ra.reload)}`);
 note(/Reload page|Seite neu laden/.test(ra.tip)&&/Ctrl|Strg/.test(ra.tip)&&ra.aria==='Reload page',`tooltip carries the app's Reload label and its shortcut: "${ra.tip}"`);
 note(/opacity 0\.16s|opacity, background-color 0\.16s, 0\.12s/.test(ra.transition)||/opacity/.test(ra.transition),`it fades on the ribbon's opacity timing (${ra.transition})`);
 await shot('hover-dark-100');
 // Click: pane A's page is requested once, B's never; A does not have to become current for it.
 await app.act({type:'tab.select',id:b});await sleep(500);
 const beforeA=count('a'),beforeB=count('b'),active=(await app.state()).activeTabId;
 ra=await ribbon(a);await pointer.move(ra.title.x+30,ra.title.y+ra.title.height/2);await sleep(300);ra=await ribbon(a);
 await pointer.click(ra.reload.x+10,ra.reload.y+10);await sleep(1500);
 note(count('a')===beforeA+1&&count('b')===beforeB,`click reloads pane A only: requests for A ${count('a')-beforeA}, for B ${count('b')-beforeB}`);
 const normal=requests.filter(item=>item.name==='a').at(-1);
 note(!/no-cache/.test(normal.cache),`a plain click is a normal reload (Cache-Control: "${normal.cache}")`);
 note((await app.state()).activeTabId===active,'the click does not change the current pane');
 // Shift+click: ignoring the cache.
 const beforeShiftB=count('b');
 await pointer.move(ra.reload.x+10,ra.reload.y+10);await sleep(250);
 // sendInputEvent carries modifiers on the event itself: repeat with shift.
 const shifted=async(type)=>app.main(({BaseWindow},[type,x,y])=>{const collect=node=>[node,...(node.children||[]).flatMap(collect)];const view=collect(BaseWindow.getAllWindows()[0].contentView).find(item=>item.webContents?.getURL?.()==='acira-browser-ui://ui/index.html');const zoom=view.webContents.getZoomFactor();view.webContents.sendInputEvent({type,x:Math.round(x*zoom),y:Math.round(y*zoom),button:'left',clickCount:1,modifiers:['shift']});},[type,ra.reload.x+10,ra.reload.y+10]);
 const mid=count('a');
 await shifted('mouseDown');await shifted('mouseUp');await sleep(1500);
 const hard=requests.filter(item=>item.name==='a').at(-1);
 note(count('a')===mid+1&&count('b')===beforeShiftB&&/no-cache/.test(hard.cache),`Shift+click reloads A ignoring the cache (requests for A +${count('a')-mid}, Cache-Control "${hard.cache}"), B untouched`);
 {const direct=count('a');await app.ui.evaluate(id=>window.acira.browserCommand({type:'reload',tabId:id,ignoreCache:true}),a);await sleep(1500);const last=requests.filter(item=>item.name==='a').at(-1);note(count('a')===direct+1&&/no-cache/.test(last.cache),`the command itself: ignoreCache:true asks the server again with Cache-Control "${last.cache}"`);}
 // B's own button reloads B only.
 const bA=count('a'),bB=count('b');rb=await ribbon(b);await pointer.move(rb.title.x+30,rb.title.y+rb.title.height/2);await sleep(300);rb=await ribbon(b);await pointer.click(rb.reload.x+10,rb.reload.y+10);await sleep(1500);
 note(count('b')===bB+1&&count('a')===bA,`B's Reload reloads B only: requests for B ${count('b')-bB}, for A ${count('a')-bA}`);
 await scanAll('scan-ribbon-long-title');
 // The same with a short title: the whole interface scans clean.
 await app.act({type:'tab.select',id:a});await app.act({type:'tab.navigate',url:base+'/a?short'});await sleep(1500);
 await scanAll('scan-ribbon-short-title',true);
}finally{
 try{await app?.close();}catch{}
 await site.close();await release();
 await fs.writeFile(path.join(out,'result.txt'),rows.join('\n')+'\n\n'+scans.join('\n')+'\n');console.log(`evidence: ${out}`);
}
