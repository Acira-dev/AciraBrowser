import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startApp, poll, sleep } from './d-harness.mjs';

// Only this disposable app's isolated artwork transport is replaced. No public request is made.
const stamp = Date.now(), root = `.qa-profiles/artwork-loading-${stamp}`, out = path.resolve(`qa/artifacts/artwork-loading-${stamp}`);
await fs.mkdir(out, { recursive: true });
const checks = [], geometry = [];
let app;
try {
  app = await startApp({ root });
  const profile = (await app.state()).activeBrowserProfileId;
  await app.main(({ BaseWindow, session }, fixtures) => {
    const win = BaseWindow.getAllWindows()[0];
    globalThis.__artworkLoadingWindow = win.id;
    win.setFocusable(false); win.setIgnoreMouseEvents(true); win.setSkipTaskbar(true);
    win.setBounds({ x: -20000, y: -20000, width: 1200, height: 900 });
    if (win.getBounds().x > -2000) throw Error('Fixture window must stay offscreen');
    win.showInactive();
    if (win.isFocused()) throw Error('Fixture window stole focus');
    const bytes = process.getBuiltinModule('fs').readFileSync(fixtures.image);
    globalThis.__artworkLoading = { pending: [], calls: [], fail: false, bytes };
    session.fromPartition('acira-artwork').fetch = async url => {
      const fixture = globalThis.__artworkLoading;
      const parsed = new URL(url);
      if (parsed.hostname !== 'upload.wikimedia.org' || !/^\/acira-fixture-[0-3]\.jpg$/.test(parsed.pathname)) throw Error('Unexpected fixture request');
      fixture.calls.push(parsed.pathname);
      if (fixture.fail) return new Response('', { status: 503 });
      return new Promise(resolve => fixture.pending.push({ name: parsed.pathname, resolve }));
    };
  }, { image: path.resolve('public/artwork/catalog-v2/aic-100489.jpg') });
  const items = Array.from({ length: 4 }, (_, index) => ({
    title: `Messier 83 — fixture ${index} — ${'A very long astronomical image title '.repeat(5)}`,
    artist: `Credit: NASA, ESA, and the Hubble Heritage Team (STScI/AURA). Acknowledgement: William Blair (Johns Hopkins University). ${'Long attribution '.repeat(12)}`,
    date: '2014', license: 'Public Domain', credit: 'Wikimedia Commons', source: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg', imageUrl: `https://upload.wikimedia.org/acira-fixture-${index}.jpg`,
  }));
  const cache = path.resolve(root, 'artwork-remote');
  await fs.mkdir(cache, { recursive: true });
  for (const collection of ['landscapes', 'nature', 'space']) await fs.writeFile(path.join(cache, collection + '.json'), JSON.stringify({ fetchedAt: Date.now(), items }));
  const seedFor = index => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const seed = `fixture-${index}-${attempt}`;
      if (parseInt(createHash('sha256').update(profile + 'fixed|' + seed).digest('hex').slice(0, 8), 16) % 4 === index) return seed;
    }
    throw Error('No fixture seed');
  };
  const choose = async (index, collection = 'space') => app.ui.evaluate(({ profile, seed, collection }) => {
    const key = 'acira-new-tab:' + profile, prefs = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...prefs, collection, collectionSeed: seed, collectionExcludeId: '', daily: false, hourly: false, perTab: false }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, { profile, seed: seedFor(index), collection });
  const current = () => app.ui.locator('.nt-art img[data-current]');
  const trigger = () => app.ui.getByRole('button', { name: 'Collection', exact: true });
  const menu = () => app.ui.getByRole('menu', { name: 'Collection', exact: true });
  const shot = async name => {
    const bytes = await app.main(async ({ webContents }) => (await webContents.getAllWebContents().find(item => item.getURL() === 'acira-browser-ui://ui/index.html').capturePage()).toPNG().toString('base64'));
    await fs.writeFile(path.join(out, name + '.png'), Buffer.from(bytes, 'base64'));
  };
  const release = index => app.main((_electron, index) => {
    const fixture = globalThis.__artworkLoading, name = `/acira-fixture-${index}.jpg`;
    const at = fixture.pending.findIndex(entry => entry.name === name);
    if (at < 0) throw Error('Missing held request ' + name);
    fixture.pending.splice(at, 1)[0].resolve(new Response(fixture.bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
  }, index);
  const pending = index => poll(() => app.main((_electron, index) => globalThis.__artworkLoading.pending.some(entry => entry.name === `/acira-fixture-${index}.jpg`), index), Boolean, 'held picture ' + index);
  await app.ui.locator('.nt-art[data-state=ready]').waitFor();
  const original = await current().getAttribute('src');
  await choose(0); await pending(0);
  await app.ui.locator('.nt-art-controls [data-loading]').waitFor();
  assert.equal(await current().getAttribute('src'), original);
  await release(0);
  await poll(() => current().getAttribute('src'), value => value !== original, 'decoded first fixture');
  checks.push('Immediate dot-matrix activity retains the last ready picture until its replacement decodes');
  for (const appearance of ['light', 'dark']) for (const scale of [100, 150]) for (const narrow of [false, true]) {
    await app.act({ type: 'settings.update', patch: { appearance, interfaceScale: scale } });
    await app.main(({ BaseWindow }, narrow) => BaseWindow.fromId(globalThis.__artworkLoadingWindow).setSize(narrow ? 900 : 1200, narrow ? 650 : 900), narrow);
    await sleep(200);
    const bounds = await app.ui.locator('.nt-credit').evaluate(node => {
      const controls = node.querySelector('.nt-art-controls').getBoundingClientRect(), credit = node.getBoundingClientRect(), text = node.querySelector('.nt-credit-text').getBoundingClientRect(), scroll = document.querySelector('.nt-scroll');
      return { width: innerWidth, height: innerHeight, controls: { left: controls.left, right: controls.right, top: controls.top, bottom: controls.bottom }, credit: { left: credit.left, right: credit.right, top: credit.top, bottom: credit.bottom }, textHeight: text.height, pageOverflow: scroll.scrollHeight - scroll.clientHeight, horizontalOverflow: scroll.scrollWidth - scroll.clientWidth };
    });
    assert.ok(bounds.controls.left >= bounds.credit.left - 1 && bounds.controls.right <= bounds.credit.right + 1 && bounds.controls.bottom <= bounds.height + 1, JSON.stringify(bounds));
    assert.ok(bounds.textHeight <= 34 && bounds.pageOverflow <= 1 && bounds.horizontalOverflow <= 1, JSON.stringify(bounds));
    geometry.push({ appearance, scale, narrow, ...bounds });
  }
  checks.push('Long space title and author remain bounded, with controls visible and no page overflow in both themes, widths and scales');
  await app.ui.locator('.nt-credit-text').focus();
  const tooltip = app.ui.getByRole('tooltip'); await tooltip.waitFor();
  assert.ok((await tooltip.innerText()).includes(items[0].artist));
  await app.ui.keyboard.press('Escape');
  checks.push('Keyboard focus exposes the complete attribution and Escape dismisses it');
  await app.act({ type: 'settings.update', patch: { interfaceScale: 100, appearance: 'dark', reducedMotion: false } });
  await app.main(({ BaseWindow }) => BaseWindow.fromId(globalThis.__artworkLoadingWindow).setSize(1200, 900));
  await trigger().click(); await menu().waitFor();
  const morph = await menu().evaluate(node => {
    const plane = node.querySelector('.nt-artwork-material'), animation = plane.getAnimations()[0];
    if (!animation) throw Error('Missing material handoff');
    const frames = animation.effect.getKeyframes(), duration = animation.effect.getTiming().duration;
    return { duration, first: frames[0].transform, last: frames.at(-1).transform };
  });
  assert.ok(morph.duration >= 200 && /translate\(.+scale\(/.test(morph.first) && morph.last === 'none', JSON.stringify(morph));
  geometry.push({ materialMorph: morph });
  await sleep(300); await shot('collection-open');
  await app.ui.keyboard.press('Escape');
  await poll(() => trigger().getAttribute('aria-expanded'), value => value === 'false', 'collection closes');
  await sleep(200);
  assert.equal(await trigger().evaluate(node => node === document.activeElement), true);
  await trigger().click(); await menu().waitFor();
  await app.ui.keyboard.press('Escape');
  await trigger().click(); await menu().waitFor();
  await app.ui.keyboard.press('Escape'); await sleep(200);
  checks.push('Collection material expands from the measured trigger rectangle, reverses on dismissal and supports interrupted reopen');
  await choose(1, 'nature'); await pending(1); await choose(2, 'space'); await pending(2);
  await release(2);
  await poll(() => app.ui.locator('.nt-credit-title').innerText(), title => title === items[2].title, 'latest picture wins');
  const newest = await current().getAttribute('src');
  await release(1); await sleep(200);
  assert.equal(await current().getAttribute('src'), newest);
  assert.equal(await app.ui.locator('.nt-credit-title').innerText(), items[2].title);
  checks.push('Rapid collection changes retain the last good picture; an older held genre response cannot replace the newer decoded image or caption');
  // A one-item source makes failure deterministic: the service cannot recover via another already cached candidate.
  await fs.writeFile(path.join(cache, 'space.json'), JSON.stringify({ fetchedAt: Date.now(), items: [items[3]] }));
  await app.main(() => { globalThis.__artworkLoading.fail = true; });
  await choose(3, 'space');
  const retry = app.ui.getByRole('button', { name: 'Retry', exact: true }); await retry.waitFor();
  assert.equal(await current().getAttribute('src'), newest);
  await app.main(() => { globalThis.__artworkLoading.fail = false; });
  await retry.click(); await pending(3); await release(3);
  await poll(() => app.ui.locator('.nt-credit-title').innerText(), title => title === items[3].title, 'retry retains requested choice');
  checks.push('A failed request keeps the last good picture; Retry requests the same collection and manual seed');
  await app.act({ type: 'settings.update', patch: { interfaceScale: 100, appearance: 'dark' } });
  await app.main(({ BaseWindow }) => BaseWindow.fromId(globalThis.__artworkLoadingWindow).setSize(1200, 900));
  await sleep(250);
  await shot('long-caption');
  await app.ui.evaluate(profile => {
    const key = 'acira-new-tab:' + profile, prefs = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...prefs, artStyle: 'full' }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, profile);
  await app.ui.locator('.nt-full-art-controls').waitFor();
  await trigger().click(); await menu().waitFor(); await sleep(300); await shot('full-collection-open');
  await app.ui.keyboard.press('Escape'); await sleep(200);
  for (const appearance of ['light', 'dark']) for (const scale of [100, 150]) for (const narrow of [false, true]) {
    await app.act({ type: 'settings.update', patch: { appearance, interfaceScale: scale, reducedTransparency: scale === 150 } });
    await app.main(({ BaseWindow }, narrow) => BaseWindow.fromId(globalThis.__artworkLoadingWindow).setSize(narrow ? 900 : 1200, narrow ? 650 : 900), narrow);
    await sleep(180);
    const bounds = await app.ui.locator('.nt-full-art-controls').evaluate(node => { const rect = node.getBoundingClientRect(), scroll = document.querySelector('.nt-scroll'); return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, pageOverflow: scroll ? scroll.scrollHeight - scroll.clientHeight : 0, horizontalOverflow: scroll ? scroll.scrollWidth - scroll.clientWidth : 0 }; });
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height && bounds.pageOverflow <= 1 && bounds.horizontalOverflow <= 1, JSON.stringify(bounds));
    geometry.push({ full: true, appearance, scale, narrow, ...bounds });
    if (appearance === 'light' && scale === 150 && narrow) await shot('full-light-150-opaque');
  }
  checks.push('Full-background controls use the same connected menu and remain inside both widths/themes/scales, including opaque glass');
  console.log(JSON.stringify({ ok: true, checks, out }));
} finally {
  await app?.close();
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ checks, geometry }, null, 2));
}
