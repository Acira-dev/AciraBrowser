// Stream H QA: "Window closed · Undo" across real windows, and a routine run from its own keyboard shortcut.
// node qa/h-window-undo.mjs [--shots dir]   (D_VISIBLE=1 for a visible window)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const site=await httpFixture((req,res)=>{const n=req.url.replace(/\W/g,'')||'root';res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><title>${n}</title><p>${n}`);});
const base=`http://127.0.0.1:${site.port}`;
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const uiPages=t=>t.context.pages().filter(p=>{try{return p.url()==='acira-browser-ui://ui/index.html';}catch{return false;}});
const t=await startApp({});
try{
 // Second window with three tabs, two of them grouped.
 await t.ui.evaluate(()=>window.acira.openWindow('normal'));
 const second=await poll(()=>uiPages(t).find(p=>p!==t.ui),Boolean,'second window');
 await poll(()=>second.evaluate(()=>Boolean(window.acira?.getSnapshot)),Boolean,'second ready');
 const act=a=>second.evaluate(a=>window.acira.dispatch(a),a),snap=()=>second.evaluate(()=>window.acira.getSnapshot());
 await act({type:'tab.navigate',tabId:(await snap()).activeTabId,url:`${base}/alpha`});
 await act({type:'tab.new',url:`${base}/beta`});await act({type:'tab.new',url:`${base}/gamma`});
 let s=await poll(snap,s=>s.tabs.length===3,'three tabs');
 await act({type:'tab.group.create',tabId:s.tabs[1].id,name:'Launch',color:'green'});s=await poll(snap,s=>s.tabGroups.length===1,'group');
 await act({type:'tab.group.assign',tabIds:[s.tabs[1].id,s.tabs[2].id],groupId:s.tabGroups[0].id});await sleep(300);
 await second.evaluate(()=>window.acira.windowControl('close'));
 await poll(()=>uiPages(t).length,n=>n===1,'second closed');
 const first=await poll(t.state,s=>s.toast?.action?.command?.type==='window.reopen','window undo toast');
 check(first.toast.text==='Window with 3 tabs closed','surviving window says "Window with 3 tabs closed · Undo"');
 await sleep(300);if(shots){await fs.mkdir(shots,{recursive:true});await t.ui.screenshot({path:path.join(shots,'window-undo.png'),scale:'css'});}
 await t.ui.locator('.toast-action').first().click();
 const third=await poll(()=>uiPages(t).find(p=>p!==t.ui),Boolean,'reopened window');
 await poll(()=>third.evaluate(()=>Boolean(window.acira?.getSnapshot)),Boolean,'third ready');
 const reopened=await poll(()=>third.evaluate(()=>window.acira.getSnapshot()),s=>s.tabs.length===3,'three tabs back',15000);
 check(JSON.stringify(reopened.tabs.map(x=>x.url))===JSON.stringify([`${base}/alpha`,`${base}/beta`,`${base}/gamma`]),'tabs back in order');
 check(reopened.tabs.filter(x=>x.group==='Launch').length===2&&reopened.tabGroups.find(g=>g.name==='Launch')?.color==='green','group back with colour');
 check((await t.state()).toast===null,'toast cleared in the surviving window');
 await third.evaluate(()=>window.acira.windowControl('close'));await poll(()=>uiPages(t).length,n=>n===1,'third closed');
 // Routine with a shortcut, run from the keyboard.
 const rw=r=>t.ui.evaluate(r=>window.acira.rewind(r),r).then(x=>x.routines);
 const recipe={format:'acira-routine',version:1,name:'Focus block',steps:[{id:'open',command:'tabs.open',args:{reuse:'exact-url-in-workspace',items:[{ref:'doc',url:`${base}/doc`}]}},{id:'focus',command:'layout.focus',args:{enabled:true}}]};
 const {id}=await rw({type:'routines.import',text:JSON.stringify(recipe),profileId:(await t.state()).activeBrowserProfileId});
 const set=await rw({type:'routines.shortcut',id,accelerator:'Ctrl+Shift+9'});check(set.ok&&set.shortcut==='Ctrl + Shift + 9','shortcut assigned');
 const listed=await t.ui.evaluate(()=>window.acira.native({type:'shortcuts.list'}));
 check(listed.shortcuts.commands.some(c=>c.id===`routine:${id}`&&c.label==='Open tab set: Focus block'&&c.category==='Tab sets'),'registry lists "Run routine: Focus block"');
 check(['rewind','routines','run-routine'].every(k=>listed.shortcuts.commands.some(c=>c.id===k)),'registry lists Rewind, Routines, Run routine…');
 await t.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];const wc=w.contentView.children[0]?.webContents;for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'9',modifiers:['control','shift']});});
 const ran=await poll(t.state,s=>s.windowUi.focusMode===true&&s.tabs.some(x=>x.url===`${base}/doc`),'routine ran from shortcut',10000).catch(()=>null);
 check(Boolean(ran),'Ctrl+Shift+9 ran the routine');
 check(/Focus block/.test(ran?.toast?.text||''),`toast: ${ran?.toast?.text}`);
}finally{await t.close();await site.close();}
