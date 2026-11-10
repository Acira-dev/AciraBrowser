import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import core from '../src/features/settings/entries/core';
import {searchSettings} from '../src/features/settings/search';
import type {SettingsContext} from '../src/features/settings/model';
import {createInitialState,persistedSnapshot,reduceBrowser,restoreSnapshot,snapshotForProfile} from '../src/runtime/core';
import {matchesSystemTheme,systemThemeActions,withSystemAccent} from '../src/ui/systemThemeRules';
import type {BrowserAction,BrowserSnapshot,SystemThemeInfo} from '../src/runtime/types';

const require=createRequire(import.meta.url);
const {validateAction}=require('../desktop/validation.cjs');
const linuxTheme=require('../desktop/linux-theme.cjs');

const base:SettingsContext={customGlassColors:false,privateProfile:false,desktop:true,websiteOpen:false};
const find=(query:string,context:SettingsContext)=>searchSettings(core,query,context).map(hit=>hit.entry.id);
const apply=(state:BrowserSnapshot,actions:BrowserAction[])=>actions.reduce((next,action)=>reduceBrowser(next,action),state);
const seenBy=(state:BrowserSnapshot)=>snapshotForProfile(state).settings;

test('the settings entry is findable only where the desktop gives a theme to match',()=>{
  const entry=core.find(item=>item.id==='match-system-theme')!;
  assert.ok(entry,'registered');assert.equal(entry.section,'Appearance');assert.equal(entry.group,'Theme');assert.equal(entry.when,'system-theme');
  for(const query of ['system theme','match system','accent color','gtk','kde','gnome'])assert.ok(find(query,{...base,systemTheme:true}).includes('match-system-theme'),query);
  for(const query of ['system theme','match system','accent color','gtk','kde','gnome'])assert.ok(!find(query,base).includes('match-system-theme'),`${query}: not off Linux`);
  assert.ok(!find('system theme',{...base,systemTheme:false}).includes('match-system-theme'));
});

test('nothing is on by default, and a fresh profile saves nothing about it',()=>{
  const state=createInitialState();
  assert.equal(state.settings.systemTheme,undefined);assert.equal(state.settings.systemAccent,undefined);
  assert.equal(matchesSystemTheme(state.settings),false);
  assert.equal(Object.hasOwn(persistedSnapshot(state).settings as object,'systemAccent'),false);
});

test('the flag is saved and comes back; the desktop accent is never saved',()=>{
  let state=apply(createInitialState(),[{type:'settings.update',patch:{systemTheme:true,appearance:'system'}}]);
  const info:SystemThemeInfo={supported:true,dark:true,accent:'#9141ac',accentSource:'portal',desktop:'gnome'};
  const handedDown=withSystemAccent(state.settings,info);
  assert.equal(handedDown.systemAccent,'#9141ac');
  state={...state,settings:handedDown};
  const saved=JSON.parse(JSON.stringify(persistedSnapshot(state)));
  assert.equal(saved.settings.systemTheme,true);assert.equal(saved.settings.systemAccent,undefined,'the colour belongs to this window and desktop');
  const back=restoreSnapshot(saved);
  assert.equal(back.settings.systemTheme,true);assert.equal(back.settings.appearance,'system');assert.equal(back.settings.systemAccent,undefined);
});

test('the bridge accepts the flag as a boolean and nothing else',()=>{
  const state=createInitialState();
  assert.doesNotThrow(()=>validateAction({type:'settings.update',patch:{systemTheme:true,appearance:'system'}},state));
  assert.doesNotThrow(()=>validateAction({type:'settings.update',patch:{systemTheme:false}},state));
  for(const bad of ['yes',1,null,{}])assert.throws(()=>validateAction({type:'settings.update',patch:{systemTheme:bad}},state),`${JSON.stringify(bad)}`);
  assert.throws(()=>validateAction({type:'settings.update',patch:{systemAccent:'#9141ac'}},state),'a window cannot save the desktop accent');
  assert.throws(()=>validateAction({type:'settings.update',patch:{systemThemeX:true}},state));
});

test('switching on: Auto for all profiles when the profile follows the shared setting',()=>{
  const state=createInitialState();
  const actions=systemThemeActions(state,true);
  assert.deepEqual(actions,[{type:'settings.update',patch:{systemTheme:true,appearance:'system'}}]);
  const next=apply(state,actions);
  assert.equal(matchesSystemTheme(seenBy(next)),true);
  assert.deepEqual(systemThemeActions(next,false),[{type:'settings.update',patch:{systemTheme:false}}]);
  const off=apply(next,systemThemeActions(next,false));
  assert.equal(matchesSystemTheme(seenBy(off)),false);assert.equal(seenBy(off).appearance,'system','switching off leaves Appearance as it is');
});

test('a profile that keeps its own Light or Dark: the switch sets Auto for that profile, the flag stays shared',()=>{
  let state=apply(createInitialState(),[{type:'browser.profile.settings',id:'profile-personal',patch:{appearance:'dark'}}]);
  assert.equal(seenBy(state).appearance,'dark');assert.equal(matchesSystemTheme(seenBy(state)),false);
  const actions=systemThemeActions(state,true);
  assert.equal(actions.length,2);assert.equal(actions[0].type,'browser.profile.settings');assert.deepEqual(actions[1],{type:'settings.update',patch:{systemTheme:true}});
  state=apply(state,actions);
  assert.equal(seenBy(state).appearance,'system');assert.equal(matchesSystemTheme(seenBy(state)),true);
  assert.equal(state.settings.appearance,'dark','the shared Appearance was not touched');
});

test('choosing Light or Dark for the profile ends matching without touching the flag',()=>{
  let state=apply(createInitialState(),systemThemeActions(createInitialState(),true));
  state=reduceBrowser(state,{type:'settings.update',patch:{appearance:'light'}});
  assert.equal(matchesSystemTheme(seenBy(state)),false);assert.equal(state.settings.systemTheme,true);
  state=reduceBrowser(state,{type:'settings.update',patch:{appearance:'system'}});
  assert.equal(matchesSystemTheme(seenBy(state)),true,'Auto again, matching again');
});

test('the main-process rule and the interface rule give the same answer for every combination',()=>{
  for(const systemTheme of [undefined,false,true])for(const appearance of ['light','dark','system'] as const)for(const supported of [false,true])for(const accent of [null,'#9141ac']){
    const settings={...createInitialState().settings,systemTheme,appearance};
    const info:SystemThemeInfo={supported,dark:false,accent,accentSource:accent?'portal':null,desktop:'other'};
    assert.equal(linuxTheme.activeAccent(settings,info),withSystemAccent(settings,info).systemAccent,JSON.stringify({systemTheme,appearance,supported,accent}));
  }
  assert.equal(linuxTheme.activeAccent(null,null),undefined);
});

test('the wiring is in place: one IPC answer, one change event, the link preview takes the same accent',()=>{
  const main=fs.readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8'),preload=fs.readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  assert.match(main,/bridge\.on\('acira:system-theme',e=>\{e\.returnValue=trustedContents\.has\(e\.sender\)&&e\.senderFrame===e\.sender\.mainFrame\?systemTheme\.current\(\):null;\}\)/);
  assert.match(main,/contents\.send\('acira:system-theme-changed',info\)/);
  assert.match(main,/accent:\(\)=>require\('\.\/linux-theme\.cjs'\)\.activeAccent\(settingsFor\(state\),systemTheme\.current\(\)\)\|\|settingsFor\(state\)\.accentColor/);
  assert.match(main,/own\.systemTheme&&own\.appearance==='system'/);
  assert.match(preload,/systemTheme:\(\)=>ipcRenderer\.sendSync\('acira:system-theme'\)/);assert.match(preload,/subscribeSystemTheme:subscription\('acira:system-theme-changed'\)/);
  assert.doesNotMatch(main.slice(main.indexOf('let systemThemeService')),/process\.platform==='linux'.*systemTheme/s,'the platform decision lives in linux-theme.cjs only');
});
