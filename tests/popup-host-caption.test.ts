import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createInitialState,makeTab} from '../src/runtime/core';
import {pointerAnchor,popupGeometry} from '../src/ui/popup';

/** beta.7 (founder, Compact, macOS fullscreen, dark): right-click on the toolbar and Toolbar options opened with its title row cut off
 * under the toolbar. A right-click menu opens at the pointer (R3-48), so one opened in the toolbar row starts above the caption line,
 * and the native host that crops every floating popup never reached above that line: it kept the shadow margin off the toolbar's
 * buttons and cropped the menu's own top with it. */
const require=createRequire(import.meta.url);
const {MaterialHost}=require('../desktop/composition.cjs');

class View {
  bounds={x:0,y:0,width:0,height:0};
  setBounds(b:typeof this.bounds){this.bounds=b;}
  getBounds(){return this.bounds;}
  setVisible(){} setBackgroundColor(){} setBackgroundBlur(){} setBorderRadius(){}
}
const state=createInitialState();
state.tabs=[makeTab('a','Page','https://example.com/',state.activeBrowserProfileId)];state.activeTabId='a';
const size={width:1200,height:738};
const place=(config:object,captionHeight:number)=>{const host=new MaterialHost(new View(),new View(),()=>{},()=>new View());host.placeFloating({id:7,...config},{reducedMotion:true,captionHeight},[size.width,size.height]);return host.bounds as {x:number;y:number;width:number;height:number};};
const contains=(host:{x:number;y:number;width:number;height:number},p:{x:number;y:number;width:number;height:number})=>host.x<=p.x&&host.y<=p.y&&host.x+host.width>=p.x+p.width&&host.y+host.height>=p.y+p.height;

test('A right-click menu opened in the toolbar row is shown whole: the native host reaches up to its top edge', () => {
  // Compact and Focus (a 32px row), the sidebar layouts' toolbar (40) and the Full strip above its toolbar (the tab bar menu at 18px).
  for (const [kind,caption,x,y] of [['toolbar-context',32,300,12],['toolbar-context',40,520,20],['strip-context',76,640,18],['tab-context',76,200,22],['toolbar-context',32,1100,4]] as const) {
    const geometry=popupGeometry(kind,state,size,pointerAnchor(x,y));
    assert.ok(geometry.bounds.y<caption,`${kind}: the menu opens above the caption line (y ${geometry.bounds.y}, caption ${caption})`);
    const host=place(geometry,caption);
    assert.ok(contains(host,geometry.bounds),`${kind} at ${x},${y}: host ${JSON.stringify(host)} holds the whole menu ${JSON.stringify(geometry.bounds)}`);
    assert.equal(host.y,geometry.bounds.y,'and its shadow margin stops at the menu\'s top edge, over the toolbar');
  }
});

test('A menu dropped from a toolbar button keeps its host off that button and the caption, as before', () => {
  const anchor={x:1120,y:4,width:28,height:28},geometry=popupGeometry('menu',state,size,anchor);
  assert.ok(geometry.bounds.y>=anchor.y+anchor.height);
  const host=place(geometry,32);
  assert.equal(host.y,32,'the shadow margin never covers the button that opened it');
  assert.ok(contains(host,geometry.bounds));
  const low=place(popupGeometry('tab-context',state,size,pointerAnchor(400,300)),32);
  assert.equal(low.y,302,'a menu lower down starts its host at the pointer, as before');
});

test('A child form beside a menu in the toolbar row is never cropped either', () => {
  const geometry=popupGeometry('toolbar-context',state,size,pointerAnchor(300,12)),child={x:geometry.bounds.x+geometry.bounds.width+8,y:10,width:260,height:200};
  const host=place({...geometry,auxiliaryBounds:child},32);
  assert.ok(contains(host,geometry.bounds)&&contains(host,child),JSON.stringify({host,child}));
});
