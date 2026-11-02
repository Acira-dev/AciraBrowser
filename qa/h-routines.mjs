// Stream H QA: Routines in the real app — paste import review (no side effects), add, run, focus, export JSON, themes.
// node qa/h-routines.mjs [--shots dir]   (D_VISIBLE=1 for a visible window)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
let hits=0;const site=await httpFixture((req,res)=>{hits++;const n=req.url.replace(/\W/g,'')||'root';res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><title>${n}</title><p>${n}`);});
const base=`http://127.0.0.1:${site.port}`;
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
async function shot(t,name){if(!shots)return;await fs.mkdir(shots,{recursive:true});await sleep(350);await t.ui.screenshot({path:path.join(shots,`${name}.png`),scale:'css'});}
const recipe={format:'acira-routine',version:1,name:'Morning',description:'Mail and calendar, grouped.',steps:[
 {id:'open',command:'tabs.open',args:{reuse:'exact-url-in-workspace',items:[{ref:'mail',url:`${base}/mail`},{ref:'cal',url:`${base}/calendar`}]}},
 {id:'group',command:'tabs.group',args:{refs:['mail','cal'],name:'Daily work',color:'blue'}},
 {id:'focus',command:'layout.focus',args:{enabled:true}}]};
const t=await startApp({});
try{
 await t.act({type:'tab.navigate',tabId:(await t.state()).activeTabId,url:'acira://routines'});
 await poll(()=>t.ui.locator('.rt-page').count(),n=>n===1,'routines page');
 await shot(t,'routines-empty');
 await t.ui.getByRole('button',{name:'Paste…'}).click();
 await t.ui.locator('.rt-paste').fill(JSON.stringify({...recipe,steps:[...recipe.steps,{id:'x',command:'page.click',args:{}}]}));
 await t.ui.getByRole('button',{name:'Check routine'}).click();
 await poll(()=>t.ui.locator('.rt-errors').textContent(),s=>/doesn’t support/.test(s||''),'unknown action rejected');
 check(true,'unknown action rejects the whole routine');
 await t.ui.locator('.rt-paste').fill(JSON.stringify(recipe));await t.ui.getByRole('button',{name:'Check routine'}).click();
 await poll(()=>t.ui.locator('.rt-review-name').count(),n=>n===1,'review');
 const before=(await t.state()).tabs.length;await shot(t,'routines-review');
 check(hits===0&&(await t.state()).tabs.length===before,'review contacts no website, changes nothing');
 await t.ui.getByRole('button',{name:'Add routine'}).click();
 await poll(()=>t.ui.locator('.rt-step').count(),n=>n===3,'editor shows 3 steps');
 await shot(t,'routines-editor-light');
 await t.ui.getByRole('button',{name:'Run',exact:true}).click();
 await poll(()=>t.ui.locator('.rw-foot-status').textContent(),s=>/Browser setup complete/.test(s||''),'run complete');
 const s=await t.state();
 check(s.tabs.filter(x=>x.group==='Daily work').length===2&&s.windowUi.focusMode===true,'run opened, grouped and set focus');
 await shot(t,'routines-ran');
 await t.ui.getByRole('button',{name:'Run',exact:true}).click();await sleep(400);
 check((await t.state()).tabs.length===s.tabs.length,'second run reuses tabs');
 await t.act({type:'ui.update',patch:{focusMode:false}});
 for(const [name,patch] of [['dark',{appearance:'dark'}],['burgundy',{appearance:'dark',colorPreset:'Burgundy',accentColor:'#4d1821',browserTint:'#4d1821'}]]){await t.act({type:'settings.update',patch});await shot(t,`routines-${name}`);}
 await t.act({type:'settings.update',patch:{interfaceScale:150}});await sleep(600);await shot(t,'routines-150');
}finally{await t.close();await site.close();}
