// Stream H QA: shortcuts.run (command bar path), Ctrl+Shift+S split view, Ctrl+Alt+click link -> split (plain Alt+click previews it: h-peek). Real app.
// node qa/h-split.mjs [--shots dir]   (D_VISIBLE=1 for a visible window)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const site=await httpFixture((req,res)=>{const n=req.url.replace(/\W/g,'')||'root';res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><title>${n}</title><body style="font:16px system-ui;padding:40px"><h1>${n}</h1><p><a id="next" href="/linked?from=${n}">Open linked page</a></p>`);});
const base=`http://127.0.0.1:${site.port}`;
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const t=await startApp({});
try{
 await t.main(({BaseWindow})=>{for(const w of BaseWindow.getAllWindows())w.setBounds({x:40,y:40,width:1500,height:900});});
 const run=id=>t.ui.evaluate(id=>window.acira.native({type:'shortcuts.run',id}),id).then(r=>r.shortcuts);
 // 1. Command bar path.
 const r1=await run('rewind');check(r1.ok&&r1.ran==='rewind','shortcuts.run rewind -> ok');
 await poll(t.state,s=>s.tabs.some(x=>x.url==='acira://rewind'),'rewind tab opened');check(true,'Rewind opened through shortcut() path');
 check((await run('nope')).code==='unknown','unknown id refused');
 // 2. Ctrl+Shift+S: current + most recent other tab.
 const home=(await t.state()).tabs[0].id;
 await t.act({type:'tab.navigate',tabId:home,url:`${base}/alpha`});await t.act({type:'tab.new',url:`${base}/beta`});await t.act({type:'tab.new',url:`${base}/gamma`});
 let s=await poll(t.state,s=>s.tabs.length===4,'tabs');
 const [alpha,rewindTab,beta,gamma]=s.tabs.map(x=>x.id);
 for(const id of [alpha,beta,gamma])await t.act({type:'tab.select',id});await sleep(300);
 await t.main(({BaseWindow})=>{const wc=BaseWindow.getAllWindows()[0].contentView.children[0].webContents;wc.focus();for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'S',modifiers:['control','shift']});});
 s=await poll(t.state,s=>Boolean(s.windowUi.split),'split open',8000).catch(()=>t.state());
 check(JSON.stringify(s.windowUi.split?.tabIds)===JSON.stringify([gamma,beta]),`Ctrl+Shift+S split current + most recent (${JSON.stringify(s.windowUi.split?.tabIds)})`);
 await sleep(600);if(shots){await fs.mkdir(shots,{recursive:true});await t.ui.screenshot({path:path.join(shots,'split-shortcut.png'),scale:'css'});}
 await run('split-view');s=await poll(t.state,s=>!s.windowUi.split,'split closed via shortcuts.run');check(true,'shortcuts.run split-view closes it again');
 // 3. Ctrl+Alt+click a link in alpha (Alt+click alone is Peek).
 await t.act({type:'tab.select',id:alpha});const page=await t.waitWeb(u=>u.endsWith('/alpha'));
 await page.waitForSelector('#next');await page.click('#next',{modifiers:['Control','Alt']});
 s=await poll(t.state,s=>s.tabs.some(x=>x.url.includes('/linked?from=alpha'))&&s.windowUi.split,'ctrl-alt-click split',8000).catch(()=>t.state());
 const linked=s.tabs.find(x=>x.url.includes('/linked?from=alpha'));
 check(Boolean(linked)&&s.tabs[s.tabs.findIndex(x=>x.id===alpha)+1]?.id===linked.id,'link opened in a new tab right after its page');
 check(JSON.stringify(s.windowUi.split?.tabIds)===JSON.stringify([alpha,linked?.id]),'page and link side by side');
 check(page.url().endsWith('/alpha'),'source page did not navigate');
 check(!(s.downloads||[]).length,'Ctrl+Alt+click did not download');
 await sleep(800);if(shots)await t.ui.screenshot({path:path.join(shots,'split-altclick.png'),scale:'css'});
 void rewindTab;
}finally{await t.close();await site.close();}
