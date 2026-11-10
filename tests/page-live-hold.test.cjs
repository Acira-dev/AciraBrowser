'use strict';
// Split view and Seamless lag (reported 10 Nov 2026, Windows: "split view with 3 tabs, everything is laggy", "Seamless ... really really laggy"). Where the interface moves a
// page's box itself a frame at a time (a split's panes following the card through a layout switch: the docked sidebar opening or closing, a view switch, Sidebar mode; the toolbar
// easing back as the view leaves Seamless), it sent each frame's rectangle "at once" and main resized the view, so the site laid out again on every frame: 13 to 20 layouts per pane per
// slide on a heavy page (3 panes: 2.2 CPU-seconds of page work for one sidebar open; one page 0.36). Those layouts now carry the size each page ends at (`views[].hold`); main still
// places every rectangle exactly as sent, and holds the page's layout at the larger of its start and end size (the held layout a single page's glide already uses), released once the
// movement stops. One layout per pane per movement.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {placeLive,endLive,placePageBounds,LIVE_QUIET,RELEASE_QUIET}=require('../desktop/page-motion.cjs');

function rig(starts){
 let now=0,seq=0;const queue=[];
 const clock={now:()=>now,later:(fn,delay)=>{const id=++seq;queue.push({at:now+Math.max(0,delay||0),fn,id});return id;},cancel:id=>{const i=queue.findIndex(q=>q.id===id);if(i>=0)queue.splice(i,1);}};
 const panes=starts.map((start,i)=>{const calls=[];const view={bounds:{...start},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};calls.push(['bounds',{...next}]);},setBorderRadius(){},getVisible:()=>true,
  webContents:{isDestroyed:()=>false,enableDeviceEmulation(p){calls.push(['hold',p.viewSize.width,p.viewSize.height]);},disableDeviceEmulation(){calls.push(['release']);}}};return {name:'p'+i,view,entry:{view},calls};});
 const advance=ms=>{const until=now+ms;for(;;){queue.sort((a,b)=>a.at-b.at||a.id-b.id);if(!queue.length||queue[0].at>until)break;const q=queue.shift();now=q.at;q.fn();}now=until;};
 return {clock,panes,advance};
}
const columns=(card,n,gap=6)=>{const w=(card.width-gap*(n-1))/n;return Array.from({length:n},(_,i)=>{const x0=Math.round(card.x+i*(w+gap)),x1=Math.round(card.x+i*(w+gap)+w);return {x:x0,y:card.y,width:x1-x0,height:card.height};});};
const closed={x:6,y:62,width:1268,height:698},opened={x:246,y:62,width:1028,height:698};
// The frames the interface sends while its follow plays: the card's box on the sidebar's curve, the panes laid out in it.
const SPRING=[0,.112,.31536,.50969,.66451,.77752,.85584,.9083,.94258,.9646,.97853,.98725,.99265,.99598,.99801,.99925,1];
const followFrames=(from,to,n)=>SPRING.map(e=>columns({x:Math.round(from.x+(to.x-from.x)*e),y:from.y,width:Math.round(from.width+(to.width-from.width)*e),height:from.height},n));
const sizeOf=r=>({width:r.width,height:r.height});

for(const n of [1,2,3,4])for(const [name,from,to] of [['the docked sidebar opens (panes narrow)',closed,opened],['the docked sidebar closes (panes widen)',opened,closed]])test(`${n} pane(s), ${name}: every rectangle placed as sent, one layout per pane`,()=>{
 const frames=followFrames(from,to,n),end=frames.at(-1),r=rig(frames[0]);
 for(const frame of frames.slice(1)){frame.forEach((rect,i)=>placeLive(r.panes[i].entry,rect,sizeOf(end[i]),r.clock,8));r.advance(1000/60);}
 for(const [i,p] of r.panes.entries()){
  const holds=p.calls.filter(c=>c[0]==='hold'),placed=p.calls.filter(c=>c[0]==='bounds').map(c=>c[1]);
  assert.deepEqual(placed,frames.slice(1).map(f=>f[i]),`${p.name}: the view takes every rectangle, exactly`);
  const want=['hold',Math.max(frames[0][i].width,end[i].width),Math.max(frames[0][i].height,end[i].height)];
  assert.deepEqual(holds[0],want,`${p.name}: laid out at the larger of its start and end size`);
  // A pane's width can round one pixel past its end on the way (an inner pane of three: 418 -> 419 -> 418): the page is never laid out narrower than its view, so that costs one more layout, never more.
  assert.ok(holds.length<=2&&holds.slice(1).every(h=>h[1]<=want[1]+2&&h[2]<=want[2]+2),`${p.name}: one layout (a second only for a rounding pixel): ${JSON.stringify(holds)}`);
  assert.equal(p.calls.filter(c=>c[0]==='release').length,0,`${p.name}: still held while the frames come`);
 }
 // The movement has ended: the layout without the hold.
 r.panes.forEach(p=>endLive(p.entry,r.clock));
 r.advance(RELEASE_QUIET-1);assert.ok(r.panes.every(p=>!p.calls.some(c=>c[0]==='release')),'not in the same turn as the last rectangle (heavy-page third re-layout race)');
 r.advance(2);
 for(const p of r.panes){assert.equal(p.calls.at(-1)[0],'release',`${p.name}: let go`);assert.equal(p.entry.layoutHold,null);assert.equal(p.entry.liveHold,false);}
});

test('a movement that stops without a final layout is let go LIVE_QUIET ms after its last rectangle',()=>{
 const frames=followFrames(closed,opened,3),r=rig(frames[0]);
 for(const frame of frames.slice(1,6)){frame.forEach((rect,i)=>placeLive(r.panes[i].entry,rect,sizeOf(frames.at(-1)[i]),r.clock,8));r.advance(16);}
 r.advance(LIVE_QUIET-20);assert.ok(r.panes.every(p=>!p.calls.some(c=>c[0]==='release')));
 r.advance(40);for(const p of r.panes){assert.equal(p.calls.at(-1)[0],'release');assert.equal(p.entry.layoutHold,null);}
});

test('a hold smaller than the view (a rounding pixel) never lays the page out smaller than its view',()=>{
 const r=rig([{x:0,y:0,width:600,height:700}]),p=r.panes[0];
 placeLive(p.entry,{x:0,y:0,width:640,height:700},{width:620,height:690},r.clock,8);
 assert.deepEqual(p.calls.find(c=>c[0]==='hold'),['hold',640,700]);
});

test('no usable hold: the rectangle is placed and any held layout let go at once, as before',()=>{
 const r=rig([{x:0,y:0,width:600,height:700}]),p=r.panes[0];
 placeLive(p.entry,{x:0,y:0,width:500,height:700},{width:500,height:700},r.clock,8);r.advance(16);
 placeLive(p.entry,{x:0,y:0,width:480,height:700},null,r.clock,8);
 assert.deepEqual(p.calls.map(c=>c[0]),['hold','bounds','release','bounds']);
 assert.equal(p.entry.liveHold,false);
});

test('a page whose view cannot take the viewport override is only placed',()=>{
 const r=rig([{x:0,y:0,width:600,height:700}]),p=r.panes[0];delete p.view.webContents.enableDeviceEmulation;
 placeLive(p.entry,{x:0,y:0,width:500,height:700},{width:400,height:700},r.clock,8);
 assert.deepEqual(p.calls.map(c=>c[0]),['bounds']);assert.equal(p.entry.liveHold,false);
});

test('main\'s own glide or a cut taking over a held page decides its layout (no hold is left behind)',()=>{
 const r=rig([{x:0,y:0,width:600,height:700},{x:0,y:0,width:600,height:700}]),[a,b]=r.panes;
 for(const p of r.panes)placeLive(p.entry,{x:0,y:0,width:550,height:700},{width:500,height:700},r.clock,8);
 placePageBounds(a.entry,{x:0,y:0,width:500,height:700},false,r.clock,1000/60,undefined,undefined,8,false);
 assert.equal(a.calls.at(-1)[0],'release','a cut lets go at once');assert.equal(a.entry.liveHold,false);
 placePageBounds(b.entry,{x:240,y:0,width:360,height:700},true,r.clock,1000/60,'slide',undefined,8,true);r.advance(2000);
 assert.ok(b.calls.some(c=>c[0]==='release'),'the glide let the live hold go');assert.deepEqual(b.view.bounds,{x:240,y:0,width:360,height:700});assert.equal(b.entry.layoutHold,null);assert.equal(b.entry.liveHold,false);
 r.advance(LIVE_QUIET*2);assert.equal(b.calls.filter(c=>c[0]==='release').length,1,'no stale live timer fires later');
});

test('the layout bridge takes a view\'s hold size and refuses a bad one',()=>{
 const {createInitialState}=require('../desktop/runtime.cjs'),{validateLayout}=require('../desktop/validation.cjs'),s=createInitialState();
 const view={tabId:s.activeTabId,bounds:{x:0,y:0,width:500,height:400}};
 assert.doesNotThrow(()=>validateLayout({views:[{...view,hold:{width:520,height:400}}],visible:true,pageImmediate:true},s));
 for(const hold of [{width:-1,height:400},{width:500},{width:500,height:400,x:1},'500'])assert.throws(()=>validateLayout({views:[{...view,hold}],visible:true},s),String(JSON.stringify(hold)));
 assert.throws(()=>validateLayout({views:[{...view,other:1}],visible:true},s),'other unknown fields are still refused');
});

const strip=text=>text.replace(/\/\*[\s\S]*?\*\//g,'');
test('main places a view that carries a hold with placeLive (only in a layout sent at once, a page already on screen) and lets it go when the hold stops coming',()=>{
 const main=strip(fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8'));
 assert.match(main,/const live=!!rect\.hold&&next\.pageImmediate===true&&visible&&wasVisible&&!entry\.slideRun;/,'never over main\'s own glide of the page: a rectangle sent at once during it becomes the glide\'s new end, as before');
 assert.match(main,/if\(live\)placeLive\(entry,bounds,rect\.hold,slideClock,pageRadius\);else\{const animated=/);
 assert.match(main,/if\(entry\.liveHold&&!live\)endLive\(entry,slideClock\);\}else if\(entry\.liveHold\)endLive\(entry,slideClock\);/,'a view without the hold, or no longer in the layout, is let go');
});

test('the interface sends the hold only while it moves the page itself, never with reduced motion or main\'s own glide',()=>{
 const app=fs.readFileSync(path.join(__dirname,'..','src','App.tsx'),'utf8'),motion=fs.readFileSync(path.join(__dirname,'..','src','ui','sharedMotion.ts'),'utf8');
 assert.match(app,/if \(fields\.pageImmediate === true && !s\.reducedMotion && \(document\.documentElement\.dataset\.pageLive !== undefined \|\| performance\.now\(\) < toolbarEasingUntil\.current\)\)/);
 assert.match(app,/let goal = pageFollowSize\(view\.tabId\); if \(!goal\) \{ goal = eased\.get\(view\.tabId\) \?\? \{ width: view\.bounds\.width, height: view\.bounds\.height \+ rise \}; eased\.set\(view\.tabId, goal\); \}/,'the pane\'s measured end size, else the page as it stands plus the toolbar height still to go (never the geometry model: wrong for a split), taken once per ease');
 assert.match(app,/if \(easingHolds\.current\.until !== toolbarEasingUntil\.current\) easingHolds\.current = \{ until: toolbarEasingUntil\.current, sizes: new Map\(\) \};/,'a new ease starts a new estimate');
 assert.match(app,/rise = headerNow === undefined \? 0 : Math\.max\(0, Math\.round\(headerNow - headerHeight\)\)/);
 assert.match(app,/if \(!topSeam && toolbarWasSeamless\.current && !s\.reducedMotion\) toolbarEasingUntil\.current = performance\.now\(\) \+ TOOLBAR_EASE_HOLD_MS;/,'leaving Seamless opens the window');
 assert.match(app,/if \(headerHeight !== toolbarWasHeight\.current && !s\.reducedMotion\) toolbarEasingUntil\.current = performance\.now\(\) \+ TOOLBAR_EASE_HOLD_MS;/,'so does any change of the toolbar\'s height (Sidebar mode in or out, Full and Compact)');
 assert.match(app,/window\.addEventListener\(PAGE_FOLLOW_END, send\)/,'a follow ending sends the layout once more, without the hold');
 assert.match(app,/window\.removeEventListener\(PAGE_FOLLOW_END, send\)/);
 const follow=motion.slice(motion.indexOf('function followPage('),motion.indexOf('function followPage(')+3000);
 assert.ok(follow.indexOf('followSizes = new Map(')<follow.indexOf('Object.assign(style, from)'),'the end sizes are measured on the new layout, before the old box is applied');
 assert.match(follow,/window\.dispatchEvent\(new Event\(PAGE_FOLLOW_END\)\)/);
});
