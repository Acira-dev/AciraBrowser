import { test } from 'node:test';import assert from 'node:assert/strict';import { formationFrames, formationLayerFrames, formationLayerPaint, restingFormation } from '../src/ui/sheetFormation';
import { canRetainClosingMaterial, createPopupMaterialDeadline, popupMaterialProvider } from '../src/ui/popupMaterial';

const options={start:{},closing:false,switching:false,reversing:false,duration:420,firstDelay:20,stagger:14,count:20,blur:12,enterScale:.96,exitScale:.985,exitBlur:10};
test('a fresh sheet condenses from blur on one clock and rests crisp',()=>{const plan=formationFrames(options),first=plan.at(0),last=plan.final;
 assert.equal(first['--formation-opacity'],0);assert.equal(first['--formation-blur'],12);assert.equal(first['--formation-scale'],.96);
 assert.deepEqual(last,restingFormation);
 // Glass is present before focus arrives: opacity leads blur and scale.
 const mid=plan.at(120);assert.ok(mid['--formation-opacity']>.6&&mid['--formation-blur']>1);});
test('rows follow the plane on an uncompressed stagger and each keeps its full duration',()=>{const plan=formationFrames(options);
 assert.equal(plan.at(20)['--formation-row-0'],0);assert.ok(plan.at(21)['--formation-row-0']>0);
 assert.equal(plan.at(20+9*14)['--formation-row-9'],0);assert.equal(plan.duration,20+9*14+420*.7);assert.equal(plan.final['--formation-row-9'],1);});
test('evaporation continues from the painted frame toward the anchor',()=>{const start=formationFrames(options).at(130),plan=formationFrames({...options,start,closing:true,duration:240});
 for(const key of ['--formation-opacity','--formation-blur','--formation-scale'])assert.equal(plan.at(0)[key],start[key]);
 assert.equal(plan.final['--formation-opacity'],0);assert.equal(plan.final['--formation-blur'],10);assert.equal(plan.final['--formation-scale'],.985);});
test('an interrupted close reopens from its painted values without a fresh cascade',()=>{const open=formationFrames(options).final,painted=formationFrames({...options,start:open,closing:true,duration:240}).at(70),plan=formationFrames({...options,start:painted,reversing:true});
 assert.equal(plan.at(0)['--formation-opacity'],painted['--formation-opacity']);assert.equal(plan.at(0)['--formation-row-3'],1);assert.equal(plan.duration,420);assert.deepEqual(plan.final,restingFormation);});
test('scene replacement keeps the formed sheet while rows resolve again',()=>{const plan=formationFrames({...options,start:formationFrames(options).final,switching:true});
 for(const time of [0,130,260])assert.equal(plan.at(time)['--formation-opacity'],1);assert.equal(plan.at(0)['--formation-row-0'],0);});
test('reduced motion is a plain crossfade with no blur or scale',()=>{const plan=formationFrames({...options,reduced:true,duration:120});
 assert.equal(plan.duration,120);for(const time of [0,60,120]){assert.equal(plan.at(time)['--formation-blur'],0);assert.equal(plan.at(time)['--formation-scale'],1);assert.equal(plan.at(time)['--formation-row-5'],1);}
 assert.equal(plan.at(60)['--formation-opacity'],.5);});

test('the sheet slides from its trigger and settles with no offset',()=>{const plan=formationFrames({...options,rise:-4,exitRise:-2});
 assert.equal(plan.at(0)['--formation-y'],-4);assert.equal(plan.final['--formation-y'],0);
 const close=formationFrames({...options,start:plan.final,closing:true,duration:130,rise:-4,exitRise:-2});assert.equal(close.final['--formation-y'],-2);
 assert.equal(plan.serialize(plan.at(0))['--formation-y'],'-4px');});

test('compositor projection keeps the exact interrupted plane and only animates transform and opacity',()=>{
 const open=formationFrames({...options,enterOpacity:.8,rise:-4});
 const interrupted=open.at(63),close=formationFrames({...options,start:interrupted,closing:true,duration:120});
 const layers=formationLayerFrames(close);
 assert.deepEqual(layers.plane[0],{offset:0,...formationLayerPaint(interrupted).plane});
 for(const keyframes of Object.values(layers))for(const frame of keyframes)assert.deepEqual(Object.keys(frame).sort(),['offset','opacity','transform']);
 assert.equal(layers.plane.at(-1)?.opacity,0);
});

test('reduced motion projection has no mist or movement throughout its fade',()=>{
 const layers=formationLayerFrames(formationFrames({...options,reduced:true,duration:90}));
 for(const frame of layers.plane)assert.equal(frame.transform,'translateY(0px) scale(1)');
 for(const frame of layers.mist){assert.equal(frame.opacity,0);assert.equal(frame.transform,'scale(1)');}
});

test('a cold native sheet never waits for its frost: it condenses on the dense plate and the glass crossfades in',()=>{
 const base={native:true,reducedTransparency:false,opaque:false,visible:false};
 assert.equal(popupMaterialProvider({...base,status:'pending'}),'opaque');
 assert.equal(popupMaterialProvider({...base,status:'live'}),'live');
 assert.equal(popupMaterialProvider({...base,status:'native'}),'native');
 assert.equal(popupMaterialProvider({...base,status:'pending',visible:true}),'opaque');
 assert.equal(popupMaterialProvider({...base,status:'pending',reducedTransparency:true}),'opaque');
 assert.equal(popupMaterialProvider({...base,status:'pending',native:false}),'css');
});

test('decoded glass remains dense while its geometry settles and sharp rows can be readable immediately',()=>{
 const plan=formationFrames({...options,enterOpacity:1,rowStart:1,blur:0,count:0,firstDelay:0,stagger:0,duration:220,enterScale:.985});
 for(const frame of formationLayerFrames(plan).plane)assert.equal(frame.opacity,1);
 assert.equal(plan.at(0)['--formation-row-0'],1);
 assert.equal(plan.final['--formation-scale'],1);
});

test('a stalled material fixes its fallback once and rejects late decoded completion',async()=>{
 let fallbacks=0;const deadline=createPopupMaterialDeadline(()=>fallbacks++,5);
 await new Promise(resolve=>setTimeout(resolve,15));
 assert.equal(fallbacks,1);assert.equal(deadline.accept(),false);deadline.cancel();assert.equal(fallbacks,1);
});

test('accepted and cancelled acquisitions cannot fire a later material switch',async()=>{
 let fallbacks=0;const accepted=createPopupMaterialDeadline(()=>fallbacks++,5),cancelled=createPopupMaterialDeadline(()=>fallbacks++,5);
 assert.equal(accepted.accept(),true);assert.equal(accepted.accept(),false);cancelled.cancel();
 await new Promise(resolve=>setTimeout(resolve,15));assert.equal(fallbacks,0);assert.equal(cancelled.accept(),false);
});

test('a context-changing exit retains only frozen pixels with every capture already ended',()=>{
 const frozen={frame:{width:640,height:480},stream:{getTracks:()=>[{readyState:'ended'},{readyState:'ended'}]}};
 const options={closing:true,enabled:true,previousEnabled:true,frames:[frozen]};
 assert.equal(canRetainClosingMaterial(options),true);
 assert.equal(canRetainClosingMaterial({...options,closing:false}),false,'A new/reopened context must clear the old cache');
 assert.equal(canRetainClosingMaterial({...options,enabled:false}),false,'Reduced transparency retires old glass at once');
 assert.equal(canRetainClosingMaterial({...options,previousEnabled:false}),false);
 assert.equal(canRetainClosingMaterial({...options,frames:[]}),false);
 assert.equal(canRetainClosingMaterial({...options,frames:[{...frozen,frame:undefined}]}),false);
 assert.equal(canRetainClosingMaterial({...options,frames:[{...frozen,frame:{width:0,height:480}}]}),false);
 assert.equal(canRetainClosingMaterial({...options,frames:[{...frozen,stream:{getTracks:()=>[{readyState:'live'}]}}]}),false,'Never retain live captures for an old context');
 assert.equal(canRetainClosingMaterial({...options,frames:[{frame:{width:640,height:480}}]}),true,'A decoded native snapshot has no capture stream');
});

test('the signature open shows the whole sheet with its glass on the first frame and never clips',()=>{
 const plan=formationFrames({...options,enterOpacity:.7,rowStart:1,blur:0,count:0,firstDelay:0,stagger:0,duration:220,enterScale:.985,exitScale:.98,exitBlur:0,rise:-4});
 const first=formationLayerPaint(plan.at(0)),layers=formationLayerFrames(plan);
 assert.equal(first.plane.opacity,.7);assert.ok(first.material.opacity>.6,'the frost is present from the input frame, not switched on at the end');
 assert.ok(first.mist.opacity>.3,'the mist condenses around the glass');
 // The glass thickens monotonically with the motion: no end-of-animation step.
 for(let i=1;i<layers.material.length;i++)assert.ok(layers.material[i].opacity>=layers.material[i-1].opacity-1e-9);
 const steps=layers.material.map((frame,i)=>i?frame.opacity-layers.material[i-1].opacity:0);assert.ok(Math.max(...steps)<.2);
 for(const keyframes of Object.values(layers))for(const frame of keyframes){assert.ok(!('clipPath' in frame));assert.deepEqual(Object.keys(frame).sort(),['offset','opacity','transform']);}
 const last=formationLayerPaint(plan.final);assert.equal(last.material.opacity,1);assert.equal(last.mist.opacity,0);assert.equal(last.plane.transform,'translateY(0px) scale(1)');
});



test('a new scene during a close reversal preserves every captured property',()=>{
 const opened=formationFrames(options).final;
 const closing=formationFrames({...options,start:opened,closing:true,duration:120}).at(45);
 const reopened=formationFrames({...options,start:closing,reversing:true,switching:true});
 assert.deepEqual(reopened.at(0),closing);
 assert.deepEqual(reopened.final,restingFormation);
});

test('a material readiness update continues a partially formed sheet',()=>{
 const painted=formationFrames(options).at(35);
 const continued=formationFrames({...options,start:painted,continuing:true});
 assert.deepEqual(continued.at(0),painted);
 assert.deepEqual(continued.final,restingFormation);
});


test('immediate menus start legible and keep their painted frame when frost arrives',()=>{
 const menu={...options,firstDelay:0,enterOpacity:.8,rowStart:.8};
 const plan=formationFrames(menu),first=plan.at(0);
 assert.equal(first['--formation-opacity'],.8);assert.equal(first['--formation-row-0'],.8);assert.equal(first['--formation-row-9'],.8);
 const painted=plan.at(24),continued=formationFrames({...menu,start:painted,continuing:true});
 assert.deepEqual(continued.at(0),painted);assert.deepEqual(continued.final,restingFormation);
 const closing=formationFrames({...menu,start:painted,closing:true}).at(35);
 assert.deepEqual(formationFrames({...menu,start:closing,reversing:true,switching:true}).at(0),closing);
});


test('zero-duration keyboard and reduced-motion plans paint their target at time zero',()=>{
 const open=formationFrames({...options,reduced:true,duration:0});
 assert.equal(open.duration,0);assert.deepEqual(open.at(0),restingFormation);assert.deepEqual(open.final,restingFormation);
 const close=formationFrames({...options,start:restingFormation,closing:true,reduced:true,duration:0});
 assert.equal(close.at(0)['--formation-opacity'],0);assert.equal(close.final['--formation-opacity'],0);
 for(const value of Object.values(close.final))assert(Number.isFinite(value));
});