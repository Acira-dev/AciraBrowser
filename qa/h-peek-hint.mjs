// Stream H QA: the one-time Peek tip. Three links opened as background tabs (Ctrl+click) on a fresh profile bring one
// "Preview links without opening a tab…" notice; a fourth doesn't. One Electron instance, ≤ 5 tabs, closed in finally.
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const site=await httpFixture((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(req.url==='/home'?'<title>Home</title><p><a id="a" href="/one">One</a> <a id="b" href="/two">Two</a> <a id="c" href="/three">Three</a> <a id="d" href="/four">Four</a>':`<title>${req.url}</title>${req.url}`);});
const t=await startApp({root:path.resolve(`.qa-profiles/h-peek-hint-${Date.now()}`)});
try{
 await t.act({type:'tab.navigate',tabId:(await t.state()).activeTabId,url:`http://127.0.0.1:${site.port}/home`});
 const page=await t.waitWeb(u=>u.endsWith('/home'));await page.waitForSelector('#a');
 for(const [i,id] of ['a','b','c'].entries()){await page.click(`#${id}`,{modifiers:['Control']});await poll(t.state,s=>s.tabs.length===2+i,`background tab ${i+1}`,8000);}
 const s=await poll(t.state,s=>/Preview links without opening a tab/.test(s.toast?.text||''),'tip',5000).catch(()=>t.state());
 check(/Shift-click a link, or press and hold it/.test(s.toast?.text||'')&&s.toast?.tone==='info',`third background-tab link brings the tip ("${s.toast?.text}")`);
 const tipId=s.toast?.id;
 await page.click('#d',{modifiers:['Control']});await poll(t.state,x=>x.tabs.length===5,'fourth',8000);await sleep(400);
 const after=(await t.state()).toast;check(!/Preview links/.test(after?.text||'')||after.id===tipId,'a fourth link raises no new tip');
}finally{await t.close();await site.close();}
