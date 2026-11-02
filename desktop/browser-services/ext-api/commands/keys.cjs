'use strict';
// The "commands" key of an extension manifest: Chromium's rules for suggested shortcuts (extensions/common/command.cc) and the accelerator form
// Acira's shortcut registry (desktop/shortcut-registry.cjs) uses.
const EXECUTE=['_execute_action','_execute_browser_action','_execute_page_action'];
const MAX_SUGGESTED=4;   // an extension may suggest at most four shortcuts
const MODIFIERS=['Ctrl','Alt','Shift','Command','MacCtrl'];
const NAMED={Comma:',',Period:'.',Space:'Space',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown',Insert:'Insert',Delete:'Delete',Up:'Up',Down:'Down',Left:'Left',Right:'Right',
 MediaNextTrack:'MediaNextTrack',MediaPlayPause:'MediaPlayPause',MediaPrevTrack:'MediaPrevTrack',MediaStop:'MediaStop'};
const MEDIA=new Set(['MediaNextTrack','MediaPlayPause','MediaPrevTrack','MediaStop']);

const platformKey=(platform=process.platform)=>(platform==='win32'?'windows':platform==='darwin'?'mac':'linux');
/** The shortcut text for this platform from a suggested_key (a string, or {default, windows, mac, linux, chromeos}), or '' */
function suggestedFor(suggested,platform=process.platform){
 if(typeof suggested==='string')return suggested;
 if(!suggested||typeof suggested!=='object')return '';
 const own=suggested[platformKey(platform)];
 return typeof own==='string'?own:typeof suggested.default==='string'?suggested.default:'';
}

/**
 * "Ctrl+Shift+Y" -> the registry's accelerator ("Ctrl+Shift+Y"; Command is Cmd; Ctrl means Command on a Mac, MacCtrl is the Control key), or null
 * when Chromium would not accept it: it needs Ctrl or Alt (Command on a Mac) unless it is a media key, one key from A-Z 0-9 F1-F12 or the named ones.
 */
function parseAccelerator(text,platform=process.platform){
 if(typeof text!=='string')return null;
 const parts=text.split('+').map(part=>part.trim());
 if(parts.some(part=>!part))return null;
 const key=parts.pop(),mods=new Set();
 for(const part of parts){
  if(!MODIFIERS.includes(part)||mods.has(part))return null;
  mods.add(part);
 }
 if(platform!=='darwin'&&(mods.has('Command')||mods.has('MacCtrl')))return null;
 let token;
 if(/^[A-Z0-9]$/.test(key))token=key;
 else if(/^F(?:[1-9]|1[0-2])$/.test(key))token=key;
 else if(NAMED[key])token=NAMED[key];
 else return null;
 const media=MEDIA.has(key);
 const out=[];
 const mac=platform==='darwin';
 const ctrl=mac?mods.has('MacCtrl'):mods.has('Ctrl'),command=mac&&(mods.has('Ctrl')||mods.has('Command')),alt=mods.has('Alt'),shift=mods.has('Shift');
 if(!media&&!ctrl&&!alt&&!command)return null;
 if(media&&(ctrl||alt||command||shift))return null;
 if(ctrl)out.push('Ctrl');
 if(alt)out.push('Alt');
 if(shift)out.push('Shift');
 if(command)out.push('Cmd');
 out.push(token);
 return out.join('+');
}

/**
 * Every command of an extension: [{name, description, key (accelerator or ''), execute (name starts with _execute_)}], at most MAX_SUGGESTED of them
 * keep a suggested key. Names that are not Chromium's _execute_* forms and have no description still exist (they run onCommand).
 */
function commandsOf(manifest,{platform=process.platform}={}){
 const raw=manifest&&typeof manifest.commands==='object'&&manifest.commands&&!Array.isArray(manifest.commands)?manifest.commands:{};
 const out=[];let suggested=0;
 for(const [name,spec] of Object.entries(raw).slice(0,200)){
  if(!spec||typeof spec!=='object')continue;
  if(name.startsWith('_execute_')&&!EXECUTE.includes(name))continue;
  const key=suggested<MAX_SUGGESTED?parseAccelerator(suggestedFor(spec.suggested_key,platform),platform):null;
  if(key)suggested++;
  out.push({name,description:typeof spec.description==='string'?spec.description:'',key:key||'',execute:name.startsWith('_execute_'),global:spec.global===true});
 }
 return out;
}

module.exports={commandsOf,parseAccelerator,suggestedFor,EXECUTE,MAX_SUGGESTED};
