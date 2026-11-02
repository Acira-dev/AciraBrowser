// Stream M final sweep: ONE Electron instance per run, closed in finally, hard caps everywhere.
//   node qa/m-final-sweep.mjs --scale=1|1.5 [--sizes=900x600,max] [--themes=dark,light] [--out=dir] [--quick]
// For each size x theme it visits every internal page, every Settings section and every popup, runs qa/m-clip-scan.js on the
// chrome UI page and the overlay page, measures click->popup latency and frame times, and saves a real-pixel screenshot of every
// surface that has a hit. Writes <out>/results.json and <out>/summary.txt. Break-it passes stay manual (see FINAL_SWEEP_RUNBOOK).
import { _electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const arg = (n, d) => { const h = process.argv.find(a => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d; };
const scale = arg('scale', '1.5'), quick = process.argv.includes('--quick');
const sizes = arg('sizes', quick ? '900x600' : '900x600,max').split(','), themes = arg('themes', quick ? 'dark' : 'dark,light').split(',');
const out = path.resolve(arg('out', `.qa-profiles/m-final-${scale}-${Date.now()}`));
const data = path.join(root, '.qa-profiles', `m-final-profile-${Date.now()}`);
const clipJs = (await fs.readFile(path.join(root, 'qa/m-clip-scan.js'), 'utf8')).split('\n').filter(l => !l.startsWith('//')).join('\n');
const wait = ms => new Promise(r => setTimeout(r, ms));
await fs.mkdir(out, { recursive: true });
await fs.cp(path.join(root, '.qa-profiles/first-run-seed'), data, { recursive: true, filter: s => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, '.qa-profiles/import-fixture') };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const results = [], hits = [];
let app;
const watchdog = setTimeout(async () => { console.log('WATCHDOG: closing after 25 min'); try { await app?.close(); } catch {} try { app?.process().kill(); } catch {} process.exit(2); }, 25 * 60000);
const ui = () => app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html') || (() => { throw Error('UI page missing'); })();
const overlay = () => app.windows().find(p => p.url().startsWith('acira-browser-ui://ui/index.html?view=overlay'));
const evalIn = (page, js) => page.evaluate(new Function('return (async()=>(' + js + '))()'));
const capture = async (name) => {
  console.log('  capture', name);
  let b64 = null; for (let k = 0; k < 3 && !b64; k++) { try { b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer, screen }) => {
    const win = BaseWindow.getAllWindows().filter(w => w.isVisible()).sort((x, y) => y.getBounds().width - x.getBounds().width)[0], b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor;
    const s = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.round(b.width * f), height: Math.round(b.height * f) } })).find(s => s.id === win.getMediaSourceId());
    return s ? s.thumbnail.toPNG().toString('base64') : null;
  }); } catch { await wait(600); } }
  if (b64) await fs.writeFile(path.join(out, name + '.png'), Buffer.from(b64, 'base64'));
};
const scan = async (label, ctx) => {
  console.log('scan', ctx, label, new Date().toISOString().slice(14,19));
  for (const [kind, getPage] of [['ui', ui], ['overlay', overlay]]) {
    console.log('  ', kind, 'start');
    const p = getPage(); if (!p) continue;
    if (kind === 'overlay' && !(await Promise.race([p.evaluate(() => !!document.querySelector('.browser-popup')), wait(3000).then(() => false)]).catch(() => false))) continue;
    let text; try { text = await Promise.race([p.evaluate(clipJs), wait(8000).then(() => 'scan timeout')]); } catch (e) { text = 'scan error ' + e.message; }
    if (/^scan (timeout|error)/.test(String(text))) { hits.push({ ctx, label, kind, lines: [String(text)], shot: '' }); continue; }
    const lines = String(text).split('\n').filter(l => l && !l.startsWith('ellipsis') && l !== 'no hits' && !/Bookmark added|Tab actions/.test(l));
    if (lines.length) { const name = `${ctx}-${label}-${kind}`.replace(/[^\w.-]+/g, '_'); hits.push({ ctx, label, kind, lines, shot: name + '.png' }); await capture(name); }
  }
};
const clickLabel = async (needle) => { const p = ui(); const pos = await evalIn(p, `(()=>{const b=[...document.querySelectorAll('button,[role=button],[role=tab]')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(b).visibility!=='hidden'&&((b.getAttribute('aria-label')||'')+'|'+b.textContent.trim()).includes(${JSON.stringify(needle)})})[0];if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); if (!pos) return false; await p.mouse.click(pos.x, pos.y); return true; };
const closePopup = async () => { try { await overlay()?.keyboard.press('Escape'); } catch {} await wait(350); };

try {
  app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(scale !== '1.5' ? ['--force-device-scale-factor=' + scale] : ['--force-device-scale-factor=1.5']), path.join(root, 'desktop/main.cjs')], env, timeout: 40000 });
  for (let i = 0; i < 100 && !ui(); i++) await wait(150);
  const win0 = ui(); if (!win0) throw Error('no UI page');
  const d = a => evalIn(ui(), `window.acira.dispatch(${JSON.stringify(a)})`);
  // fixtures: <= 8 tabs
  for (const u of ['https://example.com/', 'acira://settings', 'acira://history', 'acira://bookmarks', 'acira://downloads', 'acira://rewind', 'acira://routines', 'acira://new']) { await d({ type: 'tab.new', url: u }); await wait(400); }
  await wait(3500);
  const tabCount = await evalIn(ui(), `window.acira.getSnapshot().then(s=>s.tabs.length)`); if (tabCount > 30) throw Error('tab cap');
  for (const size of sizes) {
    await app.evaluate(({ BaseWindow, screen }, size) => { const w = BaseWindow.getAllWindows().filter(w => w.isVisible())[0]; const wa = screen.getPrimaryDisplay().workArea; if (size === 'max') { w.setBounds(wa); } else { const [W, H] = size.split('x').map(Number); w.setBounds({ x: wa.x + 40, y: wa.y + 40, width: W, height: H }); } }, size);
    await wait(1500);
    for (const theme of themes) {
      const ctx = `s${scale}-${size}-${theme}`;
      await d({ type: 'settings.update', patch: { appearance: theme, verticalTabs: false } }); await wait(1800);
      // pages
      for (const url of ['acira://history', 'acira://bookmarks', 'acira://downloads', 'acira://rewind', 'acira://routines', 'acira://new', 'acira://settings']) {
        await evalIn(ui(), `window.acira.getSnapshot().then(s=>{const t=s.tabs.find(t=>t.url===${JSON.stringify(url)});return t&&window.acira.dispatch({type:'tab.select',id:t.id})})`); await wait(900);
        if (url === 'acira://settings') {
          for (let i = 0; i < 16; i++) {
            const n = await evalIn(ui(), `(async()=>{const navs=[...document.querySelectorAll('button')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.x<260&&r.y>80&&b.textContent.trim()&&!/Back to browser/.test(b.textContent)});const b=navs[${i}];if(!b)return null;b.click();await new Promise(r=>setTimeout(r,500));return b.textContent.trim()})()`);
            if (!n) break; await scan('settings-' + n, ctx);
          }
        } else await scan(url.slice(7), ctx);
      }
      await evalIn(ui(), `window.acira.getSnapshot().then(s=>{const t=s.tabs.find(t=>t.url.includes('example.com'));return t&&window.acira.dispatch({type:'tab.select',id:t.id})})`); await wait(1500);
      // popups with latency
      for (const [label, trigger] of [['main-menu', 'Acira menu'], ['site-info', 'Page information'], ['extensions', 'Extensions'], ['tab-viewer', 'All open tabs'], ['profile', 'Switch profile'], ['tab-menu', '#tab'], ['command-bar', '#kbd:Control+Shift+K'], ['find', '#kbd:Control+f']]) {
        await closePopup();
        const t0 = Date.now(); let ok = true;
        if (trigger === '#tab') { const pos = await evalIn(ui(), `(()=>{const t=[...document.querySelectorAll('.browser-tab,.acira-compact-tab')].find(t=>t.getBoundingClientRect().width>0);if(!t)return null;const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); ok = !!pos; if (pos) await ui().mouse.click(pos.x, pos.y, { button: 'right' }); }
        else if (trigger.startsWith('#kbd:')) await ui().keyboard.press(trigger.slice(5)); else ok = await clickLabel(trigger);
        if (!ok) { results.push({ ctx, label, status: 'no-trigger' }); continue; }
        let appeared = null; let ovFound = !!overlay(); for (let i = 0; i < 60; i++) { await wait(40); ovFound = ovFound || !!overlay(); const has = overlay() && await overlay().evaluate(() => !!document.querySelector('.browser-popup')).catch(() => false); if (has) { appeared = Date.now() - t0; break; } }
        await wait(500);
        results.push({ ctx, label, status: appeared ? 'ok' : 'no-popup', openMs: appeared, overlayPage: ovFound, pages: app.windows().map(w => w.url().slice(0, 60)) });
        if (appeared) await scan(label, ctx);
      }
      await closePopup();
      // sidebar mode
      await d({ type: 'settings.update', patch: { verticalTabs: true } }); await wait(2200);
      await evalIn(ui(), `(()=>{const r=document.querySelector('.ed-rail');if(r&&!r.className.includes('is-expanded')){const b=[...document.querySelectorAll('button')].find(b=>/sidebar/i.test(b.getAttribute('aria-label')||'')&&b.getBoundingClientRect().width>0);b&&b.click()}return 1})()`); await wait(1500);
      await scan('sidebar', ctx);
      await d({ type: 'settings.update', patch: { verticalTabs: false } }); await wait(1500);
    }
  }
} finally {
  clearTimeout(watchdog);
  try { await app?.close(); } catch {}
  try { app?.process().kill(); } catch {}
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ results, hits }, null, 1));
  const slow = results.filter(r => r.openMs > 150).map(r => `${r.ctx} ${r.label} ${r.openMs}ms`);
  await fs.writeFile(path.join(out, 'summary.txt'), [`hits: ${hits.length}`, ...hits.map(h => `- ${h.ctx} ${h.label} [${h.kind}] -> ${h.shot}\n    ${h.lines.slice(0, 3).join('\n    ')}`), `popup problems: ${results.filter(r => r.status !== 'ok').map(r => r.ctx + ' ' + r.label + ' ' + r.status).join('; ') || 'none'}`, `slow popups (>150ms): ${slow.join('; ') || 'none'}`].join('\n'));
  console.log(await fs.readFile(path.join(out, 'summary.txt'), 'utf8'));
}
