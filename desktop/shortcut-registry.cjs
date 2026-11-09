'use strict';
const { tm } = require('./tm.cjs');
// One command registry for keyboard shortcuts: defaults, user customization (validated, persisted, exportable),
// conflict and reserved-key checks, safe recording, and the native dispatch layer in front of desktop/shortcuts.cjs.
const fs=require('node:fs'),path=require('node:path');
const {bundledTorSupported}=require('./platform.cjs');
const {writeFileAtomic}=require('./atomic-file.cjs');

const CATEGORIES=['Tabs','Windows','Navigation','Page','Library','Browser'];
// Labels and categories are the English source: this module loads before the language is known, so the interface shows them
// through the catalog by stable id (shortcutCmd.<id>, shortcutGroup.*; src/ui/shortcutKeys.ts commandLabel / commandGroup).
// defaults use Mod = Ctrl on Windows/Linux and Cmd on macOS. `action` is exactly what the native dispatcher switches on.
// `mac` replaces the defaults on macOS where the Windows key would collide with the system (Cmd+M minimizes) or where the Mac resolver in
// desktop/shortcuts.cjs answers other keys (Cmd+Y History, Cmd+[ Back, Option+letter types a character): the editor shows the keys that work.
// Where each default comes from (Chrome, Arc, Firefox, Edge or ours) is in docs/launch/SHORTCUTS.md.
const C=(id,label,category,action,defaults=[],mac)=>({id,label,category,action,defaults,...(mac?{mac}:{})});
const COMMANDS=[
 C('new-tab','New tab','Tabs',{action:'new-tab'},['Mod+T']),
 C('reopen-tab','Reopen closed tab','Tabs',{action:'restore'},['Mod+Shift+T']),
 C('private-tab','New private tab','Tabs',{action:'private-tab'},['Mod+Shift+P']),
 C('tor-tab','New Tor tab','Tabs',{action:'tor-tab'},[]),
 C('tor-identity','New Tor identity','Tabs',{action:'tor-identity'},['Mod+Shift+U']), // Tor Browser's New Identity key; asks first, only acts in Tor
 // Tor Browser's Ctrl+Shift+L is Seamless view here; in a Tor tab or window that key runs this instead (main.cjs shortcut()) unless the person gives it a key of its own.
 C('tor-circuit','New Tor circuit for this site','Tabs',{action:'tor-circuit'},[]),
 C('close-tab','Close tab','Tabs',{action:'close-tab'},['Mod+W','Mod+F4']),
 C('next-tab','Next tab','Tabs',{action:'cycle-tab',direction:1},['Mod+PageDown']),
 C('prev-tab','Previous tab','Tabs',{action:'cycle-tab',direction:-1},['Mod+PageUp']),
 C('tab-switcher','Switch tabs','Tabs',{action:'tab-switcher',direction:1},['Ctrl+Tab']),
 C('tab-switcher-back','Switch tabs, backwards','Tabs',{action:'tab-switcher',direction:-1},['Ctrl+Shift+Tab']),
 C('move-tab-left','Move tab left','Tabs',{action:'move-tab',direction:-1},['Mod+Shift+PageUp']),
 C('move-tab-right','Move tab right','Tabs',{action:'move-tab',direction:1},['Mod+Shift+PageDown']),
 ...Array.from({length:8},(_,i)=>C(`select-tab-${i+1}`,`Go to tab ${i+1}`,'Tabs',{action:'select-tab',index:i},[`Mod+${i+1}`])),
 C('select-last-tab','Go to last tab','Tabs',{action:'select-tab',index:-1},['Mod+9']),
 C('tab-viewer','Open tab switcher','Tabs',{action:'tabs'},['Alt+T','Mod+Shift+A']),
 C('duplicate-tab','Duplicate tab','Tabs',{action:'duplicate-tab'}),
 C('pin-tab','Pin or unpin tab','Tabs',{action:'pin-tab'}),
 C('mute-tab','Mute or unmute tab','Tabs',{action:'mute-tab'},['Mod+M'],[]),
 C('move-tab-window','Move tab to new window','Tabs',{action:'move-window'}),
 C('close-other-tabs','Close other tabs','Tabs',{action:'close-others'}),
 C('close-tabs-right','Close tabs to the right','Tabs',{action:'close-right'}),
 C('new-window','New window','Windows',{action:'new-window'},['Mod+N']),
 C('private-window','New private window','Windows',{action:'private-window'},['Mod+Shift+N']),
 // On a Mac Option+Shift+N types a character, so Option+Cmd+N there (Brave's Mac key for the same window; free in this table and in macOS).
 C('tor-window','New Tor window','Windows',{action:'tor-window'},['Alt+Shift+N'],['Mod+Alt+N']),
 C('close-window','Close window','Windows',{action:'close-window'},['Mod+Shift+W']),
 C('quit','Close Acira','Windows',{action:'quit'},['Mod+Shift+Q'],[]), // R4-36: asks first with several tabs open; Cmd+Q is the Mac app menu's
 C('fullscreen','Full screen','Windows',{action:'fullscreen'},['F11']),
 C('focus-mode','Focus view','Windows',{action:'focus-mode'},['Mod+Shift+F']),
 C('seamless-mode','Seamless view','Windows',{action:'seamless-mode'},['Mod+Shift+L']),
 C('view-full','Full view','Windows',{action:'window-view',view:'full'},[]),
 C('compact-toolbar','Compact view','Windows',{action:'toolbar-compact'},[]),
 C('workspace','Toggle sidebar','Windows',{action:'workspace'},['Mod+Shift+E']),
 C('split-view','Split view','Split view',{action:'split-view'},['Mod+Shift+S']),
 C('split-layout-columns','Split side by side','Split view',{action:'split-layout',layout:'columns'},['Mod+Shift+1']),
 C('split-layout-rows','Split top and bottom','Split view',{action:'split-layout',layout:'rows'},['Mod+Shift+2']),
 C('split-layout-three-columns','Split into three columns','Split view',{action:'split-layout',layout:'three-columns'},['Mod+Shift+3']),
 C('split-layout-top-two-bottom-one','Split two on top, one below','Split view',{action:'split-layout',layout:'top-two-bottom-one'},['Mod+Shift+4']),
 C('split-layout-left-one-right-two','Split one left, two right','Split view',{action:'split-layout',layout:'left-one-right-two'},['Mod+Shift+5']),
 C('split-layout-grid','Split into four','Split view',{action:'split-layout',layout:'grid'},['Mod+Shift+6']),
 C('split-focus-next','Next split pane','Split view',{action:'split-focus',direction:1},['Mod+F6']),
 C('split-focus-prev','Previous split pane','Split view',{action:'split-focus',direction:-1},['Mod+Shift+F6']),
 C('split-swap','Swap with the next pane','Split view',{action:'split-swap'},['Mod+Alt+F6']),
 C('split-close-pane','Close split pane','Split view',{action:'split-close-pane'},['Mod+Shift+F4']),
 C('split-exit','Exit split view','Split view',{action:'split-exit'},['Mod+Shift+0']),
 C('switch-profile','Switch profile','Windows',{action:'profile'},['Mod+Shift+M']),
 // Workspaces (R3-57): Alt+1–8 is free (Ctrl+1–9 is go to tab, Ctrl+Shift+1–6 the split layouts); on a Mac Option+digit types characters, so Ctrl.
 ...Array.from({length:8},(_,i)=>C(`switch-workspace-${i+1}`,`Go to workspace ${i+1}`,'Windows',{action:'switch-workspace',index:i},[`Alt+${i+1}`],[`Ctrl+${i+1}`])),
 // Next / previous workspace (R4-48 P1-5): Ctrl+PageDown is the next tab, Alt added moves between workspaces. Ctrl+Alt+PageDown/Up is free everywhere else in the table.
 C('next-workspace','Next workspace','Windows',{action:'workspace-cycle',direction:1},['Mod+Alt+PageDown']),
 C('prev-workspace','Previous workspace','Windows',{action:'workspace-cycle',direction:-1},['Mod+Alt+PageUp']),
 C('new-workspace','New workspace…','Windows',{action:'workspace-new'},[]),
 C('back','Back','Navigation',{action:'back'},['Alt+Left'],['Mod+[']),
 C('forward','Forward','Navigation',{action:'forward'},['Alt+Right'],['Mod+]']),
 C('home','Home','Navigation',{action:'home'},['Alt+Home'],[]),
 C('reload','Reload','Navigation',{action:'reload'},['Mod+R','F5']),
 C('hard-reload','Reload and bypass cache','Navigation',{action:'hard-reload'},['Mod+Shift+R','Mod+F5','Shift+F5']),
 C('address','Focus address bar','Navigation',{action:'address'},['Mod+L','Mod+E','Mod+K','F6','Alt+D'],['Mod+L','Mod+K','F6']),
 C('command-palette','Command search','Navigation',{action:'palette'},['Mod+Shift+K']),
 C('find','Find in page','Page',{action:'find'},['Mod+F']),
 C('ai-free','Turn AI-free mode on or off','Page',{action:'ai-free'},['Mod+Shift+X']),
 C('find-next','Find next','Page',{action:'find-next',forward:true},['F3','Mod+G']),
 C('find-prev','Find previous','Page',{action:'find-next',forward:false},['Shift+F3','Mod+Shift+G']),
 C('print','Print','Page',{action:'print'},['Mod+P']),
 C('save-pdf','Save page as PDF','Page',{action:'save-pdf'}),
 C('copy-url','Copy page address','Page',{action:'copy-url'},['Mod+Shift+C']),
 C('stop-capture','Stop sharing camera, microphone and screen','Page',{action:'stop-capture'}),
 C('save-page','Save page as','Page',{action:'save-page'},['Mod+S']),
 C('zoom-in','Zoom in','Page',{action:'zoom',change:1},['Mod+=','Mod+Shift+=']),
 C('zoom-out','Zoom out','Page',{action:'zoom',change:-1},['Mod+-']),
 C('zoom-reset','Actual size','Page',{action:'zoom',change:0},['Mod+0']),
 C('devtools','Developer tools','Page',{action:'devtools'},['F12','Mod+Shift+J','Mod+Shift+I'],['F12','Mod+Alt+I','Mod+Shift+I']),
 C('reader-mode','Reader mode','Page',{action:'reader'},['F9']),
 C('bookmark','Bookmark this page','Library',{action:'bookmark'},['Mod+D']),
 C('bookmark-all','Bookmark all tabs','Library',{action:'bookmark-all'}),
 C('pin-app','Pin tab to sidebar apps','Tabs',{action:'pin-app'},['Mod+Shift+D']),
 C('toggle-bookmarks-bar','Show or hide bookmarks bar','Library',{action:'toggle-bookmarks'},['Mod+Shift+B']),
 C('bookmarks-manager','Bookmarks','Library',{action:'bookmarks'},['Mod+Shift+O'],['Mod+Alt+B','Mod+Shift+O']),
 C('history','History','Library',{action:'history'},['Mod+H'],['Mod+Y']),
 C('rewind','Rewind','Library',{action:'rewind'},['Mod+Shift+H']),
 C('routines','Tab sets','Library',{action:'routines'}),
 C('run-routine','Open a tab set…','Library',{action:'routines',choose:true}),
 C('downloads','Downloads','Library',{action:'downloads'},['Mod+J'],['Mod+Shift+J','Mod+J']),
 // A Mac's delete key is Backspace (⌫): the stock Mac key is that one, so the key shown is a key every Mac keyboard has (the resolver also takes ⌦).
 C('clear-data','Clear browsing data','Library',{action:'clear-data'},['Mod+Shift+Delete'],['Mod+Shift+Backspace']),
 C('settings','Settings','Browser',{action:'settings'},['Mod+,']),
 C('menu','Open menu','Browser',{action:'menu'},['Alt+F','Alt+E'],[]),
 C('focus-toolbar','Focus the toolbar','Browser',{action:'focus-toolbar'},['Alt+Shift+T','F10'],['F10']),
 C('open-file','Open a file…','Browser',{action:'open-file'},['Mod+O']),
];
const BY_ID=new Map(COMMANDS.map(c=>[c.id,c]));
/** Commands another module owns as a set under one id prefix (one per saved routine). Replaced whole; stock commands are untouchable. */
function setDynamicCommands(prefix,commands){if(typeof prefix!=='string'||!/^[a-z]+:$/.test(prefix))throw new Error('Dynamic commands need a prefix like "routine:".');for(let i=COMMANDS.length-1;i>=0;i--)if(COMMANDS[i].id.startsWith(prefix)){BY_ID.delete(COMMANDS[i].id);COMMANDS.splice(i,1);}for(const c of commands.slice(0,200)){if(!c.id.startsWith(prefix)||BY_ID.has(c.id))continue;const command={...C(c.id,String(c.label).slice(0,120),c.category,c.action,(c.defaults||[]).slice(0,1)),dynamic:true,...(typeof c.note==='string'&&c.note?{note:c.note.slice(0,40)}:{})};COMMANDS.push(command);BY_ID.set(command.id,command);}}
const actionSignature=action=>JSON.stringify(Object.keys(action).sort().map(k=>[k,action[k]]));
const ID_BY_ACTION=new Map(COMMANDS.map(c=>[actionSignature(c.action),c.id]));
/** Command id for an action object produced by the default resolver, or null for actions that are not rebindable. */
const commandForAction=action=>{const {isAutoRepeat,...rest}=action||{};return ID_BY_ACTION.get(actionSignature(rest))||null;};

const KEY_TOKENS={left:'Left',right:'Right',up:'Up',down:'Down',arrowleft:'Left',arrowright:'Right',arrowup:'Up',arrowdown:'Down',pageup:'PageUp',pagedown:'PageDown',home:'Home',end:'End',escape:'Esc',esc:'Esc',tab:'Tab',enter:'Enter',return:'Enter',' ':'Space',space:'Space',pgup:'PageUp',pgdn:'PageDown',del:'Delete',ins:'Insert',spacebar:'Space',backspace:'Backspace',delete:'Delete',insert:'Insert','+':'=',add:'=',subtract:'-'};
const MODIFIERS=['Ctrl','Alt','Shift','Meta','Cmd'];
const NAMED_KEYS=new Set(['Left','Right','Up','Down','PageUp','PageDown','Home','End','Esc','Tab','Enter','Space','Backspace','Delete','Insert']);
const keyToken=raw=>{const lower=String(raw).toLowerCase();if(KEY_TOKENS[lower])return KEY_TOKENS[lower];if(/^f(?:[1-9]|1\d|2[0-4])$/.test(lower))return lower.toUpperCase();if(/^[a-z0-9]$/.test(lower))return lower.toUpperCase();if(/^[,./;'[\]\\\-=`]$/.test(lower))return lower;return null;};

/** Canonical form: modifiers in Ctrl, Alt, Shift, Meta/Cmd order then one key. Returns null when it cannot be parsed. */
function canonical(value,platform=process.platform){
 if(typeof value!=='string'||!value||value.length>40)return null;
 const parts=value.split('+').map(part=>part.trim());
 // A literal plus key is written Shift+=; a trailing empty segment means the user typed "+".
 let key=parts.pop();if(key===''&&parts.length&&parts.at(-1)===''){key='=';parts.pop();}
 const mods=new Set();
 for(const part of parts){
  const name={ctrl:'Ctrl',control:'Ctrl',alt:'Alt',option:'Alt',shift:'Shift',meta:'Meta',win:'Meta',super:'Meta',cmd:'Cmd',command:'Cmd',mod:platform==='darwin'?'Cmd':'Ctrl',commandorcontrol:platform==='darwin'?'Cmd':'Ctrl',cmdorctrl:platform==='darwin'?'Cmd':'Ctrl'}[part.toLowerCase()];
  if(!name||mods.has(name))return null;mods.add(name);
 }
 const token=keyToken(key);if(!token)return null;
 return [...MODIFIERS.filter(m=>mods.has(m)),token].join('+');
}
function accelFromInput(input,platform,keyOf){
 const key=keyToken(keyOf(input));if(!key)return null;
 const mods=[];if(input.control)mods.push('Ctrl');if(input.alt)mods.push('Alt');if(input.shift)mods.push('Shift');if(input.meta)mods.push(platform==='darwin'?'Cmd':'Meta');
 return [...mods,key].join('+');
}
const expand=(accel,platform)=>canonical(accel,platform);
// On a Mac the delete key (Backspace) is ⌫ and forward delete (fn+delete) is ⌦, as macOS menus print them.
const display=(accel,platform)=>accel.split('+').map(part=>platform==='darwin'?({Ctrl:'⌃',Alt:'⌥',Shift:'⇧',Cmd:'⌘',Backspace:'⌫',Delete:'⌦'}[part]||part):part).join(platform==='darwin'?'':' + ');

const PARKED_ID=/^ext:/,PARKED_MAX=400,PARKED_ID_MAX=300;   // ids of extension commands (desktop/browser-services/ext-api/commands.cjs PREFIX)
const RESERVED_COMBOS=new Set(['Ctrl+C','Ctrl+V','Ctrl+X','Ctrl+A','Ctrl+Z','Ctrl+Y','Ctrl+Shift+Z','Ctrl+Insert','Shift+Insert','Shift+Delete','Alt+Tab','Alt+Shift+Tab','Ctrl+Alt+Tab','Alt+F4','Alt+Esc','Alt+Space','Alt+Enter','Ctrl+Alt+Delete','Ctrl+Esc','Cmd+C','Cmd+V','Cmd+X','Cmd+A','Cmd+Z','Cmd+Shift+Z','Cmd+Q','Cmd+H','Cmd+M','Cmd+Tab','Cmd+Space']);
/** Returns null when an accelerator may be assigned, otherwise {code,message}. */
function restriction(accel,platform){
 const parts=accel.split('+'),key=parts.at(-1),mods=parts.slice(0,-1);
 if(RESERVED_COMBOS.has(accel))return {code:'reserved',message:tm("shortcutRegistry.platformIsReservedForEditing", { platform: display(accel,platform) })};
 if(key==='Esc')return {code:'reserved',message:tm("shortcutRegistry.escClosesDialogsAndStops")};
 if(platform!=='darwin'&&mods.includes('Meta'))return {code:'reserved',message:tm("shortcutRegistry.combinationsWithTheWindowsKey")};
 const functionKey=/^F\d+$/.test(key);
 if(!functionKey&&!mods.some(m=>['Ctrl','Alt','Meta','Cmd'].includes(m)))return {code:'needs-modifier',message:tm("shortcutRegistry.addCtrlAltOrCmd")};
 if(!functionKey&&!NAMED_KEYS.has(key)&&mods.includes('Alt')&&!mods.includes('Ctrl')&&!mods.includes('Meta')&&!mods.includes('Cmd'))return {code:'reserved',message:tm("shortcutRegistry.altWithALetterOr")};
 if(mods.includes('Ctrl')&&mods.includes('Alt')&&!functionKey&&!NAMED_KEYS.has(key))return {code:'reserved',message:tm("shortcutRegistry.ctrlAltWithACharacter")};
 if(['Tab','Enter','Space','Backspace'].includes(key)&&!mods.some(m=>['Ctrl','Alt','Meta','Cmd'].includes(m)))return {code:'reserved',message:tm("shortcutRegistry.thisKeyIsNeededFor")};
 return null;
}

function createShortcutRegistry({file,platform=process.platform,arch=process.arch,now=Date.now,onChange=()=>{},recordingTtlMs=30000}={}){
 // The Tor commands exist where Acira ships a Tor (platform.cjs bundledTorSupported: Windows, Mac arm64/x64, Linux x64 only), so a platform alone does not say; `arch` is a seam for tests.
 const supported=command=>Boolean(command)&&(!['tor-window','tor-tab'].includes(command.id)||bundledTorSupported(platform,arch));
 const availableCommands=()=>COMMANDS.filter(supported);
 let custom=new Map(); // command id -> canonical accelerators (empty = deliberately unbound)
 // Keys the person gave an extension's command stay in the file while that extension is not loaded (turned off, another profile not open yet,
 // still starting): they are parked here, written back on every save and handed back when the command is registered again. Only removing
 // the extension (forgetParked) or Reset all drops them.
 let parked=new Map();
 let recording=null;
 const defaultsOf=command=>(platform==='darwin'&&command.mac||command.defaults).map(accel=>expand(accel,platform)).filter(Boolean);
 const bindingsOf=command=>custom.has(command.id)?custom.get(command.id):defaultsOf(command);
 function effective(){const map=new Map();for(const command of availableCommands())for(const accel of bindingsOf(command))if(!map.has(accel))map.set(accel,command.id);return map;}
 function view(command){const bindings=bindingsOf(command);return {id:command.id,label:command.label,category:command.category,defaults:defaultsOf(command),defaultsDisplay:defaultsOf(command).map(a=>display(a,platform)),bindings,display:bindings.map(a=>display(a,platform)),customized:custom.has(command.id),unbound:bindings.length===0,...(command.note?{note:command.note}:{})};}
 const list=()=>availableCommands().map(view);
 function save(){
  if(!file)return;
  const body=JSON.stringify({version:1,bindings:{...Object.fromEntries(custom),...Object.fromEntries([...parked].filter(([id])=>!custom.has(id)))}},null,1);
  fs.mkdirSync(path.dirname(file),{recursive:true});writeFileAtomic(file,body); // Windows: a scanner can refuse the rename for a moment (atomic-file.cjs retries)
 }
 function validateTable(bindings){
  if(!bindings||typeof bindings!=='object'||Array.isArray(bindings))throw new Error('Shortcut file has no bindings.');
  // Older files keyed both Ctrl+Tab "Switch tabs" and the Alt+T viewer as 'tab-switcher'. Keys ending in Tab
  // stay with the switcher; every other key moves to 'tab-viewer' (what those keys ran). No Tab key left = switcher defaults.
  if(Array.isArray(bindings['tab-switcher'])&&!Object.hasOwn(bindings,'tab-viewer')){const all=bindings['tab-switcher'],tabKey=a=>/(^|\+)Tab$/i.test(String(a).trim()),switcher=all.filter(tabKey),{['tab-switcher']:_old,...rest}=bindings;bindings={...rest,'tab-viewer':all.filter(a=>!tabKey(a)),...(switcher.length||!all.length?{'tab-switcher':switcher}:{})};}
  const next=new Map(),seen=new Map();
  for(const [id,value] of Object.entries(bindings)){
   if(!supported(BY_ID.get(id))||!Array.isArray(value)||value.length>4)continue;
   const accels=[];
   for(const raw of value){const accel=canonical(raw,platform);if(!accel||restriction(accel,platform))continue;if(seen.has(accel))continue;seen.set(accel,id);accels.push(accel);}
   // A list the person wrote but none of whose keys can be used (a key this platform or this version refuses, or one another command already has) leaves the command on
   // its default: only an empty list in the file clears it.
   if(value.length&&!accels.length)continue;
   next.set(id,accels);
  }
  // A custom accelerator that collides with an untouched default of another command is dropped (defaults stay stable).
  for(const command of availableCommands())if(!next.has(command.id))for(const accel of defaultsOf(command))if(seen.has(accel)&&seen.get(accel)!==command.id){
   const owner=seen.get(accel);next.set(owner,(next.get(owner)||[]).filter(a=>a!==accel));
  }
  return next;
 }
 /** Entries of the saved table that belong to an extension command which is not registered now. */
 function parkedKeys(bindings,known){
  const out=new Map();
  if(!bindings||typeof bindings!=='object'||Array.isArray(bindings))return out;
  for(const [id,value] of Object.entries(bindings)){
   if(out.size>=PARKED_MAX)break;
   if(!PARKED_ID.test(id)||id.length>PARKED_ID_MAX||known.has(id)||BY_ID.has(id)||!Array.isArray(value)||value.length>4)continue;
   const accels=[];
   for(const raw of value){const accel=canonical(raw,platform);if(accel&&!accels.includes(accel))accels.push(accel);}
   out.set(id,accels);
  }
  return out;
 }
 function load(){
  if(!file)return;
  // a damaged file is kept aside before the defaults can be saved over it (atomic-file.cjs readJsonFile)
  try{const bindings=require('./atomic-file.cjs').readJsonFile(file,{maxBytes:64*1024}).bindings;custom=validateTable(bindings);parked=parkedKeys(bindings,custom);}catch{custom=new Map();parked=new Map();}
 }
 function conflictFor(accel,id){const owner=effective().get(accel);return owner&&owner!==id?BY_ID.get(owner):null;}

 /** Assign one accelerator to a command (replacing its bindings). Conflicts are refused unless replace is true. */
 function set(id,value,{replace=false}={}){
  const command=BY_ID.get(id);if(!supported(command))return {ok:false,code:'unknown',message:tm("nativeCore.unknownCommand")};
  const accel=canonical(value,platform);if(!accel)return {ok:false,code:'invalid',message:tm("shortcutRegistry.thatKeyCombinationCouldNot")};
  const blocked=restriction(accel,platform);if(blocked)return {ok:false,...blocked};
  const conflict=conflictFor(accel,id);
  if(conflict&&!replace)return {ok:false,code:'conflict',message:tm("shortcutRegistry.platformIsAlreadyUsedBy", { platform: display(accel,platform), label: conflict.label }),conflict:{id:conflict.id,label:conflict.label}};
  if(conflict)custom.set(conflict.id,bindingsOf(conflict).filter(a=>a!==accel));
  custom.set(id,[accel]);save();onChange();
  return {ok:true,binding:accel,display:display(accel,platform),replaced:conflict?{id:conflict.id,label:conflict.label}:null,commands:list()};
 }
 function clear(id){if(!supported(BY_ID.get(id)))return {ok:false,code:'unknown',message:tm("nativeCore.unknownCommand")};custom.set(id,[]);save();onChange();return {ok:true,commands:list()};}
 function reset(id){if(!supported(BY_ID.get(id)))return {ok:false,code:'unknown',message:tm("nativeCore.unknownCommand")};
  custom.delete(id);
  // Restoring defaults must not leave two commands on one key: the reset command wins, the other loses that key.
  const mine=new Set(defaultsOf(BY_ID.get(id)));
  for(const [other,accels] of custom)if(other!==id&&accels.some(a=>mine.has(a)))custom.set(other,accels.filter(a=>!mine.has(a)));
  save();onChange();return {ok:true,commands:list()};}
 function resetAll(){custom=new Map();parked=new Map();save();onChange();return {ok:true,commands:list()};}
 /** An extension was removed for good: its parked keys (ids starting with prefix) go with it. */
 function forgetParked(prefix){
  if(typeof prefix!=='string'||!PARKED_ID.test(prefix))return {ok:false};
  let dropped=0;
  for(const id of [...parked.keys()])if(id.startsWith(prefix)){parked.delete(id);dropped++;}
  if(dropped){save();onChange();}
  return {ok:true,dropped};
 }
 const exportJson=()=>JSON.stringify({version:1,app:'acira-browser',bindings:Object.fromEntries(custom)},null,1);
 function importJson(text){
  if(typeof text!=='string'||text.length>64*1024)return {ok:false,code:'invalid',message:tm("shortcutRegistry.shortcutFileIsTooLarge")};
  let parsed;try{parsed=JSON.parse(text);}catch{return {ok:false,code:'invalid',message:tm("shortcutRegistry.shortcutFileIsNotValid")};}
  if(parsed?.version!==1)return {ok:false,code:'invalid',message:tm("shortcutRegistry.thisShortcutFileVersionIs")};
  try{custom=validateTable(parsed.bindings);}catch(error){return {ok:false,code:'invalid',message:error.message};}
  save();onChange();return {ok:true,commands:list()};
 }

 // Recording captures the next accelerator without running it.
 function startRecording(owner){recording={owner,until:now()+recordingTtlMs};return {ok:true};}
 function stopRecording(){recording=null;return {ok:true};}
 const isRecording=()=>Boolean(recording&&recording.until>now())||(recording=null,false);
 /** Modifiers held after this key event, in display order (the key being pressed counts, the one being released doesn't). */
 function heldModifiers(input,pressed){
  const names={control:'Ctrl',alt:'Alt',altgraph:'Alt',shift:'Shift',meta:platform==='darwin'?'Cmd':'Meta',os:platform==='darwin'?'Cmd':'Meta'},own=names[pressed];
  const held=new Set([input.control&&'Ctrl',input.alt&&'Alt',input.shift&&'Shift',input.meta&&(platform==='darwin'?'Cmd':'Meta')].filter(Boolean));
  if(own)input.type==='keyUp'?held.delete(own):held.add(own);
  return MODIFIERS.filter(m=>held.has(m));
 }
 function describe(accel,forId){
  if(!accel)return null;const blocked=restriction(accel,platform),conflict=conflictFor(accel,forId);
  return {accelerator:accel,display:display(accel,platform),valid:!blocked,reason:blocked?.message||null,code:blocked?.code||null,conflict:conflict?{id:conflict.id,label:conflict.label}:null};
 }

 /** Native dispatch: user bindings first, then the stock resolver minus anything the user rebound or cleared. */
 function resolve(input,defaultResolver,keyOf){
  if(!input||input.type!=='keyDown'&&!(input.type==='keyUp'&&recording))return null;
  if(isRecording()){
   // Each key while recording keeps it alive, so a slow, deliberate press never runs into the time limit.
   recording.until=now()+recordingTtlMs;
   const MOD_ONLY=new Set(['control','shift','alt','meta','altgraph','os']),pressed=String(input.key||'').toLowerCase();
   // Modifiers alone (down or up) report what is held, so the editor can show the key caps as they are pressed.
   if(MOD_ONLY.has(pressed)||input.type==='keyUp')return MOD_ONLY.has(pressed)?{action:'record-pending',held:heldModifiers(input,pressed)}:null;
   const accel=accelFromInput(input,platform,keyOf);
   // Plain Backspace (or Delete) clears the shortcut; plain Esc cancels.
   if(accel==='Backspace'||accel==='Delete')return {action:'record-key',accelerator:null,valid:false,reason:null,conflict:null,cancel:false,clear:true};
   return {action:'record-key',...(describe(accel,null)||{accelerator:null,valid:false,reason:tm("shortcutRegistry.thatKeyCombinationCouldNot")}),cancel:accel==='Esc'};
  }
  if(input.type!=='keyDown')return null;
  const accel=accelFromInput(input,platform,keyOf);
  // Dynamic commands (saved routines) have no stock resolver entry: their effective keys answer directly.
  if(accel){const owner=BY_ID.get(effective().get(accel));if(owner?.dynamic)return {...owner.action};}
  if(accel&&custom.size){
   const owner=effective().get(accel);if(owner&&custom.has(owner)&&custom.get(owner).includes(accel))return {...BY_ID.get(owner).action};
  }
  const base=defaultResolver(input,platform);
  const baseId=base&&commandForAction(base);if(baseId&&!supported(BY_ID.get(baseId)))return null;
  if(!base||!custom.size)return base;
  const id=commandForAction(base);
  // A command the user changed or cleared no longer answers to its stock keys.
  if(id&&custom.has(id)&&!custom.get(id).includes(accel))return null;
  return base;
 }
 load();
 return {platform,setDynamic(prefix,commands){setDynamicCommands(prefix,commands);load();onChange();},list,set,clear,reset,resetAll,forgetParked,exportJson,importJson,startRecording,stopRecording,isRecording,describe,resolve,load,effective,get commands(){return availableCommands();},canonical:value=>canonical(value,platform),
  /** A command's first key as menus print it ("Alt+←", "Ctrl+Shift+T"; "⇧⌘T" on macOS), or undefined when it has none. */
  menuKey(id){const command=BY_ID.get(id),first=command&&bindingsOf(command)[0];if(!first)return undefined;if(platform==='darwin')return display(first,platform);const arrows={Left:'←',Right:'→',Up:'↑',Down:'↓',PageUp:'PgUp',PageDown:'PgDn'};return first.split('+').map(key=>arrows[key]||key).join('+');},
  /** Label -> accelerator display for toolbar hints. */
  hints(){const map={};for(const command of availableCommands()){const first=bindingsOf(command)[0];if(first)map[command.id]=display(first,platform);}return map;}};
}
module.exports={createShortcutRegistry,COMMANDS,CATEGORIES,canonical,restriction,commandForAction,accelFromInput,display};
