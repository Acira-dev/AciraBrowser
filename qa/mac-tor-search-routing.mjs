// Mounted Mac search routes in an owned profile. Public requests are aborted;
// assertions inspect actual native-reducer destinations, not provider rankings.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,poll} from './d-harness.mjs';
const candidate=process.argv[2]?path.resolve(process.argv[2]):process.cwd(),out=path.resolve(process.env.TOR_SEARCH_OUT||'qa/artifacts/mac-tor-search-'+Date.now());await fs.mkdir(out,{recursive:true});
const report={candidate,passed:false,checks:[],errors:[],scope:'Actual hidden Mac main and mounted address/suggestions/command controls. External pages aborted; validates native dispatch destinations/privacy, not Tor network or provider ranking.'};let app;
const state=()=>app.state(),active=async()=>{const s=await state();return s.tabs.find(t=>t.id===s.activeTabId);};
const check=async(name,run)=>{try{await run();report.checks.push({name,result:'passed'});}catch(e){report.checks.push({name,result:'failed',error:String(e.stack||e)});}console.log(report.checks.at(-1).result.toUpperCase()+' '+name);};
const open=async(privacy,suggestions=false)=>{await app.act({type:'settings.update',patch:{addressSuggestions:suggestions}});await app.act({type:'tab.new',...(privacy?{privacy}:{})});const t=await active();await poll(()=>app.ui.getByRole('combobox',{name:'Address and search',exact:true}).isVisible(),Boolean,'Address ready');return t.id;};
const enter=async(query,keys='Enter')=>{const field=app.ui.getByRole('combobox',{name:'Address and search',exact:true});await field.fill(query);await field.press(keys);await poll(active,t=>t.url!=='acira://new','Committed search');return active();};
const destination=(tab,host,q,privacy)=>{report.destinations??=[];report.destinations.push({url:tab.url,privacy:tab.privacy});const u=new URL(tab.url);assert.equal(u.hostname,host);assert.equal(u.searchParams.get('q'),q);assert.equal(tab.privacy,privacy);};
try{
 app=await startApp({root:path.resolve('.qa-profiles/mac-tor-search-'+Date.now()),main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.join(candidate,'desktop/main.cjs')}});
 await app.context.route('https://**/*',r=>r.abort());app.context.on('page',p=>p.on('pageerror',e=>report.errors.push(e.message)));
 await app.act({type:'settings.update',patch:{askBeforeClosing:false,reducedMotion:true,searchEngine:'google',searchProviders:{defaultId:'owned',engines:[{id:'owned',name:'Owned search',keyword:'owned',template:'https://owned-search.test/?q=%s'}]}}});
 await check('Ordinary Enter retains custom provider',async()=>{await open();destination(await enter('ordinary notes'),'owned-search.test','ordinary notes',undefined);});
 await check('Tor Enter without suggestions uses DuckDuckGo',async()=>{await open('tor');destination(await enter('tor secret tea'),'duckduckgo.com','tor secret tea','tor');});
 await check('Tor Alt+Enter keeps Tor privacy and DuckDuckGo',async()=>{const id=await open('tor');const t=await enter('tor new tea','Alt+Enter');assert.notEqual(t.id,id);destination(t,'duckduckgo.com','tor new tea','tor');});
 await check('Tor typed suggestion uses DuckDuckGo',async()=>{await open('tor',true);destination(await enter('tor suggested tea'),'duckduckgo.com','tor suggested tea','tor');});
 await check('Tor command search uses DuckDuckGo',async()=>{await open('tor');await app.cmd({type:'ui',tabId:(await active()).id,action:'open',kind:'palette'});const popup=await poll(()=>app.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'Command popup');const field=popup.getByRole('textbox',{name:'Search tabs, history and commands',exact:true});await field.fill('tor command tea');await field.press('Enter');await poll(active,t=>t.url!=='acira://new','Command committed');destination(await active(),'duckduckgo.com','tor command tea','tor');});
 await check('Private Alt+Enter keeps private session and ordinary provider',async()=>{await open('private');destination(await enter('private notes','Alt+Enter'),'owned-search.test','private notes','private');});
 await check('Ordinary Alt+Enter retains custom provider',async()=>{await open();destination(await enter('new ordinary notes','Alt+Enter'),'owned-search.test','new ordinary notes',undefined);});
 assert.deepEqual(report.errors,[]);report.passed=report.checks.every(c=>c.result==='passed');if(!report.passed)process.exitCode=1;
}catch(e){report.failure=String(e.stack||e);process.exitCode=1;}finally{await app?.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks,out,failure:report.failure}));}
