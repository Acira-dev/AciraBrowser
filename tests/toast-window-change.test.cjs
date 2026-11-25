'use strict';
// A toast over a website survives a change of the window itself (founder, 2 Nov): a resize, a move, Cmd-Tab away and back, a minimise.
// Main used to close whatever overlay was open on each of them, the toast stack included, so a toast (an error too) was gone when the
// person came back. Menus and popups still close; a click in the page still dismisses the toasts (main's page mouseDown is untouched).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {closesOnWindowChange}=require('../desktop/native-policy.cjs');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('a window change closes a menu or popup, never the toast stack',()=>{
 assert.equal(closesOnWindowChange(undefined),false,'nothing open: nothing to close');
 assert.equal(closesOnWindowChange({id:4,kind:'toast',bounds:{x:0,y:0,width:412,height:100}}),false);
 for(const kind of ['menu','page-context','tabs','suggestions','downloads','bookmark-edit','rating'])assert.equal(closesOnWindowChange({id:5,kind}),true,kind);
});

test('main asks it on a resize, a blur / minimise / hide, a move and a press on the Windows frame',()=>{
 assert.match(main,/if\(size\[0\]!==previousSize\[0\]\|\|size\[1\]!==previousSize\[1\]\)\{if\(closesOnWindowChange\(layout\.overlay\)\)closeOverlay\(false\);/,'resize');
 assert.match(main,/for\(const event of \['blur','minimize','hide'\]\)mainWindow\.on\(event,\(\)=>\{[^}]*if\(!dialogDepth&&closesOnWindowChange\(layout\.overlay\)\)closeOverlay\(false\);\}\);/,'blur, minimise, hide');
 assert.match(main,/mainWindow\.on\('will-move',\(\)=>\{if\(!dialogDepth&&closesOnWindowChange\(layout\.overlay\)\)closeOverlay\(false\);\}\);/,'a move');
 assert.match(main,/hookWindowMessage\(message,\(\)=>\{if\(!dialogDepth&&closesOnWindowChange\(layout\.overlay\)\)/,'a press on the Windows frame');
 assert.doesNotMatch(main,/mainWindow\.on\(event,\(\)=>\{if\(!dialogDepth\)closeOverlay\(false\);\}\)/,'no unconditional close is left on those events');
});

test('the one-time Welcome (Beta 14 AL) stays through a resize, a blur, a minimise and a move, and follows the window\'s size meanwhile',()=>{
 const {closesOnWindowChange,resizeLayout,keptThroughResize}=require('../desktop/native-policy.cjs');
 const welcome={id:11,kind:'welcome',bounds:{x:12,y:40,width:1176,height:618}};
 assert.equal(closesOnWindowChange(welcome),false);
 const layout={views:[{tabId:'a',bounds:{x:0,y:72,width:1200,height:666}}],viewport:{width:1200,height:738},overlay:welcome};
 assert.deepEqual(resizeLayout(layout,[1200,738],[1000,680]).overlay,{...welcome,bounds:{x:12,y:11,width:976,height:560}},'its frame is window - 24 by window - 120 again, re-centred');
 assert.equal(keptThroughResize(welcome,0,0).bounds.height,618,'no size change, no change');
});

test('the interface does not close the welcome on a real window resize either (its frame is re-placed), while every other popup but the tab viewer still closes',()=>{
 const app=fs.readFileSync(path.join(__dirname,'..','src','App.tsx'),'utf8');
 assert.match(app,/if \(moved && openRef\.current && openRef\.current !== 'tabs' && openRef\.current !== 'welcome'/);
});

test('a click in the page still dismisses the toasts: the page mouseDown closes any overlay',()=>{
 /* 17 Nov: named a dismissal, so a question card waiting for its answer takes it as "nobody decided" (card-question-held.test.cjs); every other overlay closes as before */
 assert.match(main,/if\(input\.type==='mouseDown'\)\{closeOverlay\(false,false,undefined,'dismiss'\);/);
});

test('the resize\'s own layout keeps the toast stack, on the page\'s bottom edge, and drops a menu (main retired a dropped id without a word: no toast showed again)',()=>{
 const {resizeLayout,keptThroughResize}=require('../desktop/native-policy.cjs');
 const toast={id:7,kind:'toast',bounds:{x:450,y:674,width:300,height:44},anchor:{x:600,y:742,width:1,height:1}};
 const layout={views:[{tabId:'a',bounds:{x:0,y:72,width:1200,height:666}}],viewport:{width:1200,height:738},overlay:toast};
 // The interface then places it at x = page.x + (page.width - 300) / 2, y = page bottom - 20 - 44: (350, 616) in a 1000x680 window.
 assert.deepEqual(resizeLayout(layout,[1200,738],[1000,680]).overlay,{...toast,bounds:{x:350,y:616,width:300,height:44},anchor:{x:500,y:684,width:1,height:1}});
 assert.equal(resizeLayout({...layout,overlay:{id:8,kind:'menu',bounds:{x:900,y:40,width:260,height:300}}},[1200,738],[1000,680]).overlay,undefined,'a menu is closed by the resize');
 assert.equal(resizeLayout({...layout,overlay:undefined},[1200,738],[1000,680]).overlay,undefined);
 assert.equal(keptThroughResize({id:9,kind:'toast',bounds:{x:10,y:10,width:5,height:5}},0,0).bounds.x,10,'no size change, no move');
});
