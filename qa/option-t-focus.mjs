// Option+T (the tab viewer) on a Mac: it types "†" in a field that takes text, so the address bar keeps the key; a checkbox, radio or slider
// takes no text, so after a click in Settings the viewer must still open. Regression: the interface skipped the key whenever ANY <input>
// had focus (QA monkey op 10, then every Settings checkbox). Disposable profile, hidden window; Mac only (elsewhere the key is not Option+T).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';
if (process.platform !== 'darwin') { console.log(JSON.stringify({ok: true, skipped: 'Mac only'})); process.exit(0); }
const root = '.qa-profiles/option-t-focus-' + Date.now(); await fs.mkdir(root, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>p</title>x'); });
const app = await startApp({root}), report = [];
try {
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/a`}); await sleep(1200);
  const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout()), overlay = () => app.context.pages().find(p => p.url().includes('view=overlay'));
  const viewerOpen = async () => { try { await poll(layout, l => l.overlay?.kind === 'tabs', 'tab viewer layout', 2500); return true; } catch { return false; } };
  const closeViewer = async () => { await app.ui.keyboard.press('Escape'); await poll(layout, l => !l.overlay, 'viewer closes', 4000); await sleep(400); };

  // 1. The address bar is a text field: the key stays with it (and the viewer stays closed).
  await app.ui.locator('input[aria-label="Address and search"]').first().focus();
  await app.ui.keyboard.press('Alt+t'); await sleep(800);
  assert.equal(await viewerOpen(), false, 'Option+T in the address bar must not open the viewer');
  report.push('address bar focused: Option+T leaves the viewer closed (it types in the field)');

  // 2. A slider or checkbox in Settings (Appearance) keeps focus after a click and takes no text: the viewer opens.
  await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(2500);
  await app.ui.getByRole('button', {name: 'Appearance', exact: true}).first().click();
  for (const type of ['range', 'checkbox']) {
    // The controls sit inside a closed fold (a <details>): open it as a click on its summary does, then give the input focus as a click or Tab would.
    await app.ui.locator(`input[type=${type}]`).first().waitFor({state: 'attached', timeout: 8000});
    assert.equal(await app.ui.evaluate(async t => { const e = document.querySelector(`input[type=${t}]`); const fold = e.closest('details'); if (fold) fold.open = true; await new Promise(r => setTimeout(r, 600)); e.focus(); return document.activeElement?.type; }, type), type, 'the ' + type + ' input has focus');
    await app.ui.keyboard.press('Alt+t');
    assert.equal(await viewerOpen(), true, `Option+T with a focused ${type} input must open the viewer`);
    await overlay().locator('.popup-content-tabs').first().waitFor({state: 'attached'});
    report.push(`${type} input focused in Settings: Option+T opens the viewer`);
    await closeViewer();
  }
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
