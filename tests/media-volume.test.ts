import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {VOLUME_HOLD_MS,VOLUME_IDLE_MS,closedPanel,createVolumeSender,forgetLevels,keyLevel,levelAt,muteToggle,rememberLevel,rememberedLevel,roundLevel,shownLevel,stepPanel,volumeChange,volumeGlyph,wheelLevel,type VolumeInput,type VolumePanel} from '../src/ui/mediaVolume';

// The sidebar media card's volume slider (founder, 27 Oct): the timing of the card <-> slider morph, the level a pointer, a key
// or the wheel asks for, mute at 0, and the order commands reach the page in.
const run=(inputs:[VolumeInput,number][],from:VolumePanel=closedPanel)=>inputs.reduce((panel,[input,now])=>stepPanel(panel,input,now),from);

test('click the speaker: the slider opens; never touched, it goes back after the idle wait',()=>{
  const open=stepPanel(closedPanel,{type:'open'},1000);
  assert.deepEqual(open,{open:true,pressing:false,keyboard:false,closeAt:1000+VOLUME_IDLE_MS});
  assert.equal(stepPanel(open,{type:'tick'},1000+VOLUME_IDLE_MS-1).open,true,'not before the deadline');
  assert.equal(stepPanel(open,{type:'tick'},1000+VOLUME_IDLE_MS),closedPanel);
  assert.equal(stepPanel(open,{type:'open'},1500),open,'opening again changes nothing');
});

test('held, it never closes; let go, it waits VOLUME_HOLD_MS, then becomes the card',()=>{
  const held=run([[{type:'open'},0],[{type:'press'},100]]);
  assert.equal(held.pressing,true);assert.equal(held.closeAt,null,'no timer while the pointer is down');
  assert.equal(stepPanel(held,{type:'tick'},60_000).open,true,'a long hold stays open');
  const let_go=stepPanel(held,{type:'release'},5000);
  assert.equal(let_go.closeAt,5000+VOLUME_HOLD_MS);assert.equal(VOLUME_HOLD_MS,1200);
  assert.equal(stepPanel(let_go,{type:'tick'},5000+VOLUME_HOLD_MS-1).open,true);
  assert.equal(stepPanel(let_go,{type:'tick'},5000+VOLUME_HOLD_MS).open,false);
});

test('any interaction during the wait restarts it: a wheel step, a key, the mute glyph, a new press',()=>{
  const waiting=run([[{type:'open'},0],[{type:'press'},10],[{type:'release'},20]]);
  const nudged=stepPanel(waiting,{type:'nudge'},1000);
  assert.equal(nudged.closeAt,1000+VOLUME_HOLD_MS,'the wait starts again from the nudge');
  assert.equal(stepPanel(nudged,{type:'tick'},20+VOLUME_HOLD_MS).open,true,'the old deadline no longer closes it');
  const pressed=stepPanel(waiting,{type:'press'},900);assert.equal(pressed.closeAt,null);
  assert.equal(stepPanel(pressed,{type:'nudge'},950).closeAt,null,'a wheel step under a held pointer does not start a timer');
  assert.equal(stepPanel(closedPanel,{type:'nudge'},5),closedPanel,'nothing to restart when closed');
  assert.equal(stepPanel(closedPanel,{type:'press'},5),closedPanel);assert.equal(stepPanel(closedPanel,{type:'release'},5),closedPanel);
});

test('Esc, focus leaving and the sidebar closing return to the card at once, even mid-drag',()=>{
  for(const type of ['escape','leave'] as const){
    assert.equal(run([[{type:'open'},0],[{type},10]]),closedPanel,type);
    assert.equal(run([[{type:'open'},0],[{type:'press'},5],[{type},10]]),closedPanel,`${type} while held`);
  }
});

test('opened from the keyboard: no timer (nothing leaves while someone tabs through it); Esc or focus leaving closes',()=>{
  const open=stepPanel(closedPanel,{type:'open',keyboard:true},0);
  assert.equal(open.keyboard,true);assert.equal(open.closeAt,null);
  const keyed=stepPanel(open,{type:'nudge'},500);assert.equal(keyed.closeAt,null);
  assert.equal(stepPanel(keyed,{type:'tick'},60_000).open,true);
  assert.equal(stepPanel(keyed,{type:'escape'},600),closedPanel);
});

test('a pointer anywhere on the track sets the level; the knob centre follows it, so both ends are reachable',()=>{
  const track={left:100,width:112};          // run = 100px between the knob centres
  assert.equal(levelAt(106,track),0);assert.equal(levelAt(50,track),0,'left of the track: 0');
  assert.equal(levelAt(156,track),.5);assert.equal(levelAt(206,track),1);assert.equal(levelAt(400,track),1,'past the end: 1');
  assert.equal(levelAt(141.3,track),.35,'whole percent');
  assert.equal(levelAt(10,{left:0,width:8}),0,'a track narrower than the knob cannot move');
});

test('slider keys (WAI-ARIA), the wheel, and rounding',()=>{
  assert.equal(keyLevel(.5,'ArrowRight'),.55);assert.equal(keyLevel(.5,'ArrowUp'),.55);assert.equal(keyLevel(.5,'ArrowLeft'),.45);assert.equal(keyLevel(.5,'ArrowDown'),.45);
  assert.equal(keyLevel(.5,'PageUp'),.6);assert.equal(keyLevel(.5,'PageDown'),.4);assert.equal(keyLevel(.5,'Home'),0);assert.equal(keyLevel(.5,'End'),1);
  assert.equal(keyLevel(.98,'ArrowUp'),1);assert.equal(keyLevel(.02,'ArrowDown'),0);assert.equal(keyLevel(.5,'a'),null);assert.equal(keyLevel(.5,'Enter'),null);
  assert.equal(wheelLevel(.5,-100),.55,'one notch up: one step louder');assert.equal(wheelLevel(.5,100),.45);assert.equal(wheelLevel(.5,-12),.51,'a trackpad moves it smoothly');
  assert.equal(wheelLevel(.5,0,100),.55,'a sideways swipe right is louder');assert.equal(wheelLevel(1,-500),1);assert.equal(wheelLevel(0,500),0);
  assert.equal(roundLevel(NaN),0);assert.equal(roundLevel(2),1);assert.equal(roundLevel(-1),0);assert.equal(roundLevel(.123),.12);
});

test('0 mutes the tab and keeps the level from before the gesture; leaving 0 sets the level, then unmutes',()=>{
  assert.deepEqual(volumeChange(.4,{muted:false,level:.8,start:.8}),{level:.4,page:.4,mute:null},'an ordinary move: the page follows');
  assert.deepEqual(volumeChange(0,{muted:false,level:.1,start:.8}),{level:.8,page:null,mute:true},'0: mute; unmuting later comes back at .8, not at a whisper');
  assert.deepEqual(volumeChange(0,{muted:true,level:.8,start:.8}),{level:.8,page:null,mute:null},'still 0: nothing more to do');
  assert.deepEqual(volumeChange(.3,{muted:true,level:.8,start:.8}),{level:.3,page:.3,mute:false},'back up from 0: level, then unmute');
  assert.deepEqual(volumeChange(0,{muted:false,level:0,start:0}),{level:.5,page:null,mute:true},'no audible level to keep: half');
  assert.equal(shownLevel(.7,true),0,'a muted tab shows 0');assert.equal(shownLevel(.7,false),.7);
});

test('the mute glyph: muting keeps the level, unmuting comes back to it (or half from nothing)',()=>{
  assert.deepEqual(muteToggle({muted:false,level:.6}),{level:.6,page:null,mute:true});
  assert.deepEqual(muteToggle({muted:true,level:.6}),{level:.6,page:.6,mute:false});
  assert.deepEqual(muteToggle({muted:true,level:0}),{level:.5,page:.5,mute:false});
});

test('the glyph shows the level: crossed when silent, one wave below half, two from half up',()=>{
  assert.equal(volumeGlyph(0,false),'mute');assert.equal(volumeGlyph(.8,true),'mute');assert.equal(volumeGlyph(.2,false),'low');assert.equal(volumeGlyph(.49,false),'low');assert.equal(volumeGlyph(.5,false),'high');
});

test('levels are per tab, in memory, and go with their tab',()=>{
  rememberLevel('a',.3);rememberLevel('b',.123);
  assert.equal(rememberedLevel('a'),.3);assert.equal(rememberedLevel('b'),.12);assert.equal(rememberedLevel('c'),undefined);
  forgetLevels(['b']);assert.equal(rememberedLevel('a'),undefined,'a closed tab forgets');assert.equal(rememberedLevel('b'),.12);
  forgetLevels([]);
});

test('commands reach the page one at a time, newest wins; an unmute waits for the level it should be heard at',async()=>{
  const sent:number[]=[],gates:(()=>void)[]=[];
  const sender=createVolumeSender(level=>{sent.push(level);return new Promise<void>(resolve=>gates.push(resolve));});
  sender.set(.5);sender.set(.4);sender.set(.3);sender.set(.2);
  assert.deepEqual(sent,[.5],'one in flight');
  let unmuted=false;sender.after(()=>{unmuted=true;});
  gates.shift()!();await new Promise(r=>setImmediate(r));
  assert.deepEqual(sent,[.5,.2],'the stale .4 and .3 are skipped');assert.equal(unmuted,false,'not before the newest level has landed');
  gates.shift()!();await new Promise(r=>setImmediate(r));
  assert.equal(unmuted,true);assert.equal(sender.idle,true);
  const failing=createVolumeSender(()=>Promise.reject(new Error('page gone')));let after=false;failing.set(1);failing.after(()=>{after=true;});
  await new Promise(r=>setImmediate(r));assert.equal(after,true,'a page that refuses never blocks the queue');
  // A level set just as the previous one lands is still sent.
  const late:number[]=[];const quick=createVolumeSender(async level=>{late.push(level);});quick.set(.1);await Promise.resolve();quick.set(.9);
  await new Promise(r=>setImmediate(r));assert.deepEqual(late,[.1,.9]);
});

test('the card is wired: the speaker opens the slider, the slider is a keyboard slider over the whole row, words in every catalog',()=>{
  const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
  const row=read('../src/components/sidebar/SidebarMedia.tsx'),css=read('../src/components/sidebar/sidebar-media.css');
  assert.match(row,/className="sb-media-act sb-media-speaker"[^>]*onClick=\{event => step\(\{ type: 'open', keyboard: event\.detail === 0 \}\)\}/s,'the speaker opens (keyboard when activated without a pointer)');
  assert.match(row,/role="slider" tabIndex=\{0\}/);for(const attr of ['aria-valuemin={0}','aria-valuemax={100}','aria-valuenow={percent}','aria-valuetext='])assert.ok(row.includes(attr),attr);
  assert.match(row,/setPointerCapture\(event\.pointerId\)/,'drag anywhere on the row');assert.match(row,/addEventListener\('wheel', wheel, \{ passive: false \}\)/);
  assert.match(row,/event\.key === 'Escape'/);assert.match(row,/onClick=\{toggleMute\}/,'the glyph inside the slider mutes');
  assert.match(row,/type: 'tab\.mute', id: tab\.id, muted: true/);assert.match(row,/sender\.after\(\(\) => dispatch\(\{ type: 'tab\.mute', id: tab\.id, muted: false \}\)\)/,'unmute waits for the level');
  assert.match(row,/action: 'volume', level: next/);assert.match(row,/forgetLevels\(/);
  // Motion: transform and opacity only, on the shared springs; Off swaps at once (animateSpring returns null).
  const morph=row.slice(row.indexOf('function morphVolume'),row.indexOf('function MediaRow'));
  assert.ok(morph.length>200);assert.doesNotMatch(morph,/width|height|left:|top:|filter|blur/,'compositor properties only');
  for(const token of ['island.content','island.expand','island.collapse'])assert.ok(morph.includes(`'${token}'`),token);
  assert.match(css,/\.sb-media-vol-fill\{[^}]*transform:translateX/);assert.match(css,/\.sb-media-vol-knob\{[^}]*transform:translateX/);
  assert.match(css,/\.sb-media-vol-track:focus-visible\{outline:2px solid var\(--sb-ring\)/);assert.doesNotMatch(css,/#[0-9a-fA-F]{3,8}\b/,'no hard-coded colours');
  for(const locale of ['en','ar','de','es','fr','hi','it','ja','ko','pt-BR','ru','tr','zh-CN']){
    const catalog=JSON.parse(read(`../src/i18n/${locale}.json`)) as Record<string,string>;
    for(const id of ['sidebarmedia.volume','sidebarmedia.volumePercent','sidebarmedia.muted'])assert.equal(typeof catalog[id],'string',`${locale} ${id}`);
    assert.match(catalog['sidebarmedia.volumePercent'],/\{percent\}/,locale);
  }
});
