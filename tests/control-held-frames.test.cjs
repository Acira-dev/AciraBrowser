'use strict';
// macOS: main tells every frame of a page when Control goes down and up (page-input-preload.cjs zooms on Control+wheel). A frame still on its
// first empty document never ran that preload, and each message to it logged "Attempted to get the 'ipcNative' object but it was missing"
// (one line per such frame per Control press: ad slots, about:blank iframes). Checked in the real app with a page holding a cross-site,
// a sandboxed, a srcdoc and an about:blank iframe: 10 lines for 5 presses before, none after; the other frames still get the message.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');

test('the Control broadcast skips frames that have no document of their own',()=>{
 const at=main.indexOf("frame.send('acira:control-held',down)");assert.ok(at>0);
 const loop=main.slice(main.lastIndexOf('for(const frame of wc.mainFrame.framesInSubtree)',at),at);
 assert.match(loop,/const url=frame\.url;if\(url&&url!=='about:blank'\)$/,loop);
});
