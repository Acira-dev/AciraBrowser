// F02 (M's sweep): the Acira menu fits short windows. For each window/scale it opens the menu and reports the density,
// the row height, the held height against the content, whether the list scrolls, and whether the scroll cue shows; it
// also captures the menu. Isolated, one instance, showInactive, capped.   node qa/a-menu-fit.mjs <outdir>
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const out = process.argv[2]; await fs.mkdir(out, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>p</title><body style="background:#f4f1ea">x</body>'); });
const dir = '.qa-profiles/a-menu-fit'; await fs.rm(dir, {recursive: true, force: true});
const app = await startApp({root: dir, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
const cases = [{w: 1280, h: 800, scale: 100}, {w: 900, h: 600, scale: 100}, {w: 900, h: 600, scale: 125}, {w: 1100, h: 760, scale: 150}];
const failures = [];
import {execFileSync} from 'node:child_process';
const mainPid = await app.main(() => process.pid);
// Every process of this instance (its profile path is on each command line): type and CPU time.
const cpu = () => { try { return JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*a-menu-fit*' } | ForEach-Object { $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $matches[1] } else { 'main' }; [pscustomobject]@{pid=$_.ProcessId; type=$t; ms=(Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).TotalProcessorTime.TotalMilliseconds} } | ConvertTo-Json -Compress`]).toString()); } catch (e) { return []; } };
const bounded = (p, ms, what) => Promise.race([p, new Promise((_, reject) => setTimeout(async () => { const a = cpu(); await new Promise(r => setTimeout(r, 1000)); const b = cpu(); const use = [].concat(b).map(p => { const before = [].concat(a).find(q => q.pid === p.pid); return `${p.type}:${p.pid}=${before ? Math.round(p.ms - before.ms) : '?'}ms`; }).join(' '); reject(new Error(`stalled > ${ms}ms: ${what} | CPU in the next second: ${use}`)); }, ms))]);
const stamp = m => process.env.A_TRACE && console.log(`   ${new Date().toISOString().slice(14, 23)} ${m}`);
try {
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/a`}); await app.waitWeb(`http://127.0.0.1:${fx.port}/a`); await sleep(600);
  for (const theme of ['light', 'dark']) for (const c of cases) {
    stamp(`${theme} ${c.w}x${c.h} ${c.scale}: resize`);
    await bounded(app.main(({BaseWindow}, c) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 60, y: 40, width: c.w, height: c.h}); w.showInactive(); }, c), 10000, 'resize');
    stamp('settings'); await bounded(app.act({type: 'settings.update', patch: {interfaceScale: c.scale, appearance: theme, verticalTabs: false}}), 10000, 'settings.update'); await sleep(1200);
    stamp('open'); await bounded(app.cmd({type: 'ui', tabId: (await bounded(app.state(), 10000, 'state')).activeTabId, action: 'open', kind: 'menu'}), 10000, 'open');
    await poll(async () => (await layout())?.overlay?.kind === 'menu', Boolean, 'menu', 4000).catch(() => {}); await sleep(700);
    stamp('layout'); const held = (await bounded(layout(), 10000, 'layout'))?.overlay;
    stamp('inspect'); const r = await bounded(overlay().evaluate(() => {
      const popup = document.querySelector('.sheet-popup .browser-popup.popup-content-menu'); if (!popup) return null;
      const scroll = popup.querySelector('.popup-scroll'), row = popup.querySelector('.menu-row'), after = getComputedStyle(popup, '::after'), b = popup.getBoundingClientRect();
      return {density: popup.dataset.density || 'full', row: Math.round(row.getBoundingClientRect().height), scrolls: scroll.scrollHeight - scroll.clientHeight, cue: +after.opacity, fade: getComputedStyle(scroll).getPropertyValue('--menu-scroll-fade').trim(), rect: [b.x, b.y, b.width, b.height].map(Math.round), viewport: [innerWidth, innerHeight]};
    }), 10000, 'inspect overlay');
    const line = `${theme} ${c.w}×${c.h} at ${c.scale}%: ${JSON.stringify(r)} | held ${held?.bounds.height}/${held?.contentHeight}`;
    console.log(line);
    if (!r) failures.push(`${line}: no menu`);
    else if (r.scrolls > 1 && r.density === 'full') failures.push(`${line}: scrolls at full density`);
    else if (r.scrolls > 1 && !(r.cue > .5)) failures.push(`${line}: scrolls without a cue`);
    if (r?.rect) { const png = await app.main(async ({webContents}, [rect, z]) => { const wc = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay')); return (await wc.capturePage({x: Math.max(0, Math.round((rect[0] - 8) * z)), y: Math.max(0, Math.round((rect[1] - 8) * z)), width: Math.round((rect[2] + 16) * z), height: Math.round((rect[3] + 16) * z)})).toPNG().toString('base64'); }, [r.rect, c.scale / 100]); /* the rect is in CSS px; the capture is in device px */ await fs.writeFile(path.join(out, `menu-${theme}-${c.w}x${c.h}-${c.scale}.png`), Buffer.from(png, 'base64')); }
    for (let i = 0; i < 3 && (await layout())?.overlay; i++) { await app.ui.keyboard.press('Escape'); await sleep(250); }
    const o = (await layout())?.overlay; if (o) await app.ui.evaluate(id => window.acira.closeOverlay(id), o.id); await sleep(400);
  }
} finally { await app.close(); fx.close?.(); }
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: the menu fits, or scrolls only at its dense size with a cue');
process.exitCode = failures.length ? 1 : 0;
