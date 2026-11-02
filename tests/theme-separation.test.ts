import test from 'node:test';
import assert from 'node:assert/strict';
import {studyFinish,frameChromeOf} from '../src/ui/theme';
import {contrast,mix,rgb,toOklch} from '../src/ui/colorMath';
import {appearancePalettes,palettePreference} from '../src/runtime/appearancePalettes';

// OKLab lightness of a hex colour: the perceptual measure the finish ladders are built on.
const lin=(c:number)=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
const lightness=(hex:string)=>{const n=parseInt(hex.replace('#','').slice(0,6),16),r=lin(n>>16),g=lin(n>>8&255),b=lin(n&255);
  return .2104542553*Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b)+.793617813*Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b)-.0040720409*Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);};
const finishes=appearancePalettes;

test('light tabs and carried cards keep dark readable ink on neutral raised surfaces across finishes',()=>{
 for(const finish of finishes){
  const t=studyFinish(palettePreference(finish),false);
  for(const [bg,fg] of [['--tab-selection-bg','--tab-selection-fg'],['--frame-selection-bg','--frame-selection-fg'],['--tab-carry-bg','--tab-carry-fg']]){
   assert.equal(t[bg],'#ffffff',finish.name+' '+bg+' stays neutral rather than taking the blue frame tint');
   assert.ok(contrast(t[fg],t[bg])>=7,finish.name+' '+fg+' reads on its own card');
  }
  assert.ok(contrast(t['--frame-selection-muted'],t['--frame-selection-bg'])>=4.5,finish.name+' secondary tab labels stay readable too');
 }
});

test('an explicitly chosen tab colour still has its own contrast-checked foreground',()=>{
 for(const dark of [false,true])for(const tabColor of ['#eff7ff','#102840','#3f91ed']){
  const t=studyFinish({...palettePreference(appearancePalettes[0]),tabColor},dark);
  assert.ok(contrast(t['--tab-selection-fg'],t['--tab-selection-bg'])>=4.5,tabColor+' '+dark);
  assert.equal(t['--frame-selection-fg'],t['--tab-selection-fg']);
 }
});

test('on every finish, light and dark, the sidebar and the page are clearly different surfaces',()=>{
  const weak:string[]=[];
  for(const finish of finishes)for(const dark of [false,true]){
    const t=studyFinish({colorPreset:finish.name,browserTint:finish.tint,accentColor:finish.accent},dark);
    // Dark pages and dark (deep) chrome need a clear step; a pale chrome around a white page also has the sheet's
    // hairline and shadow, as other apps' light sidebars do, so it needs less.
    const gap=Math.abs(lightness(t['--sheet'])-lightness(t['--ed-chrome'])),deep=dark||t['--chrome-tone']==='dark';
    if(gap<(deep?.06:.035))weak.push(`${finish.name} ${dark?'dark':'light'}: ${gap.toFixed(3)}`);
  }
  assert.deepEqual(weak,[],'chrome and page lightness differ enough to read as two surfaces');
});

test('raised controls (the composer, cards) stand off the page in dark mode',()=>{
  for(const finish of finishes){
    const t=studyFinish({colorPreset:finish.name,browserTint:finish.tint,accentColor:finish.accent},true);
    assert.ok(lightness(t['--raised'])-lightness(t['--sheet'])>=.035,`${finish.name}: raised sits above the page`);
  }
});

test('Mac glass keeps the finish hue and lets the native backdrop contribute',()=>{
  for(const finish of finishes)for(const dark of [false,true]){
    const t=studyFinish({colorPreset:finish.name,browserTint:finish.tint,accentColor:finish.accent},dark);
    const alpha=parseFloat(t['--mac-glass-density'])/100;
    assert.equal(alpha,finish.name==='Porcelain'?.18:.38,`${finish.name}: white glass stays neutral and coloured glass has a visible tint`);
    const overBlack=rgb(mix(t['--mac-glass-color'],'#000000',alpha)),overWhite=rgb(mix(t['--mac-glass-color'],'#ffffff',alpha));
    assert.ok(overWhite.every((v,i)=>v-overBlack[i]>=157),`${finish.name}: most of the native backdrop still contributes`);
    if(finish.name==='Porcelain'){
      assert.equal(t['--mac-glass-color'],t['--ed-chrome']);assert.equal(alpha,.18);
    }else{
      const [,C,h]=toOklch(finish.light),[,glassC,glassH]=toOklch(t['--mac-glass-color']);
      if(C>.035){
        const distance=Math.abs(Math.atan2(Math.sin(glassH-h),Math.cos(glassH-h)));
        assert.ok(distance<.04,`${finish.name}: glass follows the finish's hue`);
        if(dark)assert.ok(glassC>toOklch(t['--ed-chrome'])[1]*1.5,`${finish.name}: dark glass retains colour instead of becoming neutral`);
      }
    }
    if(finish.name!=='Porcelain')for(const native of t['--chrome-tone']==='dark'?['#292a2e','#686868']:['#ffffff','#b8b8b8']){
      const deep=t['--chrome-tone']==='dark',backing=mix(t['--mac-glass-color'],native,alpha),ink=deep?'#ffffff':'#141518';
      assert.ok(contrast(mix(ink,backing,deep?.94:.86),backing)>=4.5,`${finish.name}: ink stays readable on its matching native material`);
    }
  }
});

test('custom glass tints follow colour changes in the same mode',()=>{
  for(const dark of [false,true]){
    const colors=['#d03065','#20847e','#2777c8'].map(color=>studyFinish({colorPreset:'Custom',browserTint:color,accentColor:color},dark)['--mac-glass-color']);
    assert.equal(new Set(colors).size,3);
    assert.ok(rgb(colors[0])[0]>rgb(colors[0])[2],'rose stays warm');
    assert.ok(rgb(colors[1])[1]>rgb(colors[1])[0],'teal stays green');
    assert.ok(rgb(colors[2])[2]>rgb(colors[2])[0],'blue stays cool');
  }
});

test('Mac glass opacity follows the slider and reaches a solid accessible fallback',()=>{
  for(const finish of finishes)for(const dark of [false,true]){
    let previous=0;
    for(const opacity of [60,64,72,84,88,96,100]){
      const t=studyFinish({colorPreset:finish.name,browserTint:finish.tint,accentColor:finish.accent,glassOpacity:opacity},dark);
      const density=parseFloat(t['--mac-glass-density']);
      assert.ok(density>=previous&&density<=100,`${finish.name}: monotonic material opacity`);
      if(opacity===100)assert.equal(density,100);
      previous=density;
    }
  }
});

test('search ink and field boundary remain visible with custom finishes and higher contrast',()=>{
  const custom=['#000000','#ffffff','#ff0080','#00ffff','#808080'].map(tint=>({name:'Custom',tint,accent:tint}));
  for(const finish of [...finishes,...custom])for(const dark of [false,true])for(const highContrast of [false,true]){
    const t=studyFinish({colorPreset:finish.name,browserTint:finish.tint,accentColor:finish.accent},dark,highContrast);
    for(const role of ['--input-fill','--input-hover']){
      assert.ok(contrast(t['--text-primary'],t[role])>=7);
      assert.ok(contrast(t['--text-placeholder'],t[role])>=4.5);
      assert.ok(contrast(t['--input-edge-strong'],t[role])>=3);
    }
    assert.ok(contrast(t['--input-edge-strong'],t['--sheet'])>=3);
  }
});

test('the swatch frame colour (frameChromeOf) equals the token set --ed-chrome for every finish in light and dark',()=>{
  for(const finish of appearancePalettes)for(const dark of [false,true]){const p=palettePreference(finish);assert.equal(frameChromeOf(p,dark),studyFinish(p,dark)['--ed-chrome'],`${finish.name} ${dark?'dark':'light'}`);}
});
