'use strict';
// Separate windows, the first switch to a profile that has no window open (desktop/main.cjs switchProfileHere): the window being left stays on screen until
// the new window's interface has drawn (`firstShown`, resolved by maybeShowMain once the window is shown). Before 13.3 the new window was shown and the old one
// hidden the moment the new one was "ready", ~200 ms (more on a busy Mac) before its interface had loaded: an empty window, the white flash.
// The real order of the two moments is measured by qa/profile-window-first-paint.mjs; this keeps the pieces in place.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('a switch waits for the new window to have drawn before it hides the old one, but never longer than four seconds',()=>{
  assert.match(main,/void Promise\.resolve\(target\.ready\)\.then\(async ok=>\{if\(!ok\|\|target\.closing\)return;[^]*?await Promise\.race\(\[target\.firstShown,new Promise\(resolve=>setTimeout\(resolve,4000\)\)\]\);if\(target\.closing\)return;target\.takeOver\(/);
});

test('firstShown is resolved when the window has been shown (after the interface painted), and when it closes first',()=>{
  assert.match(main,/const firstShown=new Promise\(resolve=>\{firstShownResolve=resolve;\}\)/);
  assert.match(main,/startupTrace\.done\(\);setTimeout\(warmOverlay,2200\);\}firstShownResolve\(\);\},16\);\}/,'maybeShowMain resolves it after its show');
  assert.match(main,/mainWindow=null;firstShownResolve\(\);controllers\.delete\(controller\);/,'a window that closes first does not leave a switch waiting');
  assert.match(main,/get switchedAway\(\)\{return switchedAway;\},firstShown,takeOver,/,'the switch reads it from the other window\'s controller');
});

test('a second switch from the same window waits while the first one is under way (a double click never makes two windows)',()=>{
  assert.match(main,/function switchProfileHere\(id\)\{\s*if\(!mainWindow\|\|mainWindow\.isDestroyed\(\)\|\|windowClosing\|\|switchingProfile\)return;/);
  assert.match(main,/\.catch\(error=>console\.error\('Profile switch:',error\)\)\.finally\(\(\)=>\{switchingProfile=false;\}\);/);
});

test('a window that is still starting is the profile it was asked for, never the empty default (a switch to Personal took it as Personal\'s own and never landed)',()=>{
  assert.match(main,/let profileChosen=false;/);
  assert.match(main,/get profileId\(\)\{[^}]*return profileChosen\?state\.activeBrowserProfileId:\(profileId\|\|null\);\}/);
  assert.match(main,/state\.activeTabId=state\.tabs\[0\]\.id;\}profileChosen=true;normalizeWorkspaces\(state\);/,'start() says so once it has chosen the profile');
});

test('a window that stepped aside lets its pages sleep (Memory Saver), the window on screen never, and it wakes the page it comes back on',()=>{
  assert.match(main,/isVisible:id=>pageVisible\(id\)&&!switchedAway,freeze:id=>setFrozen\(id,true\)/,'Memory Saver does not count a stepped-aside window\'s page as shown');
  assert.match(main,/if\(switchedAway\)\{switchedAway=false;persistOpenWindows\(\);[^]*?setImmediate\(\(\)=>\{if\(!windowClosing&&mainWindow&&!mainWindow\.isDestroyed\(\)\)try\{syncPages\(\);\}catch/,'coming back makes the active page again and thaws a frozen one');
});
