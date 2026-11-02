import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// Esc did not stop a loading page from the address field: it put the address back and handed focus to the page, whose Esc belongs to
// the page. As in Chrome, Esc there first undoes what was typed; with nothing typed it also stops the load. Esc inside a page stays the
// page's (main returns before the shortcut when the page has focus), and Esc elsewhere in the interface already stopped a load.
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
const escape=app.slice(app.indexOf('escapeRef.current = () => {'),app.indexOf('const popupAnchorRef'));
test('Esc in the address field stops a loading page when nothing was typed, and only undoes an edit otherwise',()=>{
 assert.match(escape,/const shown = tab\.url === 'acira:\/\/new' \? '' : tab\.url, edited = addressFocused && address !== shown;/);
 assert.match(escape,/if \(tab\.contentKind === 'web' && tab\.loading && !edited\)\s*void runtime\.browserCommand\(\{ type: 'stop', tabId: tab\.id \}\);/);
 assert.ok(escape.indexOf("type: 'stop'")<escape.indexOf("type: 'focus'"),'it stops, then the page gets the keyboard as before');
 assert.match(escape,/if \(tab\.loading\)\s*void runtime\.browserCommand\(\{ type: 'stop', tabId: tab\.id \}\);\s*\};\s*$/,'Esc elsewhere in the interface still stops a load');
});
test('a page keeps its own Esc',()=>{
 assert.ok(main.includes("if(owner&&origin==='key'&&command.action==='escape'&&!layout.overlay)return;"),'website dialogs and HTML fullscreen receive the native Escape');
});
