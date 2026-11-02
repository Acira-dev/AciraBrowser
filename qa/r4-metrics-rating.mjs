// R4-60/61 native check: the feature-rating card never appears during setup or in a profile's first session, appears once the rules pass
// (seeded history, ACIRA_RATING_QUIET_MS=0 under test data only), answers with a thanks state, and "What's sent" lists every group.
// Captures light + dark at 100% and 150% into C:\ae\r4\metrics\evidence. One app at a time, one native slot, every app closed in finally.
// Run after `npm run build`:  node qa/r4-metrics-rating.mjs
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
import { nativePage } from './native-helpers.mjs';

const require = createRequire(import.meta.url);
const { BrowserDatabase } = require('../desktop/database.cjs'), { createInitialState } = require('../desktop/runtime.cjs');
const out = 'C:\\ae\\r4\\metrics\\evidence', stamp = Date.now(), report = { checks: [] };
await fs.mkdir(out, { recursive: true });
const day = (ago) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function profile(name, { onboarding = true, rating = null }) {
  const data = path.resolve(`.qa-profiles/r4m-${name}-${stamp}`);
  await fs.mkdir(data, { recursive: true });
  const db = new BrowserDatabase(path.join(data, 'browser.sqlite')), seed = createInitialState();
  seed.settings.onboardingComplete = onboarding; seed.settings.appearance = 'light';
  db.saveWindow('main', seed); db.close();
  await fs.writeFile(path.join(data, 'metrics.json'), JSON.stringify({ choice: 'on', installId: randomUUID(), lastSent: '', uses: {}, importSource: 'none', rating, askRatings: true }));
  return data;
}

async function slot() {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const n of [1, 2, 3]) { const file = `C:\\ae\\slot-${n}.lock`; try { const fd = fsSync.openSync(file, 'wx'); fsSync.writeSync(fd, `metrics r4 ${new Date().toISOString()}`); fsSync.closeSync(fd); return file; } catch {} }
    await wait(30000);
  }
  throw Error('No native slot within 20 minutes.');
}

async function run(name, data, { scale = 1 } = {}, body) {
  const lock = await slot(); let app;
  try {
    const args = [...(scale !== 1 ? [`--force-device-scale-factor=${scale}`] : []), path.resolve('desktop/main.cjs')];
    app = await launchPreparedNative({ args, env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_RATING_QUIET_MS: '0', ACIRA_METRICS_ENDPOINT: '' } });
    const ui = await nativePage(app, 'acira-browser-ui://ui/index.html');
    ui.setDefaultTimeout(10000);
    await ui.waitForFunction(() => Boolean(window.acira));
    await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setFocusable(false); w.setBounds({ x: 40, y: 40, width: 1280, height: 820 }); w.showInactive(); });
    await wait(1500);
    await body(ui, app);
  } finally { await app?.close().catch(() => {}); try { fsSync.unlinkSync(lock); } catch {} }
}

const ask = async (ui) => { await ui.evaluate(() => { document.activeElement?.blur?.(); window.dispatchEvent(new Event('acira:rating-check')); }); await wait(2500); return ui.locator('[data-rating-card]').count(); };
const theme = async (ui, appearance) => { await ui.evaluate((value) => window.acira.dispatch({ type: 'settings.update', patch: { appearance: value } }), appearance); await wait(700); };
const eligible = { since: day(3), sessions: 1, counts: { splitView: 6 }, dismissed: {}, answered: [], lastAsk: '' };

try {
  // 1. During setup: even a fully eligible history never shows the card.
  await run('setup', await profile('setup', { onboarding: false, rating: eligible }), {}, async (ui) => {
    assert.equal(await ask(ui), 0, 'no card during setup');
    report.checks.push('no card during setup (eligible history, setup visible)');
  });
  // 2. A fresh profile's first session: never.
  await run('first', await profile('first', { rating: null }), {}, async (ui) => {
    assert.equal(await ask(ui), 0, 'no card in the first session');
    report.checks.push('no card in a fresh profile\'s first session');
  });
  // 3 + 4. Eligible: the card at 100% and 150%, light and dark; thanks state; What's sent in Settings.
  for (const scale of [1, 1.5]) {
    await run('card' + scale, await profile('card' + String(scale).replace('.', ''), { rating: eligible }), { scale }, async (ui) => {
      assert.equal(await ask(ui), 1, 'card appears once the rules pass');
      const card = ui.locator('[data-rating-card]');
      assert.match(await card.innerText(), /Split view/);
      const tag = scale === 1 ? '100' : '150';
      await ui.screenshot({ path: path.join(out, `rating-card-light-${tag}.png`) });
      await card.screenshot({ path: path.join(out, `rating-card-light-${tag}-crop.png`) });
      await theme(ui, 'dark');
      await ui.screenshot({ path: path.join(out, `rating-card-dark-${tag}.png`) });
      await card.screenshot({ path: path.join(out, `rating-card-dark-${tag}-crop.png`) });
      assert.equal(await card.getByRole('button', { name: 'Submit' }).isDisabled(), true, 'Submit waits for a star');
      await card.getByRole('radio', { name: '4 of 5' }).click();
      await card.screenshot({ path: path.join(out, `rating-card-dark-${tag}-4stars.png`) });
      await card.getByRole('button', { name: 'Submit' }).click();
      await wait(250);
      await card.screenshot({ path: path.join(out, `rating-card-dark-${tag}-thanks.png`) });
      await wait(2500);
      assert.equal(await ui.locator('[data-rating-card]').count(), 0, 'the thanks fades away');
      assert.equal(await ask(ui), 0, 'answered: not asked again');
      report.checks.push(`card shown, rated, thanked and gone at ${tag}%; not asked again`);
      if (scale === 1) {
        await ui.evaluate(() => window.acira.dispatch({ type: 'tab.navigate', url: 'acira://settings' }));
        await wait(1200);
        await ui.getByRole('button', { name: 'Privacy', exact: true }).first().click().catch(() => {});
        await wait(800);
        const show = ui.locator('[data-setting="usage-metrics-payload"]').getByRole('button', { name: 'Show' });
        await show.scrollIntoViewIfNeeded(); await show.click();
        const sent = ui.locator('[data-usage-sent]'); await sent.waitFor();
        const text = await sent.innerText();
        for (const group of ['How you set up Acira', 'Which features you use', 'Your system', 'When you rate a feature']) assert.ok(text.includes(group), group);
        await sent.scrollIntoViewIfNeeded();
        await ui.screenshot({ path: path.join(out, 'whats-sent-settings-dark-100.png') });
        await theme(ui, 'light');
        await ui.screenshot({ path: path.join(out, 'whats-sent-settings-light-100.png') });
        assert.ok(await ui.getByText('Ask me now and then how features are working').count() > 0, 'the rating switch is in Settings');
        report.checks.push('What\'s sent lists all four groups; rating switch present');
      }
    });
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.message || error); }
finally { await fs.writeFile(path.join(out, `result-${stamp}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
if (report.status !== 'passed') process.exit(1);
