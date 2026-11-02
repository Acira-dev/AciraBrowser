'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {validateRecipeText}=require('../desktop/rewind/routine-validation.cjs');
const {createRoutines}=require('../desktop/rewind/routines.cjs');
const example=fs.readFileSync(path.join(__dirname,'../docs/design/rewind-routines/examples/start-work.acira-routine.json'),'utf8');
const doc=()=>JSON.parse(example);
const v=value=>validateRecipeText(typeof value==='string'?value:JSON.stringify(value));

test('the published example is valid and lists its domains',()=>{
 const r=v(example);assert.equal(r.ok,true);assert.deepEqual(r.domains,['mail.example.com','calendar.example.com','docs.example.com']);
});

test('unsafe or unknown content rejects the whole routine',()=>{
 const cases=[
  [d=>{d.steps.push({id:'x',command:'page.click',args:{}});},/doesn’t support/],
  [d=>{d.version=2;},/newer format/],
  [d=>{d.steps[0].args.items[0].url='javascript:alert(1)';},/http and https/],
  [d=>{d.steps[0].args.items[0].url='file:///C:/x';},/http and https/],
  [d=>{d.steps[0].args.items[0].url='https://user:pw@mail.example.com/';},/user name/],
  [d=>{d.steps[1].args.refs=['nope'];},/earlier step/],
  [d=>{d.steps.unshift({id:'early',command:'tabs.group',args:{refs:['mail'],name:'x',color:'blue'}});},/earlier step/],
  [d=>{d.steps[2].args.right='calendar';},/two different/],
  [d=>{d.steps[2].args.ratio=0.95;},/ratio/],
  [d=>{d.extra=1;},/unsupported field/],
  [d=>{d.steps[0].id='open-work';d.steps[1].id='open-work';},/duplicate step/],
 ];
 for(const [mutate,pattern] of cases){const d=doc();mutate(d);const r=v(d);assert.equal(r.ok,false,String(pattern));assert.match(r.errors.join(' '),pattern);}
 assert.match(v('{"format":"acira-routine",').errors[0],/valid JSON/);
 assert.match(v(example.replace('"format"','"__proto__":{"x":1},"format"')).errors[0],/field name/);
 assert.match(v('['.repeat(20)+']'.repeat(20)).errors[0],/nested/);
 assert.match(v(' '.repeat(70000)).errors[0],/64 KB/);
});

function ctxFor(state){const ctx={windowId:'w1',privateMode:false,state:()=>ctx.current,dispatch:a=>{ctx.current=reduceBrowser(ctx.current,a);return ctx.current;},current:state};return ctx;}
const wide=s=>{s.windowUi={...s.windowUi};return s;};

test('import, run (reuse + group + focus), export without local identity, idempotent rerun',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-routines-')),r=createRoutines({dir,tick:async()=>{}});
 let s=wide(reduceBrowser(createInitialState(),{type:'tab.new',url:'https://mail.example.com/'}));const ctx=ctxFor(s);
 const d=doc();d.steps.splice(2,1);// no split in this headless test
 const preview=(await r.handle({type:'routines.preview',text:JSON.stringify(d)},ctx)).routines;assert.equal(preview.ok,true);
 assert.equal(ctx.current,s,'preview changes nothing');
 const saved=(await r.handle({type:'routines.import',text:JSON.stringify(d),profileId:'profile-personal'},ctx)).routines;assert.equal(saved.ok,true);
 const run=(await r.handle({type:'routines.run',id:saved.id},ctx)).routines.run;
 assert.equal(run.status,'completed');assert.equal(run.message,'Browser setup complete. Pages may still be loading.');
 assert.equal(ctx.current.tabs.filter(t=>t.url==='https://mail.example.com/').length,1,'existing mail tab reused');
 assert.equal(ctx.current.tabs.filter(t=>t.group==='Daily work').length,3);assert.equal(ctx.current.windowUi.focusMode,true);
 const count=ctx.current.tabs.length;await r.handle({type:'routines.run',id:saved.id},ctx);assert.equal(ctx.current.tabs.length,count,'rerun reuses, no duplicates');
 const exported=(await r.handle({type:'routines.export',id:saved.id},ctx)).routines;
 assert.equal(exported.json.includes('profile-personal'),false);assert.equal(v(exported.json).ok,true);
 const reread=createRoutines({dir});assert.equal(reread.library().length,1,'survives restart');
});

test('a run in the wrong profile or a private window does nothing',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-routines-')),r=createRoutines({dir,tick:async()=>{}});
 let s=reduceBrowser(createInitialState(),{type:'browser.profile.create',name:'Work'});const ctx=ctxFor(s);
 const work=s.browserProfiles.find(p=>p.name==='Work').id;
 const saved=(await r.handle({type:'routines.import',text:example,profileId:work},ctx)).routines;
 const before=ctx.current;const run=(await r.handle({type:'routines.run',id:saved.id},ctx)).routines.run;
 assert.equal(run.status,'failed');assert.match(run.message,/Work window/);assert.equal(ctx.current,before);
 assert.equal((await r.handle({type:'routines.list'},{...ctx,privateMode:true})).routines.private,true);
});

test('each routine is a registry command with an optional shortcut; run by id reports in a toast',async()=>{
 const {createShortcutRegistry}=require('../desktop/shortcut-registry.cjs');
 const registry=createShortcutRegistry({platform:'win32'});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-routines-')),r=createRoutines({dir,tick:async()=>{},shortcuts:()=>registry});
 const ctx=ctxFor(createInitialState());
 const d=doc();d.steps.splice(2,1);
 const {id}=(await r.handle({type:'routines.import',text:JSON.stringify(d),profileId:'profile-personal'},ctx)).routines;
 const command=registry.list().find(c=>c.id===`routine:${id}`);
 assert.equal(command.label,'Open tab set: Start work');assert.equal(command.category,'Tab sets');
 assert.ok(registry.list().some(c=>c.id==='rewind')&&registry.list().some(c=>c.id==='routines')&&registry.list().some(c=>c.id==='run-routine'));
 assert.match((await r.handle({type:'routines.shortcut',id,accelerator:'Ctrl+T'},ctx)).routines.errors[0],/already used/);
 const set=(await r.handle({type:'routines.shortcut',id,accelerator:'Ctrl+Shift+9'},ctx)).routines;assert.equal(set.ok,true);assert.equal(set.shortcut,'Ctrl + Shift + 9');
 const action=registry.resolve({type:'keyDown',control:true,shift:true,key:'9'},()=>null,input=>input.key);
 assert.deepEqual(action,{action:'routine',id});
 assert.equal((await r.handle({type:'routines.export',id},ctx)).routines.json.includes('Ctrl'),false,'shortcut stays local');
 await r.runById(id,ctx);assert.equal(ctx.current.toast.text,'“Start work” is set up. Pages may still be loading.');
 await r.handle({type:'routines.delete',id},ctx);assert.equal(registry.list().some(c=>c.id===`routine:${id}`),false);
});
