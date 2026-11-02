// Stream L: M's edge scanner (qa/m-edge-scan.js) on the E01-E03 surfaces in German at 100% and 150%, light and dark.
//   node qa/l-edge-de.mjs [--locale=de]   isolated profile, one Electron per run (closed in finally), off-screen.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const locale = (process.argv.find(a => a.startsWith('--locale=')) || '--locale=de').split('=')[1];
const scanner = fs.readFileSync(path.resolve('qa/m-edge-scan.js'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const data = path.resolve('.qa-profiles/l-edge-' + Date.now());
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
});
const pick = async test => { for (let i = 0; i < 100; i++) { const p = app.windows().find(p => test(p.url())); if (p) return p; await wait(100); } return null; };
let bad = 0;
try {
  let ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
  await ui.evaluate(a => window.acira.dispatch(a), { type: 'settings.update', patch: { language: locale } }); await wait(3000);
  ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
  try { await ui.getByRole('button', { name: /Skip|Einrichtung|Passer|Ignorer|Salta|Omitir|Pular|スキップ|跳过/ }).first().click({ timeout: 6000 }); } catch {}
  await ui.evaluate(a => window.acira.dispatch(a), { type: 'settings.update', patch: { verticalTabs: true } });
  for (const [scale, theme] of [[100, 'light'], [100, 'dark'], [150, 'light'], [150, 'dark']]) {
    await ui.evaluate(a => window.acira.dispatch(a), { type: 'settings.update', patch: { interfaceScale: scale, appearance: theme } }); await wait(1800);
    ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    await ui.evaluate(scanner);
    const findings = [];
    // E01: the sidebar profile button under a real hover.
    const profile = ui.locator('.sb-foot-profile').first();
    if (await profile.count()) { await profile.hover(); await wait(400); findings.push(...(await profile.evaluate(el => window.__edge.el(el))).map(f => 'E01 ' + JSON.stringify(f))); }
    else findings.push('E01 sidebar profile button not found');
    // E02 / E03: library pages (the "/" hint, the empty-state kbd chips).
    for (const page of ['acira://history', 'acira://bookmarks', 'acira://downloads']) {
      await ui.evaluate(a => window.acira.dispatch(a), { type: 'tab.new', url: page }); await wait(1500);
      const hits = await ui.evaluate(() => { const out = []; for (const el of document.querySelectorAll('.lib-search kbd, .lib-empty-hint kbd, .lib-empty kbd')) { const f = window.__edge.el(el); const cs = getComputedStyle(el), r = el.getBoundingClientRect(); out.push({ el: el.className || el.parentElement.className, text: el.textContent, padL: cs.paddingLeft, padR: cs.paddingRight, h: Math.round(r.height * 10) / 10, f }); } return out; });
      for (const h of hits) {
        const pad = parseFloat(h.padL) >= 6 && parseFloat(h.padR) >= 6;
        findings.push(...(h.f || []).map(x => `E02/E03 ${page} "${h.text}" ${JSON.stringify(x)}`));
        if (!pad) findings.push(`E03 ${page} kbd "${h.text}" side padding ${h.padL}/${h.padR}`);
      }
    }
    // E03: the tooltip chip: hover a button whose tooltip has a key.
    // A keyed tooltip is only on screen while the pointer rests on a control, so the chip is built the way the tooltip builds it.
    const tip = await ui.evaluate(() => { const host = document.createElement('div'); host.className = 't-tip'; host.style.cssText = 'position:fixed;left:-500px;top:0'; host.innerHTML = 'Zurück<kbd>Alt+←</kbd>'; document.body.appendChild(host); const k = host.querySelector('kbd'); if (!k) return null; const cs = getComputedStyle(k); const out = { padL: cs.paddingLeft, padR: cs.paddingRight, text: k.textContent }; host.remove(); return out; });
    if (tip && !(parseFloat(tip.padL) >= 6 && parseFloat(tip.padR) >= 6)) findings.push(`E03 tooltip kbd "${tip.text}" side padding ${tip.padL}/${tip.padR}`);
    console.log(`${findings.length ? 'FAIL' : 'PASS'} ${locale} ${scale}% ${theme}` + (findings.length ? '\n  ' + findings.slice(0, 8).join('\n  ') : '') );
    bad += findings.length ? 1 : 0;
  }
} finally { await app.close().catch(() => {}); }
process.exit(bad ? 1 : 0);
