// Tor bridges UI in the real app (Settings › Connection › Bridges, and the Tor connect page when Tor looks blocked), with the
// clip/overlap scanner (qa/m-clip-scan.js) on every state in light/dark × 100/150% × English/German, and a picture of each.
// Tor is made to look blocked with ACIRA_TEST_TOR_SIMULATE_BLOCK=1 (tor-engine.cjs: a dead local proxy, so every connection tor
// tries is refused, as on a network that blocks Tor). The flow is the person's: the page says Tor looks blocked and offers a
// bridge; "Connect through a bridge" saves obfs4 and reconnects; still blocked, it offers the next kind (Snowflake).
// One app (off-screen, never focused), ≤ 3 tabs, native slot held, closed in finally. Pictures: .qa-profiles/r9-tor-bridges-ui-*/shots
import fs from 'node:fs';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const scanner = fs.readFileSync(path.resolve('qa/m-clip-scan.js'), 'utf8');
const root = path.resolve(`.qa-profiles/r9-tor-bridges-ui-${Date.now()}`), shots = path.join(root, 'shots');
const VALID = 'obfs4 203.0.113.5:443 0123456789ABCDEF0123456789ABCDEF01234567 cert=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh iat-mode=0';
const COMBOS = [];
for (const locale of ['en', 'de']) for (const appearance of ['light', 'dark']) for (const scale of [100, 150]) COMBOS.push({locale, appearance, scale});

await withSlot('r9-tor-bridges-ui', async () => {
  fs.mkdirSync(shots, {recursive: true});
  let app = await startApp({root, env: {ACIRA_TEST_TOR_SIMULATE_BLOCK: '1', ACIRA_TEST_QUIET_NETWORK: '1'}});
  try {
    await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: -3000, y: 20, width: 1280, height: 860}); w.showInactive(); });
    const ui = () => poll(async () => app.context.pages().find(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } }), Boolean, 'ui', 20000);
    const act = async a => (await ui()).evaluate(a => window.acira.dispatch(a), a);
    const scan = async (key, region) => {
      const page = await ui();
      await page.screenshot({path: path.join(shots, key + '.png')});
      const text = String(await page.evaluate(scanner));
      const hits = text.split('\n').filter(line => / :: /.test(line));
      // Only our surfaces count: the settings content or the Tor page.
      // A hit reads `why :: "text" in <ancestor> rect=…`: it is ours when its text is inside the surface (the Bridges group, the Tor page).
      const mine = await page.evaluate(([hitLines, selector]) => { const found = document.querySelector(selector), scope = found?.closest('.st-group') || found; if (!scope) return ['(surface not found: ' + selector + ')']; const words = scope.innerText.replace(/\s+/g, ' '); return hitLines.filter(line => { const m = / :: "(.*?)" in </.exec(line); return m && m[1] && words.includes(m[1].slice(0, 24)); }); }, [hits, region]);
      return {hits, mine};
    };
    // ---- The Tor connect page while Tor looks blocked ----
    await act({type: 'tab.new', privacy: 'tor'});
    const page = await ui();
    await poll(() => page.evaluate(() => Boolean(document.querySelector('[data-tor-blocked]'))), Boolean, 'blocked offer on the Tor page', 120000);
    const words = await page.evaluate(() => document.querySelector('.tor-panel')?.innerText || '');
    check(/looks blocked/i.test(words) && /Connect through a bridge/.test(words) && /obfs4/.test(words) && /Try again/.test(words), `Tor page says Tor looks blocked and offers a bridge (obfs4), Try again and Bridge settings`);
    const torState = [];
    for (const combo of COMBOS) {
      await act({type: 'settings.update', patch: {language: combo.locale, appearance: combo.appearance, interfaceScale: combo.scale}}); await sleep(1800);
      await poll(async () => (await ui()).evaluate(() => Boolean(document.querySelector('[data-tor-blocked]'))), Boolean, 'blocked page after reload', 20000);
      const r = await scan(`tor-blocked-${combo.locale}-${combo.appearance}-${combo.scale}`, '.tor-page');
      torState.push({...combo, mine: r.mine});
    }
    check(torState.every(s => !s.mine.length), `blocked Tor page: 0 clipped or crossing text in ${torState.length} states (en/de × light/dark × 100/150%) ${JSON.stringify(torState.filter(s => s.mine.length))}`);
    // The person takes the offer: obfs4 is saved and Tor reconnects with it; still blocked here, the next kind is offered.
    await act({type: 'settings.update', patch: {language: 'en', appearance: 'light', interfaceScale: 100}}); await sleep(1800);
    const p2 = await ui();
    await p2.locator('[data-tor-blocked] button', {hasText: 'Connect through a bridge'}).click();
    const saved = await p2.evaluate(() => window.acira.native({type: 'tor.bridges'}));
    check(saved.torBridges?.mode === 'builtin' && saved.torBridges?.builtin === 'obfs4', `"Connect through a bridge" saved built-in obfs4 (${JSON.stringify({mode: saved.torBridges?.mode, builtin: saved.torBridges?.builtin})})`);
    await poll(() => p2.evaluate(() => /isn.t getting through/.test(document.querySelector('.tor-panel')?.innerText || '')), Boolean, 'obfs4 not getting through', 150000);
    const next = await p2.evaluate(() => document.querySelector('.tor-panel')?.innerText || '');
    check(/obfs4 bridge isn.t getting through/.test(next) && /Try another kind of bridge/.test(next) && /Snowflake/.test(next) && /via obfs4/.test(next), 'with obfs4 still blocked, the page says so and offers Snowflake next');
    await scan('tor-blocked-obfs4-en-light-100', '.tor-page');
    // ---- Settings › Connection › Bridges ----
    await act({type: 'tab.new', url: 'acira://settings'}); await sleep(2000);
    const s = await ui();
    const found = await s.evaluate(async () => { const buttons = [...document.querySelectorAll('.bs-sidebar nav>button')]; for (const b of buttons) { b.click(); await new Promise(r => setTimeout(r, 300)); if (document.querySelector('[data-setting="tor-bridges"]')) return b.getAttribute('aria-label'); } return null; });
    check(Boolean(found), `Settings has the Bridges group (section: ${found})`);
    const settingsStates = [];
    const shoot = async name => { for (const combo of COMBOS) {
      await act({type: 'settings.update', patch: {language: combo.locale, appearance: combo.appearance, interfaceScale: combo.scale}}); await sleep(1800);
      const page = await ui();
      await page.evaluate(async () => { if (document.querySelector('[data-setting="tor-bridges"]')) return; for (const b of document.querySelectorAll('.bs-sidebar nav>button')) { b.click(); await new Promise(r => setTimeout(r, 300)); if (document.querySelector('[data-setting="tor-bridges"]')) return; } });
      await page.evaluate(() => document.querySelector('[data-setting="tor-bridges"]')?.scrollIntoView({block: 'center'}));
      if (name === 'custom-errors') { const area = page.locator('textarea.tor-bridge-lines'); await area.fill(VALID + '\nobfs5 1.2.3.4:5\nobfs4 bridge.example.com:443 cert=x iat-mode=0'); await poll(() => page.evaluate(() => Boolean(document.querySelector('.tor-bridge-errors'))), Boolean, 'line errors', 5000); }
      const r = await scan(`settings-${name}-${combo.locale}-${combo.appearance}-${combo.scale}`, '[data-setting="tor-bridges"]');
      settingsStates.push({name, ...combo, mine: r.mine});
    } };
    // built-in (obfs4 saved above), then the person's own lines with two bad ones.
    await shoot('builtin');
    const errorsText = await (async () => { await (await ui()).evaluate(() => window.acira.native({type: 'tor.bridges-set', bridges: {mode: 'custom', custom: 'obfs4 203.0.113.5:443 0123456789ABCDEF0123456789ABCDEF01234567 cert=abc iat-mode=0'}})); await act({type: 'tab.navigate', url: 'acira://settings'}); await sleep(1500); await shoot('custom-errors'); return (await ui()).evaluate(() => document.querySelector('.tor-bridge-errors')?.innerText || ''); })();
    check(settingsStates.every(st => !st.mine.length), `Settings › Bridges: 0 clipped or crossing text in ${settingsStates.length} states ${JSON.stringify(settingsStates.filter(st => st.mine.length))}`);
    check(/Zeile 2/.test(errorsText) && /Zeile 3/.test(errorsText) || /Line 2/.test(errorsText) && /Line 3/.test(errorsText), `pasted lines are checked as typed, by line number (${errorsText.replace(/\s+/g, ' ').slice(0, 160)})`);
  } finally { await app.close(); }
});
console.log('pictures:', shots);
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
