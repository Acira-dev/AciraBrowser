// Read-only network metadata on an isolated product profile; only the local fixture is visited.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startApp, httpFixture, poll} from './d-harness.mjs';
const stamp=Date.now(), out=path.resolve(`qa/artifacts/website-language-baseline-${stamp}`), requests=[];
const sourceContext=Object.fromEntries(await Promise.all(['desktop/main.cjs','desktop/runtime.cjs','desktop/browser-services/user-agent.cjs','dist/index.html'].map(async file=>[file,createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
await fs.mkdir(out,{recursive:true});
const fixture=await httpFixture((request,response)=>{requests.push({url:request.url,acceptLanguage:request.headers['accept-language']||'',userAgent:request.headers['user-agent']||'',clientHints:{brand:request.headers['sec-ch-ua']||'',platform:request.headers['sec-ch-ua-platform']||'',mobile:request.headers['sec-ch-ua-mobile']||''}});response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Local language probe</title><p>Local language probe</p>');});
let app;
try{
  app=await startApp({root:`.qa-profiles/website-language-baseline-${stamp}`});
  const url=`http://127.0.0.1:${fixture.port}/baseline`;
  await app.act({type:'tab.new',url});const page=await app.waitWeb(url);await page.waitForLoadState('domcontentloaded');
  const client=await page.evaluate(()=>({language:navigator.language,languages:[...navigator.languages],userAgent:navigator.userAgent,webdriver:navigator.webdriver,userAgentData:navigator.userAgentData?.toJSON?.()??null}));
  await poll(()=>requests,value=>value.length>0,'local header observation');
  const system=await app.main(({app})=>({locale:app.getLocale(),preferred:app.getPreferredSystemLanguages()}));
  const report={status:'PASS',sourceContext,system,client,requests,scope:'Local fixture on disposable product profile under Playwright/CDP instrumentation; this cannot establish uninstrumented bot detection. No Google account, actual user profile, real proxy or external challenge state inspected.'};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,...report},null,2));
}finally{await app?.close();await fixture.close();}
