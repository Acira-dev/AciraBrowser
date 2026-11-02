// Screenshots of the anti-tracking Settings panel (light and dark).  D_VISIBLE=1 node qa/privacy-plus/settings-shot.mjs
import fs from 'node:fs/promises';
import {startApp, sleep} from '../d-harness.mjs';
const root = '.qa-profiles/j-settings-shot'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const out = '.scratch-src/out/shots'; await fs.mkdir(out, {recursive: true});
const app = await startApp({root, env: {}});
try {
  await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(2500);
  const ui = app.ui;
  const nav = ui.getByRole('button', {name: /^Privacy$/}).first();
  try { await nav.click({timeout: 5000}); } catch { try { await ui.getByText('Privacy', {exact: true}).first().click({timeout: 5000}); } catch (error) { console.error('nav click failed', error.message); } }
  await sleep(1200);
  const target = ui.getByText('Block hidden trackers').first();
  try { await target.scrollIntoViewIfNeeded({timeout: 5000}); } catch (error) { console.error('scroll failed', error.message); }
  await sleep(600);
  for (const scheme of ['light', 'dark']) {
    await app.act({type: 'settings.update', patch: {theme: scheme}}).catch(() => {});
    await ui.emulateMedia({colorScheme: scheme}); await sleep(900);
    await ui.screenshot({path: `${out}/anti-tracking-${scheme}.png`, scale: 'css'});
    console.log('saved', `${out}/anti-tracking-${scheme}.png`);
  }
  console.log('title', await ui.title(), 'has panel', await ui.getByText('Block hidden trackers').count());
} finally { await app.close(); process.exit(0); }
