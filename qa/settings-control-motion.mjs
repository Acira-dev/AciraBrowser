// Real-app regression for overlapping Settings disclosures and misplaced select
// portals. Uses only a disposable QA profile; never attaches to a user's window.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,sleep} from './d-harness.mjs';

const output=path.resolve(process.env.ACIRA_SETTINGS_MOTION_OUT||'.qa-profiles/settings-motion-evidence');
await fs.mkdir(output,{recursive:true});
const results=[];
let app;
try {
  app=await startApp({root:'.qa-profiles/settings-control-motion-'+Date.now(),env:{ACIRA_TEST_QUIET_NETWORK:'1'}});
  await app.main(({BaseWindow})=>BaseWindow.getAllWindows()[0].setBounds({x:40,y:30,width:1352,height:900}));
  await app.act({type:'tab.new',url:'acira://settings'});
  for(const [appearance,interfaceScale,animationSpeed] of [['dark',100,'premium'],['light',150,'premium'],['light',100,'fast'],['dark',100,'off']]) {
    const tag=`${appearance}-${interfaceScale}-${animationSpeed}`;
    if(process.env.ACIRA_SETTINGS_MOTION_CASE&&process.env.ACIRA_SETTINGS_MOTION_CASE!==tag)continue;
    await app.act({type:'settings.update',patch:{appearance,interfaceScale,animationSpeed:animationSpeed==='off'?'premium':animationSpeed,reducedMotion:animationSpeed==='off',language:'en',verticalTabs:true,bookmarksBar:false}});
    await app.ui.locator('.bs-sidebar nav button[aria-label="Appearance"]').click();
    await sleep(700);
    const summary=app.ui.locator('[data-group="menu-customize-group"] summary');
    await summary.scrollIntoViewIfNeeded();await sleep(180);
    const frames=await app.ui.evaluate(async()=>{
      const group=document.querySelector('[data-group="menu-customize-group"]'),details=group.querySelector('details'),summary=details.querySelector('summary');
      details.open=false;
      await new Promise(resolve=>setTimeout(resolve,350));
      const frames=[],start=performance.now();
      summary.click();
      const toggles=[90,160,450];let next=0;
      do {
        await new Promise(requestAnimationFrame);
        const t=performance.now()-start;
        if(next<toggles.length&&t>=toggles[next]){summary.click();next++;}
        const here=group.getBoundingClientRect(),after=group.nextElementSibling?.getBoundingClientRect();
        frames.push({t,open:details.open,height:here.height,overlap:after?here.bottom-after.top:0,translate:group.nextElementSibling?getComputedStyle(group.nextElementSibling).translate:'none'});
      }while(performance.now()-start<1050);
      return frames;
    });
    assert.ok(frames.length>3,tag+': animation frames recorded');
    assert.ok(frames.every(f=>f.overlap<=1),tag+': the following section must never pass through the disclosure');
    assert.ok(frames.every(f=>f.translate==='none'||f.translate==='0px'),tag+': followers must stay attached to the animated layout edge');
    assert.equal(await app.ui.locator('[data-group="menu-customize-group"] details').evaluate(e=>e.open),false,tag+': interrupted motion reaches the last requested state');
    const trigger=app.ui.locator('[data-setting="bookmarks-bar"] .st-select-trigger');
    await trigger.scrollIntoViewIfNeeded();await sleep(150);
    const before=await trigger.boundingBox();
    await trigger.click();
    const popup=app.ui.getByRole('listbox',{name:'Bookmarks bar'});
    await popup.waitFor();await sleep(180);
    const after=await trigger.boundingBox(),menu=await popup.boundingBox();
    assert.ok(Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1,tag+': opening the list must not move the Settings controls');
    assert.ok(menu.x<after.x+after.width&&menu.x+menu.width>after.x,tag+': list stays aligned with its trigger');
    assert.ok(Math.abs(menu.x-after.x)<=8,tag+': first measurement uses the stable Settings width '+JSON.stringify({before,after,menu,host:await app.ui.locator('.browser-settings').evaluate(e=>({width:e.offsetWidth,rect:e.getBoundingClientRect().toJSON(),zoom:getComputedStyle(e).zoom}))}));
    assert.equal(await popup.evaluate(e=>document.activeElement===e),true,tag+': list receives keyboard focus');
    await popup.press('Home');await popup.press('Enter');
    await popup.waitFor({state:'detached'});
    assert.equal(await trigger.evaluate(e=>document.activeElement===e),true,tag+': selection restores trigger focus');
    assert.ok((await trigger.textContent()).includes('On new tabs'),tag+': keyboard selection is applied');
    await trigger.click();await popup.waitFor();await popup.press('Escape');await popup.waitFor({state:'detached'});
    await trigger.click();await popup.waitFor();await popup.press('Tab');await popup.waitFor({state:'detached'});
    assert.equal(await app.ui.evaluate(()=>document.activeElement!==document.body&&!document.activeElement.matches('[data-setting="bookmarks-bar"] .st-select-trigger')),true,tag+': Tab resumes traversal beyond the trigger');
    await trigger.click();await popup.waitFor();await popup.press('Shift+Tab');await popup.waitFor({state:'detached'});
    assert.equal(await app.ui.evaluate(()=>document.activeElement!==document.body&&!document.activeElement.matches('[data-setting="bookmarks-bar"] .st-select-trigger')),true,tag+': Shift+Tab resumes traversal before the trigger');
    await trigger.click();await popup.waitFor();await app.ui.locator('.st-toolbar').click();await popup.waitFor({state:'detached'});
    const size=app.ui.locator('[data-setting="interface-size"] .st-select-trigger');
    await size.scrollIntoViewIfNeeded();await size.click();
    const sizes=app.ui.getByRole('listbox',{name:'Interface size'});await sizes.waitFor();
    await sizes.press('Escape');await sizes.waitFor({state:'detached'});
    await summary.scrollIntoViewIfNeeded();await summary.click();await sleep(400);
    await app.ui.screenshot({path:path.join(output,tag+'.png')});await summary.click();await sleep(300);
    results.push({tag,frames,before,after,menu,keyboardSelection:true,tabTraversal:true,escapeDismiss:true,outsideDismiss:true});
    console.log(tag+': '+frames.length+' frames without overlap; dropdown layout, selection and dismiss passed.');
  }
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({status:'PASS',cases:results},null,2));
  console.log('Settings controls motion PASS.');
} catch(error) {
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({status:'FAIL',error:String(error),cases:results},null,2));
  throw error;
} finally {if(app)await app.close();}
