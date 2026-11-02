// Address-field selection in the real app (founder bug 27 Oct: selecting text in the address bar at rest picked other
// characters or everything). Drags/clicks are synthetic (Playwright mouse on the interface page: CDP input, the real
// cursor never moves). For each window view (Full, Compact, Seamless) and LTR + RTL (Arabic UI) it drags over the host
// and the path of the unfocused URL, backward over the path, clicks, double-clicks, triple-clicks, Shift+clicks (at rest
// and focused) and drags on the focused field, recording the selected text each time; it fails when a selection is not
// the dragged characters. Crops of the toolbar are saved for every case, plus a mid-drag crop (the at-rest text held,
// the drag painted on it). Isolated profile, one instance, a native slot lock, showInactive, ≤ 2 tabs.
//   node qa/omnibox-select.mjs [outdir]        (default C:\ae\r6\omnibox\evidence)
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const out = path.resolve(process.argv[2] || 'C:/ae/r6/omnibox/evidence');
await fs.mkdir(out, {recursive: true});
const TARGET = 'https://www.example.com/docs/selection-guide?q=omnibox';

let lock = null;
for (let tries = 0; tries < 40 && !lock; tries += 1) {
  for (const n of [1, 2, 3]) {
    const file = `C:/ae/slot-${n}.lock`;
    try { const fd = fss.openSync(file, 'wx'); fss.writeSync(fd, `omnibox-select ${new Date().toISOString()}`); fss.closeSync(fd); lock = file; break; } catch {}
  }
  if (!lock) await sleep(30000);
}
if (!lock) throw Error('no native slot free after 20 minutes');

const results = [];
let app, failed = 0;
try {
  app = await startApp({root: '.qa-profiles/omnibox-' + Date.now(), env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  const ui = app.ui;
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; globalThis.__qaTargetWindow = w.id; w.setBounds({x: 60, y: 40, width: 1280, height: 800}); w.showInactive(); });
  await app.act({type: 'tab.new', url: TARGET});
  await poll(() => ui.evaluate(() => document.querySelector('.browser-shell .address-bar .address-field input')?.value), url => url && url.includes('example.com/docs'), 'target tab', 20000);
  await sleep(800);

  const FIELD = '.browser-shell .address-bar .address-field';
  const blur = async () => { await ui.evaluate(f => { const i = document.querySelector(f + ' input'); i?.blur(); }, FIELD); await sleep(250); };
  const read = () => ui.evaluate(f => { const i = document.querySelector(f + ' input'); return {value: i.value, start: i.selectionStart, end: i.selectionEnd, direction: i.selectionDirection, text: i.value.slice(i.selectionStart, i.selectionEnd), focused: document.activeElement === i, atRest: !!i.parentElement.querySelector('.address-display')}; }, FIELD);
  /** Screen geometry of `sub` in the at-rest text (or, when the field shows the full address, in the input text). */
  const geo = (sub, nth = 0) => ui.evaluate(([f, sub, nth]) => {
    const field = document.querySelector(f), input = field.querySelector('input'), disp = field.querySelector('.address-display');
    if (disp) {
      const nodes = [...disp.querySelectorAll('[data-url-part]')].flatMap(p => [...p.childNodes].filter(n => n.nodeType === 3));
      const text = nodes.map(n => n.data).join('');
      let i = -1; for (let k = 0; k <= nth; k += 1) i = text.indexOf(sub, i + 1);
      if (i < 0) return {text};
      const pos = k => { let seen = 0; for (const n of nodes) { if (k < seen + n.length || k === seen + n.length && n === nodes.at(-1)) return [n, k - seen]; seen += n.length; } };
      const r = document.createRange(); r.setStart(...pos(i)); r.setEnd(...pos(i + 1)); const a = r.getBoundingClientRect();
      r.setStart(...pos(i + sub.length - 1)); r.setEnd(...pos(i + sub.length)); const b = r.getBoundingClientRect();
      return {text, x0: a.left, x1: b.right, y: (a.top + a.bottom) / 2, mode: 'at-rest'};
    }
    const cs = getComputedStyle(input), span = document.createElement('span');
    span.style.cssText = `position:fixed;visibility:hidden;white-space:pre;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
    document.body.append(span);
    const width = s => { span.textContent = s; return span.getBoundingClientRect().width; };
    const i = input.value.indexOf(sub), rect = input.getBoundingClientRect(), left = rect.left + parseFloat(cs.paddingLeft) - input.scrollLeft;
    const out = {text: input.value, x0: left + width(input.value.slice(0, i)), x1: left + width(input.value.slice(0, i + sub.length)), y: rect.top + rect.height / 2, mode: 'full'};
    span.remove(); return out;
  }, [FIELD, sub, nth]);
  const crop = async name => {
    const box = await ui.evaluate(() => { const r = document.querySelector('.browser-shell .address-bar').getBoundingClientRect(); return {x: Math.max(0, r.left - 24), y: Math.max(0, r.top - 10), width: Math.min(innerWidth - Math.max(0, r.left - 24), r.width + 48), height: r.height + 20}; });
    await ui.screenshot({path: path.join(out, name + '.png'), clip: box});
  };
  const drag = async (sub, {backward = false, midShot = null, nth = 0} = {}) => {
    const g = await geo(sub, nth); if (g.x0 == null) throw Error(`"${sub}" not shown in "${g.text}"`);
    const [from, to] = backward ? [g.x1 - 1, g.x0 + 1] : [g.x0 + 1, g.x1 - 1];
    await ui.mouse.move(from, g.y); await ui.mouse.down(); await ui.mouse.move(to, g.y, {steps: 8}); await sleep(120);
    const mid = await ui.evaluate(f => ({atRest: !!document.querySelector(f + ' .address-display'), painted: !!globalThis.CSS?.highlights?.has('acira-address-drag')}), FIELD);
    if (midShot) await crop(midShot);
    await ui.mouse.up(); await sleep(150);
    return {mid, mode: g.mode};
  };
  const at = async (sub, where = 'mid') => { const g = await geo(sub); return {x: where === 'end' ? g.x1 - 1 : where === 'start' ? g.x0 + 1 : (g.x0 + g.x1) / 2, y: g.y}; };
  const record = (view, dir, name, expected, got, extra = {}) => {
    const ok = got.text === expected && got.focused;
    if (!ok) failed += 1;
    results.push({view, dir, gesture: name, expected, selected: got.text, ok, direction: got.direction, ...extra});
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${view.padEnd(8)} ${dir} ${name.padEnd(34)} expected ${JSON.stringify(expected).padEnd(58)} got ${JSON.stringify(got.text)}${extra.mid ? ` mid-drag at-rest=${extra.mid.atRest} painted=${extra.mid.painted}` : ''}`);
  };

  const runCases = async (view, dir, full) => {
    const tag = `${view}-${dir}`;
    if (view === 'seamless') {
      await app.main(({webContents}) => { const w = webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html'); w.send('acira:browser-event', {type: 'chrome-edge', top: true, side: false, pinned: {top: true, side: false}}); });
      await sleep(600);
    }
    await blur(); let d = await drag('example', {midShot: `${tag}-host-mid-drag`}); let r = await read(); await crop(`${tag}-host-drag`);
    record(view, dir, 'drag over host "example"', 'example', r, d);
    await blur(); d = await drag('selection-guide', {midShot: full ? `${tag}-path-mid-drag` : null}); r = await read(); await crop(`${tag}-path-drag`);
    record(view, dir, 'drag over path "selection-guide"', 'selection-guide', r, d);
    await blur(); d = await drag('docs', {backward: true}); r = await read(); await crop(`${tag}-path-backward`);
    record(view, dir, 'backward drag over "docs"', 'docs', r, {...d, direction: r.direction});
    await blur(); d = await drag('omnibox'); r = await read();
    record(view, dir, 'drag over query "omnibox"', 'omnibox', r, d);
    await blur(); let p = await at('selection'); await ui.mouse.click(p.x, p.y); await sleep(200); r = await read(); await crop(`${tag}-click`);
    record(view, dir, 'click (unfocused)', TARGET, r);
    if (!full) return;
    await blur(); p = await at('selection'); await ui.mouse.dblclick(p.x, p.y); await sleep(200); r = await read(); await crop(`${tag}-double-click`);
    record(view, dir, 'double-click on "selection"', 'selection', r);
    await blur(); p = await at('example'); await ui.mouse.click(p.x, p.y, {clickCount: 3}); await sleep(200); r = await read(); await crop(`${tag}-triple-click`);
    record(view, dir, 'triple-click on "example"', TARGET, r);
    await blur(); p = await at('docs', 'end'); await ui.keyboard.down('Shift'); await ui.mouse.click(p.x, p.y); await ui.keyboard.up('Shift'); await sleep(200); r = await read(); await crop(`${tag}-shift-click-at-rest`);
    record(view, dir, 'Shift+click after "docs" (at rest)', 'example.com/docs', r);
    // Focused: a click expands and selects all; Shift+click then extends natively from the start.
    await blur(); p = await at('example'); await ui.mouse.click(p.x, p.y); await sleep(200);
    p = await at('docs', 'end'); await ui.keyboard.down('Shift'); await ui.mouse.click(p.x, p.y); await ui.keyboard.up('Shift'); await sleep(200); r = await read(); await crop(`${tag}-shift-click-focused`);
    record(view, dir, 'Shift+click after "docs" (focused)', 'https://www.example.com/docs', r);
    // Focused field: a drag is the browser's own (End first: pressing inside the selected address would drag the text out).
    await blur(); p = await at('example'); await ui.mouse.click(p.x, p.y); await sleep(200); await ui.keyboard.press('End'); await sleep(100);
    d = await drag('example'); r = await read(); await crop(`${tag}-focused-drag`);
    record(view, dir, 'drag over "example" (focused)', 'example', r, d);
  };

  for (const view of ['full', 'compact', 'seamless']) {
    await app.act({type: 'settings.update', patch: {windowView: view}}); await sleep(900);
    await runCases(view, 'ltr', view === 'full');
  }
  await app.act({type: 'settings.update', patch: {windowView: 'full', language: 'ar'}}); await sleep(1500);
  const rtl = await ui.evaluate(() => document.documentElement.dir);
  console.log('document dir', rtl);
  const words = await ui.evaluate(f => { const i = document.querySelector(f + ' input'); return {placeholder: i.placeholder, label: i.getAttribute('aria-label')}; }, FIELD);
  const english = words.placeholder === 'Search or enter address' || words.label === 'Address and search';
  if (english) failed += 1;
  results.push({view: 'full', dir: 'rtl', gesture: 'placeholder + name in Arabic', expected: 'not English', selected: JSON.stringify(words), ok: !english});
  console.log((english ? 'FAIL' : 'ok  ') + ' Arabic placeholder ' + JSON.stringify(words));
  await runCases('full', rtl === 'rtl' ? 'rtl' : 'ltr?', true);
  await app.act({type: 'settings.update', patch: {language: 'en'}}); await sleep(2500);
  await poll(() => ui.evaluate(() => Boolean(window.acira?.getSnapshot)).catch(() => false), Boolean, 'ui after language', 15000);
  await blur(); await ui.screenshot({path: path.join(out, 'window-full.png')});
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({target: TARGET, failed, results}, null, 2));
  console.log(failed ? `FAIL ${failed} of ${results.length}` : `PASS ${results.length} selections`);
} catch (error) {
  failed += 1; console.log('FAIL ' + (error?.stack || error));
} finally {
  await app?.close();
  try { fss.unlinkSync(lock); } catch {}
}
process.exit(failed ? 1 : 0);
