import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, poll, httpFixture } from './d-harness.mjs';

const stamp=Date.now(),out=path.resolve(`qa/artifacts/settings-targets-${stamp}`),checks=[];
await fs.mkdir(out,{recursive:true});
const root=`.qa-profiles/settings-targets-${stamp}`;
let app=await startApp({root});
const website=await httpFixture((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>Synthetic routing website</title><p>Local routing fixture.</p>');});
const state=page=>page.evaluate(()=>window.acira.getSnapshot());
const act=(page,action)=>page.evaluate(action=>window.acira.dispatch(action),action);
const section=page=>page.locator('.bs-sidebar nav [aria-current="page"]').getAttribute('aria-label');
const settings=async(page,sectionName)=>{
  await act(page,{type:'tab.navigate',url:'acira://settings'});
  await page.locator('.bs-sidebar nav').getByRole('button',{name:sectionName,exact:true}).click();
};
const findWindow=predicate=>poll(async()=>{
  for(const page of app.context.pages())if(page.url()==='acira-browser-ui://ui/index.html'){
    try{if(predicate(await state(page)))return page;}catch{}
  }
},Boolean,'new native browser window');
try{
  const first=app.ui,firstId=(await state(first)).windowId;
  assert.ok(typeof firstId==='string'&&firstId.length>0);
  await settings(first,'Appearance');
  await first.evaluate(()=>window.acira.openWindow('normal'));
  const second=await findWindow(value=>value.windowId!==firstId);
  await settings(second,'Privacy');
  const secondState=await state(second);
  assert.equal(secondState.activeBrowserProfileId,(await state(first)).activeBrowserProfileId);
  assert.equal(secondState.activeTabId,'tab-home');
  assert.equal((await state(first)).activeTabId,'tab-home');
  await act(first,{type:'tab.new',url:'acira://new'});
  const sourceTab=(await state(first)).activeTabId;
  const customize=async()=>{
    await act(first,{type:'tab.select',id:sourceTab});
    await first.getByRole('button',{name:'Collection',exact:true}).click();
    await first.getByRole('menu',{name:'Collection',exact:true}).getByRole('menuitem',{name:'Customize…',exact:true}).click();
    await first.locator('[data-setting="newtab-collection"]').waitFor();
    assert.equal(await section(first),'Appearance'); // the New tab background lives under Appearance › New tab background (SETTINGS_IA.md)
  };
  await customize();
  assert.equal(await section(second),'Privacy');
  assert.equal((await state(first)).tabs.filter(tab=>tab.url==='acira://settings').length,1);
  checks.push('Customize reuses its own Settings tab while another same-profile window with identical tab-home stays on Privacy');

  await act(second,{type:'browser.profile.create',name:'Synthetic routing profile'});
  const profile=(await state(second)).browserProfiles.find(profile=>profile.name==='Synthetic routing profile').id;
  await act(second,{type:'browser.profile.select',id:profile});
  const third=await findWindow(value=>value.activeBrowserProfileId===profile);
  await settings(third,'Search');
  await customize();
  assert.equal(await section(second),'Privacy');
  assert.equal(await section(third),'Search');
  checks.push('A different-profile Settings window also cannot consume the Customize arrival');

  await act(first,{type:'tab.new',url:`http://127.0.0.1:${website.port}/`});
  await poll(()=>state(first),value=>!value.tabs.find(tab=>tab.id===value.activeTabId).loading,'synthetic website loaded');
  await act(first,{type:'toast',text:'Synthetic protected-media notice',tone:'info',action:{label:'Learn more',settings:'known-limits',command:{type:'tab.new',url:'acira://settings'}}});
  const overlay=await poll(async()=>{
    for(const page of app.context.pages())if(page.url().includes('?view=overlay')){
      try{if((await state(page)).windowId===firstId)return page;}catch{}
    }
  },Boolean,'own toast overlay');
  await overlay.getByRole('button',{name:'Learn more',exact:true}).click();
  await first.locator('[data-setting="known-limits"]').waitFor();
  assert.equal(await section(first),'About');
  assert.equal(await section(second),'Privacy');
  assert.equal(await section(third),'Search');
  checks.push('Native toast overlay opens its exact new Settings tab on the requested control without redirecting other windows');
  const last=await state(first);
  await first.evaluate(snapshot=>localStorage.setItem(`acira-settings-target:${encodeURIComponent(snapshot.windowId)}:${encodeURIComponent(snapshot.activeTabId)}`,JSON.stringify({section:'Privacy',at:Date.now()})),last);
  await app.close();app=await startApp({root});
  // Every ordinary window comes back (this run opened three), in no fixed order: take the one that was the first window.
  const suffix=firstId.split(':').at(-1);
  const mainUi=await poll(async()=>{
    for(const page of app.context.pages())if(page.url()==='acira-browser-ui://ui/index.html'){
      try{if((await state(page)).windowId.split(':').at(-1)===suffix)return page;}catch{}
    }
  },Boolean,'restored first window');
  const restarted=await state(mainUi);assert.notEqual(restarted.windowId,firstId,'outgoing owner must change across a process restart');
  assert.equal(restarted.windowId.split(':').at(-1),suffix,'stored native window identity remains stable');
  await mainUi.locator('.bs-sidebar nav [aria-current="page"]').waitFor();assert.notEqual(await section(mainUi),'Privacy');
  checks.push('Restart changes only outgoing UI owner identity and cannot consume an earlier process Settings arrival');
  console.log(JSON.stringify({ok:true,checks,out},null,2));
}finally{
  await app.close();
  await website.close();
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({checks},null,2));
}
