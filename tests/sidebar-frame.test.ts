import test from 'node:test';
import assert from 'node:assert/strict';
import {frameTintFor,studyFinish,withFrameTint} from '../src/ui/theme';
import {browserGeometry} from '../src/ui/browserGeometry';
import type {BrowserProfile,BrowserSnapshot} from '../src/runtime/types';

// Benchmark §2 #1 and #2 (G): the profile-tinted frame and the page card inset while the sidebar is open.
const profile=(id:string,color:string,extra:Partial<BrowserProfile>={}):BrowserProfile=>({id,name:id,color,partition:`persist:acira-${id}`,...extra});
const state=(active:string,profiles:BrowserProfile[],defaultProfileId?:string)=>({activeBrowserProfileId:active,browserProfiles:profiles,settings:{colorPreset:'',browserTint:'',accentColor:'',defaultProfileId}} as unknown as Pick<BrowserSnapshot,'activeBrowserProfileId'|'browserProfiles'|'settings'>);
const profiles=[profile('profile-personal','#62666d'),profile('work','#2f6fde'),profile('private','#6d4fd6',{private:true}),profile('tor','#6a3f86',{tor:true})];
const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));

test('only a non-default, non-private profile tints the frame',()=>{
 assert.equal(frameTintFor(state('profile-personal',profiles)),undefined,'the first profile is the default and stays neutral');
 assert.equal(frameTintFor(state('work',profiles)),'#2f6fde');
 assert.equal(frameTintFor(state('work',profiles,'work')),undefined,'the chosen default stays neutral');
 assert.equal(frameTintFor(state('profile-personal',profiles,'work')),'#62666d');
 assert.equal(frameTintFor(state('private',profiles)),undefined);
 assert.equal(frameTintFor(state('tor',profiles)),undefined);
 assert.equal(frameTintFor(state('work',[profiles[0],profile('work','blue')])),undefined,'only #rrggbb colours');
 const neutral=state('profile-personal',profiles);
 assert.equal(withFrameTint(neutral),neutral.settings,'no tint: the same settings object, so the theme cache still hits');
 assert.equal(withFrameTint(state('work',profiles)).frameTint,'#2f6fde');
});

test('the tint is a light 7% mix in light and 8% in dark: the frame moves toward the profile colour and keeps its tone',()=>{
 for(const dark of [false,true]){
  const neutral=studyFinish({colorPreset:'',browserTint:'',accentColor:''},dark)['--ed-chrome'];
  const tinted=studyFinish({colorPreset:'',browserTint:'',accentColor:'',frameTint:'#2f6fde'},dark)['--ed-chrome'];
  assert.notEqual(tinted,neutral);
  const [r0,g0,b0]=rgb(neutral),[r1,g1,b1]=rgb(tinted);
  assert.ok(b1-r1>b0-r0,`${tinted} leans blue against ${neutral}`);
  assert.ok(Math.abs((r1+g1+b1)-(r0+g0+b0))<=3*14,`${tinted} keeps the tone of ${neutral}`);
 }
 assert.equal(studyFinish({colorPreset:'',browserTint:'',accentColor:'',frameTint:'nope'})['--ed-chrome'],studyFinish({colorPreset:'',browserTint:'',accentColor:''})['--ed-chrome']);
});

test('with the sidebar open the page estimate is inset 6px from the right and bottom edges',()=>{
 const base={width:1280,height:800,headerHeight:36,style:'acira' as const,focus:false,sidebarWidth:240,split:false};
 assert.deepEqual(browserGeometry(base).page,{x:240,y:36,width:1040,height:764});
 assert.deepEqual(browserGeometry({...base,cardInset:6}).page,{x:240,y:36,width:1034,height:758});
});
