// Stream N: every Tor state on the Tor page and in the chip panel, light/dark at 100% and 150%: nothing may be clipped or overflow.
// One instance, closed in finally. States are injected through the 'acira-tor-preview' window event (src/features/tor/torClient.ts).
// D_VISIBLE=1 node qa/n-tor-states.mjs → prints one line per failing element; worst cases saved to qa/artifacts/n-tor/states-*.png
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const out = path.resolve('qa/artifacts/n-tor'); await fs.mkdir(out, {recursive: true});
const base = {version: '0.4.9.14', firstConnection: true, error: null};
const long = 'Your network may block Tor. Check your connection and try again. Bridges, for networks that block Tor, are coming in a later version.';
const STATES = {
  'connecting-5': {...base, state: 'connecting', progress: 5, phase: 'Connecting to the Tor network'},
  'connecting-30': {...base, state: 'connecting', progress: 30, phase: 'Connecting to the Tor network'},
  'connecting-50': {...base, state: 'connecting', progress: 50, phase: 'Loading the network directory'},
  'connecting-90': {...base, state: 'connecting', progress: 90, phase: 'Building a private circuit'},
  'starting': {...base, state: 'starting', progress: 0, phase: 'Downloading Tor, one time', firstConnection: false},
  'ready': {...base, state: 'ready', progress: 100, phase: 'Connected', firstConnection: false},
  'error-unreachable': {...base, state: 'error', progress: 50, phase: 'Can’t reach the Tor network', error: {code: 'unreachable', title: 'Can’t reach the Tor network', detail: long}},
  'error-clock': {...base, state: 'error', progress: 10, phase: 'Your clock is wrong', error: {code: 'clock', title: 'Your clock is wrong', detail: 'Tor can’t connect while the date or time is off. Turn on “Set time automatically” in Windows Settings, then try again.'}},
  'error-missing': {...base, state: 'error', progress: 0, phase: 'Tor is missing from this install', error: {code: 'missing', title: 'Tor is missing from this install', detail: 'This development build couldn’t download it. Run node scripts/fetch-tor.mjs in the project folder, then try again.'}},
};
const MEASURE = () => {
  const bad = [];
  for (const root of document.querySelectorAll('.tor-panel, .tor-popover')) {
    const box = root.getBoundingClientRect();
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const style = getComputedStyle(el), label = (el.className && String(el.className).slice(0, 40)) || el.tagName;
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5) bad.push(`outside the panel: ${label} (${Math.round(r.right - box.right)}px)`);
      if (el.scrollWidth > el.clientWidth + 1 && style.overflow !== 'visible' && el.clientWidth) bad.push(`clipped sideways: ${label} "${(el.textContent || '').slice(0, 30)}" ${el.scrollWidth}>${el.clientWidth}`);
      if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) bad.push(`ellipsis in use: ${label} "${(el.textContent || '').slice(0, 30)}"`);
    }
    const parent = root.parentElement;
    if (parent && root.scrollHeight > parent.clientHeight + 1 && getComputedStyle(parent).overflow !== 'visible') bad.push(`cut off at the bottom: ${root.scrollHeight}>${parent.clientHeight}`);
  }
  return bad;
};
await fs.rm(path.resolve('.qa-profiles/n-tor-states'), {recursive: true, force: true}); // fresh: the vault switch is remembered, and the script turns it on through the page
const app = await startApp({root: path.resolve('.qa-profiles/n-tor-states'), env: {ACIRA_PASSWORDS_TEST_GATE: 'allow'}});
const problems = [];
try {
  await app.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) w.minimize(); });
  const before = new Set(app.context.pages());
  await app.ui.evaluate(() => window.acira.openWindow('tor'));
  const tor = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'tor ui', 30000);
  await poll(() => tor.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'acira', 30000);
  await app.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) if (w.getTitle().includes('Tor')) { w.setBounds({x: 40, y: 40, width: 1500, height: 1000}); w.show(); w.focus(); } });
  await sleep(800);
  if (process.env.STATES_LANG) { await tor.evaluate(l => window.acira.dispatch({type: 'settings.update', patch: {language: l}}), process.env.STATES_LANG); await sleep(4000); console.log('language', process.env.STATES_LANG); }
  // Vault on, one bookmark saved and the list open, so the Tor vault rows are measured too (a long title on purpose).
  // Language-independent: by role and position, not by the English label.
  const press = what => tor.evaluate(w => { const q = document.querySelector.bind(document); ({keep: () => q('.tor-panel [role=menuitemcheckbox]'), on: () => q('.tor-panel .tor-pop-note[role=note] + button'), list: () => q('.tor-panel [aria-expanded]')})[w]()?.click(); }, what);
  console.log('enabling the vault through the page'); await sleep(2000); await press('keep'); await sleep(700); await press('on'); await sleep(2500); // through the page, like a person
  await tor.evaluate(() => window.acira.dispatch({type: 'tab.new', url: 'https://example.org/a-rather-long-address/with/segments/that/keeps/going/and/going?query=value'}));
  await sleep(1200);
  await tor.evaluate(() => window.acira.native({type: 'tor.vault-bookmark'}));
  const extra = (await tor.evaluate(() => window.acira.getSnapshot())).tabs.find(t => t.url.includes('example.org')); if (extra) await tor.evaluate(id => window.acira.dispatch({type: 'tab.close', id}), extra.id); await sleep(600);
  console.log('vault on, bookmark saved'); await press('list'); await sleep(800);
  const overlayPages = () => app.context.pages().filter(p => { try { return p.url().includes('overlay'); } catch { return false; } });
  const shot = async name => {
    const png = await app.main(async ({BaseWindow, desktopCapturer}) => {
      const w = BaseWindow.getAllWindows().find(x => x.getTitle().includes('Tor')), b = w.getBounds();
      const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: b.width, height: b.height}});
      const s = sources.find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : '';
    });
    if (png) await fs.writeFile(path.join(out, name + '.png'), Buffer.from(png, 'base64'));
  };
  let checks = 0, measured = 0;
  const combos = process.env.STATES_QUICK ? [['light', 150]] : [['light', 100], ['dark', 150], ['light', 150], ['dark', 100]];
  for (const [appearance, scale] of combos) {
    await tor.evaluate(patch => window.acira.dispatch({type: 'settings.update', patch}), {appearance, interfaceScale: scale}); await sleep(1500);
    for (const [name, status] of Object.entries(STATES)) {
      await tor.evaluate(s => window.dispatchEvent(new CustomEvent('acira-tor-preview', {detail: s})), status); await sleep(250);
      for (const line of await tor.evaluate(MEASURE)) problems.push(`${appearance} ${scale}% page ${name}: ${line}`);
      checks++;
      if (['connecting-50', 'error-unreachable'].includes(name) && scale === 150) await shot(`states-page-${name}-${appearance}-150`);
      // Open the panel (at most 3 tries; the chip toggles it), then wait for its content.
      let panel = null;
      for (let attempt = 0; attempt < 3 && !panel; attempt++) {
        await tor.evaluate(() => document.querySelector('.tor-chip')?.click()); await sleep(1100);
        for (const p of overlayPages()) { try { if (await p.evaluate(() => Boolean(document.querySelector('.tor-popover')))) panel = p; } catch {} }
        if (!panel) { await tor.keyboard.press('Escape'); await sleep(500); }
      }
      if (!panel && !globalThis.__dumped) { globalThis.__dumped = true; for (const p of app.context.pages()) { let info = ''; try { info = await p.evaluate(() => `${document.querySelectorAll('.browser-popup').length} popups, ${document.querySelectorAll('.tor-popover').length} tor, scale ${devicePixelRatio}`); } catch (e) { info = 'n/a'; } console.log('page', p.url().slice(0, 60), info); } const chip = await tor.evaluate(() => { const r = document.querySelector('.tor-chip')?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height].map(Math.round) : null; }); console.log('chip rect', JSON.stringify(chip)); }
      if (!panel) problems.push(`${appearance} ${scale}% panel ${name}: could not open the chip panel`);
      for (const p of panel ? [panel] : []) {
        try {
          await p.evaluate(s => window.dispatchEvent(new CustomEvent('acira-tor-preview', {detail: s})), status); await sleep(300);
          const seen = await p.evaluate(() => document.querySelectorAll('.tor-popover').length); measured += seen;
          for (const line of await p.evaluate(MEASURE)) problems.push(`${appearance} ${scale}% panel ${name}: ${line}`);
        } catch {}
      }
      if (['connecting-50', 'error-unreachable'].includes(name) && scale === 150) await shot(`states-panel-${name}-${appearance}-150`);
      await tor.keyboard.press('Escape'); await sleep(450); checks++;
    }
  }
  const vaultRows = await tor.evaluate(() => document.querySelectorAll('.tor-bm').length); console.log(`vault bookmark rows on the page: ${vaultRows}`); if (!vaultRows) problems.push('the vault rows were not on the page, so they were not measured');
  console.log(`${checks} checks, ${measured} panel measurements`); if (!measured) problems.push('the chip panel never opened, so it was not measured');
  console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'PASS: nothing clipped or overflowing in any state');
  if (problems.length) process.exitCode = 1;
} finally { await app.close().catch(() => {}); }
