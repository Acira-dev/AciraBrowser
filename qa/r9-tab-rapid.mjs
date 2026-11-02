// Rapid tab open/close in the sidebar (and the strip): rows must never overlap, leave ghosts or stuck animations, and the list
// must settle on exactly the tabs the state holds, with the active tab marked.
//   node qa/native-slot.mjs r9-tab-rapid -- node qa/r9-tab-rapid.mjs [sidebar|strip]
import fs from 'node:fs/promises';
import {startApp, sleep} from './d-harness.mjs';
const mode = process.argv[2] || 'sidebar', root = '.qa-profiles/r9-tab-rapid';
await fs.rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 300});
const app = await startApp({root}), problems = [];

const sel = mode === 'sidebar' ? '.acira-sidebar [data-zone=tabs] .sb-tab' : '[data-drag-key]';
try {
  await app.act({type: 'settings.update', patch: {appearance: 'dark', verticalTabs: mode === 'sidebar'}}); await sleep(900);
  // A sampler runs every frame inside the page and records the worst overlap between visible rows.
  await app.ui.evaluate(sel => {
    window.__rapid = {overlap: 0, hole: 0, worstHole: null, frames: 0, worst: null, jumps: [], prev: new Map()};
    const tick = () => {
      const rows = [...document.querySelectorAll(sel)].filter(n => !n.closest('.sb-flip-ghosts') && n.offsetHeight > 0 && n.getAnimations().length === 0 || false);
      window.__rapid.frames++;
      // What is VISIBLE of each row (its box clipped to where its content is, as a still-arriving row draws it), in list order: each row's
      // visible part must end where the next one's begins, with the settled gap and no more (no overlap, no hole), at every frame.
      // Rows coming in are clipped at the list's first slot (the tab zone's top edge): what is above it is not drawn.
      const line = document.querySelector('.acira-sidebar [data-zone=tabs]')?.getBoundingClientRect().top ?? -1e9;
      const vis = [...document.querySelectorAll(sel)].filter(n => !n.closest('.sb-flip-ghosts') && n.offsetHeight > 0).map(n => {
        const box = n.getBoundingClientRect(), parts = [...n.children].map(c => c.getBoundingClientRect()), top = Math.max(line, box.top, Math.min(...parts.map(r => r.top))), bottom = Math.min(box.bottom, Math.max(...parts.map(r => r.bottom)));
        return {top, bottom, box};
      }).filter(r => r.bottom - r.top > 2);
      const R = window.__rapid; R.settledGap ??= vis.length > 1 ? vis[1].top - vis[0].bottom : 0;
      for (let i = 1; i < vis.length; i++) {
        const over = vis[i - 1].bottom - vis[i].top, hole = vis[i].top - vis[i - 1].bottom - R.settledGap;
        if (over > R.overlap) { R.overlap = over; R.worst = ['overlap', Math.round(vis[i - 1].bottom), Math.round(vis[i].top), R.frames]; }
        if (hole > R.hole) { R.hole = hole; R.worstHole = [Math.round(vis[i - 1].bottom), Math.round(vis[i].top), R.frames]; }
      }
      const axis = sel.includes('sb-tab') ? 'top' : 'left', cur = new Map();
      for (const n of document.querySelectorAll(sel)) { if (n.closest('.sb-flip-ghosts') || !(n.dataset.tabId||n.dataset.dragKey)) continue; cur.set(n.dataset.tabId||n.dataset.dragKey, n.getBoundingClientRect()[axis]); window.__rapid.tr = window.__rapid.tr || new Map(); window.__rapid.tr.set(n.dataset.tabId||n.dataset.dragKey, getComputedStyle(n).transform); }
      for (const [id, v] of cur) { const was = window.__rapid.prev.get(id); if (was !== undefined && Math.abs(v - was) > 30) window.__rapid.jumps.push({id: id.slice(-4), was: Math.round(was), now: Math.round(v), f: window.__rapid.frames, tr: window.__rapid.tr.get(id), sc: document.querySelector('.acira-sidebar .sb-scroll')?.scrollTop}); }
      window.__rapid.prev = cur;
      window.__rapidRaf = requestAnimationFrame(tick);
    };
    tick();
  }, sel);
  const settle = async label => {
    await sleep(1600);
    const r = await app.ui.evaluate(async sel => {
      const s = await window.acira.getSnapshot(), rows = [...document.querySelectorAll(sel)].filter(n => !n.closest('.sb-flip-ghosts'));
      return {tabs: s.tabs.length, rows: rows.length, ghosts: document.querySelectorAll('.sb-flip-ghost,.sb-flip-ghosts').length,
        stuck: [...document.querySelectorAll(sel)].reduce((n, el) => n + el.getAnimations().length, 0),
        current: rows.filter(n => n.getAttribute('aria-current') === 'true').length, active: s.activeTabId, activeRow: rows.find(n => n.getAttribute('aria-current') === 'true')?.dataset.tabId,
        glides: document.querySelectorAll('.sb-glide,[data-glide]').length, clip: rows.filter(n => n.style.overflow === 'clip').length};
    }, sel);
    console.log(label, JSON.stringify(r));
    if (mode === 'sidebar') {
      if (r.rows !== r.tabs) problems.push(`${label}: rows ${r.rows} != tabs ${r.tabs}`);
      if (r.ghosts) problems.push(`${label}: ghosts left ${r.ghosts}`);
      if (r.stuck) problems.push(`${label}: stuck animations ${r.stuck}`);
      if (r.current !== 1 || (r.activeRow && r.activeRow !== r.active)) problems.push(`${label}: wrong current ${r.current} ${r.activeRow} vs ${r.active}`);
      if (r.glides) problems.push(`${label}: glide leftovers ${r.glides}`);
      if (r.clip) problems.push(`${label}: clip leftovers ${r.clip}`);
    }
  };
  await settle('start');
  for (let round = 0; round < (process.env.RP_KEYS_ONLY ? 0 : 3); round++) {
    const gap = [0, 25, 70][round];
    // Open fast (the Ctrl+T path), selecting the newest row as it appears.
    for (let i = 0; i < 10; i++) { await app.act({type: 'tab.new'}); if (gap) await sleep(gap);
      const id = (await app.state()).activeTabId; const row = app.ui.locator(`${sel}[data-tab-id="${id}"]`).first(); try { await row.click({timeout: 400, trial: false}); } catch {} }
    await settle(`open gap=${gap}`);
    // Close fast: the row's own close button, then the keyboard path (tab.close of the active tab).
    for (let i = 0; i < 4; i++) { const btn = app.ui.locator(`${sel} .sb-tab-close`).first(); try { await btn.click({timeout: 400, force: true}); } catch {} if (gap) await sleep(gap); }
    for (let i = 0; i < 5; i++) { const s = await app.state(); await app.act({type: 'tab.close', id: s.activeTabId}); if (gap) await sleep(gap); }
    await settle(`close gap=${gap}`);
  }
  // Real shortcuts: Ctrl+T / Ctrl+W as key events into the chrome page (what the keyboard sends).
  const key = (k, ms) => app.main(async ({webContents}, [k, ms]) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('acira-browser-ui://ui/index.html') && !w.getURL().includes('view=')); for (let i = 0; i < 10; i++) { for (const type of ['rawKeyDown', 'char', 'keyUp']) wc.sendInputEvent({type, keyCode: k, modifiers: ['control']}); await new Promise(r => setTimeout(r, ms)); } }, [k, ms]);
  for (const ms of (process.env.RP_GAPS || '0,30,80').split(',').map(Number)) { await key('T', ms); await settle(`Ctrl+T x10 gap=${ms}`); await key('W', ms); await settle(`Ctrl+W x10 gap=${ms}`); }
  const o = await app.ui.evaluate(() => { cancelAnimationFrame(window.__rapidRaf); return window.__rapid; });
  if (process.env.RP_FLIPLOG) console.log('FLIPLOG', JSON.stringify(await app.ui.evaluate(() => window.__flipLog)).slice(0, 6000));
  console.log('overlap', JSON.stringify({overlap: o.overlap, hole: o.hole, frames: o.frames, worst: o.worst, worstHole: o.worstHole, jumps: o.jumps.length}), JSON.stringify(o.jumps.filter(j => Math.abs(j.now - j.was) > 300).slice(0, 4)));
  if (mode === 'sidebar' && o.overlap > 1.5) problems.push(`rows drawn over each other by ${Math.round(o.overlap)}px ${JSON.stringify(o.worst)}`);
  if (mode === 'sidebar' && o.hole > 1.5) problems.push(`a hole of ${Math.round(o.hole)}px between rows ${JSON.stringify(o.worstHole)}`);
} finally { await app.close(); await fs.rm(root, {recursive: true, force: true}).catch(() => {}); }
console.log(problems.length ? 'PROBLEMS\n' + problems.join('\n') : 'CLEAN');
process.exit(problems.length ? 1 : 0);
