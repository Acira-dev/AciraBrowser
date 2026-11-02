import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';

const stamp=Date.now(),root=`.qa-profiles/persistent-splits-${stamp}`,out=path.resolve(`qa/artifacts/persistent-splits-${stamp}`),checks=[];
await fs.mkdir(out,{recursive:true});
const passed=message=>{checks.push(message);console.log('PASS '+message);};
const site=await httpFixture((request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(`<title>Split ${request.url.slice(1)}</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:${request.url==='/one'?'#deeadf':'#e9e2d7'};font:28px system-ui"><main>Local split fixture ${request.url}</main>`);});
let app=await startApp({root}),artifactRuntime;
const parent=()=>app.ui.locator('.split-group-sidebar .split-group-open');
const stripTab=id=>app.ui.locator(`.tabs-strip .browser-tab[data-tab-id="${id}"]`);
const sidebarTab=id=>app.ui.locator(`.sb-tabs .sb-tab[data-tab-id="${id}"] .sb-tab-main`);
const show=()=>app.main(({BaseWindow})=>{const window=BaseWindow.getAllWindows()[0];window.setFocusable(false);window.setIgnoreMouseEvents(true);window.setSkipTaskbar(true);window.setBounds({x:-20000,y:-20000,width:1500,height:960});if(window.getBounds().x>-2000)throw Error('Fixture must stay offscreen');window.showInactive();if(window.isFocused())throw Error('Fixture stole focus');});
async function beginDrag(locator,active){
 await locator.scrollIntoViewIfNeeded();await sleep(600);
 const expected=await locator.evaluate(node=>node.closest('[data-tab-id]').dataset.tabId);
 const box=await locator.boundingBox();assert.ok(box);const point={x:box.x+Math.min(30,box.width/3),y:box.y+box.height/2};
 await app.ui.mouse.move(point.x,point.y);
 assert.equal(await app.ui.evaluate(point=>document.elementFromPoint(point.x,point.y)?.closest('[data-tab-id]')?.getAttribute('data-tab-id'),point),expected,'pointer must hit the intended settled source row');
 await app.ui.mouse.down();await sleep(80);assert.equal((await app.state()).activeTabId,active,'pointerdown must not activate inactive source');
}
async function dragToPicker(locator,active,cellIndex,name){
 await beginDrag(locator,active);
 const page=await app.ui.locator('.page-area').boundingBox();
 await app.ui.mouse.move(page.x+page.width*.55,page.y+page.height*.4,{steps:12});
 await app.ui.locator('.split-picker-card').waitFor();
 const cell=app.ui.locator('.split-picker-thumb').first().locator('.split-picker-cell').nth(cellIndex),box=await cell.boundingBox();assert.ok(box);
 await app.ui.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:6});
 await poll(()=>cell.getAttribute('data-hover'),Boolean,'picker zone');
 // R3-25: the card is real glass (a live blur that keeps the page's colour, over a translucent tint, with a hairline and a layered shadow); the veil only frosts the sharp stills under it.
 const material=await app.ui.locator('.split-picker-card').evaluate(node=>{const style=getComputedStyle(node),alpha=/\/\s*([\d.]+)\)|rgba\([^)]*,\s*([\d.]+)\)/.exec(style.backgroundColor);return {blur:style.backdropFilter,shadow:style.boxShadow,tint:alpha?Number(alpha[1]??alpha[2]):1,veil:getComputedStyle(document.querySelector('.split-picker-veil')).backdropFilter,opaque:!!node.closest('.opaque-glass')};});
 if(material.opaque){assert.equal(material.blur,'none');assert.equal(material.veil,'none');}else{assert.match(material.blur,/blur\(/);assert.match(material.blur,/saturate\(/);assert.ok(material.tint<.8,`the card tint must be translucent, got alpha ${material.tint}`);assert.match(material.veil,/blur\(/);}
 assert.notEqual(material.shadow,'none');
 await sleep(220);await app.ui.screenshot({path:path.join(out,name+'.png')});
 assert.equal((await app.state()).activeTabId,active,'dragging must preserve the original page until the drop commits');
 await app.ui.mouse.up();
}
try{
 await show();
 const a=(await app.state()).activeTabId;
 await app.act({type:'tab.navigate',url:`http://127.0.0.1:${site.port}/one`});
 for(const page of ['two','three','four','five'])await app.act({type:'tab.new',url:`http://127.0.0.1:${site.port}/${page}`,background:true});
 const [,b,c,d,e]=(await app.state()).tabs.map(tab=>tab.id);
 await poll(app.state,state=>state.tabs.every(tab=>!tab.loading),'local pages loaded');
 await dragToPicker(stripTab(b),a,1,'dark-strip-picker');
 let state=await poll(app.state,state=>state.windowUi.split?.tabIds.length===2,'strip drag creates split'),group=state.windowUi.splitGroups[0].id;
 assert.deepEqual(state.windowUi.split.tabIds,[a,b]);assert.ok([a,b].includes(state.activeTabId));
 passed('Inactive strip pointerdown preserves the active page; real drag creates a saved split with house glass and no page-wide blur');

 await stripTab(c).click();await poll(app.state,state=>!state.windowUi.split,'unrelated tab selected');
 const stripParent=app.ui.locator('.tabs-strip .split-group-open');await stripParent.click();
 await poll(app.state,state=>state.windowUi.split?.groupId===group,'parent restores split');
 await stripTab(b).click();await poll(app.state,state=>!state.windowUi.split&&state.activeTabId===b,'child opens alone');
 assert.equal((await app.state()).windowUi.splitGroups[0].id,group);
 await stripParent.click();
 const disclosure=app.ui.locator('.tabs-strip .split-group-disclosure');await disclosure.click();
 await poll(()=>stripTab(b).count(),count=>count===0,'collapsed children hidden');await disclosure.click();await stripTab(b).waitFor();
 await beginDrag(stripTab(c),(await app.state()).activeTabId);
 const parentBox=await stripParent.boundingBox();await app.ui.mouse.move(parentBox.x+parentBox.width/2,parentBox.y+parentBox.height/2,{steps:12});await app.ui.mouse.up();
 state=await poll(app.state,state=>state.windowUi.split?.tabIds.length===3,'drop onto saved split parent');assert.equal(state.windowUi.split.groupId,group);
 passed('Strip parent/child/disclosure navigation preserves membership and accepts another tab without changing parent identity');

 await app.act({type:'settings.update',patch:{verticalTabs:true,appearance:'light',reducedMotion:true,reducedTransparency:true}});
 await app.act({type:'ui.update',patch:{workspaceOpen:true,webWorkspaceOpen:true}});
 await sidebarTab(d).waitFor();
 await dragToPicker(sidebarTab(d),(await app.state()).activeTabId,3,'light-sidebar-picker');
 state=await poll(app.state,state=>state.windowUi.split?.tabIds.length===4,'sidebar drag adds fourth pane');assert.equal(state.windowUi.split.groupId,group);
 await app.act({type:'settings.update',patch:{interfaceScale:150}});
 await beginDrag(sidebarTab(e),state.activeTabId);
 const box=await parent().boundingBox();await app.ui.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:12});await app.ui.mouse.up();
 await poll(app.state,state=>/two to four/.test(state.toast?.text||''),'max four is explicit');
 assert.equal((await app.state()).windowUi.splitGroups[0].tabIds.length,4);
 await app.act({type:'split.resize',cols:[.4,.6],rows:[.6,.4]});
 await sidebarTab(e).click();await poll(app.state,state=>!state.windowUi.split,'leave split intact');
 await app.ui.screenshot({path:path.join(out,'light-sidebar-parent.png')});
 passed('Sidebar drag adds the fourth pane; parent drop explains the four-tab limit and leaving preserves the arrangement');

 await app.close();app=await startApp({root});await show();await parent().waitFor();
 state=await app.state();assert.equal(state.windowUi.split,null);assert.equal(state.windowUi.splitGroups[0].id,group);
 await parent().click();state=await poll(app.state,state=>state.windowUi.split?.tabIds.length===4,'restart parent restore');
 assert.deepEqual(state.windowUi.split.cols,[.4,.6]);assert.deepEqual(state.windowUi.split.rows,[.6,.4]);
 await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()),layout=>layout.views.length===4,'native four-pane geometry');
 for(const id of [d,c,b])await app.act({type:'tab.close',id});
 state=await poll(app.state,state=>!state.windowUi.splitGroups?.length,'one remaining child dissolves parent');assert.equal(state.windowUi.split,null);
 passed('Full restart restores the saved layout and ratios; closing members retiles and dissolves a one-child parent');

 const privateUrl=`http://127.0.0.1:${site.port}/private-split-marker`;
 await app.act({type:'tab.new',privacy:'private',url:privateUrl});const privateId=(await app.state()).activeTabId;
 await app.act({type:'split.open',tabIds:[a,privateId]});
 state=await poll(app.state,state=>state.windowUi.split?.tabIds.includes(privateId),'real private split');
 const privateGroup=state.windowUi.split.groupId;
 assert.equal(await parent().getAttribute('aria-description'),'Not saved');
 artifactRuntime=await app.main(({app})=>{
  const path=process.mainModule.require('node:path'),fs=process.mainModule.require('node:fs'),appRoot=fs.realpathSync(app.getAppPath());
  const file=[path.join(appRoot,'runtime.cjs'),path.join(appRoot,'desktop','runtime.cjs')].map(candidate=>{try{return fs.statSync(candidate).isFile()?fs.realpathSync(candidate):null;}catch{return null;}}).find(candidate=>candidate&&candidate.startsWith(appRoot+path.sep));
  if(!file)throw Error('The tested application has no runtime.cjs inside its own app root');
  const runtime=process.mainModule.require(file);
  let fixture=runtime.createInitialState();const regular=fixture.activeTabId;
  fixture=runtime.reduceBrowser(fixture,{type:'tab.new',privacy:'tor',url:'https://tor-split-marker.invalid/'});const torId=fixture.activeTabId;
  fixture=runtime.reduceBrowser(fixture,{type:'split.open',tabIds:[regular,torId]});const torGroup=fixture.windowUi.split.groupId,publicJson=JSON.stringify(runtime.persistedSnapshot(fixture));
  for(const marker of [torId,torGroup,'tor-split-marker.invalid'])if(publicJson.includes(marker))throw Error(`Artifact Tor serialization leaked ${marker}`);
  return {file,appRoot,packaged:app.isPackaged};
 });
 await app.close();
 const db=new DatabaseSync(path.resolve(root,'browser.sqlite'),{readOnly:true});
 try{const json=db.prepare('SELECT payload FROM windows WHERE id=?').get('main')?.payload;assert.equal(typeof json,'string','native main window must have a physical SQL payload');for(const marker of [privateId,privateGroup,privateUrl])assert.ok(!json.includes(marker),`private marker persisted in raw SQL: ${marker}`);}finally{db.close();}
 passed('Real private split is marked Not saved and leaves no member/group/URL in persisted window; tested artifact runtime Tor serialization also strips every marker');
 console.log(JSON.stringify({ok:true,checks,out,artifactRuntime},null,2));
}catch(error){
 await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error.stack||error),state:await app.state().catch(()=>null),dom:await app.ui.locator('body').innerText().catch(()=>null)},null,2));
 await app.ui.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
 throw error;
}finally{await app.close();await site.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks,artifactRuntime},null,2));}
