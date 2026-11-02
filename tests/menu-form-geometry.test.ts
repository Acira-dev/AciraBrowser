import test from 'node:test';
import assert from 'node:assert/strict';
import { menuFormGeometry } from '../src/ui/menuFormGeometry';
import { menuFrameCoverage, menuFormOwnerRetired, menuFormSnapshotAdmitted } from '../src/ui/menuFormBackdrop';
import { popupGeometry } from '../src/ui/popup';
import type { BrowserSnapshot } from '../src/runtime/types';

test('menu forms choose the available side without compressing the field', () => {
  const trigger = {x: 100, y: 200, width: 300, height: 30};
  assert.equal(menuFormGeometry({x: 100, y: 100, width: 320, height: 400}, trigger, {width: 1200, height: 800}, 220).side, 'right');
  assert.equal(menuFormGeometry({x: 850, y: 100, width: 320, height: 400}, trigger, {width: 1200, height: 800}, 220).side, 'left');
  assert.equal(menuFormGeometry({x: 400, y: 100, width: 320, height: 400}, trigger, {width: 1200, height: 800}, 220, true).side, 'left');
});

test('profiles follow toolbar and sidebar controls and preserve their true origin', () => {
  const state = {tabs: [], browserProfiles: [{id: 'p'}]} as unknown as BrowserSnapshot;
  const toolbar = {x: 900, y: 44, width: 28, height: 28};
  const below = popupGeometry('profile', state, {width: 1200, height: 800}, toolbar, 160);
  assert.equal(below.bounds.y, 80);
  assert.equal(below.origin.y, 0);
  assert.deepEqual(below.anchor, toolbar);
  const sidebar = {x: 20, y: 735, width: 200, height: 32};
  const above = popupGeometry('profile', state, {width: 1200, height: 800}, sidebar, 160);
  assert.equal(above.bounds.y, 567);
  assert.equal(above.origin.y, 1);
  assert.deepEqual(above.anchor, sidebar);
});

test('forms respect the primary popup toolbar and caption exclusion', () => {
  const result = menuFormGeometry({x: 400, y: 90, width: 320, height: 200}, {x: 400, y: 260, width: 300, height: 30}, {width: 1200, height: 400}, 600, false, {top: 90, bottom: 388});
  assert.equal(result.bounds.y, 90);
  assert.equal(result.bounds.height, 298);
});

test('narrow and short windows get a bounded replacement with scrolling space', () => {
  const parent = {x: 40, y: 100, width: 320, height: 400};
  const result = menuFormGeometry(parent, {x: 40, y: 490, width: 320, height: 30}, {width: 600, height: 400}, 650);
  assert.equal(result.side, 'replace');
  assert.deepEqual(result.bounds, {x: 40, y: 12, width: 320, height: 376});
});

test('child glass requires every website region behind its padded sample', () => {
  const viewport={x:0,y:0,width:1200,height:800},sample={x:100,y:160,width:500,height:300};
  const views=[{tabId:'left',bounds:{x:0,y:100,width:500,height:700}},{tabId:'right',bounds:{x:500,y:100,width:700,height:700}}];
  const chrome={key:'chrome',bounds:viewport},left={key:'page:left',bounds:views[0].bounds},right={key:'page:right',bounds:views[1].bounds};
  assert.equal(menuFrameCoverage(sample,[chrome,left],views,viewport),false,'chrome cannot substitute for a missing native split pane');
  assert.equal(menuFrameCoverage(sample,[chrome,left,right],views,viewport),true);
  assert.equal(menuFrameCoverage(sample,[chrome,{...left,bounds:{...left.bounds,width:150}},right],views,viewport),false,'partial coverage stays opaque');
  assert.equal(menuFrameCoverage(sample,[left,right],views,viewport),false,'chrome gaps also need a source');
  assert.equal(menuFrameCoverage({x:-64,y:-64,width:300,height:220},[chrome],[],viewport),true,'blur padding outside the viewport needs no invented source');
});

test('a child portal retires immediately with hidden, inactive, preparing or replaced ownership', () => {
  const ready={preparing:false,inactive:false,hidden:false,ownerScene:'10:extensions',currentScene:'10:extensions'};
  assert.equal(menuFormOwnerRetired(ready),false);
  for(const change of [{preparing:true},{inactive:true},{hidden:true},{currentScene:'11:extensions'},{currentScene:'10:profile'}])assert.equal(menuFormOwnerRetired({...ready,...change}),true);
  assert.equal(menuFormOwnerRetired({...ready,currentScene:undefined}),false,'an initially unavailable layout is an opaque fallback rather than invented replacement');
});

test('child snapshot waits for current native auxiliary geometry acknowledgment', () => {
  const desired={x:100,y:180,width:320,height:240};
  assert.equal(menuFormSnapshotAdmitted(7,{id:7},desired),false);
  assert.equal(menuFormSnapshotAdmitted(7,{id:6,auxiliaryBounds:desired},desired),false);
  assert.equal(menuFormSnapshotAdmitted(7,{id:7,auxiliaryBounds:{...desired,width:280}},desired),false);
  assert.equal(menuFormSnapshotAdmitted(7,{id:7,auxiliaryBounds:{...desired,x:100.666}},desired),true,'fractional native rounding is accepted once');
  assert.equal(menuFormSnapshotAdmitted(7,{id:7,auxiliaryBounds:desired},desired),true);
  assert.equal(menuFormSnapshotAdmitted(undefined,{id:7,auxiliaryBounds:desired},desired),false);
});
