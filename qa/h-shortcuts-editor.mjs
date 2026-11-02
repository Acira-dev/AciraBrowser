// Stream H QA: Settings › Shortcuts editor in the real app (isolated profile, one Electron instance closed in finally, bounded steps).
// Checks inline recording (live key caps, Esc cancels, Backspace clears), the clash row (Replace / Cancel), reserved keys, search,
// and captures the panel at 100% and on a 150% display. --lang de checks the panel, its record hint and the menu keys in that language.
//   D_VISIBLE=1 node qa/h-shortcuts-editor.mjs [--shots dir] [--scale 150] [--only-shots] [--lang de]
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {startApp, poll, sleep, httpFixture} from './d-harness.mjs';
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const shots = arg('--shots'), scale = Number(arg('--scale') || 100), onlyShots = process.argv.includes('--only-shots'), lang = arg('--lang');
const catalog = name => JSON.parse(readFileSync(`src/i18n/${name}.json`, 'utf8')), en = catalog('en'), local = lang ? catalog(lang) : en;
/** What the interface shows for an English text or an id in the chosen language (translateText takes the first id with that English). */
const say = (textOrId, params = {}) => { const id = textOrId in en ? textOrId : Object.keys(en).find(key => en[key] === textOrId); return (local[id] ?? en[id] ?? textOrId).replace(/\{(\w+)\}/g, (all,name) => params[name] ?? all); };
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
const root = path.resolve(`.qa-profiles/h-shortcuts-${scale}-${Date.now()}`);
let t;
async function shot(name) { if (!shots) return; await fs.mkdir(shots, {recursive: true}); await sleep(400); await t.ui.screenshot({path: path.join(shots, `${name}-${scale}.png`)}); }
// Keys go to the focused browser chrome the way a keyboard delivers them (before-input-event sees them first).
const key = (type, keyCode, modifiers = []) => t.main(({webContents}, [type, keyCode, modifiers]) => { const ui = webContents.getAllWebContents().find(w => w.getURL().startsWith('acira-browser-ui://ui/index.html')); ui.focus(); ui.sendInputEvent({type, keyCode, modifiers}); }, [type, keyCode, modifiers]);
const press = async (keyCode, modifiers = []) => { await key('keyDown', keyCode, modifiers); await key('keyUp', keyCode, modifiers); };
const row = id => t.ui.locator(`[data-shortcut="${id}"]`);
const native = r => t.ui.evaluate(r => window.acira.native(r), r);
const bindings = async id => (await native({type: 'shortcuts.list'})).shortcuts.commands.find(c => c.id === id)?.bindings;
try {
  t = await startApp({root, args: scale === 150 ? ['--force-device-scale-factor=1.5'] : [], env: process.env.D_VISIBLE ? {} : {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  await t.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 60, y: 40, width: 1240, height: 860}); win.setBounds({x: 60, y: 40, width: 1240, height: 860}); win.showInactive(); });
  if (lang) {
    // The language is a setting; a fresh launch builds every view (menus included) in it.
    await t.act({type: 'settings.update', patch: {language: lang}}); await sleep(1500); await t.close(); await sleep(1200);
    t = await startApp({root, args: scale === 150 ? ['--force-device-scale-factor=1.5'] : [], env: process.env.D_VISIBLE ? {} : {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
    await t.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 60, y: 40, width: 1240, height: 860}); win.showInactive(); });
    await poll(() => t.ui.evaluate(() => document.documentElement.lang), v => v === lang, 'language applied', 20000);
  }
  await t.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500);
  await t.ui.locator(`.bs-sidebar nav button[aria-label="${say('Shortcuts')}"]`).first().click(); await sleep(800);
  await poll(() => t.ui.locator('[data-shortcut], [data-setting^="shortcut-"]').count(), n => n > 50, 'shortcut rows', 8000);
  await shot('shortcuts-list');
  if (onlyShots) process.exit(0);
  if (lang) {
    const groups = await t.ui.locator('.sk-group h2').allTextContents();
    check(groups.includes(say('shortcutGroup.windows')) && groups.includes(say('shortcutGroup.splitView')), `groups in ${lang} (${groups.join(', ')})`);
    check((await row('mute-tab').locator('.st-title').textContent()) === say('shortcutCmd.mute-tab'), `command names in ${lang}`);
    check((await row('select-tab-3').locator('.st-title').textContent()) === say('shortcutCmd.select-tab', {n: '3'}), 'numbered commands keep their number');
    await row('pin-tab').locator('.sk-keys').click(); await poll(() => row('pin-tab').getAttribute('data-state'), v => v === 'recording', 'recording', 3000);
    const hint = await row('pin-tab').locator('.sk-note').textContent();
    check(hint.includes(say('shortcuts.recordHint').split('{')[0].trim()) && (await row('pin-tab').locator('.sk-note kbd').count()) === 2, `record hint in ${lang} with its two key caps (${hint.trim()})`);
    await shot(`shortcuts-recording-${lang}`);
    await press('Escape');
    await t.ui.locator(`[aria-label="${say('Acira menu')}"]:visible`).first().click();
    const overlay = await poll(() => t.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } }), Boolean, 'overlay page', 5000);
    const key = await poll(() => overlay.evaluate(name => [...document.querySelectorAll('.menu-row')].find(r => r.textContent.replace(r.querySelector('kbd')?.textContent ?? '', '').trim() === name)?.querySelector('kbd')?.textContent ?? '', say('New tab')), v => v === 'Ctrl+T', 'menu key', 5000).catch(() => '');
    check(key === 'Ctrl+T', `translated menu rows still find their live key (${say('New tab')} ${key})`);
    process.exitCode ??= 0; await t.close(); process.exit(process.exitCode);
  }

  // Inline recording: the key-cap field shows what is held, then the new keys; nothing runs while recording.
  const pin = row('pin-tab');
  await pin.locator('.sk-keys').click();
  await poll(() => pin.getAttribute('data-state'), s => s === 'recording', 'recording state', 3000);
  check(await pin.locator('.sk-field').isVisible(), 'clicking the keys turns the row into a key-cap field');
  await key('keyDown', 'Control', ['control']); await key('keyDown', 'Shift', ['control', 'shift']);
  const live = await poll(() => pin.locator('.sk-field').textContent(), s => /Ctrl/.test(s) && /Shift/.test(s), 'held modifiers shown', 3000).catch(() => '');
  check(/Ctrl/.test(live) && /Shift/.test(live), `held modifiers appear as key caps (${live.trim()})`);
  await shot('shortcuts-recording');
  const tabsBefore = (await t.state()).tabs.length;
  await key('keyDown', 'y', ['control', 'shift']); await key('keyUp', 'y', ['control', 'shift']); await key('keyUp', 'Shift', ['control']); await key('keyUp', 'Control', []);
  await poll(() => bindings('pin-tab'), b => b?.[0] === 'Ctrl+Shift+Y', 'pin-tab bound', 4000).catch(() => null);
  check((await bindings('pin-tab'))?.[0] === 'Ctrl+Shift+Y', 'a free combination is assigned at once');
  check((await t.state()).tabs.length === tabsBefore, 'recording did not run the keys');
  await poll(() => pin.getAttribute('data-state'), s => s === 'idle', 'idle after assign', 3000);
  check(/Ctrl.*Shift.*Y/.test(await pin.locator('.sk-keys').textContent()), 'the row shows the new keys');

  // Esc cancels and leaves the binding alone.
  await pin.locator('.sk-keys').click(); await poll(() => pin.getAttribute('data-state'), s => s === 'recording', 'recording again', 3000);
  await press('Escape');
  await poll(() => pin.getAttribute('data-state'), s => s === 'idle', 'Esc cancels', 3000);
  check((await bindings('pin-tab'))?.[0] === 'Ctrl+Shift+Y', 'Esc cancels without changing the keys');

  // Backspace clears the binding.
  await pin.locator('.sk-keys').click(); await poll(() => pin.getAttribute('data-state'), s => s === 'recording', 'recording for clear', 3000);
  await press('Backspace');
  await poll(() => bindings('pin-tab'), b => Array.isArray(b) && b.length === 0, 'cleared', 3000).catch(() => null);
  check((await bindings('pin-tab'))?.length === 0, 'Backspace clears the shortcut');
  await poll(() => pin.locator('.sk-keys').count(), n => n === 1, 'old key caps gone', 3000);
  check(/Not set/.test(await pin.locator('.sk-keys').textContent()), 'cleared row reads "Not set"');

  // A clash stays in the row with Replace and Cancel.
  await pin.locator('.sk-keys').click(); await poll(() => pin.getAttribute('data-state'), s => s === 'recording', 'recording for clash', 3000);
  await press('d', ['control']);
  await poll(() => pin.getAttribute('data-state'), s => s === 'clash', 'clash state', 3000).catch(() => null);
  const clashText = await pin.textContent();
  check(/Bookmark this page/.test(clashText), `the clash names the other command (${clashText.replace(/\s+/g, ' ').trim().slice(0, 120)})`);
  await shot('shortcuts-clash');
  await pin.getByRole('button', {name: 'Cancel'}).click();
  await poll(() => pin.getAttribute('data-state'), s => s === 'idle', 'cancel clash', 3000);
  check((await bindings('bookmark'))?.[0] === 'Ctrl+D' && (await bindings('pin-tab'))?.length === 0, 'Cancel keeps both commands as they were');
  await pin.locator('.sk-keys').click(); await poll(() => pin.getAttribute('data-state'), s => s === 'recording', 'recording for replace', 3000);
  await press('d', ['control']);
  await poll(() => pin.getAttribute('data-state'), s => s === 'clash', 'clash again', 3000);
  await pin.getByRole('button', {name: /^Replace/}).click();
  await poll(() => bindings('pin-tab'), b => b?.[0] === 'Ctrl+D', 'replaced', 3000).catch(() => null);
  check((await bindings('pin-tab'))?.[0] === 'Ctrl+D' && !(await bindings('bookmark'))?.includes('Ctrl+D'), 'Replace moves the keys and takes them from the other command');
  await poll(() => row('bookmark').locator('.sk-keys').count(), n => n === 1, 'old key caps gone', 3000);
  check(/Not set|Ctrl/.test(await row('bookmark').locator('.sk-keys').textContent()), 'the other command row updates');

  // Reserved keys are refused in the row and recording continues.
  await row('mute-tab').locator('.sk-keys').click(); await poll(() => row('mute-tab').getAttribute('data-state'), s => s === 'recording', 'recording mute', 3000);
  await press('c', ['control']);
  const refused = await poll(() => row('mute-tab').locator('.sk-note').textContent().catch(() => ''), s => /reserved/i.test(s), 'reserved note', 3000).catch(() => '');
  check(/reserved/i.test(refused), `a reserved key is explained in the row (${refused.trim()})`);
  check(await row('mute-tab').getAttribute('data-state') === 'recording', 'recording continues after a refused key');
  await press('Escape');

  // Search narrows the list (by name and by key) and empty groups go away.
  const search = t.ui.getByRole('searchbox', {name: 'Search shortcuts'});
  await search.fill('split');
  await poll(() => t.ui.locator('[data-shortcut]').count(), n => n > 0 && n < 20, 'filtered', 3000);
  const groups = await t.ui.locator('.sk-group h2').allTextContents();
  check(groups.includes('Split view') && !groups.includes('Library'), `search keeps only matching groups (${groups.join(', ')})`);
  await shot('shortcuts-search');
  await search.fill('ctrl+j');
  check(await row('downloads').count() === 1, 'searching by keys finds the command');
  await search.fill('zzqq');
  check(/No shortcut matches/.test(await t.ui.locator('.sk-empty').textContent().catch(() => '')), 'no-match line');
  await search.fill('');
  // Reset puts a changed command back on its defaults.
  await row('bookmark').getByRole('button', {name: /Reset/}).click();
  await poll(() => bindings('bookmark'), b => b?.[0] === 'Ctrl+D', 'bookmark reset', 3000).catch(() => null);
  check((await bindings('bookmark'))?.[0] === 'Ctrl+D', 'Reset restores the default (and takes it back from the other command)');
  await shot('shortcuts-after');

  // Menus and tooltips follow the live keys.
  await native({type: 'shortcuts.set', id: 'new-tab', accelerator: 'Ctrl+Shift+Y'});
  await t.ui.locator('[aria-label="Acira menu"]:visible').first().click();
  const overlay = await poll(() => t.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } }), Boolean, 'overlay page', 5000);
  const menuKey = await poll(() => overlay.evaluate(() => [...document.querySelectorAll('.menu-row')].find(row => row.textContent.replace(row.querySelector('kbd')?.textContent ?? '', '').trim() === 'New tab')?.querySelector('kbd')?.textContent ?? ''), v => v.includes('Ctrl+Shift+Y'), 'menu key', 5000).catch(() => '');
  check(menuKey.includes('Ctrl+Shift+Y'), `the menu shows a changed key (${menuKey})`);
  await press('Escape'); await sleep(300);
  const tip = await poll(() => t.ui.evaluate(() => [...document.querySelectorAll('button[aria-label="New tab"]')].filter(b => b.checkVisibility()).map(b => b.title).filter(Boolean).join(' | ')), v => !!v && v.split(' | ').every(title => title.includes('Ctrl+Shift+Y')), 'tooltip', 4000).catch(() => '');
  check(!!tip && tip.split(' | ').every(title => title.includes('Ctrl+Shift+Y')), `every visible New tab tooltip follows it (${tip})`);
  await native({type: 'shortcuts.reset', id: 'new-tab'});

  // F10 (Chrome) puts focus on the toolbar; Ctrl+F6 outside a split moves it to the page.
  await press('F10');
  check(await poll(() => t.ui.evaluate(() => !!document.activeElement?.closest('.browser-toolbar, .focus-toolbar')), Boolean, 'toolbar focus', 3000).catch(() => false), 'F10 moves focus to the toolbar');
  const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Page</title><input id=q>'); });
  try {
    const url = `http://127.0.0.1:${fx.port}/page`;
    await t.act({type: 'tab.new', url}); await t.waitWeb(url); await sleep(600);
    await press('F6', ['control']);
    check(await poll(() => t.main(({webContents}, url) => webContents.getAllWebContents().some(w => w.getURL() === url && w.isFocused()), url), Boolean, 'page focus', 3000).catch(() => false), 'Ctrl+F6 moves focus to the page');
  } finally { await fx.close?.(); }
} finally { await t?.close(); }
