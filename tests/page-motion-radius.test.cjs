'use strict';
// R7: the page's corner radius travels with the move. A page that is square under a raised toolbar rounds as it detaches into its
// card and squares again as it returns, in step with the toolbar turning into (or out of) the frame: never a flip on the first
// frame (which showed a notch under a toolbar that had not changed yet). A WebContentsView has one radius for all four corners.
const test=require('node:test'),assert=require('node:assert/strict');
const {placePageBounds}=require('../desktop/page-motion.cjs');

function run(entry,start,target,radius,{animated=true,motion='slide',midway}={}){
 let now=0,queued=null;const radii=[];
 const view={bounds:{...start},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};},setBorderRadius(value){radii.push(value);},webContents:{isDestroyed:()=>false}};
 const clock={now:()=>now,later:fn=>{queued=fn;return 1;},cancel:()=>{queued=null;}};
 entry.view=view;
 placePageBounds(entry,target,animated,clock,1000/60,motion,undefined,radius);
 for(let i=0;i<200&&queued;i++){if(midway&&i===midway.at)midway.run(entry);now+=1000/60;const fn=queued;queued=null;fn();}
 return radii;
}

test('a floating sidebar reveal: the radius grows with the glide from the square page to the card, ending at the design radius',()=>{
 const entry={radius:0};
 const radii=run(entry,{x:0,y:36,width:1280,height:764},{x:240,y:36,width:1280,height:764},8);
 assert.ok(radii.length>=5,'a run of steps, not one flip: '+radii);
 assert.ok(radii[0]<8,'the first frame is not already round: '+radii);
 for(let i=1;i<radii.length;i++)assert.ok(radii[i]>=radii[i-1],'it only grows: '+radii);
 assert.equal(radii.at(-1),8);assert.equal(entry.radius,8);assert.equal(entry.radiusGoal,undefined,'the goal is cleared at the end');
});

test('a floating sidebar hide: the radius shrinks with the glide to the square page',()=>{
 const entry={radius:8};
 const radii=run(entry,{x:240,y:36,width:1280,height:764},{x:0,y:36,width:1280,height:764},0);
 assert.ok(radii.length>=5,'a run of steps: '+radii);
 assert.ok(radii[0]>0,'the first frame is not already square: '+radii);
 for(let i=1;i<radii.length;i++)assert.ok(radii[i]<=radii[i-1],'it only shrinks: '+radii);
 assert.equal(radii.at(-1),0);assert.equal(entry.radius,0);
});

test('a move without animation sets the radius at once, and a first placement has no radius to travel from',()=>{
 const entry={radius:8};
 assert.deepEqual(run(entry,{x:240,y:36,width:100,height:100},{x:0,y:36,width:200,height:100},0,{animated:false}),[0]);
 const fresh={};
 assert.deepEqual(run(fresh,{x:0,y:36,width:100,height:100},{x:50,y:36,width:100,height:100},8),[8],'a new page view takes the design radius on its first frame');
});

test('an unchanged radius is not set again, and a caller that gives none never touches it',()=>{
 const same={radius:8};
 assert.deepEqual(run(same,{x:0,y:36,width:100,height:100},{x:50,y:36,width:100,height:100},8),[]);
 const none={radius:8};
 assert.deepEqual(run(none,{x:0,y:36,width:100,height:100},{x:50,y:36,width:100,height:100},undefined),[]);
});

test('a new goal during a move is picked up by the move that is running',()=>{
 const entry={radius:0};
 const radii=run(entry,{x:0,y:36,width:1280,height:764},{x:240,y:36,width:1280,height:764},8,{midway:{at:6,run:item=>{item.radiusGoal=4;}}});
 assert.equal(radii.at(-1),4);assert.equal(entry.radius,4);
});

test('main.cjs hands the radius to the move and only sets it directly when the page does not move',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','desktop','main.cjs'),'utf8');
 assert.match(source,/next\.pageMotion,next\.pageSpring,pageRadius[,)]/,'the move carries the radius');
 assert.match(source,/pageRadius,\['full','compact','seamless'\]\.includes\(effectiveView\(state\.settings,state\.windowUi\)\)&&next\.views\.length===1,layoutPace\(next\.motionSpeed\)\)/,'only the normal, Compact and Seamless views\' single page glides with its size held, at the speed\'s pace');
 assert.match(source,/else if\(\(entry\.radiusGoal\?\?entry\.radius\)!==pageRadius\)\{if\(entry\.boundsTimer\)entry\.radiusGoal=pageRadius;else applyRadius\(entry,pageRadius\);\}/,'no move: set at once, or hand it to the running one');
 assert.doesNotMatch(source,/entry\.view\.setBorderRadius\(Math\.round\(radius\)\)/,'no flip on the first frame any more');
});

test('the page dissolve is off unless ACIRA_DISSOLVE=1: neither the slide clock nor the sidebar intent warm-up makes a picture layer otherwise', () => {
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','desktop','main.cjs'),'utf8');
 assert.match(source,/get dissolve\(\)\{return process\.env\.ACIRA_DISSOLVE!==\'1\'\|\|chromeFloated\|\|pictureHold\?null:pageDissolve;\}/,'no dissolve on the slide clock by default');
 assert.match(source,/if\(process\.env\.ACIRA_DISSOLVE===\'1\'&&action\.type===\'ui\.update\'&&action\.patch&&[^;]*pageDissolve\.warm\(\);/,'and no layer is warmed for it (a renderer of ~100 MB)');
});
