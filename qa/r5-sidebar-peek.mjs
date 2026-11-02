// R5 live check on the real app: "Show the closed sidebar at the left edge", one switch per window view.
//   node qa/r5-sidebar-peek.mjs        (needs a native slot: takes C:\ae\slot-N.lock, releases it in finally)
// Never moves the real cursor: every click is a synthetic input event into the interface page. Proves, with ACIRA_EDGE_TRACE on,
// that the row under Window view shows the selected view's switch (Full off, Compact and Focus on; Seamless keeps its own two),
// and that each click changes what main's edge controller is told ([edge-input] lines on stdout). Evidence: whole-window PNGs and
// crops of the Layout group (desktopCapturer, real pixels), dark and light, plus peek.json, under C:\ae\r5\peek\evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';
process.env.D_VISIBLE ??= '1';
const OUT = process.env.R5_SHOTS || 'C:/ae/r5/peek/evidence';
const root = '.qa-profiles/r5-sidebar-peek';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(OUT, {recursive: true});

async function takeSlot() {
  const deadline = Date.now() + 20 * 60000;
  while (Date.now() < deadline) {
    for (const n of [1, 2, 3]) {
      const file = `C:/ae/slot-${n}.lock`;
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`r5-sidebar-peek ${new Date().toISOString()}`); await handle.close(); return file; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await sleep(30000);
  }
  throw new Error('no native slot within 20 minutes');
}
const slot = await takeSlot();
const report = [], inputs = [];
let app;
const act = a => app.ui.evaluate(a => window.acira.dispatch(a), a);
const state = () => app.ui.evaluate(() => window.acira.getSnapshot());
/** Real pixels of the whole window, and a crop of `rect` (interface CSS px) when given. */
async function shot(name, rect) {
  const out = await app.main(async ({BaseWindow, desktopCapturer, screen}, rect) => {
    const win = BaseWindow.getAllWindows()[0]; win.setAlwaysOnTop(true); win.focus(); await new Promise(r => setTimeout(r, 350));
    const b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor, id = win.getMediaSourceId();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const hit = sources.find(s => s.id === id); win.setAlwaysOnTop(false);
    if (!hit) return null;
    const full = hit.thumbnail.toPNG().toString('base64');
    const crop = rect ? hit.thumbnail.crop({x: Math.round(rect.x * f), y: Math.round(rect.y * f), width: Math.round(rect.width * f), height: Math.round(rect.height * f)}).toPNG().toString('base64') : null;
    return {full, crop};
  }, rect || null);
  assert.ok(out?.full, 'window capture ' + name);
  await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(out.full, 'base64'));
  if (out.crop) await fs.writeFile(path.join(OUT, name + '-row.png'), Buffer.from(out.crop, 'base64'));
  return name;
}
const nav = async label => { await app.ui.locator(`.bs-sidebar nav button[aria-label="${label}"]`).click(); await sleep(450); };
const card = name => app.ui.locator('[role=radiogroup][aria-label="Window view"] [role=radio]').filter({hasText: name}).first();
const peekSwitch = () => app.ui.locator('[data-setting="sidebar-peek"] [role=switch]');
async function clickEl(locator) { await locator.scrollIntoViewIfNeeded(); const b = await locator.boundingBox(); assert.ok(b, 'on screen'); await app.ui.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(700); }
/** The Layout group, padded, in interface CSS px (for the crop). */
const layoutRect = () => app.ui.evaluate(() => { const r = document.querySelector('[data-group="layout"]').getBoundingClientRect(); return {x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.width + 24, height: r.height + 24}; });
/** The newest [edge-input] line main printed (what the edge controller is told). */
function lastInput() {
  const lines = app.logs.join('').split(/\r?\n/).filter(line => line.startsWith('[edge-input]'));
  const line = lines.at(-1); if (!line) return null;
  return JSON.parse(line.replace(/^\[edge-input\] \d+ /, ''));
}
async function expectInput(label, check) {
  let seen = null;
  for (let i = 0; i < 20; i++) { seen = lastInput(); if (seen && check(seen)) break; await sleep(150); }
  assert.ok(seen && check(seen), `${label}: main's controller input ${JSON.stringify(seen)}`);
  inputs.push({label, input: seen}); report.push(`${label}: controller told ${JSON.stringify({view: seen.view, peek: seen.peek, docked: seen.docked, enabled: seen.enabled})}`);
}
async function cleanup() {
  if (!app) return; const child = (() => { try { return app.app.process(); } catch { return null; } })();
  try { await Promise.race([app.close(), sleep(12000)]); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); await sleep(800); } } catch {}
}

try {
  app = await startApp({root, env: {ACIRA_EDGE_TRACE: '1'}});
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.unmaximize(); w.setBounds({x: 40, y: 20, width: 1280, height: 800}); });
  await sleep(800);
  await act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100, animationSpeed: 'fast', verticalTabs: true, windowView: 'full'}});
  await act({type: 'tab.new', url: 'acira://settings'}); await sleep(1800);
  // The founder's case: tabs in the sidebar, the sidebar closed.
  await act({type: 'ui.update', patch: {workspaceOpen: false, webWorkspaceOpen: false}}); await sleep(600);
  await nav('Appearance');
  const fresh = (await state()).settings;
  assert.deepEqual(fresh.sidebarPeek, {full: false, compact: true, focus: true}, 'a fresh profile: Full off, Compact and Focus on');
  report.push('fresh profile sidebarPeek ' + JSON.stringify(fresh.sidebarPeek));
  await expectInput('Full, sidebar closed, switch off', i => i.view === 'full' && i.vertical && !i.docked && i.peek?.full === false && i.enabled.side === false);

  // ---- 1. Each view shows its own switch; Seamless shows its own two -------------------------------------------------------------
  for (const appearance of ['dark', 'light']) {
    await act({type: 'settings.update', patch: {appearance}}); await sleep(900);
    for (const [name, view, on] of [['Full', 'full', false], ['Compact', 'compact', true], ['Focus', 'focus', true]]) {
      await clickEl(card(name));
      assert.equal((await state()).settings.windowView, view, name);
      assert.equal(await peekSwitch().count(), 1, `${name}: the row is there`);
      assert.equal(await peekSwitch().getAttribute('aria-checked'), String(on), `${name}: ${on ? 'on' : 'off'} by default`);
      assert.equal(await app.ui.locator('[data-setting="seamless-edge-top"]').count(), 0, `${name}: no Seamless rows`);
      const title = await app.ui.locator('[data-setting="sidebar-peek"]').innerText();
      assert.match(title, /Show the closed sidebar at the left edge/);
      await shot(`peek-${view}-${appearance}`, await layoutRect());
      report.push(`${appearance} ${name}: row "${title.trim()}" switch ${on ? 'on' : 'off'}`);
    }
    await clickEl(card('Seamless'));
    assert.equal(await peekSwitch().count(), 0, 'Seamless: the per-view row steps aside');
    assert.equal(await app.ui.locator('[data-setting="seamless-edge-top"] [role=switch], [data-setting="seamless-edge-side"] [role=switch]').count(), 2, 'Seamless keeps its two switches');
    await shot(`peek-seamless-${appearance}`, await layoutRect());
    report.push(`${appearance} Seamless: its own two switches, no per-view row`);
    await clickEl(card('Full'));
  }
  await act({type: 'settings.update', patch: {appearance: 'dark'}}); await sleep(700);
  await act({type: 'ui.update', patch: {workspaceOpen: false, webWorkspaceOpen: false}}); await sleep(500);

  // ---- 2. A click on the switch changes what main's edge controller is told, at once -------------------------------------------
  await expectInput('Full, back from Seamless, sidebar closed', i => i.view === 'full' && !i.docked && i.enabled.side === false);
  await clickEl(peekSwitch());
  assert.deepEqual((await state()).settings.sidebarPeek, {full: true, compact: true, focus: true});
  await expectInput('Full, switch turned on', i => i.view === 'full' && i.peek.full === true && i.enabled.side === true);
  await clickEl(peekSwitch());
  assert.equal((await state()).settings.sidebarPeek.full, false);
  await expectInput('Full, switch turned off again', i => i.view === 'full' && i.peek.full === false && i.enabled.side === false);
  await clickEl(card('Compact'));
  await expectInput('Compact (its switch on)', i => i.view === 'compact' && i.enabled.side === true);
  await clickEl(peekSwitch());
  await expectInput('Compact, switch turned off', i => i.view === 'compact' && i.peek.compact === false && i.enabled.side === false);
  await clickEl(peekSwitch());
  await expectInput('Compact, switch on again', i => i.view === 'compact' && i.peek.compact === true && i.enabled.side === true);
  await clickEl(card('Focus'));
  await expectInput('Focus (its switch on)', i => i.view === 'focus' && i.enabled.side === true);
  await clickEl(card('Full'));
  await expectInput('Full again (still off)', i => i.view === 'full' && i.enabled.side === false);
  // The keyboard's way (the sidebar opened for good) is untouched: docked, so the edge has nothing to do.
  await act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}}); await sleep(500);
  await expectInput('Full, sidebar opened', i => i.view === 'full' && i.docked === true && i.enabled.side === false);
  assert.equal((await state()).windowUi.workspaceOpen, true);
  await fs.writeFile(path.join(OUT, 'peek.json'), JSON.stringify({report, inputs}, null, 2));
  console.log(report.join('\n')); console.log('PASS r5-sidebar-peek');
} catch (error) {
  try { await shot('failure'); } catch {}
  await fs.writeFile(path.join(OUT, 'peek.json'), JSON.stringify({report, inputs, error: String(error.stack || error), tail: app?.logs?.join('').split(/\r?\n/).filter(l => l.startsWith('[edge')).slice(-20)}, null, 2)).catch(() => {});
  console.error(report.join('\n')); console.error(error); process.exitCode = 1;
} finally {
  await cleanup();
  await fs.unlink(slot).catch(() => {});
}
