'use strict';
// macOS native fullscreen: AppKit puts its own title strip (a white bar with the title and the traffic lights, NSToolbarFullScreenWindow) over the
// top 32pt of the page whenever the pointer touches the top edge, covering the tab row. mac-material.mm keeps that window invisible; main asks for
// it when the window enters fullscreen (and when it loads already fullscreen). Seen in the real app by moving the pointer to the top.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('the wrapper answers 0 and never throws without a window, a destroyed window or a handle the native side refuses',()=>{
 const {hideFullscreenStrip}=require('../desktop/mac-material.cjs');
 assert.equal(hideFullscreenStrip(null),0);
 assert.equal(hideFullscreenStrip({isDestroyed:()=>true}),0);
 assert.equal(hideFullscreenStrip({isDestroyed:()=>false,getNativeWindowHandle:()=>Buffer.alloc(8)}),0,'a null handle');
});

test('main hides the strip when the window enters fullscreen and when its interface loads in a window that is already fullscreen',()=>{
 const main=read('desktop/main.cjs');
 assert.match(main,/require\('\.\/mac-material\.cjs'\)/);assert.match(main,/hideFullscreenStrip/);
 assert.match(main,/mainWindow\.on\('enter-full-screen',\(\)=>hideTitleStrip\(\)\)/,'on entering fullscreen');
 assert.match(main,/chromeView\.webContents\.on\('dom-ready',\(\)=>hideTitleStrip\(\)\)/,'already fullscreen when the interface loads (the window-state resend next to it is the fullscreen-corner work\'s)');
 assert.match(main,/process\.platform!=='darwin'\|\|!mainWindow\|\|mainWindow\.isDestroyed\(\)\|\|!mainWindow\.isFullScreen\(\)\)return;if\(!hideFullscreenStrip\(mainWindow\)&&attempt<5\)setTimeout/,'macOS only, retried while the strip window does not exist yet');
});

test('the native side keeps the strip invisible and mouse-transparent, and lets go before the strip window is torn down',()=>{
 const source=read('desktop/native/mac-material.mm');
 assert.match(source,/isEqual:@"NSToolbarFullScreenWindow"/,'matched by AppKit\'s own class name; a renamed class does nothing');
 assert.match(source,/strip\.ignoresMouseEvents=YES; strip\.alphaValue=0;/);
 assert.match(source,/addObserver:self forKeyPath:@"alphaValue"/,'AppKit sets the alpha back to 1 on every reveal');
 assert.match(source,/removeObserver:self forKeyPath:@"alphaValue"/);
 assert.match(source,/NSWindowWillExitFullScreenNotification, NSWindowWillCloseNotification/,'no observer outlives the strip window');
 assert.match(source,/NSMaxY\(f\) - NSMaxY\(m\)/,'only the strip of this window');
});
