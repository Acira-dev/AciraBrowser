// Stream L: Settings section icons: one 20px tile, 16px glyph, centred, same box for every section; light/dark x 100%/150%.
//   node qa/l-settings-icons.mjs   isolated profile, one Electron, off-screen.
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const data = path.resolve('.qa-profiles/l-icons-' + Date.now());
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
const record = (name, ok, detail = '') => { rows.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
let exitCode = 1;
try {
  let ui = null;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 6000 }); } catch {}
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  await act({ type: 'tab.new', url: 'acira://settings' }); await wait(2000);
  for (const [scale, theme] of [[100, 'light'], [100, 'dark'], [150, 'light'], [150, 'dark']]) {
    await act({ type: 'settings.update', patch: { interfaceScale: scale, appearance: theme } }); await wait(1500);
    const m = await ui.evaluate(() => [...document.querySelectorAll('.bs-sidebar nav>button')].map(b => { const t = b.querySelector('.bs-nav-icon')?.getBoundingClientRect(), g = b.querySelector('.bs-nav-icon svg')?.getBoundingClientRect(), l = b.querySelector(':scope>span:not(.bs-nav-icon)')?.getBoundingClientRect(); return t && g ? { name: b.getAttribute('aria-label'), tw: Math.round(t.width * 10) / 10, gw: Math.round(g.width * 10) / 10, gh: Math.round(g.height * 10) / 10, dx: Math.abs(t.x + t.width / 2 - (g.x + g.width / 2)), dy: Math.abs(t.y + t.height / 2 - (g.y + g.height / 2)), gap: l ? Math.round((l.x - (t.x + t.width)) * 10) / 10 : 0, x: Math.round(t.x * 10) / 10 } : { name: b.getAttribute('aria-label'), missing: true }; }));
    const bad = m.filter(r => r.missing || r.dx > 0.5 || r.dy > 0.5 || r.gw !== m[0].gw || r.gh !== m[0].gh || r.tw !== m[0].tw || r.x !== m[0].x || r.gap < 6);
    record(`${scale}% ${theme}: ${m.length} section icons share one tile, size and left edge, centred, clear of the label`, m.length >= 9 && bad.length === 0, bad.length ? JSON.stringify(bad) : `tile ${m[0].tw}, glyph ${m[0].gw}x${m[0].gh}, gap ${m[0].gap}`);
  }
  console.log(rows.every(Boolean) ? 'ALL PASS' : 'FAILED'); exitCode = rows.every(Boolean) ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await app.close().catch(() => {}); }
process.exit(exitCode);
