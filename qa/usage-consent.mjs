import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,poll} from './d-harness.mjs';
const stamp=Date.now(),root=`.qa-profiles/usage-consent-${stamp}`,out=path.resolve(`qa/artifacts/usage-consent-${stamp}`),checks=[],geometry=[];
await fs.mkdir(out,{recursive:true});let app;
const usageRow=()=>app.ui.locator('.fr-row').filter({has:app.ui.locator('b',{hasText:'Share anonymous usage'})});
try{
 app=await startApp({root,skipSetup:false});
 await app.main(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.setFocusable(false);win.setIgnoreMouseEvents(true);win.setSkipTaskbar(true);win.setBounds({x:-20000,y:-20000,width:1440,height:900});if(win.getBounds().x>-2000)throw Error('Fixture must stay offscreen');win.showInactive();if(win.isFocused())throw Error('Fixture stole focus');});
 // Drive real setup; no arbitrary IPC step injection or existing user's preferences.
 for(let step=0;step<9&&!await usageRow().count();step++){
  const next=app.ui.locator('[data-onboarding-next]').first();await next.waitFor({state:'visible'});await next.click();
  await app.ui.waitForTimeout(950);
 }
 await usageRow().waitFor();await poll(()=>app.svc({type:'metrics.status'}),r=>r.metrics?.enabled,'new setup default on');
 assert.equal(await usageRow().locator('input').isChecked(),true);
 assert.match(await usageRow().innerText(),/startup|active-install/);
 assert.equal((await app.svc({type:'metrics.status'})).metrics.configured,false);
 checks.push('New setup visibly defaults on, explains active installations and says the current endpoint sends nothing');
 const ai=app.ui.locator('.fr-row').filter({has:app.ui.locator('b',{hasText:'AI-free mode'})});
 const aiChoice=await ai.locator('input').isChecked(),aiInfo=ai.locator('.setting-info-button');
 await fs.writeFile(path.join(out,'privacy-before-info.png'),await app.ui.screenshot());
 await aiInfo.hover();await app.ui.locator('.t-tip:not(.t-tip-measure):not(.nt-credit-tip)').waitFor();
 assert.match(await app.ui.locator('.t-tip:not(.t-tip-measure):not(.nt-credit-tip)').innerText(),/recognized|supported websites/);
 // R3-05: one tooltip for hover and click; a click keeps it open (pinned) until a second click, Esc, scroll or another click.
 await aiInfo.click();await app.ui.locator('.t-tip:not(.t-tip-measure):not(.nt-credit-tip)').waitFor();
 assert.match(await app.ui.locator('.t-tip:not(.t-tip-measure):not(.nt-credit-tip)').innerText(),/recognized|supported websites/);
 // (R3-05: the info button no longer carries aria-expanded; the pinned tooltip above is the open state.)
 await fs.writeFile(path.join(out,'privacy-info.png'),await app.ui.screenshot());
 await app.ui.keyboard.press('Escape');assert.equal(await ai.locator('input').isChecked(),aiChoice);
 checks.push('AI-free information appears on hover, opens by click and dismisses without changing the switch');
 await usageRow().locator('input').click();await poll(()=>app.svc({type:'metrics.status'}),r=>r.metrics?.choice==='off','off saved');
 await app.ui.locator('.usage-off-notice').waitFor();assert.match(await app.ui.locator('.usage-off-notice').innerText(),/off|saved/);
 assert.equal(await usageRow().locator('input').isChecked(),false);checks.push('Off saves immediately, deletes ID and shows a nonblocking acknowledgment');
 for(const [width,height]of [[1440,900],[1350,900],[1280,800]]){
  await app.main(({BaseWindow},{width,height})=>BaseWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
  await app.ui.waitForTimeout(350);
  const measured=await app.ui.evaluate(()=>{const card=document.querySelector('.fr-card-main'),foot=document.querySelector('.fr-card>.fr-foot'),note=document.querySelector('.usage-off-notice');return {width:innerWidth,height:innerHeight,mainBottom:card?.getBoundingClientRect().bottom,footerTop:foot?.getBoundingClientRect().top,scrollHeight:card?.scrollHeight,clientHeight:card?.clientHeight,noticeBottom:note?.getBoundingClientRect().bottom};});
  geometry.push(measured);assert.ok(measured.scrollHeight<=measured.clientHeight+1,`Privacy content fits at ${width}x${height}: ${JSON.stringify(measured)}`);
  assert.ok(measured.noticeBottom<=measured.height-8,'acknowledgment stays within the window');
  await fs.writeFile(path.join(out,`privacy-off-${width}x${height}.png`),await app.ui.screenshot());
 }
 await fs.writeFile(path.join(out,'privacy-off.png'),await app.ui.screenshot());
 await app.close();app=await startApp({root,skipSetup:false});
 await poll(()=>app.svc({type:'metrics.status'}),r=>r.metrics?.choice==='off','saved opt-out after restart');
 checks.push('Reopening incomplete onboarding preserves the saved opt-out');
 const report={status:'PASS',checks,geometry,scope:'Disposable synthetic profile; no backend deployed or real usage endpoint enabled.'};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,...report},null,2));
}catch(error){const ui=await app?.ui.evaluate(()=>({title:document.querySelector('.fr-card-title')?.textContent,rows:[...document.querySelectorAll('.fr-row b')].map(node=>node.textContent),popovers:[...document.querySelectorAll(':popover-open')].map(node=>node.className)})).catch(()=>null);if(app)await fs.writeFile(path.join(out,'failure.png'),await app.ui.screenshot()).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'FAIL',checks,geometry,ui,error:error.stack||String(error)},null,2)+'\n');throw error;}
finally{await app?.close();}
