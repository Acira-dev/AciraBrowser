import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// M saw web tabs that never opened after first-run setup with Import (1 of 3 runs, not reproduced in 5 capped runs, qa/l-setup-import.mjs).
// The code paths that could leave a tab without a page are kept from stopping each other; these checks keep that in place.
const main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8').replace(/\r/g,'');
const body=(name:string)=>{const start=main.indexOf(name);assert.ok(start>=0,name+' exists');return main.slice(start,start+2600);};

test('resuming after a profile is ready always makes its pages, even if restoring extensions fails',()=>{
  const resume=body('async function resumeCleanup(){');
  assert.match(resume,/try\{if\(!privateMode&&nativeNetwork\.isReady\(\)\)\{await extensionManager\?\.restore\(\);attachReadyExtensionProfiles\(\);\}\}catch\(error\)/);
  assert.ok(resume.indexOf('catch(error)')<resume.indexOf('syncPages();'),'syncPages runs after the guarded block, not inside it');
});

test('one tab that cannot get a page does not stop the others, and says so',()=>{
  const sync=body('function syncPages(){');
  assert.match(sync,/for\(const tab of state\.tabs\)\{try\{/);
  assert.match(sync,/catch\(error\)\{console\.warn\('A tab page could not be made:'/);
  assert.match(sync,/browserEvent\(tab\.id,\{error:/);
});

test('tabs of a profile that is still getting ready are looked at again, a bounded number of times',()=>{
  const sync=body('let cleanupResyncs=0,cleanupResyncTimer=null;function syncPages(){');
  assert.match(sync,/waitingForCleanup=true/);
  assert.match(sync,/cleanupResyncs<10/);
  assert.match(sync,/setTimeout\(\(\)=>\{if\(!windowClosing/);
  assert.match(sync,/else if\(!waitingForCleanup\)cleanupResyncs=0/);
});
