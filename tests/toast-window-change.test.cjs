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

test('a click in the page still dismisses the toasts: the page mouseDown closes any overlay',()=>{
 assert.match(main,/if\(input\.type==='mouseDown'\)\{closeOverlay\(\);/);
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
