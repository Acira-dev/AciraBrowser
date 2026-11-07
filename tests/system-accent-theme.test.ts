import test from 'node:test';
import assert from 'node:assert/strict';
import {studyFinish,systemAccentOf,themeTokens} from '../src/ui/theme';
import {contrast} from '../src/ui/colorMath';
import {appearancePalettes,palettePreference} from '../src/runtime/appearancePalettes';
import {createInitialState} from '../src/runtime/core';
import {matchesSystemTheme,systemThemePatch,withSystemAccent} from '../src/ui/systemThemeRules';
import type {SystemThemeInfo} from '../src/runtime/types';

// Match my system theme: the desktop's accent takes the accent role and nothing else. Desktops below are made-up inputs.
const porcelain=palettePreference(appearancePalettes.find(p=>p.name==='Porcelain')!);
const desktops={purple:'#9141ac',orange:'#f67400',green:'#3a944a',yellow:'#c88800',slate:'#6f8396',kdeBlue:'#3daee9'};
const ROLES=['--accent','--primary','--toggle-on','--focus-ring','--link','--chrome-accent'];

test('without a desktop accent nothing changes, byte for byte',()=>{
  for(const dark of [false,true])for(const finish of appearancePalettes){
    const own=palettePreference(finish);
    assert.deepEqual(studyFinish({...own},dark),studyFinish({...own,systemAccent:undefined},dark));
    assert.deepEqual(studyFinish({...own},dark),studyFinish({...own,systemAccent:'#808080'},dark),'a grey is no accent');
  }
});

test('the accent roles follow the desktop; frame, page tones and finish name stay the finish\'s own',()=>{
  for(const finish of appearancePalettes)for(const dark of [false,true])for(const [name,hex] of Object.entries(desktops)){
    const own=palettePreference(finish),plain=studyFinish({...own},dark),on=studyFinish({...own,systemAccent:hex},dark);
    for(const key of ['--ed-chrome','--chrome-sheet','--finish','--surface-tone','--chrome-tone','--on-ink','--shade'])assert.equal(on[key],plain[key],`${finish.name} ${dark?'dark':'light'} ${name}: ${key} must not move`);
    assert.notEqual(on['--accent'],plain['--accent'],`${finish.name} ${dark?'dark':'light'} ${name}: accent follows`);
  }
});

test('every desktop accent stays readable on Acira\'s own surfaces, light and dark, in every finish',()=>{
  for(const finish of appearancePalettes)for(const dark of [false,true])for(const [name,hex] of Object.entries(desktops)){
    const t=studyFinish({...palettePreference(finish),systemAccent:hex},dark),surface=t['--on-ink'];
    assert.ok(contrast(t['--accent'],surface)>=4.5,`${finish.name} ${dark?'dark':'light'} ${name}: text accent ${t['--accent']} on ${surface} is ${contrast(t['--accent'],surface).toFixed(2)}:1`);
    assert.ok(contrast(t['--toggle-on'],'#ffffff')>=3,`${finish.name} ${dark?'dark':'light'} ${name}: switch ${t['--toggle-on']} keeps 3:1 against its thumb`);
  }
});

test('Porcelain keeps its neutral buttons; a coloured finish\'s buttons take the accent',()=>{
  const p=studyFinish({...porcelain,systemAccent:desktops.purple},false),own=palettePreference(appearancePalettes.find(f=>f.name==='Ocean Blue')!),o=studyFinish({...own,systemAccent:desktops.orange},false);
  assert.equal(p['--primary'],studyFinish({...porcelain},false)['--primary']);
  assert.equal(o['--primary'],o['--accent']);
  assert.notEqual(o['--primary'],studyFinish({...own},false)['--primary']);
});

test('systemAccentOf takes only six-digit hex with a hue to show',()=>{
  assert.equal(systemAccentOf('#9141AC'),'#9141ac');
  for(const bad of [undefined,'','#fff','purple','#808080','#8a8a8c','#9141acff'])assert.equal(systemAccentOf(bad as string|undefined),undefined);
});

test('the token cache never mixes a desktop accent into another window\'s tokens',()=>{
  const s={...createInitialState().settings,...porcelain};
  const a=themeTokens({...s,systemAccent:desktops.purple},true),b=themeTokens(s,true),c=themeTokens({...s,systemAccent:desktops.orange},true);
  assert.notEqual(a['--accent'],b['--accent']);assert.notEqual(a['--accent'],c['--accent']);assert.equal(b['--accent'],themeTokens(s,true)['--accent']);
});

const info=(over:Partial<SystemThemeInfo>={}):SystemThemeInfo=>({supported:true,dark:true,accent:'#9141ac',accentSource:'portal',desktop:'gnome',...over});
test('matching is on only while the flag is set and Appearance is Auto',()=>{
  const base=createInitialState().settings;
  assert.equal(matchesSystemTheme({...base,systemTheme:true,appearance:'system'}),true);
  assert.equal(matchesSystemTheme({...base,systemTheme:true,appearance:'dark'}),false,'choosing Dark anywhere ends it');
  assert.equal(matchesSystemTheme({...base,systemTheme:false,appearance:'system'}),false);
  assert.equal(matchesSystemTheme({...base,appearance:'system'}),false,'a profile that never saw the setting');
});

test('the accent is handed down only when matching is on, the desktop is supported and it gave one',()=>{
  const on={...createInitialState().settings,systemTheme:true,appearance:'system' as const};
  assert.equal(withSystemAccent(on,info()).systemAccent,'#9141ac');
  assert.equal(withSystemAccent(on,info({accent:null})).systemAccent,undefined);
  assert.equal(withSystemAccent(on,info({supported:false})).systemAccent,undefined);
  assert.equal(withSystemAccent({...on,appearance:'light'},info()).systemAccent,undefined);
  assert.equal(withSystemAccent({...on,systemTheme:false},info()).systemAccent,undefined);
  assert.equal(on.systemAccent,undefined,'the saved settings object is never written to');
});

test('turning it on also follows the desktop\'s light or dark; turning it off leaves Appearance as it is',()=>{
  assert.deepEqual(systemThemePatch(true),{systemTheme:true,appearance:'system'});
  assert.deepEqual(systemThemePatch(false),{systemTheme:false});
});
