import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {windowMaterial,materialOptions,windowChrome,updateCaption}=require('../desktop/platform.cjs');
const material=(platform:string,release='10.0.22621',extra={})=>windowMaterial({platform,release,disabled:false,...extra});

test('Mac uses the native sidebar material and follows window activation',()=>{
  assert.equal(material('darwin'),'vibrancy');
  assert.deepEqual(materialOptions('vibrancy'),{vibrancy:'sidebar',visualEffectState:'followWindow'});
  assert.deepEqual(windowChrome('darwin'),{titleBarStyle:'hidden',trafficLightPosition:{x:12,y:12},autoHideMenuBar:false});
});

test('Mac can turn transparency off and restore it without changing window chrome',()=>{
  assert.equal(material('darwin',undefined,{reducedTransparency:true}),'none');
  assert.equal(material('darwin',undefined,{disabled:true}),'none');
  assert.equal(material('darwin',undefined,{reducedTransparency:false}),'vibrancy');
  assert.deepEqual(materialOptions('none'),{});
});

test('Windows keeps exactly its existing build-gated acrylic and caption options',()=>{
  assert.equal(material('win32','10.0.22620'),'none');
  assert.equal(material('win32','10.0.22621'),'acrylic');
  assert.equal(material('win32','10.0.26100'),'acrylic');
  assert.equal(material('win32',undefined,{disabled:true}),'none');
  assert.equal(material('win32',undefined,{reducedTransparency:true}),'acrylic');
  assert.deepEqual(materialOptions('acrylic'),{backgroundMaterial:'acrylic'});
  assert.deepEqual(windowChrome('win32'),{titleBarStyle:'hidden',titleBarOverlay:{color:'#eef0f2',symbolColor:'#26282b',height:40},autoHideMenuBar:true});
});

test('unsupported platforms keep the opaque fallback',()=>{
  assert.equal(material('linux'),'none');
  assert.equal(material('win32','unknown'),'none');
});

test('caption updates preserve a transparent native backing without calling Windows APIs on Mac',()=>{
  const calls:unknown[]=[];
  const window={setTitleBarOverlay:(value:unknown)=>calls.push(value),setBackgroundColor:(value:string)=>calls.push(value),setWindowButtonPosition:(value:unknown)=>calls.push(value),setWindowButtonVisibility:(value:boolean)=>calls.push(value)};
  updateCaption(window,{color:'#00000000',height:40},'darwin');
  assert.deepEqual(calls,[true,{x:12,y:13},'#00000000'],'AppKit moves the buttons back to its default spot when they are shown, so the position follows the visibility');
  calls.length=0;
  updateCaption(window,{color:'#00000000',height:40},'win32');
  assert.deepEqual(calls,[{color:'#00000000',height:40},'#00000000']);
});
