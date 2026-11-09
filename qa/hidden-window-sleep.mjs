// Separate windows keep every profile's window alive, hidden, with its page: about 640 MB per profile window with a page (9 Nov sweep, 12 profiles = 8 GB). A window that stepped aside
// for another profile now lets its pages sleep through Memory Saver (the same idle time, the same protections: audio, capture, typed input, downloads, pinned, never-sleep sites), and
// wakes the page it comes back on. The window on screen is never put to sleep. Memory Saver's clock is sped up here (7 s idle, 1 s to freeze, a sweep every 0.4 s).
// `node qa/hidden-window-sleep.mjs [repo]`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,sleep,poll} from './d-harness.mjs';

const stamp=Date.now(),root=path.resolve('.qa-profiles/hidden-sleep-'+stamp),out=path.resolve(process.env.HIDDEN_SLEEP_OUT||'qa/artifacts/hidden-sleep-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const fixture=await httpFixture((req,res)=>{const name=decodeURIComponent(req.url.slice(1))||'Page';res.setHeader('Content-Type','text/html');res.end(`<title>${name}</title><body><h1>${name}</h1>`);});
const site=name=>'http://127.0.0.1:'+fixture.port+'/'+encodeURIComponent(name);
const UI='acira-browser-ui://ui/index.html',report={passed:false,problems:[]};
let app;
// the tabs one profile's window holds, from that window's own interface
const tabsOf=profile=>app.main(async({BaseWindow},{UI,profile})=>{for(const w of BaseWindow.getAllWindows()){if(w.isDestroyed())continue;for(const v of w.contentView.children){try{if(v.webContents.getURL()!==UI)continue;const s=await v.webContents.executeJavaScript('window.acira.getSnapshot()');if(s.activeBrowserProfileId===profile)return s.tabs.map(t=>({url:t.url,sleeping:!!t.sleeping,active:t.id===s.activeTabId,loading:!!t.loading}));}catch{}}}return null;},{UI,profile});
const livePages=()=>app.main(({webContents})=>webContents.getAllWebContents().filter(wc=>!wc.isDestroyed()&&/^http:\/\/127\.0\.0\.1:/.test(wc.getURL())).map(wc=>({url:decodeURIComponent(wc.getURL().split('/').pop()),loading:wc.isLoading()})));
try{
 app=await startApp({root,args:['--use-mock-keychain'],main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1',ACIRA_MEMORY_SAVER_TICK_MS:'400',ACIRA_MEMORY_SAVER_IDLE_MS:'7000',ACIRA_MEMORY_SAVER_FREEZE_MS:'1000'}});
 if(process.platform==='darwin')assert.equal(await app.main(({app})=>app.commandLine.hasSwitch('use-mock-keychain')),true,'every launch here uses the mock keychain');
 // A Playwright-driven app reports every page as being captured (the debugger is attached), and Memory Saver never sleeps a page that is being captured: say what a real run says.
 await app.main(({webContents})=>{let proto=Object.getPrototypeOf(webContents.getAllWebContents()[0]);while(proto&&!Object.hasOwn(proto,'isBeingCaptured'))proto=Object.getPrototypeOf(proto);if(proto)proto.isBeingCaptured=function(){return false;};});
 await app.act({type:'settings.update',patch:{askBeforeClosing:false}});
 await app.act({type:'browser.profile.create',name:'Client'});await sleep(300);
 const s=await app.state(),[personal,client]=s.browserProfiles.filter(p=>!p.private).map(p=>p.id);
 await app.act({type:'tab.navigate',tabId:s.activeTabId,url:site('Personal page')});
 await poll(async()=>(await livePages()).some(p=>p.url==='Personal page'&&!p.loading),Boolean,'the Personal page loaded',15000);
 // to Client: Personal's window steps aside with its page (and Client's window opens the page on screen as a tab of its own)
 await app.act({type:'browser.profile.select',id:client,here:true});
 await poll(async()=>Boolean(await tabsOf(client)),Boolean,'Client\'s window',15000);
 const switchTo=(from,to)=>app.main(async({BaseWindow},{UI,from,to})=>{for(const w of BaseWindow.getAllWindows()){for(const v of w.contentView.children){try{if(v.webContents.getURL()===UI&&(await v.webContents.executeJavaScript('window.acira.getSnapshot().then(s=>s.activeBrowserProfileId)'))===from){await v.webContents.executeJavaScript('window.acira.dispatch('+JSON.stringify({type:'browser.profile.select',id:to,here:true})+')');return true;}}catch{}}}return false;},{UI,from,to});
 const respond=()=>app.main(async({webContents})=>{for(const wc of webContents.getAllWebContents()){if(wc.isDestroyed()||!wc.getURL().endsWith('/Personal%20page'))continue;return await Promise.race([wc.executeJavaScript('document.title'),new Promise(r=>setTimeout(()=>r('frozen'),2500))]);}return 'no page';});
 // 1. Aside for a short while (frozen, not yet asleep): back on Personal the page answers at once.
 await sleep(2500);
 assert.equal(await switchTo(client,personal),true);
 await poll(async()=>{const tabs=await tabsOf(personal);return tabs&&tabs.find(t=>t.active);},Boolean,'Personal on screen',10000);
 const answer=await respond();
 if(answer!=='Personal page')report.problems.push('back on Personal after a short while aside, its page does not answer: '+answer);
 // 2. Aside for longer than the idle time: the page falls asleep, the page on screen does not.
 assert.equal(await switchTo(personal,client),true);
 const slept=await poll(async()=>{const tabs=await tabsOf(personal);return tabs&&tabs.find(t=>t.active)?.sleeping;},Boolean,'Personal\'s page asleep while its window is aside',30000).then(()=>true,()=>false);
 if(!slept)report.problems.push('the page of the window that stepped aside never went to sleep');
 const shown=await tabsOf(client);
 if(shown?.some(t=>t.sleeping))report.problems.push('a page in the window on screen went to sleep: '+JSON.stringify(shown));
 report.livePagesWhileAside=(await livePages()).map(p=>p.url);
 // 3. Back to Personal: its page is made again and loads.
 assert.equal(await switchTo(client,personal),true);
 const woke=await poll(async()=>{const tabs=await tabsOf(personal);const pages=await livePages();return tabs&&tabs.find(t=>t.active)&&!tabs.find(t=>t.active).sleeping&&pages.some(p=>p.url==='Personal page'&&!p.loading);},Boolean,'Personal\'s page awake again',15000).then(()=>true,()=>false);
 if(!woke)report.problems.push('coming back to Personal did not wake its page');
 report.passed=!report.problems.length;if(!report.passed)process.exitCode=1;
 console.log((report.passed?'PASS':'FAIL')+' a window that stepped aside lets its page sleep and wakes it on return'+(report.problems.length?' - '+report.problems.join('; '):''));
}catch(e){report.error=String(e.stack||e);process.exitCode=1;console.log('FAIL '+report.error);}
finally{await app?.close();await fixture.close();await fs.rm(root,{recursive:true,force:true});await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');}
