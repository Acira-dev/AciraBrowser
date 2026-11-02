// Isolated native UI checks. Never installs extensions or opens a real profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startApp, sleep, poll, httpFixture } from './d-harness.mjs';
process.env.D_VISIBLE = '1'; // toolbar and popup motion needs frames: a hidden window renders them in bursts, so a position measured mid-glide is not where the popup will anchor

const resultRoot = path.resolve('qa/artifacts/profile-menu-forms');
const out = path.join(resultRoot,`run-${Date.now()}`);
await fs.mkdir(out, {recursive:true});
let app,fixture;
const results = [];
const fixturePath = fileURLToPath(import.meta.url);
const sha256 = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
let identity = {fixture:{path:fixturePath,sha256:await sha256(fixturePath)}};
async function report(error) {
  const value={status:error?'failed':'passed',passed:results.length,expected:4,results,artifacts:out,identity,...(error?{error:String(error.stack||error)}:{})};
  const body=JSON.stringify(value,null,2);
  await fs.writeFile(path.join(out,'results.json'),body);
  await fs.writeFile(path.join(resultRoot,'results.json'),body);
}
const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
const overlay = () => app.context.pages().find(page => page.url().includes('view=overlay'));
async function close() { const current = (await layout()).overlay; if (current) await app.ui.evaluate(id => window.acira.closeOverlay(id), current.id); await sleep(240); }
async function opened(kind) { await poll(async () => (await layout()).overlay?.kind, value => value === kind, kind); await sleep(350); return overlay(); }
async function open(kind, anchor) { await close(); const state = await app.state(); await app.cmd({type:'ui',tabId:state.activeTabId,action:'open',kind,anchor}); return opened(kind); }
async function capture(page, name) {
  const data = await app.main(async ({webContents}, url) => {
    const target = webContents.getAllWebContents().find(w => w.getURL() === url);
    return (await target.capturePage()).toPNG().toString('base64');
  }, page.url());
  await fs.writeFile(path.join(out, name+'.png'), Buffer.from(data,'base64'));
}
async function nativeKey(keyCode, modifiers=[]) {
  await app.main(({webContents}, {keyCode,modifiers}) => {
    const target = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay'));
    target.sendInputEvent({type:'keyDown',keyCode,modifiers}); target.sendInputEvent({type:'keyUp',keyCode,modifiers});
  }, {keyCode,modifiers});
}

/** Waits on state, never on a delay: the first element of `selector` (in `page`) that is visible (and not inert) is also still, that is its box is identical
 *  over three consecutive animation frames and nothing on it is animating. A toolbar glide or a popup entrance runs on a spring, so a fixed sleep either
 *  measures it mid-flight or waits for nothing. On timeout the poll error carries what was last seen (moved from/to, animations running, nothing visible). */
async function settled(page, selector, label, timeout = 10000) {
  return poll(() => page.evaluate(selector => new Promise(resolve => {
    const el = [...document.querySelectorAll(selector)].find(node => node.checkVisibility({visibilityProperty:true,opacityProperty:true}) && !node.closest('[inert]'));
    if (!el) return resolve({ok:false,why:'no visible element for '+selector});
    const key = () => { const r = el.getBoundingClientRect(); return [r.x,r.y,r.width,r.height].map(n => Math.round(n*100)/100).join(); };
    const first = key(); let frames = 0;
    const next = () => { frames++; const now = key(); if (now !== first) return resolve({ok:false,why:'moved '+first+' -> '+now}); if (frames < 3) return requestAnimationFrame(next); const running = el.getAnimations({subtree:true}).filter(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity).length; resolve(running ? {ok:false,why:running+' animations running'} : {ok:true,frames}); };
    requestAnimationFrame(next);
  }), selector).catch(error => ({ok:false,why:String(error.message||error).slice(0,120)})), value => value.ok === true, label + ' settled', timeout);
}

try {
  app = await startApp({root:`.qa-profiles/profile-menu-forms-${Date.now()}`});
  const target = await app.main(({app})=>({executable:process.execPath,appPath:app.getAppPath()}));
  identity = {...identity,target:{...target,sha256:await sha256(target.executable),packaged:Boolean(process.env.D_APP_EXE)}};
  fixture=await httpFixture((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Local material texture</title><body style="margin:0;min-height:100vh;background:repeating-linear-gradient(90deg,#c62828 0 120px,#1565c0 120px 240px,#1b5e20 240px 360px);color:white;font:40px system-ui">Local material texture</body>');});
  const fixtureURL=`http://127.0.0.1:${fixture.port}/`;
  await app.act({type:'tab.navigate',url:fixtureURL});await app.waitWeb(fixtureURL);await sleep(400);
  for (const appearance of ['light','dark']) for (const scale of [100,150]) {
    const tag = `${appearance}-${scale}`;
    await close();
    await app.main(({BaseWindow}, width) => BaseWindow.getAllWindows()[0].setBounds({x:20,y:20,width,height:800}), scale===100?1280:960);
    await app.act({type:'settings.update',patch:{appearance,interfaceScale:scale,verticalTabs:false,toolbarLayout:'expanded',language:'en'}});
    await sleep(400);
    const button = app.ui.locator('.toolbar-optional-profile').filter({visible:true}).first();
    assert.equal(await button.count(),1,'enabled profile is a direct toolbar control');
    {
      const source = await button.boundingBox(); await button.click(); await opened('profile');
      const p = (await layout()).overlay;
      assert.ok(Math.abs(p.anchor.x-source.x)<2 && Math.abs(p.anchor.y-source.y)<2, 'profile uses clicked toolbar anchor');
      assert.equal(p.origin.y,0);
      const avatar = await button.locator('.profile-avatar').evaluate(el => {const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {w:r.width,h:r.height,outline:s.outlineStyle};});
      const hit=await button.evaluate(el=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height};});
      assert.ok(Math.abs(avatar.w-20)<1&&Math.abs(avatar.h-20)<1); assert.equal(avatar.outline,'none');
      assert.ok(Math.abs(hit.w-28)<1&&Math.abs(hit.h-28)<1);
      await close();
    }
    await app.act({type:'settings.update',patch:{verticalTabs:true}});
    /* R4 toolbar fit: 960 DIP at 150% is 640 CSS px. With the sidebar open that row has no room, so every optional action, the avatar too, moves into the » menu
       (src/ui/toolbarFit.ts; the sidebar foot keeps the profile). The direct-avatar anchoring is only checked where the row has the room for it. */
    const roomForAvatar = (await app.ui.evaluate(() => innerWidth)) >= 900;
    if (!roomForAvatar) {
      await settled(app.ui,'.sb-foot-profile','sidebar profile '+tag);
      await poll(()=>app.ui.locator('.toolbar-optional-profile').filter({visible:true}).count(),value=>value===0,'narrow sidebar row moves the avatar into the » menu');
    } else {
    /* the toolbar glides to its sidebar-mode place on a spring: wait until the avatar is visible and has stopped before measuring where the popup must anchor */
    try { await settled(app.ui,'.toolbar-optional-profile','toolbar avatar '+tag); }
    catch (error) { const seen = await app.ui.evaluate(() => ({viewport:[innerWidth,innerHeight],profile:[...document.querySelectorAll('.toolbar-optional-profile,.toolbar-overflow-profile,.sb-foot-profile')].map(el => ({cls:el.className,box:[el.getBoundingClientRect().x,el.getBoundingClientRect().y,el.getBoundingClientRect().width,el.getBoundingClientRect().height].map(Math.round),visible:el.checkVisibility({visibilityProperty:true,opacityProperty:true})})),items:[...document.querySelectorAll('[data-toolbar-item]')].map(el => el.dataset.toolbarItem+':'+(el.checkVisibility()?'v':'h'))})).catch(() => null); throw new Error(error.message+' | '+JSON.stringify(seen)); }
    const sidebarToolbarProfile=app.ui.locator('.toolbar-optional-profile').filter({visible:true}).first();
    assert.equal(await sidebarToolbarProfile.count(),1,'sidebar layout keeps direct toolbar avatar');
    const directSource=await sidebarToolbarProfile.boundingBox();await sidebarToolbarProfile.click();await opened('profile');
    const directProfile=(await layout()).overlay;
    assert.ok(Math.abs(directProfile.anchor.x-directSource.x)<2&&Math.abs(directProfile.anchor.y-directSource.y)<2,'sidebar-mode toolbar avatar anchors directly');
    await capture(app.ui,`${tag}-direct-profile-icon`);await close();
    }
    const sidebar = app.ui.locator('.sb-foot-profile').filter({visible:true}).first();
    const source = await sidebar.boundingBox(); await sidebar.click(); await opened('profile');
    const profile = (await layout()).overlay;
    assert.ok(Math.abs(profile.anchor.x-source.x)<2 && Math.abs(profile.anchor.y-source.y)<2, 'profile uses clicked sidebar anchor');
    assert.equal(profile.origin.y,1);
    assert.ok(profile.bounds.y+profile.bounds.height<=source.y);
    await capture(overlay(),`${tag}-profile`);
    await close();
    await app.act({type:'settings.update',patch:{verticalTabs:false}});
    await sleep(300);
    for(const [toolbarLayout,patch] of [['compact',{windowView:'compact'}],['expanded',{windowView:'full',toolbarLayout:'expanded'}]]){ /* Compact is a Window view now; toolbarLayout is expanded or automatic */
      await app.act({type:'settings.update',patch});await sleep(450);
      assert.equal(await app.ui.locator('.toolbar-optional-profile').filter({visible:true}).count(),1,`${toolbarLayout} keeps direct profile icon`);
    }
    await app.act({type:'ui.update',patch:{focusMode:true}});await sleep(250);
    assert.equal(await app.ui.locator('.toolbar-menu-control').filter({visible:true}).count(),1,'focus mode keeps the Acira menu button (R3-65: it keeps the address field and the essentials, not every toolbar icon)');
    await app.act({type:'ui.update',patch:{focusMode:false}});await sleep(450);
    assert.equal(await app.ui.locator('.toolbar-optional-profile').filter({visible:true}).count(),1,'leaving focus mode brings the direct profile icon back');
    const viewport = await app.ui.evaluate(()=>({width:innerWidth,height:innerHeight}));
    const page = await open('extensions',{x:viewport.width-70,y:60,width:28,height:28});
    await poll(()=>page.locator('.extension-panel').getAttribute('aria-busy'), value=>value==='false','extensions ready');
    /* The panel settles on its measured height after it is ready (the estimate is replaced by the natural height and the popup re-anchors, 155 -> 155.33 DIP at 150%):
       take the primary coordinates once the host's bounds have stopped changing (three identical reads), not at the first ready frame. */
    { let last = '', same = 0; await poll(async () => { const now = JSON.stringify((await layout()).overlay?.bounds); same = now === last && now ? same + 1 : 0; last = now; return same >= 3; }, Boolean, 'primary panel bounds settled', 8000); }
    const primary = (await layout()).overlay.bounds;
    const trigger = page.locator('.menu-form-trigger').filter({hasText:'Add from a Web Store link'});
    await page.evaluate(()=>{window.__formFrames=[];window.__formInputAt=performance.now();document.addEventListener('click',()=>{window.__formInputAt=performance.now();},{once:true,capture:true});let frames=0;const next=()=>{const el=document.querySelector('.menu-form-flyout');if(el&&el.checkVisibility({visibilityProperty:true,opacityProperty:true}))window.__formFrames.push({material:el.dataset.formMaterial,time:performance.now()});if(++frames<90)requestAnimationFrame(next);};requestAnimationFrame(next);});
    await trigger.click();
    await poll(async()=>(await layout()).overlay?.auxiliaryBounds,Boolean,'child host bounds');
    const form = page.locator('.menu-form-flyout'); await form.waitFor({state:'visible'});
    assert.deepEqual((await layout()).overlay.bounds,primary,'opening form preserves primary panel coordinates');
    const measured = await form.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,side:el.dataset.placement,scroll:el.scrollHeight,client:el.clientHeight};});
    assert.ok(measured.x>=0&&measured.y>=0&&measured.x+measured.w<=viewport.width+1&&measured.y+measured.h<=viewport.height+1);
    assert.equal(measured.side,scale===150?'replace':'left');
    assert.equal(await form.getAttribute('data-form-material'),'captured','native child uses decoded website pixels');
    const firstMaterial=await page.evaluate(()=>window.__formFrames[0]);
    assert.equal(firstMaterial?.material,'captured','captured material contributes from the first visible child frame');
    const firstVisibleMs=await page.evaluate(()=>window.__formFrames[0].time-window.__formInputAt);
    const texture=await form.locator('canvas').evaluate(el=>{const values=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let low=255,high=0;for(let i=0;i<values.length;i+=160){low=Math.min(low,values[i]);high=Math.max(high,values[i]);}return high-low;});
    assert.ok(texture>30,'owned child canvas contains textured page pixels');
    const hostBounds = await app.main(({BaseWindow}) => {
      const find = node => { for (const child of node.children || []) { if (child.webContents?.getURL?.().includes('view=overlay')) return node.getBounds(); const found=find(child); if(found)return found; } };
      return find(BaseWindow.getAllWindows()[0].contentView);
    });
    assert.ok(hostBounds && hostBounds.x<=measured.x*scale/100+1 && hostBounds.x+hostBounds.width>=(measured.x+measured.w)*scale/100-1,'native input host includes child form');
    const input = form.locator('input'); assert.equal(await input.evaluate(el=>document.activeElement===el),true,'form opens with field focus'); await input.fill('not-a-store-link');
    await form.getByRole('button',{name:'Add',exact:true}).click();
    await form.locator('[role=alert]').waitFor(); assert.equal(await input.getAttribute('aria-invalid'),'true');
    assert.equal((await app.ui.evaluate(async()=>{const s=await window.acira.getSnapshot();return window.acira.extensions({type:'list',profileId:s.activeBrowserProfileId});})).extensions.length,0,'invalid input installs nothing');
    await capture(page,`${tag}-extension-form`);
    await nativeKey('Escape');
    await poll(()=>form.count(),n=>n===0,'Escape closes child');
    assert.equal((await layout()).overlay?.kind,'extensions','Escape keeps parent');
    await poll(async()=>(await layout()).overlay?.auxiliaryBounds,value=>!value,'child input area clears');
    assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,'Escape returns focus');
    await nativeKey('Right'); await form.waitFor({state:'visible'});
    await nativeKey('Escape'); await poll(()=>form.count(),n=>n===0,'keyboard child closes');
    await nativeKey('Escape'); await poll(async()=>(await layout()).overlay,value=>!value,'second Escape closes parent');
    const contextPage=await open('extensions',{x:viewport.width-70,y:60,width:28,height:28});
    await poll(()=>contextPage.locator('.extension-panel').getAttribute('aria-busy'),value=>value==='false','context fixture extensions ready');
    await contextPage.locator('.menu-form-trigger').filter({hasText:'Add from a Web Store link'}).click();
    await poll(async()=>(await layout()).overlay?.auxiliaryBounds,Boolean,'context child host ready');
    await contextPage.evaluate(()=>{window.__retiredChildFrames=[];let frames=0;const next=()=>{const child=document.querySelector('.menu-form-flyout'),owner=document.querySelector('.sheet-popup');if(child&&owner&&(owner.hasAttribute('data-preparing')||owner.inert||getComputedStyle(owner).visibility==='hidden'))window.__retiredChildFrames.push({visible:child.checkVisibility({visibilityProperty:true,opacityProperty:true}),interactive:!child.inert});if(++frames<45)requestAnimationFrame(next);};requestAnimationFrame(next);});
    // The context change is another popup taking the owner's place (the Extensions popup is one of the few that stays open when a tab opens, so a tab is not the owner's context).
    await app.cmd({type:'ui',tabId:(await app.state()).activeTabId,action:'open',kind:'profile',anchor:{x:viewport.width-120,y:60,width:28,height:28}});
    await poll(()=>contextPage.locator('.menu-form-flyout').count(),value=>value===0,'context change retires child portal');
    await poll(async()=>(await layout()).overlay?.auxiliaryBounds,value=>!value,'retired child clears native bounds');
    const retiredFrames=await contextPage.evaluate(()=>window.__retiredChildFrames);
    assert.ok(retiredFrames.every(frame=>!frame.visible&&!frame.interactive),'no visible or interactive child survives a hidden owner');
    await close();
    await app.ui.evaluate(()=>window.dispatchEvent(new CustomEvent('acira-study-bookmark-menu',{detail:{url:'node:root',anchor:{x:100,y:120,width:2,height:2}}})));
    await opened('bookmark-context');
    const folderTrigger=overlay().locator('.menu-form-trigger').filter({hasText:'New folder'});
    await folderTrigger.click();
    const folderForm=overlay().locator('.menu-form-flyout');
    await folderForm.locator('input').fill(`Folder ${tag}`);
    await folderForm.locator('button[type=submit]').click();
    await poll(async()=>(await app.state()).bookmarkNodes.some(node=>node.title===`Folder ${tag}`),Boolean,'folder persists through native command');
    await close();
    const current = await app.state();
    await app.act({type:'tab.group.create',tabId:current.activeTabId,name:`Group ${tag}`,color:'blue'});
    const grouped = await app.state(), group = grouped.tabGroups.find(item=>item.name===`Group ${tag}`);
    assert.ok(group);
    await app.cmd({type:'ui',tabId:grouped.activeTabId,action:'open',kind:'group-context',targetTabId:grouped.activeTabId});
    await opened('group-context');
    const groupTrigger = overlay().locator('.menu-form-trigger').filter({hasText:`Edit Group ${tag}`});
    await groupTrigger.click();
    const groupForm = overlay().locator('.menu-form-flyout'), groupInput = groupForm.locator('input');
    await groupInput.fill('Unsaved name');
    await nativeKey('Escape');
    await poll(()=>groupInput.inputValue(),value=>value===group.name,'first Escape reverts group name');
    assert.equal(await groupForm.count(),1,'first Escape leaves editor open');
    await nativeKey('Escape');
    await poll(()=>groupForm.count(),value=>value===0,'second Escape dismisses group editor');
    assert.equal((await layout()).overlay?.kind,'group-context');
    await groupTrigger.click();
    await groupInput.fill(`Renamed ${tag}`); await groupInput.press('Tab');
    await poll(async()=>(await app.state()).tabGroups.find(item=>item.id===group.id)?.name,value=>value===`Renamed ${tag}`,'group name saves on blur');
    await groupForm.getByRole('button',{name:'Grey group color',exact:true}).click();
    await poll(async()=>(await app.state()).tabGroups.find(item=>item.id===group.id)?.color,value=>value==='grey','group color changes immediately');
    await groupForm.getByRole('button',{name:'Done',exact:true}).click();
    await poll(()=>groupForm.count(),value=>value===0,'Done dismisses child form');
    await close();
    const customizer=await open('customize-toolbar',{x:viewport.width-70,y:60,width:28,height:28});
    // A popup that takes the place of another keeps the leaving scene's copy for a moment (inert, tabindex -1): the live row is the first.
    await settled(customizer,'[data-item="profile"] input[type=checkbox]','customise checkbox (profile)');
    await customizer.locator('[data-item="profile"] input[type=checkbox]').first().uncheck();
    await poll(()=>app.ui.locator('.toolbar-optional-profile,.toolbar-overflow-profile').count(),value=>value===0,'explicit profile:false hides direct and fallback controls');
    await close();await app.ui.reload();
    await poll(()=>app.ui.locator('.toolbar-actions').count(),Boolean,'toolbar reload');
    assert.equal(await app.ui.locator('.toolbar-optional-profile,.toolbar-overflow-profile').count(),0,'profile off survives renderer reload');
    const restored=await open('customize-toolbar',{x:viewport.width-70,y:60,width:28,height:28});
    await settled(restored,'[data-item="profile"] input[type=checkbox]','customise checkbox (profile, restore)');
    await restored.locator('[data-item="profile"] input[type=checkbox]').first().check();await close();
    await poll(()=>app.ui.locator('.toolbar-optional-profile').filter({visible:true}).count(),value=>value===1,'profile can be explicitly restored');
    results.push({appearance,scale,placement:measured.side,material:'captured',firstVisibleMaterial:firstMaterial.material,firstVisibleMs,textureRange:texture,passed:true});
  }
  await report();
  console.log(JSON.stringify({passed:results.length,results}));
} catch(error) {
  await report(error);
  throw error;
} finally { if(app){await close().catch(()=>{});await app.close();}await fixture?.close(); }
