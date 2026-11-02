import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import{createRequire}from'node:module';
import{startApp,sleep}from'./d-harness.mjs';
const require=createRequire(import.meta.url),stamp=Date.now(),out=path.resolve('qa/artifacts/light-tab-selection-'+stamp),root=path.resolve('.qa-profiles/light-tab-selection-'+stamp);
await fs.mkdir(out,{recursive:true});await fs.mkdir(root,{recursive:true});
const{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,makeTab}=require('../desktop/runtime.cjs'),s=createInitialState();
s.tabs=Array.from({length:4},(_,i)=>makeTab('tone-'+i,['Selected page','Another page','Third page','Last page'][i],'acira://new',s.activeBrowserProfileId));s.activeTabId='tone-0';
Object.assign(s.settings,{onboardingComplete:true,askBeforeClosing:false,reducedMotion:false,animationSpeed:'fast',appearance:'light',compactTabTitles:true});
Object.assign(s.windowUi,{view:'full',workspaceOpen:true});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',s);db.close();
const report={passed:false,platform:process.platform,cases:[],errors:[]};let app;
const shot=async name=>{const png=await app.main(async({webContents})=>(await webContents.getAllWebContents().find(w=>w.getURL()==='acira-browser-ui://ui/index.html').capturePage()).toPNG().toString('base64'));await fs.writeFile(path.join(out,name+'.png'),Buffer.from(png,'base64'));};
const paint=locator=>locator.evaluate(n=>{const c=getComputedStyle(n);return{color:c.color,background:c.backgroundColor,outline:c.outline,shadow:c.boxShadow,selection:getSelection()?.toString(),vars:Object.fromEntries(['--frame-selection-bg','--frame-selection-fg','--tab-selection-fg','--surface','--text','--sb-current','--sb-current-fg'].map(k=>[k,c.getPropertyValue(k).trim()])),text:n.textContent.slice(0,90)};});
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve('desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});app.ui.setDefaultTimeout(7000);app.ui.on('pageerror',e=>report.errors.push(String(e)));
 await app.main(({BaseWindow,screen})=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'));w.setBounds({x:-17000,y:100,width:1280,height:850});w.showInactive();w.isFocused=()=>true;screen.getCursorScreenPoint=()=>{const b=w.getContentBounds();return{x:b.x+900,y:b.y+500};};});
 for(const appearance of ['light','dark'])for(const preset of [{colorPreset:'Porcelain',browserTint:'#eef0f3',accentColor:'#487667'},{colorPreset:'Alpine Green',browserTint:'#07523d',accentColor:'#487667'},{colorPreset:'Ocean Blue',browserTint:'#99c9e8',accentColor:'#266a98'}])for(const mode of ['sidebar','compact','full']){
  const name=appearance+'-'+preset.colorPreset.replaceAll(' ','-')+'-'+mode;
  await app.act({type:'settings.update',patch:{...preset,appearance,verticalTabs:mode==='sidebar'}});await app.act({type:'ui.update',patch:{view:mode==='compact'?'compact':'full',workspaceOpen:mode==='sidebar'}});await app.act({type:'tab.select',id:'tone-0'});await app.ui.mouse.move(1000,600);await sleep(380);
  const selector=mode==='sidebar'?'.sb-tab':mode==='compact'?'.acira-compact-tab':'.browser-tab',row=app.ui.locator(selector+'[data-tab-id="tone-0"]:visible').first();await row.waitFor();
  const entry={name,selected:await paint(row)};const selection=app.ui.locator(mode==='compact'?'.acira-compact-selection':'.tab-strip-selection');if(mode!=='sidebar'&&await selection.count())entry.plate=await paint(selection.first());
  const box=await row.boundingBox(),grab={x:box.x+Math.min(12,box.width/3),y:box.y+box.height/2};entry.box=box;entry.interaction=await row.evaluate(n=>({events:getComputedStyle(n).pointerEvents,inert:n.inert,ancestors:[...function*(n){while(n){yield n;n=n.parentElement;}}(n)].map(n=>({tag:n.tagName,cls:n.className,events:getComputedStyle(n).pointerEvents,inert:n.inert}))}));entry.hit=await app.ui.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML.slice(0,250),grab);await app.ui.mouse.move(grab.x,grab.y);await sleep(80);await app.ui.mouse.down();
  for(let i=1;i<=8;i++){await app.ui.mouse.move(grab.x+i*5,grab.y+(mode==='sidebar'?i*4:0));await sleep(18);}await sleep(120);
  const ghost=app.ui.locator(mode==='sidebar'?'.sidebar-tab-drag-preview':'.tab-drag-preview');if(await ghost.count())entry.drag=await paint(ghost.first());entry.dragSource=await paint(row);await shot(name);await app.ui.mouse.up();await sleep(450);report.cases.push(entry);
  if(appearance==='light'){
   assert.ok(entry.selected.color.match(/[\d.]+/g).slice(0,3).every(x=>Number(x)<40),name+' selected text stays dark on its raised card: '+entry.selected.color);
   if(mode==='sidebar')assert.equal(entry.selected.background,'rgb(255, 255, 255)');
   if(mode==='compact')assert.equal(entry.plate.background,'rgb(255, 255, 255)');
   if(entry.drag)assert.equal(entry.drag.color,'rgb(28, 29, 33)',name+' drag text follows the card, not the frame');
  }
  if(entry.drag)assert.equal(entry.drag.selection,'','Dragging rows never produces native blue text selection');
  console.log('PASS '+name,JSON.stringify({ink:entry.selected.color,dragInk:entry.drag?.color,dragFill:entry.drag?.background}));
 }
 assert.equal(report.errors.length,0,report.errors.join('\n'));report.passed=true;
}finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log('RESULT '+out);await app?.close();}
