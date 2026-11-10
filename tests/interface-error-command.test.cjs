'use strict';
// `interface-error` (src/main.tsx → desktop/main.cjs setInterfaceFailed): the interface's error screen tells main it is up (on) or gone (off), so main takes the
// page views off it. It names no tab (the interface may have none to name), takes nothing else, and does not loosen any other command's tab check.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {validateNativeCommand}=require('../desktop/validation.cjs');
const snapshot={tabs:[{id:'tab-1'}],browserProfiles:[],workspaces:[]};

test('the error screen can say it is up and say it is gone, with no tab named',()=>{
  assert.deepEqual(validateNativeCommand({type:'interface-error',tabId:'interface',on:true},snapshot),{type:'interface-error',tabId:'interface',on:true});
  assert.deepEqual(validateNativeCommand({type:'interface-error',tabId:'interface',on:false},snapshot),{type:'interface-error',tabId:'interface',on:false});
});

test('it needs a true or false, and takes no other field',()=>{
  assert.throws(()=>validateNativeCommand({type:'interface-error',tabId:'interface'},snapshot),/on/i);
  assert.throws(()=>validateNativeCommand({type:'interface-error',tabId:'interface',on:'yes'},snapshot));
  assert.throws(()=>validateNativeCommand({type:'interface-error',tabId:'interface',on:true,url:'https://example.com'},snapshot));
});

test('every other command still has to name a tab that exists',()=>{
  assert.throws(()=>validateNativeCommand({type:'reload',tabId:'interface'},snapshot));
  assert.doesNotThrow(()=>validateNativeCommand({type:'reload',tabId:'tab-1'},snapshot));
});

test('main hides the pages when told, and only the window\'s own interface can tell it',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
  assert.match(main,/function setInterfaceFailed\(on\)/);
  assert.match(main,/!authActive&&!interfaceFailed&&!!rect/,'a page view is not shown while the interface shows its error screen');
  assert.match(main,/if\(command\.type==='interface-error'\)\{if\(e\.sender===chromeView\?\.webContents\)setInterfaceFailed\(command\.on\);return;\}/,'the popup layer cannot hide the window\'s pages');
  assert.match(main,/if\(e\.sender===chromeView\.webContents\)\{interfaceFailed=false;uiLayoutAt=Date\.now\(\);const adopted=fastSwitchWait\.adopt\(valid,state\.activeTabId\);applyLayout\(adopted\.layout,\{forceChanged:adopted\.forceChanged\}\);\}/,'the interface drawing again (it publishes a layout) puts the pages back');
});
