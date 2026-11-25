import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {kick,motionTokens,springFor,type SpeedName} from '../src/ui/motionTokens';
import {springEasing} from '../src/ui/springs';

// The Peek frame (desktop/rewind/peek-frame.html) and the tab hover card (desktop/tab-card.html) are standalone pages: each
// carries its own copy of the spring maths and of the few tokens it uses. This keeps both copies equal to the app's
// (src/ui/springs.ts, src/ui/motionTokens.ts), so the one motion family and the one speed setting hold there too.
interface Copy {
  springEasing:(spec:{duration:number;bounce:number},scale:number,velocity:number)=>{duration:number;easing:string};
  tokenSpring:(id:string,speed:string)=>{duration:number;bounce:number};TOKENS:Record<string,[string,number,number]>;SCALES:Record<string,Record<string,number>>;KICK:Record<string,number>;TAU:number;
}
const load=(file:string)=>{
  const html=readFileSync(new URL(file,import.meta.url),'utf8'),block=html.slice(html.indexOf('//#spring'),html.indexOf('//#endspring'));
  assert.ok(block.length>200,file+' carries the spring block');
  return {html,frame:new Function(`${block}\nreturn {springEasing,tokenSpring,TOKENS,SCALES,KICK,TAU};`)() as Copy};
};
const pages:[string,string[]][]=[['../desktop/rewind/peek-frame.html',['materialize','menu.content','popover.grow']],['../desktop/tab-card.html',['materialize','menu.fade','menu.grow']],['../desktop/site-prompt.html',['materialize','menu.content','popover.grow','menu.fade']]];

for(const [file,tokens] of pages){
  const {frame}=load(file);
  test(`${file}: uses the app's tokens, with the app's numbers`,()=>{
    for(const id of Object.keys(frame.TOKENS) as (keyof typeof motionTokens)[])assert.deepEqual(frame.TOKENS[id],[...motionTokens[id]],id);
    assert.deepEqual(Object.keys(frame.TOKENS).sort(),[...tokens].sort());
    assert.deepEqual(frame.KICK,{fast:kick.fast,premium:kick.premium});
  });
  test(`${file}: its springs are the app's springs, at both speeds, opening and closing`,()=>{
    for(const speed of ['fast','premium'] as SpeedName[])for(const id of Object.keys(frame.TOKENS) as (keyof typeof motionTokens)[]){
      const ours=frame.tokenSpring(id,speed),theirs=springFor(id,speed)!;
      assert.deepEqual(ours,theirs,`${id} ${speed}`);
      const opening=frame.KICK[speed]*frame.TAU/ours.duration,reference=kick[speed]*Math.PI*2/theirs.duration;
      for(const velocity of [0,opening]){const a=frame.springEasing(ours,1,velocity),b=springEasing(theirs,1,velocity===0?0:reference);assert.equal(a.duration,b.duration,`${id} ${speed}`);assert.equal(a.easing,b.easing,`${id} ${speed} easing`);}
      const exit={duration:ours.duration*.7,bounce:0};assert.equal(frame.springEasing(exit,1,0).easing,springEasing(exit,1,0).easing);
    }
  });
}

test('the Peek card opens on the popover token, leaves in two thirds of the time, and speaks the accessible words',()=>{
  const {html}=load('../desktop/rewind/peek-frame.html');
  assert.match(html,/tokenSpring\('popover\.grow',speed\)/);assert.match(html,/role="dialog"/);assert.match(html,/role="toolbar"/);
  for(const id of ['back','reload','split','tab','close'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/state\.link/,'the card grows from the link box');assert.match(html,/exit=\{duration:grow\.duration\*\.7/,'critically damped, 70% of the enter');
  assert.doesNotMatch(html,/blur\(\d+px\)[^}]*animation/,'no blur is animated');
});

test('the tab card arrives on the spatial and effects springs, leaves on the effects spring, and fetches nothing',()=>{
  const {html}=load('../desktop/tab-card.html');
  assert.match(html,/'menu\.grow'/);assert.match(html,/'materialize'/);assert.match(html,/'menu\.fade'/);assert.match(html,/role="tooltip"/);
  assert.match(html,/img-src data:/);assert.doesNotMatch(html,/https?:\/\//);assert.doesNotMatch(html,/<link|@import|fetch\(|XMLHttpRequest/);
  assert.match(html,/state\.picture\.startsWith\('data:image\/jpeg;base64,'\)/,'only a JPEG data URL can be shown');
  assert.match(html,/-webkit-line-clamp:2/,'a long title takes two lines, then ends in a fade-free clamp');
});

test('the chip and the column of icon buttons ride the card\'s own opening, are at least 28px, and use only the labels the frame already has', () => {
  const {html} = load('../desktop/rewind/peek-frame.html');
  // they sit in #extras, a box the size of the card that scales on the card's own spring; each rides a corner of the aperture's moving box and fades in as it nears the card
  assert.match(html, /<div id="extras">/);
  const card = html.slice(html.indexOf('<div id="card"'), html.indexOf('<div id="notice"'));
  for (const id of ['side', 'rail', 'more', 'chip', 'r-close', 'r-tab', 'r-split', 'r-copy', 'back2', 'reload2']) assert.match(card, new RegExp(`id="${id}"`), id + ' is in the card\'s box');
  assert.match(html, /play\(card,\[\{clipPath:apertureAt\(state\.link,g\),transform:'scale\(\.94\)'\}/, 'the card is what opens');
  assert.match(html, /play\(\$\(id\),\[\{translate:at\},\{translate:'0px 0px'\}\],grow,\{opening:true\}\)/, 'the chip and the column ride on the card\'s own spring, no spring of their own');
  assert.match(html, /play\(\$\('extras'\),\[\{transform:'scale\(\.94\)'\},\{transform:'none'\}\],grow,\{opening:true\}\)/);
  assert.match(html, /button\.rail\{width:32px;height:32px/);assert.match(html, /#chip button\.icon\{width:28px;height:28px/);assert.match(html, /button\.icon\{width:28px;height:28px\}/);
  // every one of the four column buttons and the chip's two say what they do from the app's catalog labels, and no new text exists in the page
  for (const cmd of ['close', 'tab', 'split', 'copy', 'back', 'reload']) assert.match(html, new RegExp(`data-cmd="${cmd}"`));
  assert.match(html, /tipAll\('tab',name\.tab,keys\.tab\)/);assert.match(html, /tipAll\('split',name\.split,keys\.split\)/);assert.match(html, /tipAll\('close',name\.close,keys\.close\)/);
  const text = html.slice(html.indexOf('<body>')).replace(/<script>[\s\S]*<\/script>/, '').replace(/<style>[\s\S]*<\/style>/, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
  assert.equal(text, '', 'the markup carries no words of its own: every word comes from the catalog labels');
  assert.doesNotMatch(/#rail,#more,#chip\{[^}]*(border|outline)/.exec(html)?.[0] ?? '', /border|outline/, 'no drawn line on the plates');
  // the card has no drawn line: its edge is the scrim and a soft shadow, and it is curved like the page card
  assert.match(html, /#shadow\{[^}]*border-radius:12px;box-shadow:var\(--lift\)/);assert.match(html, /#surface\{[^}]*inset:2px;border-radius:10px/, 'the surface sits 2px inside the page view, so no fringe shows on the curve');
  assert.doesNotMatch(/--lift:[^;]*;/.exec(html)?.[0] ?? '', /0 0 0 1px/, 'no ring in the shadow');
  assert.doesNotMatch(html.slice(html.indexOf('#shadow{'), html.indexOf('#shadow{') + 400), /var\(--line\)|var\(--highlight\)/, 'no hairline or highlight on the card');
  assert.match(html, /APERTURE_END='inset\(0px 0px 0px 0px round 12px\)'/, 'the aperture ends exactly on the card\'s box and curve: no frame has a clip taller than the card and narrower than it');
});
