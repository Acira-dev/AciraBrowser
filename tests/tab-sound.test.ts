import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {audioBars} from '../src/ui/matrixShapes';
import {tabSound,closeSlotShows,soundPlacement,SLOT_MIN_TAB_WIDTH} from '../src/ui/tabSound';
import {crispSpec} from '../src/components/DotMatrix';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const R=4,C=5;
const frame=(t:number)=>Array.from({length:R},(_,r)=>Array.from({length:C},(_,c)=>audioBars(t,r,c,R,C)));
const heights=(t:number)=>Array.from({length:C},(_,c)=>frame(t).reduce((sum,row)=>sum+row[c],0));
const times=Array.from({length:600},(_,i)=>i*.05+3.3);

test('R4-30: an audible, unmuted tab shows the equaliser; muted wins, and a quiet tab shows nothing',()=>{
  assert.equal(tabSound({audible:true}),'playing');
  assert.equal(tabSound({audible:true,muted:false}),'playing');
  assert.equal(tabSound({audible:true,muted:true}),'muted','muting keeps the speaker-off button, which is the one-click unmute');
  assert.equal(tabSound({muted:true}),'muted','a muted tab stays muted when the page goes quiet');
  assert.equal(tabSound({}),null);
  assert.equal(tabSound({audible:false,muted:false}),null);
});

test('R4-30: the close slot shows the equaliser until the pointer or the keyboard is on the tab, then the x',()=>{
  assert.equal(closeSlotShows('playing',false),'meter');
  assert.equal(closeSlotShows('playing',true),'close','hover or focus brings the x, so the tab can always be closed');
  assert.equal(closeSlotShows('muted',false),'close');
  assert.equal(closeSlotShows(null,false),'close');
});

test('R4-30: roomy tabs use the slot, icon-only, pinned and narrow tabs a badge on the icon',()=>{
  assert.equal(soundPlacement(200,false),'slot');
  assert.equal(soundPlacement(SLOT_MIN_TAB_WIDTH,false),'slot');
  assert.equal(soundPlacement(SLOT_MIN_TAB_WIDTH-1,false),'badge');
  assert.equal(soundPlacement(40,true),'badge');
  assert.equal(soundPlacement(200,true),'badge','a pinned tab is icon-only whatever its width');
  assert.match(read('src/styles/tab-sound.css'),new RegExp(`@container \\(min-width:${SLOT_MIN_TAB_WIDTH}px\\)`),'the slot rules start at the same width as the code');
  assert.match(read('src/styles/tab-sound.css'),new RegExp(`@container \\(max-width:${SLOT_MIN_TAB_WIDTH-1}px\\)`),'the badge rules take over just below it');
  assert.match(read('src/components/BrowserTabs.css'),new RegExp(`@container\\(max-width:${SLOT_MIN_TAB_WIDTH-1}px\\)`),'the strip floats its x over a tab this narrow');
});

test('R4-30: the equaliser is the classic grid: full, half or dark, never a drawn picture',()=>{
  for(const t of times)for(const row of frame(t))for(const value of row)assert.ok(value===0||value===.5||value===1,`two intensities and dark only, got ${value}`);
});

test('R4-30: the columns move on their own, never in step, and never settle into a loop',()=>{
  // Every column reaches every height over time (the full range is used).
  for(let c=0;c<C;c++){
    const seen=new Set(times.map(t=>heights(t)[c]));
    assert.ok(seen.size>=5,`column ${c} only ever showed ${[...seen].join(',')}`);
    assert.ok(Math.max(...seen)>=3.5&&Math.min(...seen)<=1.5,`column ${c} should rise high and fall low`);
  }
  // Columns are not copies of one another.
  for(let a=0;a<C;a++)for(let b=a+1;b<C;b++){
    const same=times.filter(t=>heights(t)[a]===heights(t)[b]).length;
    assert.ok(same<times.length*.45,`columns ${a} and ${b} move together (${same}/${times.length})`);
  }
  // It does not repeat: a frame is not found again a whole number of seconds later.
  for(const period of [1,2,3,4,5,6,8,10,12,15,20,30]){
    const repeats=times.slice(0,200).filter(t=>heights(t).join()===heights(t+period).join()).length;
    assert.ok(repeats<80,`the pattern repeats every ${period}s (${repeats}/200 frames)`);
  }
  // It changes from one painted frame (32ms) to the next often enough to read as lively, and is never frozen.
  const moved=times.filter((t,i)=>i>0&&heights(t).join()!==heights(times[i-1]).join()).length;
  assert.ok(moved>times.length*.4);
});

test('R4-30: a quiet moment still reads as a meter: the bottom row is always lit',()=>{
  for(const t of times)for(let c=0;c<C;c++)assert.equal(audioBars(t,R-1,c,R,C),1,`bottom dot of column ${c} at ${t}`);
});

test('R4-30: with animations Off the bars are held still, varied, as a representative frame',()=>{
  const dot=read('src/components/DotMatrix.tsx');
  assert.match(dot,/audio:\s*audioBars/);
  const rest=Number(/restingTime[^\n]*audio:\s*([\d.]+)/.exec(dot)?.[1]);
  assert.ok(Number.isFinite(rest),'DotMatrix names a resting frame for the audio preset');
  const bars=heights(rest);
  assert.ok(new Set(bars).size>=3,`the held frame should be varied, got ${bars.join(',')}`);
  assert.ok(Math.max(...bars)>=3&&Math.min(...bars)<=2.5);
});

test('R4-30: one lightweight renderer, paused when the window is hidden, only for an audible tab',()=>{
  const dot=read('src/components/DotMatrix.tsx'),meter=read('src/components/TabSound.tsx');
  assert.match(dot,/!document\.hidden/,'the shared paint loop stops while the window is hidden or minimised');
  assert.match(dot,/const painters = new Set/,'every matrix shares one loop');
  assert.match(meter,/preset="audio"/);
  for(const file of ['src/App.tsx','src/components/BrowserTabsHorizontal.tsx','src/components/CompactTabs.tsx','src/components/sidebar/AciraSidebar.tsx']){
    const source=read(file);
    assert.match(source,/sound==='playing'|tabSound\(t\) === 'playing'/,`${file} mounts the meter only for a playing tab`);
    assert.doesNotMatch(source,/\(tab\.audible\|\|tab\.muted\)|\(t\.audible \|\| t\.muted\)/,`${file} no longer shows the speaker for a playing tab`);
  }
});

test('R4-30: hover and keyboard focus swap the equaliser for the x on the strip, the compact strip and the sidebar',()=>{
  const css=read('src/styles/tab-sound.css');
  for(const surface of ['.browser-tab:is(:hover,:focus-visible,:has(:focus-visible)','.acira-compact-tab.selected:not([data-pinned=true])[data-labels=true]:is(:hover,:focus-visible,:has(:focus-visible)','.sb-tab:is(:hover,:has(:focus-visible))'])assert.ok(css.includes(surface),`missing hover and focus swap for ${surface}`);
  assert.match(css,/--ts-dur:calc\(140ms \* var\(--motion-f,1\)\)/,'the crossfade follows the speed setting: Off is instant');
  assert.doesNotMatch(css.replaceAll('linear-gradient(#000 0 0)',''),/#[0-9a-f]{3,8}\b/i,'no hard-coded colours (the mask gradients only say opaque)');
});

test('R4-30: mute stays one click away: the muted button, and Mute tab in the tab menu',()=>{
  assert.match(read('src/App.tsx'),/tabSound\(t\) === 'muted' && <button/);
  assert.match(read('src/App.tsx'),/context\.muted \? tr\("app\.unmuteTab"\) : tr\("app\.muteTab"\)/,'the right-click menu still mutes and unmutes');
  assert.match(read('src/components/CompactTabs.tsx'),/sound==='muted'&&!tab\.pinned&&<button/);
  assert.match(read('src/components/sidebar/AciraSidebar.tsx'),/sound==='muted'&&<button className="sb-tab-action"/);
});

test('R4-38: the badge on a site icon is bare square dots on a hard-edged cut-out: no box, no border, no rounded corners',()=>{
  const css=read('src/styles/tab-sound.css');
  for(const line of css.split('\n').filter(text=>text.includes('data-variant=badge]{')))assert.doesNotMatch(line,/border|background|radius|outline|box-shadow/,`the badge draws nothing but dots: ${line.slice(0,90)}`);
  assert.match(css,/mask-composite:exclude/,'the icon is cut, not covered');
  for(const surface of ['.browser-tab[data-sound][data-icon-only=true]>.site-identity-icon','.acira-compact-tab[data-labels=false][data-sound] .acira-compact-tab-icon>.site-identity-icon'])assert.ok(css.includes(surface),`no cut-out for ${surface} (playing and muted alike)`);
  assert.match(css,/--ts-cut:right -2px top -2px/,'a private or Tor tab keeps its own mark in the lower right corner: the equaliser goes upper right');
  assert.match(read('src/components/TabSound.tsx'),/snap/,'both variants use crisp square dots');
});

test('R4-38: crisp dots are whole device pixels at 100%, 150% and 200%, and stay about the same size on screen',()=>{
  for(const [density,dot,gap] of [[1,2,1],[1.5,3,2],[2,4,2]] as const){
    const [d,g]=crispSpec(density);
    assert.deepEqual([d,g],[dot,gap]);
    for(const [cols,rows] of [[3,3],[5,4]]){
      const width=cols*(d+g)-g,height=rows*(d+g)-g;
      assert.ok(Number.isInteger(width)&&Number.isInteger(height));
      const css=cols===3?width/density:null;
      if(css!==null)assert.ok(css>=8&&css<=9,`the badge is ${css}px wide at ${density}x`);
    }
  }
  assert.match(read('src/components/DotMatrix.tsx'),/context\.fillRect\(c \* cell, r \* cell, dotPx, dotPx\)/,'dots are filled squares on whole cells');
});

test('R4-38: no other dot matrix is drawn as a badge over a site icon',()=>{
  // The only DotMatrix users that sit on a site icon are the loading state (it replaces the icon) and this equaliser badge.
  for(const file of ['src/components/sidebar/AciraSidebar.tsx','src/components/sidebar/SidebarMedia.tsx','src/components/sidebar/TabSwitcher.tsx','src/App.tsx']){
    for(const use of read(file).match(/<DotMatrix[^>]*>/g)??[])assert.doesNotMatch(use,/snap|preset="audio"/,`${file}: ${use}`);
  }
});

test('R4-30: the new string is in every catalog',()=>{
  for(const code of ['en','ar','de','es','fr','hi','it','ja','ko','pt-BR','ru','tr','zh-CN'])assert.ok(JSON.parse(read(`src/i18n/${code}.json`))['tabsound.playing'],code);
});

test('Muted: the original speaker-off glyph, never a dot matrix, and the equaliser alone is drawn in dots',()=>{
  const dot=read('src/components/DotMatrix.tsx');
  assert.doesNotMatch(dot,/muted/,'no muted preset in the matrix');
  const sound=read('src/components/TabSound.tsx');
  assert.match(sound,/export function TabMutedBadge/);
  assert.match(sound,/<VolumeX size=\{10\} \/>/,'the badge is the same glyph as the button, small');
  assert.doesNotMatch(sound,/TabMutedMark/);
  assert.match(sound,/data-state="muted"/);
  assert.match(read('src/App.tsx'),/className="tab-audio is-muted"[^\n]*<VolumeX size=\{14\}\/>/,'the strip button holds the speaker-off glyph');
  const css=read('src/styles/tab-sound.css');
  assert.match(css,/\.tab-audio>svg\{width:12px;height:12px;color:var\(--ed-muted\)\}/,'drawn at the x\'s optical size and in its colour');
});

test('Muted: no room, no button. Below 105px, icon-only and pinned tabs the speaker-off button leaves and the cross takes the icon\'s corner',()=>{
  const css=read('src/styles/tab-sound.css');
  assert.match(css,/\.browser-tab\[data-icon-only=true\]>\.tab-audio\{display:none\}/,'icon-only and pinned tabs');
  assert.match(css,new RegExp(`@container \\(max-width:${SLOT_MIN_TAB_WIDTH-1}px\\)\\{\\n:root \\.app \\.tab-strip-container \\.browser-tab>\\.tab-audio\\{display:none\\}`),'narrow tabs, at the same width as the equaliser slot');
  assert.match(css,/\.compact-tab-audio|\.acira-compact-tab-audio\{display:none\}/,'narrow compact tabs');
  const strip=read('src/components/BrowserTabsHorizontal.tsx');
  assert.match(strip,/sound==='muted'&&<TabMutedBadge\/>/,'the strip tab carries the badge version');
  assert.match(strip,/tabsound\.muted/,'and says muted to a screen reader');
  assert.match(read('src/components/CompactTabs.tsx'),/sound==='muted'&&<TabMutedBadge\/>/);
  const app=read('src/App.tsx');
  assert.doesNotMatch(app,/!t\.pinned && tabSound\(t\) === 'muted'/,'a pinned tab shows it too (as the badge)');
  assert.match(app,/className="tab-audio is-muted"[^\n]*<VolumeX/,'the button holds the glyph, and is still the unmute control');
  assert.match(app,/type: 'tab\.mute', id: t\.id, muted: false/);
});

test('Muted: the new string is in every catalog',()=>{
  for(const code of ['en','ar','de','es','fr','hi','it','ja','ko','pt-BR','ru','tr','zh-CN'])assert.ok(JSON.parse(read(`src/i18n/${code}.json`))['tabsound.muted'],code);
});
