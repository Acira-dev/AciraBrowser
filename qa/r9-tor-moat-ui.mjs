// "Request a bridge from the Tor Project" (Moat) in the real app: Settings › Connection › Bridges › A bridge I know › Request. The
// puzzle arrives over the domain-fronted channel (real network), is shown, and is clip-scanned in light/dark × 100/150% × en/de with a
// picture of each; then an answer is submitted and the bridges Moat returns must land in the field and be saved (mode "custom").
// The bridge lines are never printed. One app (off-screen, never focused), 2 tabs, native slot held, closed in finally.
import fs from 'node:fs';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const scanner = fs.readFileSync(path.resolve('qa/m-clip-scan.js'), 'utf8');
const root = path.resolve(`.qa-profiles/r9-tor-moat-ui-${Date.now()}`), shots = path.join(root, 'shots');

await withSlot('r9-tor-moat-ui', async () => {
  fs.mkdirSync(shots, {recursive: true});
  const app = await startApp({root, env: {ACIRA_TEST_QUIET_NETWORK: '1'}});
  try {
    await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: -3000, y: 20, width: 1280, height: 860}); w.showInactive(); });
    const ui = () => poll(async () => app.context.pages().find(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } }), Boolean, 'ui', 20000);
    const act = async a => (await ui()).evaluate(a => window.acira.dispatch(a), a);
    const toBridges = async () => { const page = await ui(); await page.evaluate(async () => { for (const b of document.querySelectorAll('.bs-sidebar nav>button')) { b.click(); await new Promise(r => setTimeout(r, 300)); if (document.querySelector('[data-setting="tor-bridges"]')) return; } }); return page; };
    // Mode "a bridge I know" with one valid line, so the Request row shows.
    await (await ui()).evaluate(() => window.acira.native({type: 'tor.bridges-set', bridges: {mode: 'custom', custom: 'obfs4 203.0.113.5:443 0123456789ABCDEF0123456789ABCDEF01234567 cert=abc iat-mode=0'}}));
    await act({type: 'tab.new', url: 'acira://settings'}); await sleep(2000);
    let page = await toBridges();
    await page.locator('[data-setting="tor-bridge-moat"] button').click();
    const started = Date.now();
    await poll(() => page.evaluate(() => Boolean(document.querySelector('[data-setting="tor-bridge-moat"] img')?.naturalWidth)), Boolean, 'puzzle image', 120000);
    check(true, `the Tor Project's puzzle arrived over the domain-fronted channel and shows (${Math.round((Date.now() - started) / 1000)}s)`);
    const states = [];
    for (const locale of ['en', 'de']) for (const appearance of ['light', 'dark']) for (const scale of [100, 150]) {
      await act({type: 'settings.update', patch: {language: locale, appearance, interfaceScale: scale}}); await sleep(1800);
      page = await ui();
      // The view reloads on a language change: the puzzle is asked for again (a new one), as a person would see it.
      if (!(await page.evaluate(() => Boolean(document.querySelector('[data-setting="tor-bridge-moat"] img'))))) { page = await toBridges(); await page.locator('[data-setting="tor-bridge-moat"] button').click(); await poll(() => page.evaluate(() => Boolean(document.querySelector('[data-setting="tor-bridge-moat"] img')?.naturalWidth)), Boolean, 'puzzle again', 120000); }
      await page.evaluate(() => document.querySelector('[data-setting="tor-bridge-moat"]')?.scrollIntoView({block: 'center'}));
      await page.screenshot({path: path.join(shots, `moat-${locale}-${appearance}-${scale}.png`)});
      const text = String(await page.evaluate(scanner)), hits = text.split('\n').filter(line => / :: /.test(line));
      const mine = await page.evaluate(lines => { const scope = document.querySelector('[data-setting="tor-bridges"]')?.closest('.st-group'); const words = (scope?.innerText || '').replace(/\s+/g, ' '); return lines.filter(line => { const m = / :: "(.*?)" in </.exec(line); return m && m[1] && words.includes(m[1].slice(0, 24)); }); }, hits);
      // The scanner reads text nodes only: the answer field's placeholder is measured separately.
      const placeholder = await page.evaluate(() => { const input = document.querySelector('[data-setting="tor-bridge-moat"] input'); if (!input) return {fits: false}; const cs = getComputedStyle(input), ctx = document.createElement('canvas').getContext('2d'); ctx.font = cs.font; const width = ctx.measureText(input.placeholder).width, room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); return {fits: width <= room, width: Math.round(width), room: Math.round(room)}; });
      if (!placeholder.fits) mine.push('placeholder does not fit ' + JSON.stringify(placeholder));
      states.push({locale, appearance, scale, mine});
    }
    check(states.every(s => !s.mine.length), `Moat puzzle in Settings: 0 clipped or crossing text (placeholder included) in ${states.length} states ${JSON.stringify(states.filter(s => s.mine.length))}`);
    // An answer (Moat currently hands out bridges for any answer; a wrong one would bring a new puzzle instead).
    await act({type: 'settings.update', patch: {language: 'en', appearance: 'light', interfaceScale: 100}}); await sleep(1800);
    page = await ui();
    if (!(await page.evaluate(() => Boolean(document.querySelector('[data-setting="tor-bridge-moat"] img'))))) { page = await toBridges(); await page.locator('[data-setting="tor-bridge-moat"] button').click(); await poll(() => page.evaluate(() => Boolean(document.querySelector('[data-setting="tor-bridge-moat"] img')?.naturalWidth)), Boolean, 'puzzle (answer)', 120000); }
    await page.locator('[data-setting="tor-bridge-moat"] input').fill('freedom');
    await page.locator('[data-setting="tor-bridge-moat"] button.primary').click();
    const outcome = await poll(() => page.evaluate(() => { const notes = [...document.querySelectorAll('.st-note')].map(n => n.innerText); return notes.find(n => /received and saved|wasn.t right|Couldn.t reach/.test(n)) || ''; }), Boolean, 'Moat answer', 120000);
    const saved = await page.evaluate(() => window.acira.native({type: 'tor.bridges'}));
    const field = await page.evaluate(() => document.querySelector('textarea.tor-bridge-lines')?.value.split('\n').filter(Boolean).length || 0);
    await page.screenshot({path: path.join(shots, 'moat-saved-en-light-100.png')});
    if (/wasn.t right/.test(outcome)) check(true, `Moat said the answer was wrong and showed a new puzzle ("${outcome}")`);
    else check(/received and saved/.test(outcome) && saved.torBridges.mode === 'custom' && saved.torBridges.custom.length > 1 && field === saved.torBridges.custom.length, `Moat's bridges were saved as "a bridge I know" (${saved.torBridges.custom.length} lines, field shows ${field}; "${outcome}")`);
  } finally { await app.close(); }
});
console.log('pictures:', shots);
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
