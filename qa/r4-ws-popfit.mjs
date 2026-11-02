// R4-48 follow-up: do the workspace popover, the profile panel and the new-workspace sheet fit short windows? For each
// window/scale it opens each popup from its real trigger and reports the overlay viewport, the popup box, the held bounds
// and whether the content scrolls with the cue. Captures each.   node qa/r4-ws-popfit.mjs <outdir>
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const out = path.resolve(process.argv[2] || 'C:/ae/r4/workspaces/evidence/popfit'); await fs.mkdir(out, {recursive: true});
let slot = process.env.R4_SLOT_HELD ? 'held' : undefined;
for (let attempt = 0; attempt < 40 && !slot; attempt++) {
  for (const n of [1, 2, 3]) { try { const file = `C:/ae/slot-${n}.lock`; fss.writeFileSync(file, `workspaces popfit ${new Date().toISOString()}`, {flag: 'wx'}); slot = file; break; } catch {} }
  if (!slot) await sleep(30000);
}
if (!slot) throw new Error('no native slot');
const rows = [], failures = [];
let app;
try {
  const dir = '.qa-profiles/r4-ws-popfit'; await fs.rm(dir, {recursive: true, force: true});
  app = await startApp({root: dir, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
  await app.act({type: 'settings.update', patch: {verticalTabs: true}}); await sleep(600);
  for (const name of ['Work', 'Study']) await app.act({type: 'workspace.create', name});
  await sleep(600);
  const kinds = [['workspace-menu', '.sb-ws-title-main', '.ws-menu-head'], ['profile', '.sb-foot-profile', '[data-profile-workspace-new]'], ['workspace-edit', '[data-workspace-new]', '#ws-edit-name']];
  for (const theme of ['dark', 'light']) for (const c of [{w: 1280, h: 820, scale: 100}, {w: 1280, h: 820, scale: 150}, {w: 1000, h: 640, scale: 125}]) {
    await app.main(({BaseWindow}, c) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 40, y: 30, width: c.w, height: c.h}); w.show(); }, c);
    await app.act({type: 'settings.update', patch: {appearance: theme, interfaceScale: c.scale}}); await sleep(1500);
    for (const [kind, trigger, ready] of kinds) {
      await app.ui.locator(trigger).first().click();
      await poll(async () => { const o = overlay(); return o && await o.locator(ready).count().catch(() => 0); }, Boolean, kind, 6000).catch(() => {});
      await sleep(900);
      const held = (await app.ui.evaluate(() => window.acira.getBrowserLayout()))?.overlay;
      const o = overlay();
      const r = await o.evaluate(() => {
        const popup = document.querySelector('.browser-popup'); if (!popup) return null;
        const scroll = popup.querySelector('.popup-scroll') || popup, b = popup.getBoundingClientRect(), after = getComputedStyle(popup, '::after');
        return {vh: innerHeight, vw: innerWidth, top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height), scrolls: scroll.scrollHeight - scroll.clientHeight, cue: +after.opacity, overflowY: getComputedStyle(scroll).overflowY};
      }).catch(error => ({error: error.message}));
      const line = {theme, ...c, kind, ...r, held: held && {y: held.bounds.y, h: held.bounds.height, content: held.contentHeight}};
      rows.push(line); console.log(JSON.stringify(line));
      if (r && !r.error && r.bottom > r.vh + 1) failures.push(`${theme} ${c.w}x${c.h}@${c.scale} ${kind}: bottom ${r.bottom} > viewport ${r.vh}`);
      if (r && !r.error && r.scrolls > 1 && !(r.cue > .5)) failures.push(`${theme} ${c.w}x${c.h}@${c.scale} ${kind}: scrolls ${r.scrolls}px without the cue`);
      // Real pixels of the overlay view (a Playwright screenshot at 150% crops to the CSS viewport at device scale).
      try { const png = await app.main(async ({webContents}) => { const wc = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay')); return (await wc.capturePage()).toPNG().toString('base64'); }); await fs.writeFile(path.join(out, `${kind}-${theme}-${c.w}x${c.h}-${c.scale}.png`), Buffer.from(png, 'base64')); } catch (error) { console.log('capture', error.message); }
      await o.keyboard.press('Escape').catch(() => {}); await sleep(500);
    }
  }
} catch (error) {
  failures.push('run: ' + (error.stack || error).toString().split('\n').slice(0, 3).join(' | '));
} finally {
  try { await app?.close(); } catch {}
  try { if (slot !== 'held') fss.unlinkSync(slot); } catch {}
  await fs.writeFile(path.join(out, 'popfit.json'), JSON.stringify({rows, failures}, null, 1));
  console.log(failures.length ? 'FAILURES\n' + failures.join('\n') : 'all fit');
}
