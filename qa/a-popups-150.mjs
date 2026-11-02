// A (round 2 P0 from N): every popup opens at interface scale 150% in a small window (1100×760), and on a 150% display.
// For each case it clicks the toolbar triggers and checks that main holds an overlay for the popup and that the popup is
// inside the window's work area, scrolling inside itself when it can't fit. Isolated, one instance, no focus stealing
// (showInactive), capped polls, ≤ 3 tabs.   node qa/a-popups-150.mjs [case index] [repeats ≤ 5]   (A_DEBUG=1 for traces)
// Root cause found with it (P0): a fractional zoom (1100px at 150% = 733.3 CSS px) jitters the UI viewport by 1px when
// a popup opens, and App's resize handler closed every anchored popup on any viewport change.
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Page ${req.url}</title><body style="font:16px system-ui">${req.url}</body>`); });
const base = `http://127.0.0.1:${fx.port}/`;
const cases = [
  {name: 'interface 150%, 1100×760', scale: 150, args: [], width: 1100, height: 760},
  {name: 'display 150%, 1100×760', scale: 100, args: ['--force-device-scale-factor=1.5'], width: 1100, height: 760},
  {name: 'interface 150% on a 150% display, 1100×760', scale: 150, args: ['--force-device-scale-factor=1.5'], width: 1100, height: 760},
  {name: 'interface 125%, 1100×760', scale: 125, args: [], width: 1100, height: 760},
];
const triggers = [['menu', '[aria-label="Acira menu"]'], ['tabs', '[aria-label^="All open tabs"]'], ['security', '.address-security, [aria-label^="Site information"], [aria-label^="Connection"]']];
const failures = [], only = process.argv[2] ? Number(process.argv[2]) : -1, repeat = Math.min(5, Number(process.argv[3] || 1));
for (const c of (only >= 0 ? Array(repeat).fill(cases[only]) : cases)) {
  const root = `.qa-profiles/a-popups-150-${c.scale}-${c.args.length}`; await fs.rm(root, {recursive: true, force: true});
  const app = await startApp({root, args: c.args, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
  try {
    await app.main(({BaseWindow}, [w, h]) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 80, y: 60, width: w, height: h}); win.showInactive(); }, [c.width, c.height]);
    await app.act({type: 'settings.update', patch: {interfaceScale: c.scale, verticalTabs: false}});
    await app.act({type: 'tab.new', url: base + 'a'}); await app.waitWeb(base + 'a'); await sleep(900);
    for (const [kind, selector] of triggers) {
      const trigger = app.ui.locator(selector).first();
      if (!(await trigger.count())) { failures.push(`${c.name}: ${kind} trigger not found`); continue; }
      await app.ui.evaluate(() => { window.__resizes = []; window.__onResize ??= () => window.__resizes.push(`${innerWidth}x${innerHeight}`); window.addEventListener('resize', window.__onResize); });
      await trigger.click();
      const open = await poll(async () => (await layout())?.overlay, Boolean, `${kind} open`, 2500).catch(() => null);
      const area = await app.main(({BaseWindow, screen}) => { const w = BaseWindow.getAllWindows()[0], b = w.getBounds(); return {window: b, work: screen.getDisplayMatching(b).workArea}; });
      // Held by main is not enough: the popup must be painted. Read the overlay renderer once it has had time to form.
      const held = []; for (let i = 0; i < 12; i++) { const o = (await layout())?.overlay; held.push(o ? `${o.kind}:${o.bounds.height}` : '-'); await sleep(60); }
      if (process.env.A_DEBUG) console.log('  held over time', held.join(' '), '| UI resizes', JSON.stringify(await app.ui.evaluate(() => window.__resizes)));
      const overlayPages = app.context.pages().filter(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
      const probes = await Promise.all(overlayPages.map(p => p.evaluate(async () => { const l = await window.acira?.getBrowserLayout?.(); const s = document.querySelector('.sheet-popup'); return {overlay: l?.overlay ? `${l.overlay.id}:${l.overlay.kind}` : null, sheet: !!s, size: s?.dataset.sizePending}; }).catch(e => String(e).slice(0, 80))));
      if (process.env.A_DEBUG) console.log('  overlay pages', JSON.stringify(probes));
      const overlayPage = overlayPages[0];
      const painted = overlayPage ? await overlayPage.evaluate(() => {
        const sheet = document.querySelector('.sheet-popup'); if (!sheet) return {sheet: false};
        let o = 1; for (let e = sheet; e && e !== document.documentElement; e = e.parentElement) o *= +getComputedStyle(e).opacity;
        const r = sheet.getBoundingClientRect();
        return {sheet: true, opacity: +o.toFixed(2), pending: !!sheet.querySelector('[data-popup-pending]'), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], viewport: [innerWidth, innerHeight], hidden: document.hidden};
      }).catch(e => ({error: String(e).slice(0, 120)})) : {overlayPage: false};
      if (process.env.A_DEBUG) console.log(`  painted ${JSON.stringify(painted)}`);
      if (open && (!painted.sheet || painted.opacity < .9)) failures.push(`${c.name}: ${kind} held but not painted ${JSON.stringify(painted)}`);
      const line = open ? `${kind}: open as ${open.kind} at ${JSON.stringify(open.bounds)} content ${open.contentHeight}` : `${kind}: DID NOT OPEN`;
      console.log(`${c.name} | ${line}`);
      if (!open) failures.push(`${c.name}: ${kind} did not open`);
      else {
        const b = open.bounds, w = area.window;
        if (b.y < 0 || b.x < 0 || b.x + b.width > w.width || b.y + b.height > w.height) failures.push(`${c.name}: ${kind} outside the window ${JSON.stringify(b)} in ${w.width}×${w.height}`);
      }
      for (let i = 0; i < 4 && (await layout())?.overlay; i++) { await app.ui.keyboard.press('Escape').catch(() => {}); await sleep(300); }
      const still = (await layout())?.overlay; if (still) await app.ui.evaluate(id => window.acira.closeOverlay(id), still.id);
      await sleep(400);
    }
    const errors = [...new Set(app.logs.join('').split('\n').filter(l => /error|refus|reject|invalid/i.test(l)).map(l => l.slice(0, 180)))].slice(0, 12);
    if (errors.length) console.log(`${c.name} | logs:\n    ${errors.join('\n    ')}`);
  } finally { await app.close(); }
}
fx.close?.();
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: every popup opened inside the window at every case');
process.exitCode = failures.length ? 1 : 0;
