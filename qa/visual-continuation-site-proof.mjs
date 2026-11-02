// Focused native pass for an already leased, disposable d-harness session.
// No app launch or connection occurs on import. A local fixture and native pixel
// capture callback are supplied by the lease holder. Results still need review.
import assert from 'node:assert/strict';
import path from 'node:path';
import {inspectDisclosureLayout} from './visual-continuation-inspect.mjs';
import {poll, sleep} from './d-harness.mjs';

export async function proveSiteDisclosures(h, {fixtureUrl, capture, record}) {
  const qaRoot = path.resolve('.qa-profiles') + path.sep;
  assert.ok(h.root && path.resolve(h.root).startsWith(qaRoot), 'Use a disposable QA profile');
  const url = new URL(fixtureUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Use a local synthetic fixture');
  assert.equal(typeof capture, 'function', 'Native pixel capture callback required');
  assert.equal(typeof record, 'function', 'Incremental evidence recorder required');
  assert.ok((await h.state()).tabs.length < 29, 'Stay below the 30-tab limit');
  await h.act({type: 'tab.new', url: fixtureUrl});
  const tabId = (await h.state()).activeTabId;
  await poll(() => h.state(), s => s.tabs.find(t => t.id === tabId)?.loading === false, 'local fixture loaded');
  const cases = [];
  const dismiss = async () => {
    const layout = await h.ui.evaluate(() => window.acira.getBrowserLayout());
    if (layout?.overlay) await h.ui.evaluate(id => window.acira.closeOverlay(id), layout.overlay.id);
    await sleep(180);
  };
  try {
    for (const scale of [100, 150]) for (const theme of ['light', 'dark']) {
      await dismiss();
      await h.act({type: 'settings.update', patch: {appearance: theme, interfaceScale: scale, language: 'en'}});
      await sleep(400);
      await h.ui.getByRole('button', {name: 'Page information', exact: true}).click();
      const overlay = await poll(async () => {
        for (const p of h.context.pages()) {
          if (p.url().includes('view=overlay') && await p.locator('.site-content-filters').count()) return p;
        }
      }, Boolean, 'current site-information overlay', 7000);
      const filters = overlay.locator('.site-content-filters');
      await filters.locator(':scope > summary').click();
      await filters.locator('.content-filter-controls h3').scrollIntoViewIfNeeded();
      await sleep(350);
      const inspection = await inspectDisclosureLayout(overlay);
      const selected = inspection.openDisclosures.find(d => d.title === 'Content filters');
      assert.ok(selected, 'Expanded Content filters is visible');
      assert.equal(selected.dividers.length, 0, 'Expanded filters must not paint a duplicate divider');
      assert.equal(selected.intersections.length, 0, 'No filter text intersects a divider');
      const label = `${scale}-${theme}`;
      const entry = {label, scaleMeaning: 'Acira interfaceScale preference', filters: inspection, screenshots: [await capture(`${label}-filters-expanded`)]};
      await filters.locator('input[type=checkbox]').last().scrollIntoViewIfNeeded();
      await filters.locator('input[type=checkbox]').last().hover();
      await sleep(160);
      entry.screenshots.push(await capture(`${label}-filters-bottom-hover`));
      await filters.locator(':scope > summary').click();
      const data = overlay.locator('.site-data-disclosure');
      await data.locator(':scope > summary').click();
      const nested = data.locator('.acira-nested').first();
      await nested.locator(':scope > summary').click();
      await nested.locator('input[type=checkbox]').first().focus();
      await sleep(200);
      entry.peers = await inspectDisclosureLayout(overlay);
      entry.screenshots.push(await capture(`${label}-site-data-expanded-focus`));
      cases.push(entry);
      await record(entry);
    }
  } finally {
    await dismiss().catch(() => {});
  }
  return cases;
}
