import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, sleep, poll } from './d-harness.mjs';

const stamp = Date.now(), root = `.qa-profiles/artwork-controls-${stamp}`, out = path.resolve(`qa/artifacts/artwork-controls-${stamp}`);
await fs.mkdir(out, { recursive: true });
let app = await startApp({ root });
const checks = [], geometry = [];
const trigger = () => app.ui.getByRole('button', { name: 'Collection', exact: true });
const menu = () => app.ui.getByRole('menu', { name: 'Collection', exact: true });
const preferences = () => app.ui.evaluate(async () => JSON.parse(localStorage.getItem('acira-new-tab:' + (await window.acira.getSnapshot()).activeBrowserProfileId) || '{}'));
const showFixtureWindow = () => app.main(({ BaseWindow }) => {
  const win = BaseWindow.getAllWindows()[0]; globalThis.__artworkControlsWindow = win.id;
  win.setFocusable(false); win.setIgnoreMouseEvents(true); win.setSkipTaskbar(true);
  win.setBounds({ x: -20000, y: -20000, width: 1200, height: 900 });
  if (win.getBounds().x > -2000) throw Error('Fixture window must remain offscreen');
  win.showInactive();
  if (win.isFocused()) throw Error('Fixture window stole focus');
});
const shot = async name => {
  await app.ui.locator('.nt-art[data-state=ready]').waitFor();
  await menu().evaluate(async node => {
    await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await sleep(100); // capturePage must receive the compositor frame after the popover settles.
  const data = await app.main(async ({ webContents }) => (await webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html').capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(data, 'base64'));
};
try {
  await showFixtureWindow();
  const profile = (await app.state()).activeBrowserProfileId;
  for (const excludeId of ['nature:short', 'space:0123456789ab', 'nature:' + 'a'.repeat(200), 'nature:0123456789ab\n', {}]) {
    await assert.rejects(() => app.svc({ type: 'artwork.remote', collection: 'nature', seed: 'invalid-exclusion', excludeId }), /collection is not available/);
  }
  checks.push('Native service rejects malformed, oversized and foreign-collection exclusion IDs');
  await app.ui.locator('.nt-art[data-state=ready]').waitFor();
  const before = await app.ui.locator('.nt-art img[data-current]').getAttribute('src');
  await app.ui.getByRole('button', { name: 'Another painting', exact: true }).click();
  await poll(() => app.ui.locator('.nt-art img[data-current]').getAttribute('src'), value => value !== before, 'next built-in painting');
  checks.push('Another painting displays a different built-in image');
  for (const appearance of ['light', 'dark']) for (const scale of [100, 150]) {
    await app.act({ type: 'settings.update', patch: { appearance, interfaceScale: scale, reducedMotion: scale === 150 } });
    await app.main(({ BaseWindow }, scale) => BaseWindow.fromId(globalThis.__artworkControlsWindow).setSize(scale === 150 ? 900 : 1200, scale === 150 ? 650 : 900), scale);
    await sleep(450);
    await trigger().click(); await menu().waitFor();
    assert.equal(await menu().getByRole('menuitemradio').count(), 6);
    const bounds = await menu().evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, overflow: n.scrollWidth - n.clientWidth }; });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= bounds.viewportWidth + 1 && bounds.bottom <= bounds.viewportHeight + 1 && bounds.overflow <= 1, JSON.stringify(bounds));
    geometry.push({ appearance, scale, ...bounds });
    if (appearance === 'light' && scale === 100 || appearance === 'dark' && scale === 150) await shot(`${appearance}-${scale}-collection`);
    await app.ui.keyboard.press('Escape');
    await poll(() => app.ui.locator('.nt-artwork-menu').evaluate(n => n.matches(':popover-open')), value => !value, 'Escape closes collection');
    assert.equal(await trigger().evaluate(n => n === document.activeElement), true);
    await trigger().click(); await menu().waitFor();
    await app.ui.keyboard.press('End'); assert.equal(await menu().getByRole('menuitem').evaluate(n => n === document.activeElement), true);
    await app.ui.keyboard.press('Home'); assert.equal(await menu().getByRole('menuitemradio').first().evaluate(n => n === document.activeElement), true);
    await app.ui.keyboard.press('Escape');
  }
  checks.push('Six collection choices, Escape/reopen, keyboard navigation and bounds pass in both themes at 100/150%');
  await app.act({ type: 'settings.update', patch: { interfaceScale: 100, appearance: 'dark' } });
  await trigger().click(); await menu().waitFor();
  await app.ui.locator('.nt-search input').click();
  await poll(() => app.ui.locator('.nt-artwork-menu').evaluate(n => n.matches(':popover-open')), value => !value, 'outside click closes collection');
  checks.push('Clicking outside dismisses the collection menu');
  // Import a qualified bundled painting through the real personal-image service, with only the native chooser stubbed.
  await app.main(({ dialog }, file) => {
    globalThis.__artworkControlsChooser = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, path.resolve('public/artwork/catalog-v2/aic-100489.jpg'));
  let imported;
  try { imported = await app.svc({ type: 'artwork.import' }); }
  finally { await app.main(({ dialog }) => { dialog.showOpenDialog = globalThis.__artworkControlsChooser; delete globalThis.__artworkControlsChooser; }); }
  assert.ok(imported.artwork?.addedId);
  await app.ui.evaluate(({ profile, id }) => {
    const key = 'acira-new-tab:' + profile, prefs = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...prefs, artwork: 'personal:' + id, daily: false, perTab: false, hourly: false }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, { profile, id: imported.artwork.addedId });
  await poll(() => app.ui.locator('.nt-art img[data-current]').getAttribute('src'), src => src?.includes('/personal-artwork/'), 'personal image displayed');
  await trigger().click(); await menu().getByRole('menuitemradio', { name: 'Nature (Wikimedia Commons)', exact: true }).click();
  await poll(preferences, prefs => prefs.collection === 'nature' && !prefs.artwork.startsWith('personal:'), 'collection replaces personal override');
  const firstPhoto = await poll(() => app.ui.locator('.nt-art img[data-current]').getAttribute('src'), src => src?.includes('/artwork-remote/'), 'real collection photograph', 30000);
  const chosen = await preferences();
  // "Another image" belongs to the tab where it was pressed (src/ui/tabArtwork.ts): this tab shows a different photograph, the profile's choices
  // (collection, seed, exclusion) do not change, a second tab keeps the profile's picture, and the pick is in memory only (a reload follows the profile again).
  await app.ui.getByRole('button', { name: 'Another image', exact: true }).click();
  const nextPhoto = await poll(() => app.ui.locator('.nt-art img[data-current]').getAttribute('src'), src => src?.includes('/artwork-remote/') && src !== firstPhoto, 'different remote photograph', 30000);
  const after = await preferences();
  assert.equal(after.collectionSeed, chosen.collectionSeed, 'Another image does not change the profile seed'); assert.equal(after.collectionExcludeId, chosen.collectionExcludeId); assert.equal(after.collection, 'nature');
  await app.act({ type: 'tab.new', url: 'acira://new' });
  await poll(() => app.ui.locator('.nt-art img[data-current]').getAttribute('src'), src => src === firstPhoto, 'a second tab keeps the profile photograph', 30000);
  await app.ui.reload(); await trigger().waitFor();
  assert.equal((await preferences()).collectionSeed, chosen.collectionSeed); assert.equal((await preferences()).collection, 'nature');
  await poll(() => app.ui.locator('.nt-art img[data-current]').getAttribute('src'), src => src === firstPhoto, 'the tab follows the profile again after a reload', 30000);
  await app.close(); app = await startApp({ root });
  await showFixtureWindow();
  await trigger().waitFor();
  assert.equal((await preferences()).collectionSeed, chosen.collectionSeed);
  assert.equal((await preferences()).collection, 'nature');
  await poll(() => app.ui.locator('.nt-art img[data-current]').getAttribute('src'), src => src === firstPhoto, 'the same profile photograph after full restart', 30000);
  checks.push('Choosing a collection replaces an imported personal-image override');
  checks.push('Another image changes only its own tab (a second tab and the profile keep theirs); the collection survives reload and full browser restart');
  // Full background exposes the same controls, independently of caption/name visibility.
  await app.ui.evaluate(profile => { const key = 'acira-new-tab:' + profile, prefs = JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify({ ...prefs, collection: 'built-in', artStyle: 'full', caption: false, modules: { ...prefs.modules, name: false, mark: false } })); window.dispatchEvent(new StorageEvent('storage', { key })); }, profile);
  await app.ui.locator('.nt-full-art-controls').waitFor();
  await trigger().click(); await menu().waitFor(); await shot('full-background-collection');
  await menu().getByRole('menuitem', { name: 'Customize…', exact: true }).click();
  await app.ui.locator('[data-setting="newtab-collection"]').waitFor();
  assert.match(await app.ui.locator('.bs-main').innerText(), /Collection/);
  checks.push('Full-background controls remain reachable and Customize opens New Tab artwork settings');
  console.log(JSON.stringify({ ok: true, checks, geometry, out }, null, 2));
} finally {
  await app.close();
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ checks, geometry }, null, 2));
}
