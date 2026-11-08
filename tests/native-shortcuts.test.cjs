'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createShortcutRegistry,COMMANDS,canonical,commandForAction}=require('../desktop/shortcut-registry.cjs');
const {resolveDefaultShortcut,shortcutKey}=require('../desktop/shortcuts.cjs');
const win='win32';
const key=(k,mods=[],code)=>({type:'keyDown',key:k,code:code||(/^[a-z]$/i.test(k)?'Key'+k.toUpperCase():k),control:mods.includes('ctrl'),shift:mods.includes('shift'),alt:mods.includes('alt'),meta:mods.includes('meta')});
const make=(file)=>createShortcutRegistry({file,platform:win});
const resolve=(r,input)=>r.resolve(input,resolveDefaultShortcut,shortcutKey);
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-shortcuts-'));

test('Tor commands are available on supported Mac, Windows and Linux builds and stay out of unsupported platforms',()=>{
 for(const platform of ['freebsd']){
  const r=createShortcutRegistry({platform});
  for(const id of ['tor-window','tor-tab']){
   assert.ok(!r.list().some(command=>command.id===id));
   assert.ok(!r.commands.some(command=>command.id===id));
   assert.equal(r.hints()[id],undefined);
   assert.equal(r.set(id,'Ctrl+Shift+Y').ok,false);
  }
  assert.ok(!r.commands.some(command=>command.id==='tor-window'));
  assert.equal(r.hints()['tor-window'],undefined);
  assert.equal(r.set('tor-window','Ctrl+Shift+Y').ok,false);
  assert.equal(r.importJson(JSON.stringify({version:1,bindings:{'tor-window':['Alt+Shift+N']}})).ok,true);
  assert.equal(resolve(r,key('n',['alt','shift'])),null);
 }
 // Tor is bundled for Windows, Mac (arm64 and x64) and Linux x64 only (desktop/platform.cjs bundledTorSupported, tests/tor-linux.test.cjs): the architecture is given, so the test does not depend on the machine it runs on
 for(const [platform,arch] of [['darwin','arm64'],['darwin','x64'],['win32','x64'],['win32','arm64'],['linux','x64']]){const supported=createShortcutRegistry({platform,arch});for(const id of ['tor-window','tor-tab'])assert(supported.list().some(command=>command.id===id),platform+' '+arch+' '+id);}
 {const linuxArm=createShortcutRegistry({platform:'linux',arch:'arm64'});for(const id of ['tor-window','tor-tab']){assert.ok(!linuxArm.list().some(command=>command.id===id),'no bundled Tor for Linux arm64: '+id);assert.equal(linuxArm.hints()[id],undefined);assert.equal(linuxArm.set(id,'Ctrl+Shift+Y').ok,false);}}
 const windows=createShortcutRegistry({platform:'win32'});
 for(const id of ['tor-window','tor-tab'])assert.ok(windows.list().some(command=>command.id===id));
 assert.equal(resolve(windows,key('n',['alt','shift'])).action,'tor-window');
});

test('every stock binding resolves to a registered command and matches the stock resolver',()=>{
 const r=make(null);let checked=0;
 for(const command of COMMANDS)for(const accel of command.defaults){
  const parts=canonical(accel,win).split('+'),name=parts.pop(),mods=parts.map(p=>p.toLowerCase()),map={Left:'ArrowLeft',Right:'ArrowRight',Up:'ArrowUp',Down:'ArrowDown',Esc:'Escape'};
  const code=name==='='?'Equal':name==='-'?'Minus':name===','?'Comma':undefined;
  const input=key(map[name]||(name.length===1?name.toLowerCase():name),mods,code);
  const action=resolve(r,input);
  assert.ok(action,`${command.id} ${accel} resolved nothing`);
  assert.equal(commandForAction(action),command.id,`${command.id} ${accel} -> ${JSON.stringify(action)}`);checked++;
 }
 assert.ok(checked>=60,String(checked));
});

test('rebinding replaces the stock keys; an unrelated stock key keeps working',()=>{
 const r=make(null);
 assert.equal(r.set('new-tab','Ctrl+Shift+Y').ok,true);
 assert.equal(resolve(r,key('y',['ctrl','shift'])).action,'new-tab');
 assert.equal(resolve(r,key('t',['ctrl'])),null,'old stock key no longer opens a tab');
 assert.equal(resolve(r,key('w',['ctrl'])).action,'close-tab');
 assert.deepEqual(r.list().find(c=>c.id==='new-tab').bindings,['Ctrl+Shift+Y']);
});

test('conflicts are reported and only replaced on request',()=>{
 const r=make(null);
 const refused=r.set('duplicate-tab','Ctrl+T');
 assert.equal(refused.ok,false);assert.equal(refused.code,'conflict');assert.equal(refused.conflict.id,'new-tab');
 assert.equal(resolve(r,key('t',['ctrl'])).action,'new-tab');
 const replaced=r.set('duplicate-tab','Ctrl+T',{replace:true});
 assert.equal(replaced.ok,true);assert.equal(replaced.replaced.id,'new-tab');
 assert.equal(resolve(r,key('t',['ctrl'])).action,'duplicate-tab');
 assert.equal(r.list().find(c=>c.id==='new-tab').unbound,true);
 assert.equal(r.reset('new-tab').ok,true);
 assert.equal(resolve(r,key('t',['ctrl'])).action,'new-tab','reset command takes its stock key back');
 assert.equal(r.list().find(c=>c.id==='duplicate-tab').unbound,true);
});

test('reserved, modifier-less and layout-sensitive combinations are refused',()=>{
 const r=make(null);
 for(const [accel,code] of [['Ctrl+C','reserved'],['Ctrl+V','reserved'],['Alt+F4','reserved'],['Esc','reserved'],['Meta+T','reserved'],['T','needs-modifier'],['Shift+T','needs-modifier'],['Ctrl+Alt+Q','reserved'],['Alt+Q','reserved']]){
  const result=r.set('pin-tab',accel);assert.equal(result.ok,false,accel);assert.equal(result.code,code,accel);
 }
 assert.equal(r.set('pin-tab','F7').ok,true,'function keys need no modifier');
 assert.equal(r.set('pin-tab','nonsense').code,'invalid');
 assert.equal(r.set('missing','Ctrl+Q').code,'unknown');
});

test('clear leaves a command unbound; reset-all restores every default',()=>{
 const r=make(null);
 r.clear('print');assert.equal(resolve(r,key('p',['ctrl'])),null);
 r.set('find','Ctrl+Shift+J',{replace:true});
 assert.ok(r.list().some(c=>c.customized));
 r.resetAll();
 assert.equal(resolve(r,key('p',['ctrl'])).action,'print');assert.equal(resolve(r,key('f',['ctrl'])).action,'find');
 assert.ok(r.list().every(c=>!c.customized));
});

test('bindings persist to a validated local file and survive a corrupt file',()=>{
 const dir=tmp(),file=path.join(dir,'shortcuts.json');
 const a=make(file);a.set('pin-tab','Ctrl+Shift+Y');a.clear('print');
 const b=make(file);
 assert.equal(resolve(b,key('y',['ctrl','shift'])).action,'pin-tab');assert.equal(resolve(b,key('p',['ctrl'])),null);
 fs.writeFileSync(file,'{not json');
 const c=make(file);assert.equal(resolve(c,key('p',['ctrl'])).action,'print');
 fs.writeFileSync(file,JSON.stringify({version:1,bindings:{'pin-tab':['Ctrl+C'],'mute-tab':['Ctrl+Shift+Y','Ctrl+Shift+Y'],bogus:['Ctrl+Q']}}));
 const d=make(file);assert.deepEqual(d.list().find(x=>x.id==='pin-tab').bindings,[]);assert.deepEqual(d.list().find(x=>x.id==='mute-tab').bindings,['Ctrl+Shift+Y']);
});

test('export and import round-trip and reject foreign files',()=>{
 const a=make(null);a.set('pin-tab','Ctrl+Shift+Y');
 const json=a.exportJson(),b=make(null);
 assert.equal(b.importJson(json).ok,true);assert.equal(resolve(b,key('y',['ctrl','shift'])).action,'pin-tab');
 assert.equal(b.importJson('nope').ok,false);assert.equal(b.importJson(JSON.stringify({version:9,bindings:{}})).ok,false);
 assert.equal(b.importJson('x'.repeat(70000)).ok,false);
});

test('recording captures a key without running it and Escape cancels',()=>{
 const r=make(null);r.startRecording('w1');
 const modOnly=resolve(r,{...key('Control'),control:true});assert.equal(modOnly.action,'record-pending');
 const recorded=resolve(r,key('t',['ctrl']));
 assert.equal(recorded.action,'record-key');assert.equal(recorded.accelerator,'Ctrl+T');assert.equal(recorded.valid,true);assert.equal(recorded.conflict.id,'new-tab');
 const reserved=resolve(r,key('c',['ctrl']));assert.equal(reserved.valid,false);assert.match(reserved.reason,/reserved/);
 assert.equal(resolve(r,key('Escape')).cancel,true);
 r.stopRecording();assert.equal(resolve(r,key('t',['ctrl'])).action,'new-tab');
});

test('recording expires on its own',()=>{
 let now=1000;const r=createShortcutRegistry({platform:win,now:()=>now,recordingTtlMs:500});
 r.startRecording('w');assert.equal(r.isRecording(),true);now+=600;assert.equal(r.isRecording(),false);
 assert.equal(resolve(r,key('t',['ctrl'])).action,'new-tab');
});

test('non-Latin layouts resolve by physical key and keypad zoom keys still work',()=>{
 const r=make(null);
 assert.equal(resolve(r,{type:'keyDown',key:'е',code:'KeyT',control:true}).action,'new-tab');
 assert.equal(resolve(r,{type:'keyDown',key:'Add',code:'NumpadAdd',control:true}).action,'zoom');
 assert.equal(resolve(r,{type:'keyDown',key:'0',code:'Numpad0',control:true}).change,0);
});

test('settings validation accepts valid search providers and rejects unsafe templates',()=>{
 const {validateAction}=require('../desktop/validation.cjs');
 const {createInitialState}=require('../desktop/runtime.cjs');
 const state=createInitialState();
 const engines=[{id:'wiki',name:'Wikipedia',keyword:'w',template:'https://en.wikipedia.org/wiki/Special:Search?search=%s'}];
 assert.doesNotThrow(()=>validateAction({type:'settings.update',patch:{searchProviders:{defaultId:'wiki',engines}}},state));
 assert.doesNotThrow(()=>validateAction({type:'settings.update',patch:{searchProviders:null}},state));
 for(const template of ['http://insecure.test/?q=%s','https://user:pw@x.test/?q=%s','https://x.test/?q=','https://x.test/?q=%s&b=%s','https://%s.evil.test/'])
  assert.throws(()=>validateAction({type:'settings.update',patch:{searchProviders:{defaultId:'wiki',engines:[{...engines[0],template}]}}},state),/template|HTTPS|%s|origin/i,template);
 assert.throws(()=>validateAction({type:'settings.update',patch:{searchProviders:{defaultId:'missing',engines}}},state),/default/i);
});

test('keys Windows keeps for itself are refused with a reason, and a key another command uses is reported as a clash (editor warning)',()=>{
 const registry=createShortcutRegistry({platform:'win32'});
 for(const key of ['Win+E','Meta+L','Alt+F4','Ctrl+Alt+Delete','Ctrl+Shift+Esc','Alt+Shift+Tab','Ctrl+Alt+Tab','Alt+Tab']){const info=registry.describe(registry.canonical(key),'close-tab');assert.equal(info.valid,false,key);assert.equal(info.code,'reserved',key);assert.ok(info.reason,key);}
 const clash=registry.describe(registry.canonical('Ctrl+T'),'close-tab');assert.equal(clash.valid,true);assert.equal(clash.conflict.id,'new-tab');
 const refused=registry.set('close-tab','Alt+F4');assert.equal(refused.ok,false);assert.equal(refused.code,'reserved');
});

test('defaults never collide, and none of them is a key Windows keeps for itself',()=>{
 const {restriction}=require('../desktop/shortcut-registry.cjs');
 // Alt+letter defaults are Chrome's own (menu, address, tab viewer, Tor window); the editor refuses new ones for layouts that type with Alt.
 // Alt+1–8 switch workspaces (R3-57; Ctrl+1–9 is go to tab, Ctrl+Shift+1–6 the split layouts, so Alt is the free one).
 const chromeAltLetters=new Set(['Alt+F','Alt+E','Alt+D','Alt+T','Alt+Shift+N','Alt+Shift+T',...Array.from({length:8},(_,i)=>`Alt+${i+1}`)]);
 const owner=new Map();
 for(const command of COMMANDS)for(const raw of command.defaults){
  const accel=canonical(raw,win);assert.ok(accel,raw);
  assert.ok(!owner.has(accel),`${accel} is a default of both ${owner.get(accel)} and ${command.id}`);owner.set(accel,command.id);
  const blocked=restriction(accel,win);
  if(blocked)assert.ok(chromeAltLetters.has(accel),`${command.id} default ${accel} is restricted: ${blocked.message}`);
 }
 for(const reserved of ['Alt+F4','Alt+Tab','Alt+Space','Ctrl+Esc','Ctrl+Shift+Esc','Ctrl+Alt+Delete','Shift+F10'])assert.ok(!owner.has(canonical(reserved,win)),reserved);
});

test('Chrome and Arc keys added in the coverage pass reach their commands',()=>{
 const r=make(null);
 for(const [input,id] of [[key('i',['ctrl','shift']),'devtools'],[key('e',['alt']),'menu'],[key('p',['ctrl','shift']),'private-tab'],[key('m',['ctrl']),'mute-tab'],[key('o',['ctrl']),'open-file'],[key('F9'),'reader-mode'],[key('F10'),'focus-toolbar'],[key('t',['alt','shift']),'focus-toolbar']])
  assert.equal(commandForAction(resolve(r,input)),id,JSON.stringify(input));
 assert.equal(resolve(r,key('F10',['shift'])),null,'Shift+F10 stays the context-menu key');
 assert.equal(resolve(r,key('t',['alt'])).action,'tabs','Alt+T still opens the tab viewer');
 assert.equal(resolve(r,key('p',['ctrl'])).action,'print');
 const mac=createShortcutRegistry({platform:'darwin'});
 assert.deepEqual(mac.list().find(c=>c.id==='mute-tab').bindings,[],'no Cmd+M on macOS (minimize)');
});

test('recording reports held modifiers live, Backspace clears and a slow press never times out',()=>{
 let now=1000;const r=createShortcutRegistry({platform:win,now:()=>now,recordingTtlMs:500});r.startRecording('w');
 assert.deepEqual(resolve(r,{...key('Control'),control:true}).held,['Ctrl']);
 assert.deepEqual(resolve(r,{...key('Shift'),control:true,shift:true}).held,['Ctrl','Shift']);
 now+=400;assert.deepEqual(resolve(r,{type:'keyUp',key:'Shift',code:'ShiftLeft',control:true,shift:true}).held,['Ctrl'],'a released key leaves the caps');
 now+=400;assert.equal(r.isRecording(),true,'each key keeps recording alive');
 assert.equal(resolve(r,{type:'keyUp',key:'t',code:'KeyT',control:true}),null,'other key-ups are ignored');
 const cleared=resolve(r,key('Backspace'));assert.equal(cleared.action,'record-key');assert.equal(cleared.clear,true);
 r.stopRecording();assert.equal(resolve(r,{type:'keyUp',key:'Control',code:'ControlLeft'}),null,'key-ups do nothing outside recording');
});

test('menus get each command live key',()=>{
 const r=make(null);assert.equal(r.menuKey('back'),'Alt+←');assert.equal(r.menuKey('reopen-tab'),'Ctrl+Shift+T');
 r.set('reload','Ctrl+Shift+Y');assert.equal(r.menuKey('reload'),'Ctrl+Shift+Y');r.clear('print');assert.equal(r.menuKey('print'),undefined);
});


test('website zoom renders every supported ratio independently of interface size on Mac and Windows', {skip:!['darwin','win32'].includes(process.platform),timeout:240000},()=>{
 const {spawnSync}=require('node:child_process');
 const repo=path.resolve(__dirname,'..'),out=path.join(repo,'qa/artifacts/page-zoom-test-'+Date.now());
 const result=spawnSync(process.execPath,['qa/page-zoom-rendering.mjs'],{cwd:repo,env:{...process.env,PAGE_ZOOM_OUT:out},encoding:'utf8',timeout:230000,maxBuffer:2*1024*1024});
 assert.equal(result.status,0,((result.stdout||'')+'\n'+(result.stderr||'')).slice(-7000));
 const report=JSON.parse(fs.readFileSync(path.join(out,'result.json'),'utf8'));
 assert.equal(report.passed,true);assert.equal(report.checks.filter(c=>!c.passed).length,0);
 assert.equal(report.checks.filter(c=>/^Website \d+% with interface/.test(c.name)).length,102);
});

test('on macOS every default key the editor shows reaches its command, and Rewind is not swallowed as Hide',()=>{
 const mac=createShortcutRegistry({platform:'darwin'}),named={PageDown:'PageDown',PageUp:'PageUp',Left:'ArrowLeft',Right:'ArrowRight',Up:'ArrowUp',Down:'ArrowDown',Home:'Home',End:'End',Tab:'Tab',Esc:'Escape',Space:' ',Enter:'Enter',Backspace:'Backspace',Delete:'Delete'};
 const dead=[];
 for(const command of mac.list())for(const accel of command.bindings){
  const parts=accel.split('+'),last=parts.pop(),mods=new Set(parts),typed=named[last]||last;
  const input={type:'keyDown',key:typed,code:/^[A-Za-z]$/.test(last)?'Key'+last.toUpperCase():/^[0-9]$/.test(last)?'Digit'+last:'',control:mods.has('Ctrl'),alt:mods.has('Alt'),shift:mods.has('Shift'),meta:mods.has('Cmd')};
  const base=resolveDefaultShortcut(input,'darwin');
  if(!base||commandForAction(base)!==command.id)dead.push(`${command.id}: ${accel}`);
 }
 // Every Mac default works: New Tor window is Option+Cmd+N there (Option+Shift+N, its Windows key, types a character on a Mac).
 assert.deepEqual(dead,[]);
 assert.deepEqual(mac.list().find(command=>command.id==='tor-window').bindings,['Alt+Cmd+N']);
 assert.equal(resolveDefaultShortcut({type:'keyDown',key:'h',code:'KeyH',meta:true,shift:true,control:false,alt:false},'darwin').action,'rewind');
 assert.equal(resolveDefaultShortcut({type:'keyDown',key:'h',code:'KeyH',meta:true,shift:false,control:false,alt:false},'darwin'),null,'Cmd+H stays Hide');
 assert.equal(mac.list().find(command=>command.id==='history').bindings[0],'Cmd+Y');
});
