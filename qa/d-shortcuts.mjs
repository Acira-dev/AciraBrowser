// Stream D: shortcut registry in the real app - rebinding through the native channel, real key events, recording.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-shortcuts'; await fs.rm(root, {recursive: true, force: true});
let app = await startApp({root}); const report = [];
const native = r => app.ui.evaluate(r => window.acira.native(r), r);
// Keys are injected into the focused browser chrome the way a keyboard would deliver them.
const press = (key, modifiers = []) => app.main(({webContents}, [key, modifiers]) => new Promise((resolve, reject) => {
  const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html');
  const received = (_event, input) => {
    if (input.type !== 'keyDown' || input.key.toLowerCase() !== key.toLowerCase()) return;
    clearTimeout(timer); ui.removeListener('before-input-event', received); resolve();
  };
  const timer = setTimeout(() => { ui.removeListener('before-input-event', received); reject(Error('Native shortcut keydown was not delivered')); }, 5000);
  ui.on('before-input-event', received); ui.focus();
  ui.sendInputEvent({type: 'keyDown', keyCode: key, modifiers});
  ui.sendInputEvent({type: 'keyUp', keyCode: key, modifiers});
}), [key, modifiers]);
const tabs = async () => (await app.state()).tabs.length;
const addressReady = async started => {
  await poll(() => app.ui.evaluate(() => document.activeElement?.matches('.address-bar input') && document.querySelector('.browser-shell')?.dataset.seamless !== 'hidden'), Boolean, 'native address focus delivered', 1000);
  assert.ok(Date.now() - started < 500, 'native address focus must arrive within 500ms');
};
const addressText = async text => { const started=Date.now(); await press('l', ['control']); await addressReady(started); await app.ui.keyboard.type(text); };
try {
  const list = (await native({type: 'shortcuts.list'})).shortcuts; assert.ok(list.commands.length > 50); assert.equal(list.commands.find(c => c.id === 'new-tab').display[0], 'Ctrl + T'); report.push('list: ' + list.commands.length + ' commands');
  // Stock Ctrl+T opens a tab.
  const base = await tabs(); await press('t', ['control']); await poll(tabs, n => n === base + 1, 'Ctrl+T opens tab'); report.push('stock Ctrl+T works');
  // Rebind new-tab to Ctrl+Shift+Y.
  const set = (await native({type: 'shortcuts.set', id: 'new-tab', accelerator: 'Ctrl+Shift+Y'})).shortcuts; assert.equal(set.ok, true);
  const n1 = await tabs(); await press('t', ['control']); await sleep(500); assert.equal(await tabs(), n1, 'old key must not open a tab'); report.push('old stock key suppressed after rebind');
  await press('y', ['control', 'shift']); await poll(tabs, n => n === n1 + 1, 'new binding opens tab'); report.push('new binding works');
  // Conflict + reserved feedback over the channel.
  const conflict = (await native({type: 'shortcuts.set', id: 'pin-tab', accelerator: 'Ctrl+W'})).shortcuts; assert.equal(conflict.code, 'conflict'); assert.equal(conflict.conflict.id, 'close-tab');
  const reserved = (await native({type: 'shortcuts.set', id: 'pin-tab', accelerator: 'Ctrl+C'})).shortcuts; assert.equal(reserved.code, 'reserved'); report.push('conflict + reserved reported');
  // Recording: the pressed combination is delivered as an event and NOT executed.
  await app.ui.evaluate(() => { window.__rec = []; window.acira.subscribeBrowser(e => { if (e.type === 'shortcut-recorded') window.__rec.push(e); }); });
  await native({type: 'shortcuts.record-start'}); const n2 = await tabs();
  await press('t', ['control']); await poll(() => app.ui.evaluate(() => window.__rec.length), n => n >= 1, 'recorded event');
  const rec = await app.ui.evaluate(() => window.__rec.at(-1)); assert.equal(rec.accelerator, 'Ctrl+T'); assert.equal(rec.valid, true); assert.equal(await tabs(), n2, 'recording must not run the shortcut');
  assert.equal((await native({type: 'shortcuts.list'})).shortcuts.recording, false, 'valid capture ends recording'); report.push('recording captures without executing');
  // The editor groups actual bindings; a cleared default remains editable at the end, and assigning it restores its category.
  await app.act({type:'tab.new',url:'acira://settings'});
  await app.ui.locator('.bs-sidebar nav').getByRole('button',{name:'Shortcuts',exact:true}).click();
  const row=app.ui.locator('[data-shortcut="new-tab"]'),group=()=>row.locator('xpath=ancestor::section[1]').locator('h2').innerText();
  await row.waitFor();await native({type:'shortcuts.clear',id:'new-tab'});
  await poll(group,value=>value==='Unassigned','cleared command moves to Unassigned');
  assert.equal(await app.ui.locator('.sk-group').last().locator('h2').innerText(),'Unassigned');
  assert.deepEqual((await native({type:'shortcuts.list'})).shortcuts.commands.find(command=>command.id==='new-tab').defaults,list.commands.find(command=>command.id==='new-tab').defaults);
  await native({type:'shortcuts.set',id:'new-tab',accelerator:'Ctrl+Shift+Y'});
  await poll(group,value=>value==='Tabs','assigned command returns to Tabs');
  assert.deepEqual((await native({type:'shortcuts.list'})).shortcuts.commands.find(command=>command.id==='new-tab').defaults,list.commands.find(command=>command.id==='new-tab').defaults);
  report.push('clearing moves a command to final Unassigned group; reassignment restores Tabs and preserves defaults');
  // Persisted across restart.
} finally { await app.close(); }
await sleep(1200);
app = await startApp({root});
let fixture;
try {
  const native2 = r => app.ui.evaluate(r => window.acira.native(r), r);
  const c = (await native2({type: 'shortcuts.list'})).shortcuts.commands.find(x => x.id === 'new-tab'); assert.deepEqual(c.bindings, ['Ctrl+Shift+Y']); assert.equal(c.customized, true); report.push('binding persists across restart');
  const before = (await app.state()).tabs.length; await press('y', ['control', 'shift']);
  await poll(async () => (await app.state()).tabs.length, n => n === before + 1, 'persisted binding works after restart');
  await native2({type: 'shortcuts.reset-all'}); assert.ok((await native2({type: 'shortcuts.list'})).shortcuts.commands.every(x => !x.customized)); report.push('reset-all');
  // Verify native focus delivery, then type without a fixed settling delay; no later select may erase a prefix.
  await addressText('standard fixture input');
  assert.equal(await app.ui.evaluate(() => document.activeElement?.value), 'standard fixture input');
  await addressText('repeat focused fixture');
  assert.equal(await app.ui.evaluate(() => document.activeElement?.value), 'repeat focused fixture');
  await app.ui.keyboard.press('Escape');
  await app.act({type: 'tab.new', url: 'acira://bookmarks'});
  await app.ui.getByRole('button', {name: 'Turn Focus on', exact: true}).click();
  await app.ui.evaluate(() => document.activeElement?.blur());
  await poll(() => app.ui.evaluate(() => document.querySelector('.browser-shell')?.dataset.layout), value => value === 'focus', 'true Focus mode');
  await addressText('focus mode fixture');
  assert.equal(await app.ui.evaluate(() => document.activeElement?.value), 'focus mode fixture');
  await app.ui.keyboard.press('Escape');
  await app.ui.getByRole('button', {name: 'Turn Focus off', exact: true}).click();
  // "Hide until needed" is the Seamless window view since R3-68 (the old renderer-only flag is retired): the toolbar hides until the pointer or Ctrl+L asks for it.
  await app.ui.evaluate(() => document.activeElement?.blur());
  await app.act({type: 'ui.update', patch: {view: 'seamless'}});
  fixture = await httpFixture((_req, res) => res.end('<!doctype html><title>Shortcut fixture</title><body style="margin:0;min-height:100vh">Controlled toolbar fixture</body>'));
  const url = `http://127.0.0.1:${fixture.port}/toolbar-fixture`;
  await app.act({type: 'tab.new', url});
  const web = await poll(() => app.web(url), Boolean, 'controlled shortcut page');
  await web.locator('body').click({position: {x: 100, y: 100}});
  await poll(() => app.ui.evaluate(() => document.querySelector('.browser-shell')?.dataset.seamless === 'hidden'), Boolean, 'toolbar actually hidden');
  const hiddenStarted = Date.now();
  // Native injection is enqueue-only. Await receipt of the shortcut keydown,
  // not renderer focus/readiness, before sending text through the other driver.
  await app.main(({webContents}, url) => new Promise((resolve, reject) => {
    const web = webContents.getAllWebContents().find(w => w.getURL() === url);
    const received = (_event, input) => {
      if (input.type !== 'keyDown' || input.key.toLowerCase() !== 'l' || !input.control) return;
      clearTimeout(timer); web.removeListener('before-input-event', received); resolve();
    };
    const timer = setTimeout(() => { web.removeListener('before-input-event', received); reject(Error('Native shortcut keydown was not delivered')); }, 5000);
    web.on('before-input-event', received);
    web.focus(); web.sendInputEvent({type: 'keyDown', keyCode: 'l', modifiers: ['control']});
    web.sendInputEvent({type: 'keyUp', keyCode: 'l', modifiers: ['control']});
  }), url);
  await addressReady(hiddenStarted);
  await app.ui.keyboard.type('hidden toolbar fixture');
  const address = () => app.ui.evaluate(() => ({value: document.activeElement?.value, hidden: document.querySelector('.browser-shell')?.dataset.seamless === 'hidden'}));
  assert.deepEqual(await address(), {value: 'hidden toolbar fixture', hidden: false});
  await sleep(100);
  assert.deepEqual(await address(), {value: 'hidden toolbar fixture', hidden: false}, 'no later select overwrites immediate input');
  report.push('native Ctrl+L focuses within 500ms and preserves all characters in standard, repeated, Focus and auto-hidden modes');
} finally { await app.close(); await fixture?.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
