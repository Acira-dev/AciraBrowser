const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLayout } = require('../desktop/validation.cjs');
const { scaleLayout } = require('../desktop/interface-scale.cjs');
const { MaterialHost } = require('../desktop/composition.cjs');

const bounds = {x: 700, y: 100, width: 320, height: 240};
const child = {x: 372, y: 180, width: 320, height: 220};
const overlay = {kind: 'extensions', id: 12, bounds, anchor: {x: 980, y: 64, width: 28, height: 28}, origin: {x: 1, y: 0}, contentHeight: 240, auxiliaryBounds: child};

test('child form bounds validate strictly and scale exactly once in both directions', () => {
  const layout = {views: [], visible: true, overlay};
  assert.deepEqual(validateLayout(layout).overlay.auxiliaryBounds, child);
  for (const bad of [{...child, width: NaN}, {...child, x: Infinity}, {...child, width: 13000}, {...child, injected: true}]) {
    assert.throws(() => validateLayout({...layout, overlay: {...overlay, auxiliaryBounds: bad}}));
  }
  assert.deepEqual(scaleLayout(layout, 1.5).overlay.auxiliaryBounds, {x: 558, y: 270, width: 480, height: 330});
  assert.deepEqual(scaleLayout(scaleLayout(layout, 1.5), 1 / 1.5).overlay.auxiliaryBounds, child);
});

class View {
  getBounds() { return this.bounds || {x:0,y:0,width:0,height:0}; }
  setBounds(bounds) { this.bounds = bounds; }
  setVisible() {} setBackgroundColor() {} setBackgroundBlur() {} setBorderRadius() {}
}

test('passive native popups never extend their renderer input canvas over the page', () => {
  for (const scale of [.8,.9,1,1.1,1.25,1.5]) for (const kind of ['toast','zoom','group-preview']) {
    const content=new View(),host=new MaterialHost(new View(),content,()=>{},()=>new View());
    host.uiScale=scale;
    const config={...overlay,kind}; delete config.auxiliaryBounds;
    host.placeFloating(config,{reducedMotion:true,captionHeight:40},[1200,800]);
    assert.deepEqual(content.getBounds(),{x:0,y:0,width:host.bounds.width,height:host.bounds.height},kind);
    assert.equal(content.popupViewport.x,host.bounds.x/scale);
    assert.equal(content.popupViewport.y,host.bounds.y/scale);
    assert.equal(content.popupViewport.width,1200/scale);
    assert.equal(content.popupViewport.height,800/scale);
    host.hide({reducedMotion:true});
  }
});

test('switching between passive notices and menus restores each native input policy', () => {
  const content=new View(),host=new MaterialHost(new View(),content,()=>{},()=>new View());
  const layout={reducedMotion:true,captionHeight:40};
  let id=20;
  for(const kind of ['toast','menu','zoom','extensions','group-preview','suggestions','toast']){
    host.placeFloating({...overlay,kind,id:++id},layout,[1200,800]);
    const passive=['toast','zoom','group-preview'].includes(kind);
    assert.equal(content.getBounds().x,passive?0:-host.bounds.x);
    assert.equal(content.getBounds().width,passive?host.bounds.width:1200);
    assert.equal(content.popupViewport.x,passive?host.bounds.x:0);
  }
  host.hide({reducedMotion:true});
});

test('popup warmup is also bounded and a viewport rebase is sent only when changed', () => {
  const {placePopupCanvas}=require('../desktop/composition.cjs'),content=new View(),sent=[];
  content.webContents={send:(channel,value)=>sent.push({channel,value})};
  placePopupCanvas(content,{x:1176,y:776,width:24,height:24},[1200,800],1.5);
  placePopupCanvas(content,{x:1176,y:776,width:24,height:24},[1200,800],1.5);
  assert.deepEqual(content.getBounds(),{x:0,y:0,width:24,height:24});
  assert.deepEqual(sent,[{channel:'acira:popup-viewport',value:{x:784,y:776/1.5,width:800,height:800/1.5}}]);
});

test('native passive popup placement, Undo and menu transitions work at every interface scale', {skip:!['darwin','win32'].includes(process.platform),timeout:180000}, () => {
  const {spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
  const repo=path.resolve(__dirname,'..'),out=path.join(repo,'qa/artifacts/passive-popup-input-test-'+Date.now());
  const run=spawnSync(process.execPath,['qa/passive-popup-input.mjs'],{cwd:repo,env:{...process.env,PASSIVE_INPUT_ONLY:'',PASSIVE_INPUT_OUT:out},encoding:'utf8',timeout:170000,maxBuffer:2*1024*1024});
  assert.equal(run.status,0,((run.stdout||'')+'\n'+(run.stderr||'')).slice(-6000));
  const report=JSON.parse(fs.readFileSync(path.join(out,'result.json'),'utf8'));
  assert.equal(report.passed,true);assert.ok(report.checks.length>=25);
});

test('real popup trigger metadata validates and scales once without changing native host geometry',()=>{
 const trigger={x:1040,y:56,width:32,height:28},layout={views:[],visible:true,overlay:{...overlay,context:{trigger,lockedTop:110}}};
 assert.deepEqual(validateLayout(layout).overlay.context.trigger,trigger);
 for(const bad of [{...trigger,width:NaN},{...trigger,height:13000},{...trigger,script:true}])assert.throws(()=>validateLayout({...layout,overlay:{...layout.overlay,context:{trigger:bad}}}));
 const scaled=scaleLayout(layout,1.5);assert.deepEqual(scaled.overlay.context.trigger,{x:1560,y:84,width:48,height:42});
 assert.equal(scaled.overlay.context.lockedTop,165);assert.deepEqual(scaleLayout(scaled,1/1.5).overlay.context.trigger,trigger);
 const a=new MaterialHost(new View(),new View(),()=>{},()=>new View()),b=new MaterialHost(new View(),new View(),()=>{},()=>new View());
 a.placeFloating(layout.overlay,{views:[],reducedMotion:true,captionHeight:40},[1200,800]);b.placeFloating(overlay,{views:[],reducedMotion:true,captionHeight:40},[1200,800]);
 assert.deepEqual(a.readyDestination,b.readyDestination,'Trigger metadata must never widen the input host');
});

test('child form grows only the native input host and closing returns to primary bounds', () => {
  const host = new MaterialHost(new View(), new View(), () => {}, () => new View());
  const layout = {views: [], visible: true, reducedMotion: true, reducedTransparency: true, captionHeight: 40};
  const size = [1200, 800];
  const primary = {...overlay}; delete primary.auxiliaryBounds;
  host.placeFloating(primary, layout, size);
  const original = {...host.readyDestination};
  host.placeFloating(overlay, layout, size);
  assert.deepEqual(host.panelRect, bounds, 'the primary material is not resized into a giant panel');
  assert.ok(host.readyDestination.x <= child.x);
  assert.ok(host.readyDestination.x + host.readyDestination.width >= child.x + child.width);
  assert.ok(host.readyDestination.y >= overlay.anchor.y + overlay.anchor.height, 'toolbar remains outside the input region');
  host.placeFloating(primary, layout, size);
  assert.deepEqual(host.readyDestination, original, 'child crop clears when the form closes');
});
