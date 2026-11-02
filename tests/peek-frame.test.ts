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
