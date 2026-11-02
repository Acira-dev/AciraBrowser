import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll} from './d-harness.mjs';
const stamp=Date.now(),root=`.qa-profiles/website-languages-${stamp}`,out=path.resolve(`qa/artifacts/website-languages-${stamp}`),checks=[],requests=[],observations={};
await fs.mkdir(out,{recursive:true});
const fixture=await httpFixture((request,response)=>{requests.push({url:request.url,language:request.headers['accept-language']||'',cookie:request.headers.cookie||''});response.setHeader('Content-Type','text/html');if(request.url==='/seed-a')response.setHeader('Set-Cookie','languageFixture=A; Path=/; Max-Age=86400');response.end('<!doctype html><title>Local language fixture</title><p>Local website languages</p>');});
const base=`http://127.0.0.1:${fixture.port}`;
let app,profileA,profileB;
const state=ui=>ui.evaluate(()=>window.acira.getSnapshot());
const svc=(ui,request)=>ui.evaluate(request=>window.acira.service(request),request);
const act=(ui,action)=>ui.evaluate(action=>window.acira.dispatch(action),action);
const uiFor=id=>poll(async()=>{for(const page of app.context.pages())if(page.url()==='acira-browser-ui://ui/index.html'){try{if((await state(page)).activeBrowserProfileId===id)return page;}catch{}}},Boolean,'profile UI');
const visit=async(ui,route)=>{const url=base+route;await act(ui,{type:'tab.new',url});const page=await app.waitWeb(url);await page.waitForLoadState('domcontentloaded');return page;};
try{
 app=await startApp({root});profileA=(await app.state()).activeBrowserProfileId;
 const a=await visit(app.ui,'/seed-a'),ua=await a.evaluate(()=>navigator.userAgent),initialRendererLanguages=await a.evaluate(()=>[...navigator.languages]);
 Object.assign(observations,{initialRendererLanguages});
 await app.act({type:'tab.new',url:'acira://settings'});
 await app.ui.locator('.bs-sidebar nav').getByRole('button',{name:'Languages',exact:true}).click();
 await app.ui.locator('[data-setting="website-language"] button[aria-haspopup="listbox"]').click();
 await app.ui.getByRole('option',{name:'English',exact:true}).click();
 const chosen=await poll(()=>app.svc({type:'website-language.status'}),result=>result.websiteLanguages?.restartRequired,'saved English requires restart');
 assert.deepEqual(chosen.websiteLanguages.choice,['en-US']);checks.push('Website-language UI saves English separately and clearly requires restart');
 await app.act({type:'browser.profile.create',name:'Language B'});profileB=(await app.state()).browserProfiles.find(p=>p.name==='Language B').id;
 await app.act({type:'browser.profile.select',id:profileB});const bUi=await uiFor(profileB);
 await svc(bUi,{type:'website-language.set',languages:['fr']});checks.push('A second profile saves a separate French preference');
 await app.close();app=await startApp({root});
 const aUi=await uiFor(profileA);let bUi2;
 try{bUi2=await uiFor(profileB);}catch{await act(aUi,{type:'browser.profile.select',id:profileB});bUi2=await uiFor(profileB);}
 const aStatus=(await svc(aUi,{type:'website-language.status'})).websiteLanguages,bStatus=(await svc(bUi2,{type:'website-language.status'})).websiteLanguages;
 Object.assign(observations,{aStatus,bStatus});
 assert.deepEqual(aStatus.current,['en-US']);assert.deepEqual(bStatus.current,['fr']);assert.equal(aStatus.restartRequired,false);assert.equal(bStatus.restartRequired,false);
 const aPage=await visit(aUi,'/after-a'),bPage=await visit(bUi2,'/after-b');
 const aClient=await aPage.evaluate(()=>({languages:[...navigator.languages],ua:navigator.userAgent,webdriver:navigator.webdriver,userAgentData:navigator.userAgentData?.toJSON?.()??null}));
 const bClient=await bPage.evaluate(()=>({languages:[...navigator.languages],ua:navigator.userAgent}));
 Object.assign(observations,{aClient,bClient});
 assert.match(requests.find(r=>r.url==='/after-a').language,/^en-US(?:,|$)/);assert.match(requests.find(r=>r.url==='/after-b').language,/^fr(?:,|$)/);
 // R3-58/R3-63: what a page can read as navigator.languages is the language list the session sends (a choice as is), per profile; the user agent is untouched.
 assert.deepEqual(aClient.languages,['en-US']);assert.deepEqual(bClient.languages,['fr']);assert.equal(aClient.ua,ua);assert.equal(bClient.ua,ua);
 assert.match(requests.find(r=>r.url==='/after-a').cookie,/languageFixture=A/);assert.doesNotMatch(requests.find(r=>r.url==='/after-b').cookie,/languageFixture/);
 checks.push('Restart applies actual English/French request headers without changing UA; profile A cookie persists and remains isolated');
 await aUi.evaluate(()=>window.acira.openWindow('private'));
 const privateUi=await poll(async()=>{for(const page of app.context.pages())if(page.url()==='acira-browser-ui://ui/index.html'){try{const s=await state(page);if(s.browserProfiles.find(p=>p.id===s.activeBrowserProfileId)?.private)return page;}catch{}}},Boolean,'private UI');
 const privateStatus=(await svc(privateUi,{type:'website-language.status'})).websiteLanguages;assert.equal(privateStatus.privateMode,true);
 await assert.rejects(svc(privateUi,{type:'website-language.set',languages:['de']}),/ordinary profile/);
 assert.deepEqual((await svc(aUi,{type:'website-language.status'})).websiteLanguages.choice,['en-US']);checks.push('Private setter refuses persistence and preserves ordinary profile preference');
 const report={status:'PASS_REQUEST_PROFILE_SUBGATES',rendererLanguageParity:'PER_PROFILE_NAVIGATOR_LANGUAGES_MATCH_REQUEST_HEADER',checks,requests,initialRendererLanguages,aClient,bClient,limitation:'Local fixture under Playwright/CDP; no Google/CAPTCHA verdict. Tor request preference/nonpersistence has service tests, not a real Tor bootstrap in this script.'};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,...report},null,2));
}catch(error){await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'FAIL',checks,observations,requests,error:error.stack||String(error)},null,2)+'\n');throw error;}
finally{await app?.close();await fixture.close();}
