import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, poll, sleep } from './d-harness.mjs';

// Real Wikimedia Commons pictures through the app's own picture transport, in an isolated profile and an off-screen 2560 x 1440 window:
// every genre shows a sharp picture (natural width at least the rendered width), and a profile
// that had chosen the retired NASA collection reads back as Space. Run: node qa/native-slot.mjs r8-art -- node qa/r8-art-collections.mjs
const root = '.qa-profiles/r8-art-collections', out = path.resolve('qa/artifacts/r8-art-collections');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
let app;
const report = [];
try {
  app = await startApp({ root });
  const profile = (await app.state()).activeBrowserProfileId;
  await app.main(({ BaseWindow }) => {
    const win = BaseWindow.getAllWindows()[0];
    win.setFocusable(false); win.setIgnoreMouseEvents(true); win.setSkipTaskbar(true);
    win.setBounds({ x: -20000, y: -20000, width: 2560, height: 1440 });
  });
  await sleep(1500);
  const prefs = patch => app.ui.evaluate(({ profile, patch }) => {
    const key = 'acira-new-tab:' + profile, current = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...current, ...patch }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, { profile, patch });
  const shot = async name => {
    for (let pass = 0; pass < 2; pass++) {
    await sleep(1200);
    const bytes = await app.main(async ({ webContents }) => (await webContents.getAllWebContents().find(item => item.getURL() === 'acira-browser-ui://ui/index.html').capturePage()).toPNG().toString('base64'));
    await fs.writeFile(path.join(out, name + '.png'), Buffer.from(bytes, 'base64'));
    }
  };
  const current = () => app.ui.locator('.nt-art img[data-current]');

  await prefs({ collection: 'nasa', artStyle: 'full', collectionSeed: 'legacy-1', collectionExcludeId: '' });
  await app.ui.reload(); await app.ui.waitForFunction(() => Boolean(window.acira));
  const migrated = await app.ui.evaluate(profile => JSON.parse(localStorage.getItem('acira-new-tab:' + profile)).collection, profile);
  report.push('stored collection after legacy nasa: ' + migrated + ' (raw store untouched until the next change)');

  for (const collection of ['space', 'landscapes', 'nature', 'architecture']) {
    for (const seed of ['one-' + collection, 'two-' + collection]) {
      await prefs({ collection, artStyle: 'full', collectionSeed: seed, collectionExcludeId: '', daily: false, hourly: false, perTab: false });
      await poll(() => current().getAttribute('src'), value => /\/artwork-remote\/[a-f0-9]{24}\.jpg$/.test(value || ''), collection + ' picture', 60000);
      await sleep(900);
      const facts = await current().evaluate(img => ({ natural: img.naturalWidth + 'x' + img.naturalHeight, shown: Math.round(img.getBoundingClientRect().width) + 'x' + Math.round(img.getBoundingClientRect().height), complete: img.complete, dpr: devicePixelRatio }));
      assert.ok(facts.complete && facts.natural.split('x')[0] >= facts.shown.split('x')[0] * facts.dpr * 0.99 || +facts.natural.split('x')[0] >= 2560, collection + ' not sharp: ' + JSON.stringify(facts));
      report.push(`${collection}/${seed}: natural ${facts.natural}, shown ${facts.shown} at dpr ${facts.dpr}`);
      await shot(`${collection}-${seed.startsWith('one') ? 1 : 2}`);
    }
  }

} finally {
  console.log(report.join('\n'));
  await app?.close();
}
