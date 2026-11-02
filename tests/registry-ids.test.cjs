'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createShortcutRegistry,COMMANDS}=require('../desktop/shortcut-registry.cjs');
const {createNativeCore}=require('../desktop/native-core.cjs');
const {resolveShortcut}=require('../desktop/shortcuts.cjs');
const dupes=ids=>ids.filter((id,i)=>ids.indexOf(id)!==i);

test('every registry command id is unique, including dynamic ones',()=>{
 assert.deepEqual(dupes(COMMANDS.map(c=>c.id)),[]);
 const registry=createShortcutRegistry({platform:'win32'});
 registry.setDynamic('routine:',[{id:'routine:rt-0000000000000001',label:'Run routine: A',category:'Routines',action:{action:'routine',id:'rt-0000000000000001'}},{id:'routine:rt-0000000000000001',label:'dup',category:'Routines',action:{action:'routine',id:'x'}}]);
 assert.deepEqual(dupes(registry.list().map(c=>c.id)),[]);
 assert.equal(registry.list().find(c=>c.id==='tab-viewer').label,'Open tab switcher');
 assert.equal(registry.list().find(c=>c.id==='tab-switcher').label,'Switch tabs');
});

test('tab-viewer runs by id and keeps Alt+T; tab-switcher stays keyboard-only Ctrl+Tab',()=>{
 const registry=createShortcutRegistry({platform:'win32'}),ran=[];
 const core=createNativeCore({shortcutRegistry:registry}),context={runCommand:a=>ran.push(a)};
 assert.deepEqual(core.handle({type:'shortcuts.run',id:'tab-viewer'},context).shortcuts,{ok:true,ran:'tab-viewer'});assert.deepEqual(ran,[{action:'tabs'}]);
 assert.equal(core.handle({type:'shortcuts.run',id:'tab-switcher'},context).shortcuts.code,'keyboard-only');
 const key=input=>registry.resolve({type:'keyDown',...input},resolveShortcut,i=>i.key);
 assert.deepEqual(key({alt:true,key:'t'}),{action:'tabs'});assert.deepEqual(key({control:true,key:'Tab'}),{action:'tab-switcher',direction:1});
});

function withFile(bindings){const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'acira-keys-')),'shortcuts.json');fs.writeFileSync(file,JSON.stringify({version:1,bindings}));return createShortcutRegistry({file,platform:'win32'});}
const view=(registry,id)=>registry.list().find(c=>c.id===id);

test('old files: a custom tab-switcher key that is not a Tab key moves to tab-viewer, Ctrl+Tab keeps working',()=>{
 const registry=withFile({'tab-switcher':['Ctrl+Shift+Y']});
 assert.deepEqual(view(registry,'tab-viewer').bindings,['Ctrl+Shift+Y']);
 assert.deepEqual(view(registry,'tab-switcher').bindings,['Ctrl+Tab']);assert.equal(view(registry,'tab-switcher').customized,false);
 assert.deepEqual(registry.resolve({type:'keyDown',control:true,shift:true,key:'y'},resolveShortcut,i=>i.key),{action:'tabs'});
 assert.deepEqual(registry.resolve({type:'keyDown',control:true,key:'Tab'},resolveShortcut,i=>i.key),{action:'tab-switcher',direction:1});
});

test('old files: Tab keys stay with the switcher, a cleared entry stays cleared, imports migrate too, new files untouched',()=>{
 let registry=withFile({'tab-switcher':['Ctrl+Tab','Ctrl+Shift+Y']});
 assert.deepEqual(view(registry,'tab-switcher').bindings,['Ctrl+Tab']);assert.deepEqual(view(registry,'tab-viewer').bindings,['Ctrl+Shift+Y']);
 registry=withFile({'tab-switcher':[]});
 assert.deepEqual(view(registry,'tab-switcher').bindings,[]);assert.deepEqual(view(registry,'tab-viewer').bindings,[]);
 registry=createShortcutRegistry({platform:'win32'});
 assert.equal(registry.importJson(JSON.stringify({version:1,bindings:{'tab-switcher':['Ctrl+Shift+Y']}})).ok,true);
 assert.deepEqual(view(registry,'tab-viewer').bindings,['Ctrl+Shift+Y']);
 registry=withFile({'tab-switcher':['Ctrl+Shift+Y'],'tab-viewer':['Ctrl+Shift+F9']});
 assert.deepEqual(view(registry,'tab-viewer').bindings,['Ctrl+Shift+F9'],'already-migrated files are left alone');
});
