'use strict';
// QA audit (tabs, groups, split view): after a restart with a split on screen the current pane was always the LAST pane.
// Every visible page attached to the extension API as it was created; the extension API selects what it is given as the active tab, and our
// delegate answers with tab.select, so each pane selected itself in turn and the last one won. Only the shown (current) tab attaches that way now.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
test('a visible pane that is not the current tab attaches quietly, like a hidden tab',()=>{
 const at=main.indexOf('attachExtensionTab(id,wc){'),body=main.slice(at,main.indexOf('finally{extensionSelectQuiet=false;}',at)+40);
 assert.ok(at>0,'attachExtensionTab exists');
 assert.match(body,/pageVisible\(id\)&&id===state\.activeTabId/,'only the current tab takes the plain attach');
 assert.ok(body.indexOf('extensionSelectQuiet=true')>body.indexOf('pageVisible(id)&&id===state.activeTabId'),'every other page attaches inside the quiet guard');
 assert.match(body,/extensionManager\.selectTab\(current\)/,'the current page is re-selected for the extension API afterwards');
});
