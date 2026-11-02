// Stream H QA: the real app's command registry — unique ids, "Open tab switcher" listed as tab-viewer and runnable.
import {startApp,poll} from './d-harness.mjs';
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const t=await startApp({});
try{
 const {shortcuts}=await t.ui.evaluate(()=>window.acira.native({type:'shortcuts.list'}));
 const ids=shortcuts.commands.map(c=>c.id);
 check(new Set(ids).size===ids.length,`${ids.length} commands, all ids unique`);
 const viewer=shortcuts.commands.find(c=>c.id==='tab-viewer');
 check(viewer?.label==='Open tab switcher'&&viewer.display.includes('Alt + T'),'tab-viewer listed with Alt + T');
 const run=await t.ui.evaluate(()=>window.acira.native({type:'shortcuts.run',id:'tab-viewer'}));
 check(run.shortcuts.ok,'shortcuts.run tab-viewer ok');
 await poll(()=>t.main(({BaseWindow})=>BaseWindow.getAllWindows()[0].contentView.children.some(v=>v.getVisible?.()&&v.getBounds().width>0&&v!==BaseWindow.getAllWindows()[0].contentView.children[0])),Boolean,'viewer overlay shown',5000).then(()=>check(true,'tab viewer opened'),()=>check(false,'tab viewer opened'));
}finally{await t.close();}
